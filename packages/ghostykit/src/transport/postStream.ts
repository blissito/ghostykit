// El otro estilo de servidor: el POST que encarga el turno DEVUELVE el stream (EasyBits, la mayoría
// de los chats con fetch). Para re-engancharse a un turno vivo (recarga, red caída, deploy) hay un
// GET de «attach» que manda el estado (`snapshot`, permisos abiertos) y sigue en vivo.
//
// Contrato por default (EasyBits `/api/v2/admin/copilot/chat`):
//   POST {url} {text, context?, turnId, continueTurnId?} → SSE: started, chunk, tool, permission,
//        done{turnId,text}, error, capacity, interrupted, idle. 409 turn_busy · 503 draining (se
//        reintenta con el MISMO turnId).
//   GET  {url}?attach=1 → started, un `permission` por tarjeta abierta, snapshot, y en vivo.
//   GET  {url} → { messages:[{role,text}], pending, activeTurn, lastTurn }  (historial)
import type { SendInput, SendResult, Turn } from "../core/types";
import { PilotHttpError, type PilotListener, type PilotTransport, type SubscribeOptions } from "./types";

/** Un evento SSE ya separado: nombre + data crudo. */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Lee un stream SSE (`text/event-stream`) de un `fetch`. Llama `onMessage` por cada evento con
 * nombre y `onBytes` con CUALQUIER cosa que llegue (los comentarios `: ka` cuentan como vida).
 */
export async function readSse(body: ReadableStream<Uint8Array>, onMessage: (m: SseMessage) => void, onBytes?: () => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  const flush = () => {
    if (data.length) onMessage({ event, data: data.join("\n") });
    event = "message";
    data = [];
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    onBytes?.();
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + (buffer[nl] === "\r" && buffer[nl + 1] === "\n" ? 2 : 1));
      if (line === "") flush();
      else if (line.startsWith(":")) continue;
      else {
        const i = line.indexOf(":");
        const field = i < 0 ? line : line.slice(0, i);
        const val = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
        if (field === "event") event = val;
        else if (field === "data") data.push(val);
      }
    }
  }
  flush();
}

export interface PostStreamTransportOptions {
  fetch?: typeof fetch;
  /** Default `same-origin` (la cookie de sesión viaja; EasyBits rechaza cualquier Bearer). */
  credentials?: RequestCredentials;
  /** Cuerpo del POST. Default: el contrato de EasyBits. */
  body?: (input: SendInput & { turnId: string }) => unknown;
  /** URL del re-enganche. Default `${url}?attach=1`; `null` = sin re-enganche. */
  attachUrl?: string | null;
  /** URL del historial (JSON). Default `url`; `null` = sin historial. */
  historyUrl?: string | null;
  /** Cómo leer el historial. Default: `{messages:[{role:"user"|"agent",text}]}`. */
  parseHistory?: (json: unknown) => Turn[];
  /** URL para cancelar (POST). Sin ella, «detener» sólo deja de escuchar: el turno sigue en el servidor. */
  cancelUrl?: string;
  /** Silencio (sin un solo byte, ni `: ka`) tras el que la conexión se da por muerta. Default 60 s. */
  silenceMs?: number;
  /** Reintentos de un 503 (deploy) o de un re-enganche. Default 6. */
  retries?: number;
  newTurnId?: () => string;
  /** Reloj y espera inyectables (pruebas). */
  sleep?: (ms: number) => Promise<void>;
}

const TERMINAL = new Set(["done", "capacity", "interrupted", "idle"]);

function parse(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function defaultHistory(json: unknown): Turn[] {
  const msgs = (json as { messages?: { role?: string; text?: string }[] } | null)?.messages ?? [];
  return msgs
    .filter((m) => typeof m.text === "string")
    .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), text: m.text! }));
}

function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * El transporte de «POST que devuelve el stream». Cada turno es su propio stream; si se corta sin
 * evento final (red, deploy), se re-engancha con el GET de attach y el servidor dice la verdad
 * (`snapshot` y sigue, o el evento final, o `idle`).
 */
