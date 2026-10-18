// El hook: corre runs AG-UI por el transporte y los reduce al estado del chat. Arma cada
// `RunAgentInput` (hilo, run, mensaje nuevo, contexto, respuestas a aprobaciones) y traduce los
// efectos del reductor a callbacks de la app.
import { useCallback, useEffect, useRef, useState } from "react";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import {
  beginSend,
  createPilotState,
  dropLastExchange,
  lastUserTurn,
  reduceAgUiEvent,
  resolvePermission,
  sendFailed,
  stopTurn,
} from "../core/reducer";
import type { Attachment, Decision, PermissionRequest, PilotState, Reference, Turn } from "../core/types";
import { PilotHttpError, type PilotTransport } from "../transport";

export interface TurnDoneInfo {
  /** El texto final de la respuesta. */
  text: string;
  runId?: string;
  /** Cuánto tardó. */
  seconds?: number;
  /** El run terminó en RUN_ERROR. */
  error?: string;
  /** El run se detuvo a pedir aprobación. */
  interrupted?: boolean;
}

export interface UsePilotOptions {
  /** El hilo (AG-UI `threadId`). Con él, al montar se pide el hilo guardado (MESSAGES_SNAPSHOT). Sin él, hilo nuevo. */
  threadId?: string;
  /** Turnos para pintar de entrada (sin pedirlos al servidor). */
  initialTurns?: Turn[];
  /**
   * Lo que el usuario ve en pantalla: viaja en CADA run como `context` de AG-UI. Un objeto da una
   * entrada por llave (`{description: llave, value: JSON}`); una función se evalúa al mandar.
   */
  context?: unknown | (() => unknown);
  onTurnStart?: () => void;
  /** Fin de turno con su texto: aquí la app re-lee datos, repinta efectos, avisa. */
  onTurnDone?: (info: TurnDoneInfo) => void;
  /** El servidor bautizó el hilo (`CUSTOM ghosty.title`). */
  onTitle?: (title?: string) => void;
  /** Cada evento AG-UI crudo, antes del reductor (analítica, STATE_*, CUSTOM propios). */
  onEvent?: (event: BaseEvent) => void;
  /** Cada run que sale (analítica). */
  onSend?: (input: RunAgentInput) => void;
}

export interface SendOptions {
  references?: Reference[];
}

export interface Pilot {
  state: PilotState;
  threadId: string;
  send: (text: string, attachments?: Attachment[], opts?: SendOptions) => Promise<void>;
  /** Detiene el run: corta la conexión (el servidor corta el run). */
  stop: () => void;
  /** Reintenta el último mensaje. */
  retry: () => void;
  /** Contesta una tarjeta. Cuando ya están contestadas TODAS las abiertas, sale el `resume`. */
  respondPermission: (id: string, approved: boolean) => void;
  /** Anota la decisión bajo la respuesta y retira la tarjeta (tras su sello). */
  recordDecision: (id: string, status: Decision["status"], asked?: PermissionRequest) => void;
  /** Una tarjeta venció sin contestarse: se anota y su interrupt viaja como `cancelled` en el siguiente run. */
  expirePermission: (id: string) => void;
}

const uuid = () => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Respaldo para contextos sin randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

/** El contexto de la app como `context` de AG-UI: `[{description, value}]`, `value` siempre texto. */
export function toAgUiContext(ctx: unknown): RunAgentInput["context"] {
  if (ctx === undefined || ctx === null) return [];
  if (Array.isArray(ctx) && ctx.every((c) => c && typeof c === "object" && "description" in c && "value" in c)) return ctx as RunAgentInput["context"];
  const str = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  if (typeof ctx === "object" && !Array.isArray(ctx)) return Object.entries(ctx as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k, v]) => ({ description: k, value: str(v) }));
  return [{ description: "context", value: str(ctx) }];
}

