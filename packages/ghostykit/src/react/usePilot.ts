// El hook: corre runs AG-UI por el transporte y los reduce al estado del chat. Arma cada
// `RunAgentInput` (hilo, run, mensaje nuevo, contexto, respuestas a aprobaciones) y traduce los
// efectos del reductor a callbacks de la app.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/core";
import {
  beginSend,
  beginSteer,
  createPilotState,
  dropLastExchange,
  lastUserTurn,
  markSubagent,
  prependHistory,
  queueMessage,
  reduceAgUiEvent,
  resolvePermission,
  sendFailed,
  stopTurn,
  subagentsOf,
  takeQueued,
} from "../core/reducer";
import type { Attachment, Decision, HistoryPage, PermissionRequest, PilotState, Reference, SubagentTask, Turn } from "../core/types";
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
  /** El estado del agente cambió (`STATE_SNAPSHOT` / `STATE_DELTA` ya aplicado). */
  onState?: (state: Record<string, unknown>) => void;
  /**
   * Steer: mandar con el run vivo (docs/protocol.md §6). Default: lo que diga el agente en
   * `state.caps.steer`. Sin steer, mandar mientras corre no hace nada.
   */
  steer?: boolean;
  /**
   * Trae los mensajes anteriores a `before` (el cursor de `CUSTOM ghosty.history`), p. ej. del REST de
   * lectura de la app. Las páginas empiezan en un mensaje del usuario.
   */
  loadOlder?: (before: string | undefined) => Promise<{ messages: Message[] } & HistoryPage>;
  /**
   * Lo que viaja en `forwardedProps` de cada run, además de lo del protocolo (`cancel`, `steer`,
   * `stopSubagent`), p. ej. `{permissions: "ask"}` en gs. Una función se evalúa al mandar.
   */
  forwardedProps?: Record<string, unknown> | (() => Record<string, unknown>);
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
  /** Se puede mandar con el run vivo (steer). */
  canSteer: boolean;
  /** Antepone la página anterior del hilo (si hay `loadOlder` y `state.history.hasMoreBefore`). */
  loadOlder: () => Promise<void>;
  loadingOlder: boolean;
  /** Los subagentes del agente (`state.subagents.tasks`), al día con cada STATE_SNAPSHOT/DELTA. */
  subagents: SubagentTask[];
  /** Detiene un subagente (`forwardedProps.stopSubagent`). No toca el run vivo. */
  stopSubagent: (taskId: string) => Promise<void>;
  /**
   * Vuelve a pedir el hilo (POST sin mensaje → snapshot + estado + run vivo). Para cuando la app sabe
   * por fuera que algo cambió (p. ej. el bus `/me/events` avisa que un subagente terminó).
   */
  refresh: () => Promise<void>;
}

/** A la tercera vez que el servidor rechaza un mensaje en espera, se deja de insistir. */
const MAX_QUEUE_TRIES = 3;

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

