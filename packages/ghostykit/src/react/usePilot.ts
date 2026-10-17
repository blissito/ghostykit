// El hook: conecta un transporte al reductor puro y traduce los efectos a callbacks de la app.
// Reemplaza lo que en Ghosty eran `revalidate()` y los eventos `gs:*` de `window`.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RESUME_TEXT,
  appendAgentMessages,
  beginSend,
  createPilotState,
  dropLastExchange,
  lastUserTurn,
  reconcileWith,
  reducePilotEvent,
  resumeMode,
  sendAccepted,
  sendFailed,
  stopTurn,
} from "../core/reducer";
import type { Attachment, Interrupted, PilotState, Reference, SendInput, Turn } from "../core/types";
import { createSseTransport, type PilotTransport, type SseTransportOptions } from "../transport";

export interface TurnDoneInfo {
  /** El texto final de la respuesta. */
  text: string;
  turnId?: string;
  /** Cuánto tardó (sólo si lo encargó este cliente). */
  seconds?: number;
  /** Se cortó por falla del servidor (el chat ofrece Retomar). */
  interrupted?: Interrupted;
}

export interface UsePilotOptions {
  /** El hilo guardado. Si cambia (la app volvió a leerlo), se reconcilia en reposo. */
  initialTurns?: Turn[];
  /** Lo que el usuario ve en pantalla: viaja con CADA turno. Una función se evalúa al mandar. */
  context?: unknown | (() => unknown);
  onTurnStart?: () => void;
  /** Fin de turno con su texto: aquí la app re-lee datos, repinta efectos, avisa. */
  onTurnDone?: (info: TurnDoneInfo) => void;
  /** El servidor bautizó el hilo. */
  onTitle?: (title?: string) => void;
  /** El servidor pide cuenta (cupo sin cuenta agotado). */
  onNeedsLogin?: () => void;
  /** El stream se cerró (el hilo sigue en el servidor y se puede reabrir). */
  onDisconnected?: () => void;
  /** Cada evento crudo, antes del reductor (analítica, efectos propios). */
  onEvent?: (name: string, data: unknown) => void;
  /** Cada mensaje que sale (analítica: «primer mensaje»). */
  onSend?: (input: SendInput) => void;
}

export interface SendOptions {
  resume?: boolean;
  references?: Reference[];
}