/** El mensaje del usuario como mensaje AG-UI (texto + adjuntos como partes). */
function userMessage(text: string, attachments: Attachment[]): RunAgentInput["messages"][number] {
  if (!attachments.length) return { id: uuid(), role: "user", content: text };
  const parts: unknown[] = text ? [{ type: "text", text }] : [];
  for (const a of attachments) {
    const type = a.mimeType.startsWith("image/") ? "image" : a.mimeType.startsWith("audio/") ? "audio" : "document";
    parts.push({ type, mimeType: a.mimeType, ...(a.name ? { filename: a.name } : {}), source: a.url ? { type: "url", value: a.url } : { type: "data", value: a.data ?? "", mimeType: a.mimeType } });
  }
  return { id: uuid(), role: "user", content: parts } as RunAgentInput["messages"][number];
}

export function usePilot(transport: PilotTransport | null, opts: UsePilotOptions = {}): Pilot {
  const [state, setState] = useState<PilotState>(() => createPilotState(opts.initialTurns ?? []));
  const ref = useRef(state);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const transportRef = useRef(transport);
  transportRef.current = transport;
  const [threadId] = useState(() => opts.threadId ?? uuid());
  const ctrl = useRef<AbortController | null>(null);
  /** El `runId` del run que este cliente arrancó y sigue vivo (para detenerlo). */
  const liveRun = useRef<string | null>(null);
  /** Respuestas a tarjetas que esperan a las demás (un resume debe cubrirlas todas). */
  const answers = useRef(new Map<string, { status: "resolved" | "cancelled"; payload?: unknown }>());

  const commit = useCallback((next: PilotState) => {
    if (next === ref.current) return;
    ref.current = next;
    setState(next);
    const o = optsRef.current;
    for (const e of next.effects) {
      if (e.type === "turn-start") o.onTurnStart?.();
      else if (e.type === "turn-done") o.onTurnDone?.({ text: e.text, runId: e.runId, seconds: e.seconds, error: e.error, interrupted: e.interrupted });
      else if (e.type === "title") o.onTitle?.(e.title);
    }
  }, []);

  /** Corre un run y reduce sus eventos. Si el stream se corta sin terminar, se reabre el hilo (snapshot). */
  const runNow = useCallback(
    async (partial: Pick<RunAgentInput, "messages"> & Partial<RunAgentInput>, reopening = false): Promise<void> => {
      const t = transportRef.current;
      if (!t) return;
      const ctx = optsRef.current.context;
      const input: RunAgentInput = {
        threadId,
        runId: uuid(),
        tools: [],
        context: toAgUiContext(typeof ctx === "function" ? (ctx as () => unknown)() : ctx),
        state: {},
        forwardedProps: {},
        ...partial,
      };
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      if (input.messages.length || input.resume?.length) liveRun.current = input.runId;
      optsRef.current.onSend?.(input);
      let ended = false;
      try {
        await t.run(
          input,
          (e) => {
            if (c.signal.aborted) return;
            optsRef.current.onEvent?.(e);
            if (e.type === "RUN_FINISHED" || e.type === "RUN_ERROR") {
              ended = true;
              liveRun.current = null;
            }
            commit(reduceAgUiEvent(ref.current, e as never));
          },
          c.signal,
        );
      } catch (err) {
        if (c.signal.aborted) return;
        const code = err instanceof PilotHttpError ? err.code : undefined;
        // Ya hay un run vivo, o aprobaciones sin contestar: se abre el hilo para verlas.
        if ((code === "run_active" || code === "interrupt_pending") && !reopening) {
          commit({ ...ref.current, notice: err instanceof Error ? err.message : null, effects: [] });
          return runNow({ messages: [] }, true);
        }
        commit(sendFailed(ref.current, err instanceof Error && err.message ? err.message : "No se pudo hablar con el agente."));
        return;
      }
      if (ended || c.signal.aborted) return;
      // Se cortó a media respuesta (red, deploy): el hilo vive en el servidor, se pide de nuevo.
      if (!reopening) return runNow({ messages: [] }, true);
      commit(sendFailed(ref.current, "Se cortó la conexión con el agente."));
    },
    [commit, threadId],
  );

  // Abrir un hilo existente: su historia y, si está en pausa, sus tarjetas.
  useEffect(() => {
    if (!transport || !opts.threadId) return;
    void runNow({ messages: [] }, true);
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport]);

  /** Las tarjetas abiertas que el siguiente run debe cerrar (las que se ignoraron o vencieron). */
  const pendingResume = () => [
    ...ref.current.permissions.filter((p) => !answers.current.has(p.id)).map((p) => ({ interruptId: p.id, status: "cancelled" as const })),
    ...[...answers.current.entries()].map(([interruptId, a]) => ({ interruptId, ...a })),
  ];

  const send = useCallback(
    async (text: string, attachments: Attachment[] = [], _extra: SendOptions = {}) => {
      if (!transportRef.current || ref.current.busy) return;
      // Mandar un mensaje con tarjetas abiertas las descarta (AG-UI pide cerrarlas en el mismo run).
      const resume = pendingResume();
      answers.current.clear();
      let s = ref.current;
      for (const p of s.permissions) s = resolvePermission(s, p.id, "cancelled");
      commit(beginSend(s, text, attachments));
      await runNow({ messages: [userMessage(text, attachments)], ...(resume.length ? { resume } : {}) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, runNow],
  );

  const stop = useCallback(() => {
    // Dejar de leer NO detiene el run (desconectarse nunca cancela): se pide explícito.
    // `cancel` es el runId con el que se arrancó el run (docs/protocol.md §6): el que mandó este cliente
    // o, si se enganchó a uno vivo al abrir el hilo, el de su RUN_STARTED.
    const run = liveRun.current ?? (ref.current.busy ? ref.current.runId : null);
    liveRun.current = null;
    ctrl.current?.abort();
    ctrl.current = null;
    commit(stopTurn(ref.current));
    const t = transportRef.current;
    if (!t || !run) return;
    const ctx = optsRef.current.context;
    void t
      .run(
        { threadId, runId: uuid(), messages: [], tools: [], context: toAgUiContext(typeof ctx === "function" ? (ctx as () => unknown)() : ctx), state: {}, forwardedProps: { cancel: run } },
        () => {},
      )
      .catch(() => {});
  }, [commit, threadId]);

  const retry = useCallback(() => {
    const s = ref.current;
    const last = lastUserTurn(s.turns);
    if (!last || s.busy) return;
    commit(dropLastExchange(s));
    void send(last.text, last.attachments ?? []);
  }, [commit, send]);

  const sendAnswersIfComplete = useCallback(() => {
    const open = ref.current.permissions.filter((p) => !answers.current.has(p.id));
    if (open.length || !answers.current.size || ref.current.busy) return;
    const resume = [...answers.current.entries()].map(([interruptId, a]) => ({ interruptId, ...a }));
    answers.current.clear();
    commit(beginSend(ref.current, "", []));
    void runNow({ messages: [], resume });
  }, [commit, runNow]);

  const respondPermission = useCallback(
    (id: string, approved: boolean) => {
      answers.current.set(id, { status: "resolved", payload: { approved } });
      sendAnswersIfComplete();
    },
    [sendAnswersIfComplete],
  );

  const recordDecision = useCallback(
    (id: string, status: Decision["status"], asked?: PermissionRequest) => commit(resolvePermission(ref.current, id, status, asked)),
    [commit],
  );

  const expirePermission = useCallback(
    (id: string) => {
      if (!ref.current.permissions.some((p) => p.id === id)) return;
      // Vencida: viaja como `cancelled` cuando salga el siguiente run (con otra respuesta o un mensaje).
      answers.current.set(id, { status: "cancelled" });
      commit(resolvePermission(ref.current, id, "expired"));
      sendAnswersIfComplete();
    },
    [commit, sendAnswersIfComplete],
  );

  return { state, threadId, send, stop, retry, respondPermission, recordDecision, expirePermission };
}
