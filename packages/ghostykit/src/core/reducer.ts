// El estado del chat como reductor PURO sobre eventos AG-UI: entra un evento, sale un estado nuevo.
// Un turno del asistente es todo lo que el agente dice y hace entre dos mensajes del usuario: su texto
// (varios TEXT_MESSAGE seguidos), sus pasos (TOOL_CALL_*) y, si se detiene, sus aprobaciones.
//
// MESSAGES_SNAPSHOT manda: el servidor guarda el hilo, así que al abrirlo, al reconectar o al cerrar
// un run, el snapshot REEMPLAZA lo que se armó en vivo (conservando lo que sólo se ve en vivo:
// segundos, uso, decisiones y pensamiento).
import type { Interrupt, Message } from "@ag-ui/core";
import { applyJsonPatch, type PatchOp } from "./jsonPatch";
import type { Attachment, CustomEntry, Decision, HistoryPage, PermissionOption, PermissionRequest, PilotEffect, PilotState, ToolEntry, Turn } from "./types";

export function createPilotState(turns: Turn[] = []): PilotState {
  return {
    turns,
    busy: false,
    error: null,
    notice: null,
    usage: null,
    permissions: [],
    turnStartedAt: 0,
    runId: null,
    agentState: {},
    step: null,
    history: null,
    olderCount: 0,
    effects: [],
  };
}

/** Los `CUSTOM` que son fontanería del protocolo, no contenido del turno. */
const PROTOCOL_CUSTOM = new Set(["ghosty.title", "ghosty.injected", "ghosty.history"]);

type Ev = { type: string; [k: string]: any };

/** El turno del asistente en curso (si el último es del usuario, se abre uno). */
function patchAssistant(s: PilotState, patch: (t: Turn) => Turn): PilotState {
  const turns = [...s.turns];
  const last = turns[turns.length - 1];
  if (last?.role === "assistant") turns[turns.length - 1] = patch(last);
  else turns.push(patch({ role: "assistant", text: "" }));
  return { ...s, turns };
}