/** El texto y los adjuntos de vuelta desde el `content` de un mensaje AG-UI del usuario. */
function fromUserMessage(content: unknown): { text: string; attachments: Attachment[] } {
  if (typeof content === "string") return { text: content, attachments: [] };
  const parts = Array.isArray(content) ? (content as { type?: string; text?: string; mimeType?: string; filename?: string; source?: { type?: string; value?: string } }[]) : [];
  const text = parts.filter((p) => p?.type === "text").map((p) => p.text ?? "").join("");
  const attachments = parts
    .filter((p) => p && p.type !== "text" && p.source)
    .map((p) => ({ mimeType: p.mimeType ?? "application/octet-stream", ...(p.filename ? { name: p.filename } : {}), ...(p.source!.type === "url" ? { url: p.source!.value } : { data: p.source!.value }) }));
  return { text, attachments };
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
  /** Cuántas veces se rechazó cada texto en espera (por el id del mensaje con que salió). */
  const queuedTries = useRef(new Map<string, number>());
  const flushRef = useRef<() => void>(() => {});

  /** Lo que lleva todo run: hilo, run nuevo y el contexto de la pantalla en este momento. */
  const baseInput = (): RunAgentInput => {
    const ctx = optsRef.current.context;
    return { threadId, runId: uuid(), messages: [], tools: [], context: toAgUiContext(typeof ctx === "function" ? (ctx as () => unknown)() : ctx), state: {}, forwardedProps: extraProps() };
  };
  const extraProps = (): Record<string, unknown> => {
    const f = optsRef.current.forwardedProps;
    return (typeof f === "function" ? f() : f) ?? {};
  };

  const commit = useCallback((next: PilotState) => {
    if (next === ref.current) return;
    ref.current = next;
    setState(next);
    const o = optsRef.current;
    for (const e of next.effects) {
      if (e.type === "turn-start") o.onTurnStart?.();
      else if (e.type === "turn-done") o.onTurnDone?.({ text: e.text, runId: e.runId, seconds: e.seconds, error: e.error, interrupted: e.interrupted });
      else if (e.type === "title") o.onTitle?.(e.title);
      else if (e.type === "state") o.onState?.(e.state);
    }
  }, []);

  /** Corre un run y reduce sus eventos. Si el stream se corta sin terminar, se reabre el hilo (snapshot). */
  const runNow = useCallback(
    async (partial: Pick<RunAgentInput, "messages"> & Partial<RunAgentInput>, reopening = false): Promise<void> => {
      const t = transportRef.current;
      if (!t) return;
      const input: RunAgentInput = { ...baseInput(), ...partial, forwardedProps: { ...extraProps(), ...partial.forwardedProps } };
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      const steering = typeof input.forwardedProps?.steer === "string";
      const userMsg = input.messages[0] as { content?: unknown } | undefined;
      // El run que se puede detener: el que este cliente arrancó (un steer se suma al que ya corre).
      if (!steering && (input.messages.length || input.resume?.length)) liveRun.current = input.runId;
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
        // Ya hay un run vivo, o aprobaciones sin contestar: el mensaje queda en espera (sale solo al
        // terminar ese run, gs-agui 1 §0.7b-6) y se abre el hilo para seguir el run o ver las tarjetas.
        if ((code === "run_active" || code === "interrupt_pending") && !reopening) {
          if (userMsg) {
            const { text, attachments } = fromUserMessage(userMsg.content);
            const tries = (queuedTries.current.get(input.messages[0].id) ?? 0) + 1;
            if (tries < MAX_QUEUE_TRIES) {
              let s = queueMessage(ref.current, text, attachments, tries);
              // Si no era un steer, el reloj del turno era de este mensaje: todavía no empieza.
              if (!steering) s = { ...s, busy: false, turnStartedAt: 0 };
              commit({ ...s, notice: null });
            } else {
              // Ya se intentó varias veces: la burbuja se queda con el error (y «Reintentar»).
              commit(sendFailed(ref.current, err instanceof Error && err.message ? err.message : "No se pudo mandar el mensaje."));
              return;
            }
          } else commit({ ...ref.current, notice: err instanceof Error ? err.message : null, effects: [] });
          return runNow({ messages: [] }, true);
        }
        // Un steer que no entró no detiene el run: se vuelve a leer el hilo (el snapshot dice si quedó).
        if (steering && !reopening) {
          commit({ ...ref.current, notice: err instanceof Error && err.message ? err.message : null, effects: [] });
          return runNow({ messages: [] }, true);
        }
        commit(sendFailed(ref.current, err instanceof Error && err.message ? err.message : "No se pudo hablar con el agente."));
        return;
      }
      if (c.signal.aborted) return;
      if (ended) {
        // Lo que esperaba a que terminara este run sale ahora.
        if (ref.current.queued.length) setTimeout(() => flushRef.current(), 0);
        return;
      }
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

  const steerOn = () => optsRef.current.steer ?? ((ref.current.agentState.caps as { steer?: unknown } | undefined)?.steer === true);

  const send = useCallback(
    async (text: string, attachments: Attachment[] = [], _extra: SendOptions = {}) => {
      if (!transportRef.current) return;
      if (ref.current.busy) {
        // Steer: el mensaje entra al run que corre (sólo texto).
        const live = liveRun.current ?? ref.current.runId;
        if (!steerOn() || !live || !text.trim() || attachments.length) return;
        commit(beginSteer(ref.current, text));
        await runNow({ messages: [userMessage(text, [])], forwardedProps: { steer: live } });
        return;
      }
      await sendNew(text, attachments);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, runNow],
  );

  /** Un run nuevo con el mensaje. `tries`: cuántas veces ya se rechazó (mensajes en espera). */
  const sendNew = useCallback(
    async (text: string, attachments: Attachment[], tries = 0) => {
      // Mandar un mensaje con tarjetas abiertas las descarta (AG-UI pide cerrarlas en el mismo run).
      const resume = pendingResume();
      answers.current.clear();
      let s = ref.current;
      for (const p of s.permissions) s = resolvePermission(s, p.id, "cancelled");
      commit(beginSend(s, text, attachments));
      const msg = userMessage(text, attachments);
      if (tries) queuedTries.current.set(msg.id, tries);
      try {
        await runNow({ messages: [msg], ...(resume.length ? { resume } : {}) });
      } finally {
        queuedTries.current.delete(msg.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, runNow],
  );

  // Los mensajes en espera salen juntos, como un run normal, cuando ya no hay run ni tarjetas.
  flushRef.current = () => {
    const s = ref.current;
    if (!s.queued.length || s.busy || s.permissions.length || !transportRef.current) return;
    const { state: next, queued } = takeQueued(s);
    commit(next);
    const text = queued.map((q) => q.text).filter(Boolean).join("\n\n");
    const attachments = queued.flatMap((q) => q.attachments ?? []);
    void sendNew(text, attachments, Math.max(...queued.map((q) => q.tries)));
  };

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
    const input = baseInput();
    void t
      .run({ ...input, forwardedProps: { ...input.forwardedProps, cancel: run } }, () => {})
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingRef = useRef(false);
  const loadOlder = useCallback(async () => {
    const fn = optsRef.current.loadOlder;
    const h = ref.current.history;
    if (!fn || !h?.hasMoreBefore || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await fn(h.before);
      // Si mientras tanto llegó otro snapshot que soltó lo anterior, esta página ya no encaja.
      if (ref.current.history !== h) return;
      commit(prependHistory(ref.current, page.messages ?? [], { hasMoreBefore: page.hasMoreBefore === true, ...(page.before ? { before: page.before } : {}) }));
    } catch (err) {
      commit({ ...ref.current, notice: err instanceof Error && err.message ? err.message : null, effects: [] });
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  }, [commit]);

  const stopSubagent = useCallback(
    async (taskId: string) => {
      const t = transportRef.current;
      if (!t) return;
      commit(markSubagent(ref.current, taskId, "stopped"));
      const input = baseInput();
      // Un POST aparte: su respuesta (RUN_STARTED → RUN_FINISHED) no es del run vivo y no se reduce.
      await t.run({ ...input, forwardedProps: { ...input.forwardedProps, stopSubagent: taskId } }, () => {}).catch(() => {});
      // Con el run vivo, el cambio llega como STATE_DELTA; sin él, el estado fresco viene al reabrir.
      if (!ref.current.busy) await runNow({ messages: [] }, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, runNow],
  );

  const refresh = useCallback(() => runNow({ messages: [] }, true), [runNow]);

  const canSteer = Boolean(transport) && (opts.steer ?? ((state.agentState.caps as { steer?: unknown } | undefined)?.steer === true));
  const subagents = useMemo(() => subagentsOf(state.agentState), [state.agentState]);

  return { state, threadId, send, stop, retry, respondPermission, recordDecision, expirePermission, canSteer, loadOlder, loadingOlder, subagents, stopSubagent, refresh };
}