export interface Pilot {
  state: PilotState;
  send: (text: string, attachments?: Attachment[], opts?: SendOptions) => Promise<void>;
  stop: () => void;
  /** Reintenta el último mensaje (quita la respuesta anterior). */
  retry: () => void;
  /** Turno PERDIDO (no arrancó): se abandona y se reenvía. */
  abandonAndRetry: () => void;
  /** «Retomar» un turno cortado por el servidor. */
  resume: () => void;
  setModel: (value: string) => void;
  respondPermission: (id: string, optionId: string) => Promise<{ resolved: boolean }>;
  /** Un mensaje del agente que llegó fuera de un turno: espera a que cierre el turno vivo. */
  appendAgentMessage: (text: string) => void;
}

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function usePilot(transport: PilotTransport | null, opts: UsePilotOptions = {}): Pilot {
  const [state, setState] = useState<PilotState>(() => createPilotState(opts.initialTurns ?? []));
  const ref = useRef(state);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const transportRef = useRef(transport);
  transportRef.current = transport;
  /** Mensajes del agente que llegaron con un turno vivo: se pintan al cerrarlo. */
  const pendingWakes = useRef<string[]>([]);

  const commit = useCallback((next: PilotState) => {
    const prev = ref.current;
    if (next === prev) return;
    ref.current = next;
    setState(next);
    const o = optsRef.current;
    for (const e of next.effects) {
      if (e.type === "turn-start") o.onTurnStart?.();
      else if (e.type === "turn-done") o.onTurnDone?.({ text: e.text, turnId: e.turnId, seconds: e.seconds });
      else if (e.type === "turn-interrupted") {
        const last = next.turns[next.turns.length - 1];
        o.onTurnDone?.({ text: last?.role === "assistant" ? last.text : "", turnId: e.turnId, interrupted: { reason: e.reason, turnId: e.turnId } });
      } else if (e.type === "needs-login") o.onNeedsLogin?.();
      else if (e.type === "title") o.onTitle?.(e.title);
      else if (e.type === "disconnected") o.onDisconnected?.();
    }
    // El remate que esperaba a que cerrara el turno: va debajo de la respuesta, como en el hilo guardado.
    if (prev.busy && !next.busy && pendingWakes.current.length) {
      const texts = pendingWakes.current.splice(0);
      const after = appendAgentMessages(ref.current, texts);
      ref.current = after;
      setState(after);
    }
  }, []);

  useEffect(() => {
    if (!transport) return;
    return transport.subscribe(
      (name, data) => {
        optsRef.current.onEvent?.(name, data);
        commit(reducePilotEvent(ref.current, name, data));
      },
      { isBusy: () => ref.current.busy },
    );
  }, [transport, commit]);

  // La copia del hilo cambió: trae los mensajes que se mandaron desde OTRO cliente. Sólo en reposo.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (opts.initialTurns) commit(reconcileWith(ref.current, opts.initialTurns));
  }, [opts.initialTurns, commit]);

  const send = useCallback(
    async (text: string, attachments: Attachment[] = [], extra: SendOptions = {}) => {
      const t = transportRef.current;
      if (!t) return;
      const s0 = ref.current;
      const inFlight = s0.busy;
      const ctx = optsRef.current.context;
      const input: SendInput = {
        text,
        attachments,
        firstTurn: s0.turns.length === 0,
        ...(extra.resume ? { resume: true } : {}),
        ...(extra.references?.length ? { references: extra.references } : {}),
        ...(ctx !== undefined ? { context: typeof ctx === "function" ? (ctx as () => unknown)() : ctx } : {}),
      };
      commit(beginSend(s0, text, attachments));
      optsRef.current.onSend?.(input);
      try {
        const r = await t.send(input);
        commit(sendAccepted(ref.current, r, inFlight));
      } catch (e) {
        commit(sendFailed(ref.current, message(e, "No se pudo mandar el mensaje"), Boolean((e as { needsLogin?: boolean })?.needsLogin)));
      }
    },
    [commit],
  );

  const stop = useCallback(() => {
    commit(stopTurn(ref.current));
    void transportRef.current?.cancel();
  }, [commit]);

  const retry = useCallback(() => {
    const s = ref.current;
    const last = lastUserTurn(s.turns);
    if (!last || s.busy) return;
    commit(dropLastExchange(s));
    void send(last.text, last.attachments ?? []);
  }, [commit, send]);

  const abandonAndRetry = useCallback(() => {
    const s = ref.current;
    const last = lastUserTurn(s.turns);
    if (!last) return;
    commit({ ...dropLastExchange(s), busy: false });
    void send(last.text, last.attachments ?? []);
  }, [commit, send]);

  const resume = useCallback(() => {
    const s = ref.current;
    if (s.busy) return;
    commit({ ...s, interrupted: null, effects: [] });
    if (resumeMode(s.turns) === "resend") abandonAndRetry();
    else void send(RESUME_TEXT, [], { resume: true });
  }, [commit, send, abandonAndRetry]);

  const setModel = useCallback(
    (value: string) => {
      // Optimista: el stream confirma el valor real cuando el agente responde.
      commit({ ...ref.current, currentModel: value, effects: [] });
      void transportRef.current?.setModel?.(value);
    },
    [commit],
  );

  const respondPermission = useCallback(
    async (id: string, optionId: string) => {
      const t = transportRef.current;
      if (!t?.respondPermission) throw new Error("ghostykit: el transporte no sabe contestar permisos (pasa `onPermission`)");
      const r = await t.respondPermission(id, optionId);
      // Contestado o vencido, la tarjeta ya no tiene nada que pedir (el stream también lo retira).
      commit({ ...ref.current, permissions: ref.current.permissions.filter((p) => p.id !== id), effects: [] });
      return r;
    },
    [commit],
  );

  const appendAgentMessage = useCallback(
    (text: string) => {
      if (ref.current.busy) {
        pendingWakes.current.push(text);
        return;
      }
      commit(appendAgentMessages(ref.current, [text]));
    },
    [commit],
  );

  return { state, send, stop, retry, abandonAndRetry, resume, setModel, respondPermission, appendAgentMessage };
}

/** Un transporte SSE estable por `base` (crearlo en cada render reabriría el stream). */
export function useSseTransport(base: string | null | undefined, opts?: SseTransportOptions): PilotTransport | null {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (base ? createSseTransport(base, optsRef.current) : null), [base]);
}