/** Los argumentos de una tool en corto, para el renglón del paso: «job: purge-notifications». */
export function argsDetail(json?: string): string | undefined {
  if (!json) return undefined;
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object") return String(v);
    const parts = Object.entries(v)
      .filter(([, x]) => x !== null && x !== undefined && x !== "")
      .map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : String(x)}`);
    const s = parts.join(", ");
    return s ? (s.length > 80 ? `${s.slice(0, 79)}…` : s) : undefined;
  } catch {
    return undefined;
  }
}

function upsertTool(s: PilotState, id: string, patch: Partial<ToolEntry>): PilotState {
  return patchAssistant(s, (t) => {
    const tools = [...(t.tools ?? [])];
    const i = tools.findIndex((x) => x.id === id);
    let cuts = t.cuts;
    if (i === -1) {
      tools.push({ id, ...patch });
      // Lo que el agente dijo ANTES de esta herramienta es narración («Reviso tus crons.»).
      const len = t.text.length;
      if (t.text.trim() && cuts?.[cuts.length - 1] !== len) cuts = [...(cuts ?? []), len];
    } else tools[i] = { ...tools[i], ...patch };
    return { ...t, tools, cuts };
  });
}

const APPROVE: PermissionOption = { optionId: "approve", name: "Aprobar", kind: "allow_once" };
const REJECT: PermissionOption = { optionId: "reject", name: "Rechazar", kind: "reject_once" };

/** Un `Interrupt` de AG-UI como tarjeta: título, herramienta (por su toolCallId) y vencimiento. */
export function toPermission(i: Interrupt, turns: Turn[], clockOffset = 0): PermissionRequest {
  const meta = (i.metadata ?? {}) as Record<string, unknown>;
  const toolName =
    (typeof meta.tool === "string" ? meta.tool : undefined) ??
    turns.flatMap((t) => t.tools ?? []).find((x) => x.id === i.toolCallId)?.title;
  return {
    id: i.id,
    title: i.message ?? (toolName ? `${toolName}` : i.reason),
    ...(toolName ? { tool: toolName } : {}),
    ...(i.toolCallId ? { toolCallId: i.toolCallId } : {}),
    reason: i.reason,
    options: [REJECT, APPROVE],
    ...(i.expiresAt ? { expiresAt: i.expiresAt, deadline: expiryMs(i.expiresAt) + clockOffset } : {}),
  };
}

/** Los pasos que seguían abiertos cuando el run se cortó: ya no corren (ni giran ni dicen «…ando»). */
function closeOpenTools(turns: Turn[], status: "cancelled" | "failed"): Turn[] {
  return turns.map((t) =>
    t.tools?.some((x) => x.status === "in_progress") ? { ...t, tools: t.tools.map((x) => (x.status === "in_progress" ? { ...x, status } : x)) } : t,
  );
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? ((p as { text?: string }).text ?? "") : "")).join("");
  return "";
}

function attachmentsOf(content: unknown): Attachment[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const out: Attachment[] = [];
  for (const p of content as { type?: string; mimeType?: string; source?: { type?: string; value?: string; mimeType?: string }; filename?: string }[]) {
    if (!p || p.type === "text" || !p.source) continue;
    const mime = p.mimeType ?? p.source.mimeType ?? (p.type === "image" ? "image/*" : "application/octet-stream");
    out.push(p.source.type === "data" ? { mimeType: mime, data: p.source.value, name: p.filename } : { mimeType: mime, url: p.source.value, name: p.filename });
  }
  return out.length ? out : undefined;
}

/**
 * El hilo guardado (mensajes AG-UI) como turnos: cada mensaje del usuario abre uno; lo que sigue del
 * asistente y de las herramientas se junta en un turno, con sus pasos y su narración.
 */
export function messagesToTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  const assistant = (id?: string) => {
    if (!cur) {
      cur = { ...(id ? { id } : {}), role: "assistant", text: "" };
      turns.push(cur);
    }
    return cur;
  };
  for (const m of messages) {
    if (m.role === "user") {
      cur = null;
      turns.push({ ...(m.id ? { id: m.id } : {}), role: "user", text: textOf(m.content), ...(attachmentsOf(m.content) ? { attachments: attachmentsOf(m.content) } : {}) });
    } else if (m.role === "assistant") {
      const t = assistant();
      if (!t.id && m.id) t.id = m.id;
      // Lo que el turno entregó (`CUSTOM ghosty.delivery`…) viaja en el campo `custom` del mensaje.
      const custom = (m as { custom?: CustomEntry[] }).custom;
      if (Array.isArray(custom) && custom.length) t.custom = [...(t.custom ?? []), ...custom.filter((c) => c && typeof c.name === "string")];
      const text = m.content ?? "";
      if (text) t.text = t.text ? `${t.text}\n\n${text}` : text;
      for (const c of m.toolCalls ?? []) {
        t.tools = [...(t.tools ?? []), { id: c.id, title: c.function.name, status: "pending", args: c.function.arguments, detail: argsDetail(c.function.arguments) }];
        if (t.text.trim() && t.cuts?.[t.cuts.length - 1] !== t.text.length) t.cuts = [...(t.cuts ?? []), t.text.length];
      }
    } else if (m.role === "tool") {
      const t = assistant(m.id);
      const failed = Boolean((m as { error?: string }).error);
      t.tools = (t.tools ?? []).map((x) => (x.id === m.toolCallId ? { ...x, status: failed ? "failed" : "completed" } : x));
    } else if (m.role === "reasoning") {
      const t = assistant(m.id);
      t.thought = (t.thought ?? "") + textOf((m as { content?: unknown }).content);
    }
  }
  return turns;
}

/**
 * El snapshot manda, pero lo que sólo existe en vivo (segundos, uso, decisiones…) se conserva.
 * Con un run vivo (reconexión, o un reemplazo a media respuesta) el run sigue: `busy` y `runId` no
 * cambian y sus pasos sin resultado siguen corriendo. Lo cargado con `loadOlder` se queda delante si
 * el snapshot empieza en un turno que ya teníamos; si no, el hilo vuelve a empezar en el snapshot.
 */
function applySnapshot(s: PilotState, messages: Message[]): PilotState {
  const fresh = messagesToTurns(messages);
  let prefix: Turn[] = [];
  if (s.olderCount && fresh[0]?.id) {
    const at = s.turns.findIndex((t) => t.id === fresh[0].id);
    if (at >= 0) prefix = s.turns.slice(0, at);
  }
  const keepOlder = prefix.length > 0;
  const old = keepOlder ? s.turns.slice(prefix.length) : s.turns.slice(s.olderCount);
  const lastIndex = fresh.length - 1;
  const turns = fresh.map((t, i) => {
    const o = old[i];
    // Un paso sin resultado en el turno vivo sigue corriendo (después del run, espera aprobación).
    const live = s.busy && i === lastIndex && t.role === "assistant";
    const tools = t.tools?.map((x) => {
      const prev = o?.role === t.role ? o.tools?.find((y) => y.id === x.id) : undefined;
      const status = x.status === "pending" && (prev?.status ?? (live ? "in_progress" : undefined));
      return { ...prev, ...x, ...(status ? { status } : {}) };
    });
    const base = tools ? { ...t, tools } : t;
    if (!o || o.role !== t.role) return base;
    return {
      ...base,
      ...(o.seconds !== undefined ? { seconds: o.seconds } : {}),
      ...(o.usage ? { usage: o.usage } : {}),
      ...(o.decisions ? { decisions: o.decisions } : {}),
      ...(o.thought && !t.thought ? { thought: o.thought } : {}),
      ...(o.attachments && !t.attachments ? { attachments: o.attachments } : {}),
      ...(o.custom && !t.custom ? { custom: o.custom } : {}),
    };
  });
  return {
    ...s,
    turns: [...prefix, ...turns],
    olderCount: prefix.length,
    history: keepOlder ? s.history : (s.historyNext ?? null),
    historyNext: undefined,
  };
}

/** Un evento AG-UI → estado nuevo. `now` se inyecta para que el reductor sea puro. */
export function reduceAgUiEvent(prev: PilotState, e: Ev, now: number = Date.now()): PilotState {
  const s: PilotState = prev.effects.length ? { ...prev, effects: [] } : prev;
  switch (e.type) {
    case "RUN_STARTED":
      return { ...s, busy: true, error: null, step: null, runId: e.runId ?? s.runId };
    case "TEXT_MESSAGE_START":
      if (e.role && e.role !== "assistant") return s;
      // Un mensaje nuevo del mismo turno va en párrafo aparte.
      return patchAssistant(s, (t) => ({ ...t, text: t.text && !t.text.endsWith("\n") ? `${t.text}\n\n` : t.text }));
    case "TEXT_MESSAGE_CONTENT":
    case "TEXT_MESSAGE_CHUNK":
      if (e.role && e.role !== "assistant") return s;
      if (typeof e.delta !== "string" || !e.delta) return s;
      return patchAssistant(s, (t) => ({ ...t, text: t.text + e.delta }));
    case "TEXT_MESSAGE_END":
      return s;
    case "TOOL_CALL_START":
      return upsertTool(s, e.toolCallId, { title: e.toolCallName, status: "in_progress" });
    case "TOOL_CALL_CHUNK": {
      const known = s.turns[s.turns.length - 1]?.tools?.find((x) => x.id === e.toolCallId);
      let next = known ? s : upsertTool(s, e.toolCallId, { title: e.toolCallName, status: "in_progress" });
      if (typeof e.delta === "string" && e.delta) next = upsertTool(next, e.toolCallId, { args: ((known?.args ?? "") + e.delta) });
      return next;
    }
    case "TOOL_CALL_ARGS": {
      const known = s.turns[s.turns.length - 1]?.tools?.find((x) => x.id === e.toolCallId);
      return upsertTool(s, e.toolCallId, { args: (known?.args ?? "") + (e.delta ?? "") });
    }
    case "TOOL_CALL_END": {
      const known = s.turns[s.turns.length - 1]?.tools?.find((x) => x.id === e.toolCallId);
      return upsertTool(s, e.toolCallId, { detail: argsDetail(known?.args) });
    }
    case "TOOL_CALL_RESULT": {
      const failed = Boolean(e.metadata?.error);
      return upsertTool(s, e.toolCallId, { status: failed ? "failed" : "completed" });
    }
    case "REASONING_MESSAGE_CONTENT":
    case "REASONING_MESSAGE_CHUNK":
      if (typeof e.delta !== "string" || !e.delta) return s;
      return patchAssistant(s, (t) => ({ ...t, thought: (t.thought ?? "") + e.delta }));
    case "MESSAGES_SNAPSHOT":
      return Array.isArray(e.messages) ? applySnapshot(s, e.messages) : s;
    case "RUN_FINISHED":
      return finish(s, e, now);
    case "RUN_ERROR":
      return finish({ ...s, error: typeof e.message === "string" ? e.message : "El agente falló." }, e, now, true);
    case "STEP_STARTED":
      return typeof e.stepName === "string" ? { ...s, step: e.stepName } : s;
    case "STEP_FINISHED":
      return s.step === e.stepName ? { ...s, step: null } : s;
    case "STATE_SNAPSHOT": {
      const agentState = e.snapshot && typeof e.snapshot === "object" ? (e.snapshot as Record<string, unknown>) : {};
      return { ...s, agentState, effects: [{ type: "state", state: agentState }] };
    }
    case "STATE_DELTA": {
      if (!Array.isArray(e.delta)) return s;
      const { doc, ok } = applyJsonPatch(s.agentState, e.delta as PatchOp[]);
      // Un delta que no aplica (estado desfasado) se ignora: el siguiente snapshot lo corrige.
      return ok ? { ...s, agentState: doc, effects: [{ type: "state", state: doc }] } : s;
    }
    case "CUSTOM":
      if (e.name === "ghosty.title") return { ...s, effects: [{ type: "title", title: e.value?.title }] };
      if (e.name === "ghosty.history") return { ...s, historyNext: toHistory(e.value) };
      if (typeof e.name !== "string" || PROTOCOL_CUSTOM.has(e.name)) return s;
      return patchAssistant(s, (t) => ({ ...t, custom: [...(t.custom ?? []), { name: e.name, value: e.value, ...(typeof e.timestamp === "number" ? { timestamp: e.timestamp } : {}) }] }));
    default:
      // ACTIVITY_*, RAW…: no se pintan (la app los ve por `onEvent`).
      return s;
  }
}

function toHistory(v: unknown): HistoryPage | null {
  if (!v || typeof v !== "object") return null;
  const h = v as { hasMoreBefore?: unknown; before?: unknown };
  return { hasMoreBefore: h.hasMoreBefore === true, ...(typeof h.before === "string" ? { before: h.before } : {}) };
}

function finish(s0: PilotState, e: Ev, now: number, failed = false): PilotState {
  let s: PilotState = { ...s0, busy: false, step: null };
  const outcome = e.outcome as { type?: string; interrupts?: Interrupt[] } | undefined;
  const interrupted = outcome?.type === "interrupt" && Array.isArray(outcome.interrupts) && outcome.interrupts.length > 0;
  // Las tarjetas abiertas son las del último run: si terminó bien o se canceló, ya no hay.
  // El reloj del servidor (`timestamp` del evento, o el que puso el transporte con el `Date` de la
  // respuesta) contra el local al recibirlo: la cuenta regresiva no depende del reloj de la persona.
  const clockOffset = typeof e.timestamp === "number" ? now - e.timestamp : 0;
  s.permissions = interrupted ? outcome!.interrupts!.map((i) => toPermission(i, s.turns, clockOffset)) : [];
  if (outcome?.type === "cancelled" || failed) s = { ...s, turns: closeOpenTools(s.turns, failed ? "failed" : "cancelled") };
  if (interrupted) {
    // La herramienta que espera aprobación no está corriendo: espera.
    const waiting = new Set(s.permissions.map((p) => p.toolCallId).filter(Boolean));
    if (waiting.size) {
      s = { ...s, turns: s.turns.map((t) => (t.tools?.some((x) => waiting.has(x.id)) ? { ...t, tools: t.tools.map((x) => (waiting.has(x.id) && x.status !== "completed" ? { ...x, status: "pending" } : x)) } : t)) };
    }
  }
  // Uso de tokens (`usage: TokenUsage[]`) en el último turno.
  const usage = Array.isArray(e.usage) && e.usage.length
    ? (e.usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number }[]).reduce(
        (a, u) => ({ ...a, used: a.used + (u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0)), input: (a.input ?? 0) + (u.inputTokens ?? 0), output: (a.output ?? 0) + (u.outputTokens ?? 0) }),
        { used: 0, size: 0, cost: 0 } as NonNullable<PilotState["usage"]>,
      )
    : null;
  const t0 = s.turnStartedAt;
  const seconds = t0 ? Math.max(1, Math.round((now - t0) / 1000)) : undefined;
  const turns = [...s.turns];
  const last = turns[turns.length - 1];
  if (last?.role === "assistant") turns[turns.length - 1] = { ...last, ...(seconds !== undefined ? { seconds } : {}), ...(usage ? { usage } : {}) };
  s = { ...s, turns, turnStartedAt: 0, ...(usage ? { usage } : {}) };
  // Abrir el hilo (sin turno de este cliente) no es «fin de turno».
  if (!t0) return s;
  const effect: PilotEffect = {
    type: "turn-done",
    text: last?.role === "assistant" ? last.text : "",
    runId: e.runId ?? s.runId ?? undefined,
    ...(seconds !== undefined ? { seconds } : {}),
    ...(failed ? { error: s.error ?? undefined } : {}),
    ...(interrupted ? { interrupted: true } : {}),
  };
  return { ...s, effects: [effect] };
}

// ── Acciones locales (lo que hace el cliente, no el servidor) ──────────────────────────

/** El usuario manda un mensaje (o contesta una tarjeta: `text` vacío, sin burbuja). */
export function beginSend(prev: PilotState, text: string, attachments: Attachment[] = [], now: number = Date.now()): PilotState {
  const turns = text || attachments.length ? [...prev.turns, { role: "user" as const, text, ...(attachments.length ? { attachments } : {}) }] : prev.turns;
  return { ...prev, turns, busy: true, error: null, notice: null, turnStartedAt: now, effects: [{ type: "turn-start" }] };
}

/**
 * Steer: un mensaje del usuario mientras el run sigue. Su burbuja entra en el hilo y lo que el agente
 * diga después va en una respuesta nueva debajo; el run (y su reloj) siguen siendo los mismos.
 */
export function beginSteer(prev: PilotState, text: string): PilotState {
  return { ...prev, turns: [...prev.turns, { role: "user", text }], notice: null, effects: [] };
}

/**
 * Mensajes más viejos (`loadOlder`) delante del hilo. Las páginas empiezan en un mensaje del usuario;
 * lo que ya se tenía (mismo id) no se repite.
 */
export function prependHistory(prev: PilotState, messages: Message[], page: HistoryPage | null): PilotState {
  const have = new Set(prev.turns.map((t) => t.id).filter(Boolean));
  const older = messagesToTurns(messages).filter((t) => !t.id || !have.has(t.id));
  return { ...prev, turns: [...older, ...prev.turns], olderCount: prev.olderCount + older.length, history: page, effects: [] };
}

/** El servidor no aceptó el encargo (HTTP): se DICE, para que no se quede pensando. */
export function sendFailed(prev: PilotState, message: string): PilotState {
  return { ...prev, busy: false, turnStartedAt: 0, error: message, effects: [] };
}

/** Detener: el cliente cortó la conexión (el servidor corta el run). */
export function stopTurn(prev: PilotState): PilotState {
  return { ...prev, busy: false, step: null, turnStartedAt: 0, turns: closeOpenTools(prev.turns, "cancelled"), effects: [] };
}

/** Quita el último intercambio (las respuestas del final y el último mensaje del usuario). */
export function dropLastExchange(prev: PilotState): PilotState {
  const turns = [...prev.turns];
  while (turns.length && turns[turns.length - 1].role === "assistant") turns.pop();
  return { ...prev, turns: turns.slice(0, -1), effects: [] };
}

/** El último mensaje del usuario (para reintentar). */
export function lastUserTurn(turns: Turn[]): Turn | null {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "user") return turns[i];
  return null;
}

/**
 * El usuario contestó (o dejó vencer) una tarjeta: sale de las abiertas y queda anotada en la última
 * respuesta («Aprobaste: correr la purga»).
 */
export function resolvePermission(prev: PilotState, id: string, status: Decision["status"], asked?: PermissionRequest): PilotState {
  const req = prev.permissions.find((p) => p.id === id) ?? asked;
  const s: PilotState = { ...prev, effects: [], permissions: prev.permissions.filter((p) => p.id !== id) };
  if (!req) return s;
  const decision: Decision = { id, title: req.title, status };
  const turns = [...s.turns];
  let i = turns.length - 1;
  while (i >= 0 && turns[i].role !== "assistant") i--;
  if (i >= 0) turns[i] = { ...turns[i], decisions: [...(turns[i].decisions ?? []), decision] };
  return { ...s, turns };
}

/** `expiresAt` (ISO o epoch ms) → epoch ms. */
export function expiryMs(v: string | number): number {
  return typeof v === "number" ? v : Date.parse(v);
}