export function createPostStreamTransport(
  target: string | (PostStreamTransportOptions & { url: string }),
  options: PostStreamTransportOptions = {},
): PilotTransport {
  const url = typeof target === "string" ? target : target.url;
  const opts: PostStreamTransportOptions = typeof target === "string" ? options : { ...target, ...options };
  const doFetch = (...a: Parameters<typeof fetch>) => (opts.fetch ?? fetch)(...a);
  const credentials = opts.credentials ?? "same-origin";
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = opts.retries ?? 6;
  const silenceMs = opts.silenceMs ?? 60_000;
  const attachUrl = opts.attachUrl === undefined ? `${url}${url.includes("?") ? "&" : "?"}attach=1` : opts.attachUrl;
  const historyUrl = opts.historyUrl === undefined ? url : opts.historyUrl;
  const buildBody =
    opts.body ??
    ((i: SendInput & { turnId: string }) => ({
      text: i.text,
      ...(i.context !== undefined ? { context: i.context } : {}),
      turnId: i.turnId,
      ...(i.resume && i.resumeTurnId ? { continueTurnId: i.resumeTurnId } : {}),
    }));

  let listener: PilotListener | null = null;
  let isBusy: () => boolean = () => false;
  let closed = false;
  /** El stream que se está leyendo (POST o attach): se aborta al detener o al reemplazarlo. */
  let current: AbortController | null = null;

  const emit = (name: string, data: unknown) => listener?.(name, data);

  /**
   * Lee un stream hasta su evento final. Regresa `true` si terminó como debe; `false` si se cortó
   * a medias (y hay que re-engancharse).
   */
  async function consume(res: Response, ctrl: AbortController): Promise<boolean> {
    if (!res.body) return false;
    let terminal = false;
    let errored = false;
    let lastByte = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastByte > silenceMs) ctrl.abort();
    }, Math.min(15_000, silenceMs));
    try {
      await readSse(
        res.body,
        ({ event, data }) => {
          if (ctrl.signal.aborted) return;
          const d = parse(data);
          emit(event, d);
          if (event === "error") errored = true;
          if (TERMINAL.has(event)) terminal = true;
        },
        () => {
          lastByte = Date.now();
        },
      );
    } catch {
      // abortado o red caída
    } finally {
      clearInterval(watchdog);
    }
    // En este contrato `error` es final y no le sigue un `done`: se cierra el turno aquí.
    if (errored && !terminal) {
      emit("done", {});
      return true;
    }
    return terminal;
  }

  /** Re-engancharse al turno vivo (o enterarse de cómo terminó). */
  async function attach(): Promise<void> {
    if (!attachUrl) return;
    for (let attempt = 0; attempt <= retries && !closed; attempt++) {
      const ctrl = new AbortController();
      current?.abort();
      current = ctrl;
      try {
        const res = await doFetch(attachUrl, { credentials, headers: { accept: "text/event-stream" }, signal: ctrl.signal });
        if (res.ok && (await consume(res, ctrl))) return;
        if (ctrl.signal.aborted && current !== ctrl) return; // lo reemplazó otro stream
      } catch {
        if (current !== ctrl) return;
      }
      // Sin turno en vuelo no vale la pena insistir: al siguiente mensaje se abre otro stream.
      if (!isBusy()) return;
      await sleep(Math.min(1000 * 2 ** attempt, 10_000));
    }
  }

  return {
    // Sin steer: con un turno corriendo el servidor contesta 409. El composer no deja mandar.
    steer: false,

    subscribe(l, sub: SubscribeOptions = {}) {
      listener = l;
      isBusy = sub.isBusy ?? (() => false);
      closed = false;
      void attach();
      return () => {
        closed = true;
        listener = null;
        current?.abort();
        current = null;
      };
    },

    async history() {
      if (!historyUrl) return [];
      const res = await doFetch(historyUrl, { credentials, headers: { accept: "application/json" } });
      if (!res.ok) return [];
      return (opts.parseHistory ?? defaultHistory)(await res.json().catch(() => null));
    },

    async send(input: SendInput): Promise<SendResult> {
      const turnId = (opts.newTurnId ?? uuid)();
      const body = JSON.stringify(buildBody({ ...input, turnId }));
      for (let attempt = 0; ; attempt++) {
        const ctrl = new AbortController();
        current?.abort();
        current = ctrl;
        const res = await doFetch(url, {
          method: "POST",
          credentials,
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body,
          signal: ctrl.signal,
        });
        // Deploy en curso: la instancia vieja ya no acepta turnos. Mismo turnId → no se duplica.
        if (res.status === 503 && attempt < retries) {
          await sleep(Number(res.headers.get("Retry-After")) * 1000 || 3000);
          continue;
        }
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
          const err = new PilotHttpError(json?.message ?? json?.error ?? `Error ${res.status}`, res.status, res.headers.get("X-Needs-Login") != null);
          if (json?.error) err.code = json.error;
          // Ya hay un turno corriendo (otra pestaña, el teléfono): se re-engancha a ÉL en vez de
          // quedarse con un error. El mensaje de este cliente no entró.
          if (res.status === 409 && json?.error === "turn_busy") void attach();
          throw err;
        }
        // El stream se lee aparte: `send` regresa en cuanto el servidor aceptó el turno.
        void consume(res, ctrl).then((ok) => {
          if (!ok && current === ctrl && !closed) void attach();
        });
        return { turnId, state: "running" };
      }
    },

    async cancel() {
      if (opts.cancelUrl) await doFetch(opts.cancelUrl, { method: "POST", credentials }).catch(() => {});
      current?.abort();
      current = null;
    },
  };
}
