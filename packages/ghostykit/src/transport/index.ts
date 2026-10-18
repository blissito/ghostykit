// ghostykit/transport — el ÚNICO transporte: AG-UI sobre HTTP. Un `POST <url>` con
// `RunAgentInput` que contesta SSE de eventos AG-UI (ver docs/protocol.md). Nada más: cancelar es
// abortar la petición; reconectar es otro POST sin mensaje nuevo (el servidor manda MESSAGES_SNAPSHOT).
//
// No se usa `HttpAgent` de `@ag-ui/client` a propósito: arrastra rxjs y su propio estado de mensajes, y
// aquí el estado vive en el reductor de Piloto. Los TIPOS sí son los de `@ag-ui/core`.
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";

export interface PilotTransport {
  /**
   * Corre un run: manda `input`, entrega cada evento AG-UI a `onEvent` en orden y se resuelve cuando el
   * servidor cierra el stream. Rechaza con `PilotHttpError` si el servidor dice que no antes de empezar.
   */
  run(input: RunAgentInput, onEvent: (event: BaseEvent) => void, signal?: AbortSignal): Promise<void>;
}

/** El servidor rechazó el run antes de empezar (§6 de docs/protocol.md). */
export class PilotHttpError extends Error {
  status: number;
  /** El `error` del cuerpo: `run_active`, `interrupt_pending`, `bad_request`… */
  code?: string;
  /** Segundos de `Retry-After` (429/503). */
  retryAfter?: number;
  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = "PilotHttpError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export interface AgUiTransportOptions {
  /** El endpoint del agente: `POST <url>`. */
  url: string;
  /** Cabeceras propias (auth por token). */
  headers?: Record<string, string>;
  /** Default `same-origin`: la cookie de sesión viaja sola. */
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
  /** Reintentos de un 503 (deploy) con el MISMO run. Default 6. */
  retries?: number;
  /** Espera inyectable (pruebas). */
  sleep?: (ms: number) => Promise<void>;
}

/** Un evento SSE ya separado: nombre + data crudo. */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Lee un stream SSE (`text/event-stream`) de un `fetch`. Los comentarios (`: ping`) se ignoran; un
 * evento puede llegar partido en varios pedazos de red.
 */
export async function readSse(body: ReadableStream<Uint8Array>, onMessage: (m: SseMessage) => void): Promise<void> {
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

/** El transporte AG-UI sobre HTTP (SSE). */
export function createAgUiTransport(opts: AgUiTransportOptions): PilotTransport {
  const doFetch = (...a: Parameters<typeof fetch>) => (opts.fetch ?? fetch)(...a);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = opts.retries ?? 6;
  return {
    async run(input, onEvent, signal) {
      const body = JSON.stringify(input);
      for (let attempt = 0; ; attempt++) {
        const res = await doFetch(opts.url, {
          method: "POST",
          credentials: opts.credentials ?? "same-origin",
          headers: { "content-type": "application/json", accept: "text/event-stream", ...opts.headers },
          body,
          signal,
        });
        const retryAfter = Number(res.headers.get("Retry-After")) || undefined;
        // Deploy en curso: el mismo run (mismo runId) en un momento.
        if (res.status === 503 && attempt < retries) {
          await sleep((retryAfter ?? 3) * 1000);
          continue;
        }
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
          throw new PilotHttpError(json?.message ?? json?.error ?? `Error ${res.status}`, res.status, json?.error, retryAfter);
        }
        if (!res.body) return;
        // La hora del servidor (header `Date`; en otro origen hace falta `Access-Control-Expose-Headers:
        // Date`): a los eventos que no traen `timestamp` se les pone la del servidor, para que la cuenta
        // regresiva de una aprobación no dependa del reloj de este navegador.
        const serverDate = Date.parse(res.headers.get("date") ?? "");
        const skew = Number.isNaN(serverDate) ? null : serverDate - Date.now();
        await readSse(res.body, ({ data }) => {
          if (!data) return;
          try {
            const event = JSON.parse(data) as BaseEvent;
            if (skew !== null && typeof event.timestamp !== "number") event.timestamp = Date.now() + skew;
            onEvent(event);
          } catch {
            // Un evento que no es JSON no es AG-UI: se ignora.
          }
        });
        return;
      }
    },
  };
}
