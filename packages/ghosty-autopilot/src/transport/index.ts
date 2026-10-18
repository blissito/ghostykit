// ghosty-autopilot/transport — por dónde viaja la conversación. La interfaz es chica a propósito: un stream
// de eventos con nombre, mandar, cancelar y (opcional) modelo y permisos. `createSseTransport` habla
// el contrato de Ghosty Studio (`${base}/events|messages|cancel|model|permission`).
import type { SendInput, SendResult } from "../core/types";
import { PilotHttpError, type PilotListener, type PilotTransport } from "./types";

export * from "./types";
export { createPostStreamTransport, readSse, type PostStreamTransportOptions, type SseMessage } from "./postStream";

/** Los eventos con nombre del contrato. Un evento SSE sin `addEventListener` no se despacha nunca. */
export const SSE_EVENTS = [
  "started", "status", "caps", "models", "chunk", "thought", "tool", "artifact", "usage", "title",
  "done", "error", "warning", "reemplazo", "permission", "permission-resolved", "closed",
  "page-plan", "section-building", "section-update", "section", "page-ready", "page-error",
  "page-planning", "page-drop", "review", "page-version", "page-edit",
  // Los de un servidor de turnos durables (EasyBits): re-enganche, sin turno, cortado, sin lugar.
  "snapshot", "idle", "interrupted", "capacity",
] as const;

/** Los que cuentan como señal de vida de la conexión (los mismos que en `useAcpStream`). */
const LIFE_EVENTS = new Set([
  "started", "status", "chunk", "thought", "tool", "artifact", "usage", "done", "error", "warning",
  "reemplazo", "permission", "page-plan", "section-building", "section-update", "section",
  "page-ready", "page-error", "page-planning", "page-drop", "review", "page-version", "page-edit",
  "snapshot", "idle", "interrupted", "capacity",
]);

/**
 * Tope de silencio del cliente, la red de seguridad: pasado esto SIN NINGÚN evento —ni el `status`
 * que el servidor manda cada 25 s con turno vivo— la conexión está muerta aunque el navegador no lo
 * note. No se da el turno por perdido: se reconecta y el servidor dice la verdad. ≥ el silencio
 * máximo del servidor (10 min) para no adelantarse nunca a él si no manda latido.
 */
export const SILENCE_MAX_MS = 11 * 60_000;
/** Con latido anunciado, basta con perder unos cuantos para saber que la conexión murió. */
export const MISSED_BEATS = 4;
/** Piso del tope con latido: un latido muy corto no debe reconectar a lo loco. */
export const MIN_SILENCE_MS = 90_000;

export interface SseTransportOptions {
  /** Para mandar cabeceras propias (auth) en los POST. */
  fetch?: typeof fetch;
  /** Cookies en un stream de otro origen (widget embebido). */
  withCredentials?: boolean;
  /** Para pruebas o entornos sin `EventSource` global. */
  EventSource?: typeof EventSource;
  /** Eventos extra a escuchar (además de `SSE_EVENTS`). */
  events?: string[];
  /** Cada cuánto se revisa el silencio. */
  checkEveryMs?: number;
  /** Reloj inyectable (pruebas). */
  now?: () => number;
}

function parse(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** El transporte SSE de Ghosty: `GET ${base}/events` (stream) y POST a `messages|cancel|model|permission`. */
export function createSseTransport(base: string, opts: SseTransportOptions = {}): PilotTransport {
  const doFetch = (...args: Parameters<typeof fetch>) => (opts.fetch ?? fetch)(...args);
  const now = opts.now ?? Date.now;
  const root = base.replace(/\/+$/, "");
  /** Cuándo llegó el último evento con vida; lo comparten el stream y `send`. */
  let lastEventAt = now();

  const post = (path: string, body?: unknown) =>
    doFetch(`${root}/${path}`, {
      method: "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: opts.withCredentials ? "include" : undefined,
    });

  return {
    subscribe(listener, sub = {}) {
      const ES = opts.EventSource ?? (globalThis as { EventSource?: typeof EventSource }).EventSource;
      if (!ES) throw new Error("ghosty-autopilot: no hay EventSource en este entorno (pasa `EventSource` en las opciones)");
      let es: EventSource | null = null;
      let heartbeatMs: number | null = null;
      let closed = false;

      const open = () => {
        const source = new ES(`${root}/events`, { withCredentials: Boolean(opts.withCredentials) });
        es = source;
        const names = new Set<string>([...SSE_EVENTS, ...(opts.events ?? [])]);
        for (const name of names) {
          source.addEventListener(name, (e) => {
            if (es !== source) return; // una conexión vieja que se reemplazó
            if (LIFE_EVENTS.has(name)) lastEventAt = now();
            const raw = (e as MessageEvent).data;
            // El `error` NATIVO del EventSource (se cayó la red) no trae data: el navegador
            // reintenta solo y el servidor contesta qué pasó. Sólo el `error` del servidor se pinta.
            if (name === "error" && (raw === undefined || raw === "")) return;
            const data = parse(raw);
            if (name === "started") {
              const d = data as { latidoMs?: unknown } | null;
              heartbeatMs = typeof d?.latidoMs === "number" && d.latidoMs > 0 ? d.latidoMs : null;
            }
            listener(name, data);
            if (name === "closed") source.close();
          });
        }
      };
      open();

      // La red de seguridad: un turno en vuelo sin NINGÚN evento en mucho rato. No se declara muerto
      // aquí: se reabre el stream y el servidor contesta (sigue → `status`; terminó → `done`; se
      // cortó → `done{interrumpido}`).
      const timer = setInterval(() => {
        if (closed || !sub.isBusy?.()) return;
        const cap = heartbeatMs ? Math.max(heartbeatMs * MISSED_BEATS, MIN_SILENCE_MS) : SILENCE_MAX_MS;
        if (now() - lastEventAt < cap) return;
        lastEventAt = now();
        es?.close();
        open();
      }, opts.checkEveryMs ?? 15_000);

      return () => {
        closed = true;
        clearInterval(timer);
        es?.close();
        es = null;
      };
    },

    async send(input) {
      lastEventAt = now();
      const res = await post("messages", {
        content: input.text,
        images: input.attachments,
        // Lo que hace que el hilo se BAUTICE al cerrar este turno.
        primerTurno: input.firstTurn,
        ...(input.resume ? { retomar: true } : {}),
        ...(input.context !== undefined ? { context: input.context } : {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new PilotHttpError(text || `Error ${res.status}`, res.status, Boolean(res.headers.get("X-Needs-Login")));
      }
      const r = (await res.json().catch(() => ({}))) as { inyectado?: boolean; estado?: string; turnId?: string };
      return { injected: r.inyectado, state: r.estado, turnId: r.turnId };
    },

    async cancel() {
      await post("cancel").catch(() => {});
    },

    async setModel(value) {
      await post("model", { value });
    },

    async respondPermission(id, optionId) {
      const res = await post("permission", { id, optionId });
      const r = (await res.json().catch(() => ({}))) as { resuelto?: boolean; resolved?: boolean };
      return { resolved: Boolean(r.resuelto ?? r.resolved) };
    },
  };
}
