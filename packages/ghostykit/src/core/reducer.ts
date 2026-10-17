// El estado del chat como reductor PURO: cada evento del SSE (o cada acción local) entra y sale un
// estado nuevo. Extraído de `useAcpStream` de Ghosty Studio sin cambiar comportamiento: lo que allá
// eran refs (`streaming`, `inicioTurno`, `conexiones`…) aquí es parte del estado, y lo que allá eran
// efectos (`revalidate`, eventos `gs:*`) aquí son `effects` que el hook ejecuta.
//
// ⚠️ El orden importa y es el mismo del original: `patchCurrent` lee `streaming` AL LLEGAR el
// evento. En React eso evitaba un bug de batching (respuesta doble, 1-oct); aquí es natural porque
// cada evento se reduce en secuencia.
import { reconcileTurns } from "./reconcile";
import type {
  Attachment,
  ConnectPhase,
  Decision,
  Delivery,
  Interrupted,
  ModelOption,
  PageBuild,
  PageBuildSection,
  PageReview,
  PermissionRequest,
  PilotEffect,
  PilotState,
  SendResult,
  ToolEntry,
  Turn,
  Usage,
} from "./types";

/** El aviso de reinicio del servidor. Se retira solo si el agente sigue mandando algo. */
export const RESTART_NOTICE = "El servidor se reinició a media respuesta. Vuelve a enviar el mensaje.";

/** Lo que se ve en el hilo al retomar (el servidor manda al agente la continuación entera). */
export const RESUME_TEXT = "Continúa donde te quedaste.";

export function createPilotState(turns: Turn[] = []): PilotState {
  return {
    turns,
    busy: false,
    connected: false,
    error: null,
    notice: null,
    phase: "waking",
    usage: null,
    models: [],
    currentModel: null,
    canSeeImages: true,
    interrupted: null,
    elsewhere: false,
    permissions: [],
    turnStartedAt: 0,
    streaming: false,
    currentTurnId: null,
    connections: 0,
    needAccount: false,
    heartbeatMs: null,
    effects: [],
  };
}

type Obj = Record<string, any>;
const isObj = (d: unknown): d is Obj => typeof d === "object" && d !== null;

/**
 * Todo lo que llega durante un turno cae en el mismo mensaje del asistente; si aún no existe, se
 * crea. Con un steer en medio, lo que se escriba DESPUÉS va en una burbuja nueva debajo de él.
 */
function patchCurrent(s: PilotState, patch: (t: Turn) => Turn): PilotState {
  const inProgress = s.streaming;
  const turns = [...s.turns];
  const last = turns[turns.length - 1];
  if (inProgress && last?.role === "assistant") turns[turns.length - 1] = patch(last);
  else turns.push(patch({ role: "assistant", text: "" }));
  return { ...s, streaming: true, turns };
}

/** Si el agente sigue mandando algo, el aviso de reinicio era falso: se retira. */
function stillAlive(s: PilotState): PilotState {
  return { ...s, notice: s.notice === RESTART_NOTICE ? null : s.notice, interrupted: null };
}

function upsertTool(s: PilotState, entry: ToolEntry): PilotState {
  return patchCurrent(s, (t) => {
    const tools = [...(t.tools ?? [])];
    const i = tools.findIndex((x) => x.id === entry.id);
    let cuts = t.cuts;
    if (i === -1) {
      tools.push(entry);
      const len = t.text.length;
      if (t.text.trim() && cuts?.[cuts.length - 1] !== len) cuts = [...(cuts ?? []), len];
    } else tools[i] = { ...tools[i], ...entry };
    return { ...t, tools, cuts };
  });
}

const patchPage = (s: PilotState, pageId: string, fn: (p: PageBuild) => PageBuild) =>
  patchCurrent(s, (t) => ({ ...t, pages: (t.pages ?? []).map((p) => (p.pageId === pageId ? fn(p) : p)) }));

const patchSection = (s: PilotState, pageId: string, id: string, fn: (x: PageBuildSection) => PageBuildSection) =>
  patchPage(s, pageId, (p) => ({ ...p, sections: p.sections.map((x) => (x.id === id ? fn(x) : x)) }));

/** El paso del SSE (`detalle` en español) al tipo público. */
function toToolEntry(d: Obj): ToolEntry {
  const e: ToolEntry = { id: String(d.id) };
  if (d.title !== undefined) e.title = d.title;
  if (d.kind !== undefined) e.kind = d.kind;
  if (d.status !== undefined) e.status = d.status;
  if (d.path !== undefined) e.path = d.path;
  const detail = d.detail ?? d.detalle;
  if (detail !== undefined) e.detail = detail;
  return e;
}

function toDelivery(p: Obj): Delivery {
  return {
    kind: p.tipo === "artefacto" ? "artifact" : "file",
    name: p.nombre ?? p.titulo ?? "archivo",
    fileId: p.fileId,
    docId: p.docId,
    mime: p.mime,
    size: p.size ?? (typeof p.contenidoBase64 === "string" ? Math.floor((p.contenidoBase64.length * 3) / 4) : undefined),
    ...(p.captura ? { capture: true } : {}),
    raw: p,
  };
}

/**
 * Un evento del stream → estado nuevo. `data` ya viene parseado (JSON); `null` si no traía.
 * `now` se inyecta para que el reductor sea puro (tiempos de turno y de página).
 */
export function reducePilotEvent(prev: PilotState, name: string, data: unknown, now: number = Date.now()): PilotState {
  const s: PilotState = prev.effects.length ? { ...prev, effects: [] } : prev;
  const d: Obj = isObj(data) ? data : {};
  switch (name) {
    case "started": {
      const connections = s.connections + 1;
      const heartbeatMs = typeof d.latidoMs === "number" && d.latidoMs > 0 ? d.latidoMs : null;
      let next: PilotState = { ...s, connections, connected: true, heartbeatMs };
      // Contrato de un POST que devuelve el stream (EasyBits): `started` trae el turno de este cliente.
      if (typeof d.turnId === "string" && s.turnStartedAt && !s.currentTurnId) next.currentTurnId = d.turnId;
      // Reconexión con un turno en vuelo: el servidor repinta lo que lleva. Se quita la burbuja en
      // curso para que no salga dos veces.
      if (connections > 1 && s.turnStartedAt && s.streaming) {
        const last = next.turns[next.turns.length - 1];
        next = { ...next, streaming: false, turns: last?.role === "assistant" ? next.turns.slice(0, -1) : next.turns };
      }
      return next;
    }
    case "caps": {
      if (!isObj(data)) return s;
      // `needAccount` llega a media respuesta: la invitación se pone al cerrar el turno.
      if (d.needAccount) return { ...s, needAccount: true };
      return { ...s, canSeeImages: d.image !== false };
    }
    case "page-plan": {
      if (!isObj(data)) return s;
      const live = stillAlive(s);
      return patchCurrent(live, (t) => {
        const page: PageBuild = {
          pageId: d.pageId,
          title: d.title,
          theme: d.theme,
          sections: (d.sections ?? []).map((x: Obj) => ({ ...x, status: "pending" })),
          startedAt: t.planningAt ?? now,
          mode: "build",
        };
        return { ...t, planning: false, pages: [...(t.pages ?? []).filter((p) => p.pageId !== d.pageId), page] };
      });
    }
    case "section-building":
      if (!isObj(data)) return s;
      return patchSection(s, d.pageId, d.id, (x) => (x.status === "done" ? x : { ...x, status: "building" }));
    case "section-update":
      if (!isObj(data)) return s;
      return patchSection(s, d.pageId, d.id, (x) => ({ ...x, html: d.html, status: x.status === "pending" ? "building" : x.status }));
    case "section":
      if (!isObj(data)) return s;
      return patchSection(s, d.pageId, d.id, (x) => ({ ...x, html: d.html, status: d.ok ? "done" : "failed" }));
    case "page-ready":
      if (!isObj(data)) return s;
      return patchPage(s, d.pageId, (p) => ({ ...p, readyAt: now, url: d.url, n: d.n }));
    case "page-planning":
      return patchCurrent(stillAlive(s), (t) => ({ ...t, planning: true, planningAt: t.planningAt ?? now }));
    case "page-drop":
      // La armada especulativa que el modelo no pidió: fuera las páginas que no llegaron a estar listas.
      return patchCurrent(s, (t) => ({ ...t, planning: false, pages: (t.pages ?? []).filter((p) => p.readyAt) }));
    case "page-edit": {
      if (!isObj(data)) return s;
      const live = stillAlive(s);
      const page: PageBuild = {
        pageId: d.pageId,
        title: d.title,
        theme: d.theme,
        sections: (d.sections ?? []).map((x: Obj) => ({ ...x, status: x.id === d.sectionId ? "building" : "done" })),
        startedAt: now,
        mode: "edit",
        focus: d.sectionId && d.nodeId ? { sectionId: d.sectionId, nodeId: d.nodeId } : undefined,
        editLabel: d.label,
      };
      return patchCurrent(live, (t) => ({ ...t, pages: [...(t.pages ?? []).filter((p) => p.pageId !== d.pageId), page] }));
    }
    case "review":
      if (!isObj(data)) return s;
      return patchPage(s, d.pageId, (p) => ({
        ...p,
        theme: d.theme ?? p.theme,
        review: { status: d.status, fixes: d.fixes ?? [], skipped: d.skipped ?? [], thumb: d.thumb ?? p.review?.thumb, seconds: d.seconds } as PageReview,
      }));
    case "page-version":
      if (!isObj(data)) return s;
      return patchPage(s, d.pageId, (p) => ({
        ...p,
        n: d.n,
        url: d.url ?? p.url,
        readyAt: p.readyAt ?? now,
        ...(d.summary ? { editSummary: d.summary } : {}),
        ...(d.focusId && p.focus ? { focus: { ...p.focus, nodeId: d.focusId } } : {}),
      }));
    case "page-error":
      if (!isObj(data)) return s;
      // Sin `pageId` (falló antes del plan o se canceló): todas las que sigan en obra.
      return patchCurrent(s, (t) => ({
        ...t,
        planning: false,
        pages: (t.pages ?? []).map((p) => (p.pageId === d.pageId || (!d.pageId && !p.readyAt) ? { ...p, error: d.message } : p)),
      }));
    case "models":
      if (!isObj(data)) return s;
      return { ...s, models: (d.options ?? []) as ModelOption[], currentModel: d.current ?? null };
    case "status": {
      if (!isObj(data)) return s;
      return { ...stillAlive(s), phase: d.phase as ConnectPhase, elsewhere: Boolean(d.otraCaja) };
    }
    case "reemplazo":
      // El turno que se siguió desde otra instancia cerró: su texto guardado reemplaza lo reenviado.
      if (!s.turnStartedAt || !isObj(data)) return s;
      return patchCurrent(s, (t) => ({ ...t, text: d.text }));
    case "chunk":
      if (!isObj(data)) return s;
      return patchCurrent(stillAlive(s), (t) => ({ ...t, text: t.text + d.text }));
    case "thought":
      if (!isObj(data)) return s;
      return patchCurrent(s, (t) => ({ ...t, thought: (t.thought ?? "") + d.text }));
    case "tool":
      if (!isObj(data)) return s;
      return upsertTool(stillAlive(s), toToolEntry(d.id == null ? { ...d, id: syntheticToolId(s, d) } : d));
    case "snapshot":
      if (!isObj(data)) return s;
      return reduceSnapshot(s, d, now);
    case "idle": {
      // No hay turno vivo en el servidor. Si este cliente esperaba uno, se perdió.
      if (!s.turnStartedAt) return s;
      return closeCut(s, "se cortó la conexión", undefined, undefined, now);
    }
    case "interrupted": {
      if (!isObj(data)) return s;
      const turnId = typeof d.turnId === "string" ? d.turnId : undefined;
      return closeCut(s, typeof d.reason === "string" ? d.reason : "se interrumpió", turnId, d.canContinue === true, now);
    }
    case "capacity": {
      // Sin lugar ahora mismo: se dice y el turno se suelta (se puede volver a mandar en un rato).
      if (!isObj(data)) return s;
      const message = typeof d.message === "string" && d.message ? d.message : "No hay capacidad ahora mismo. Intenta en un momento.";
      return { ...reduceDone(s, { turnId: d.turnId }, now), notice: message };
    }
    case "artifact":
      if (!isObj(data)) return s;
      return patchCurrent(s, (t) => ({ ...t, deliveries: [...(t.deliveries ?? []), toDelivery(d)] }));
    case "usage": {
      if (!isObj(data)) return s;
      const u = d as Usage;
      const turns = [...s.turns];
      const last = turns[turns.length - 1];
      if (last?.role === "assistant") turns[turns.length - 1] = { ...last, usage: u };
      return { ...s, usage: u, turns };
    }
    case "title":
      return { ...s, effects: [{ type: "title", title: typeof d.title === "string" ? d.title : undefined }] };
    case "permission": {
      if (!isObj(data) || typeof d.id !== "string") return s;
      // Los permisos abiertos se reenvían en CADA suscripción: se reemplazan por id, sin duplicar.
      const req: PermissionRequest = { id: d.id, title: String(d.title ?? ""), tool: d.tool, options: Array.isArray(d.options) ? d.options : [], ...(d.expiresAt != null ? { expiresAt: d.expiresAt } : {}) };
      const i = s.permissions.findIndex((p) => p.id === req.id);
      const permissions = i === -1 ? [...s.permissions, req] : s.permissions.map((p, k) => (k === i ? req : p));
      return { ...s, permissions };
    }
    case "permission-resolved":
      if (!isObj(data)) return s;
      return { ...s, permissions: s.permissions.filter((p) => p.id !== d.id) };
    case "done": {
      // `done{text}` (EasyBits): la respuesta final. Sólo pinta si no llegó nada por `chunk`.
      let next = s;
      const last = s.turns[s.turns.length - 1];
      if (typeof d.text === "string" && d.text && s.turnStartedAt && !(s.streaming && last?.role === "assistant" && last.text)) {
        next = patchCurrent(s, (t) => ({ ...t, text: d.text }));
      }
      return reduceDone(next, d, now);
    }
    case "warning":
      if (!isObj(data) || typeof d.message !== "string") return s;
      return { ...s, notice: d.message };
    case "error":
      if (!isObj(data) || typeof d.message !== "string") return s;
      return { ...s, error: d.message };
    case "closed":
      // El socket murió, no el hilo: quien mira tiene que poder seguir leyéndolo y reabrirlo.
      return { ...s, connected: false, effects: [{ type: "disconnected" }] };
    default:
      return s;
  }
}

/**
 * Al cerrar un turno, sus permisos se van (en ACP el turno ESPERA al permiso: si cerró, ya se
 * resolvió). Los que traen `expiresAt` vigente no dependen del turno y se quedan.
 */
function keepIndependent(perms: PermissionRequest[], now: number): PermissionRequest[] {
  return perms.filter((p) => p.expiresAt !== undefined && expiryMs(p.expiresAt) > now);
}

/** `expiresAt` (ISO o epoch ms) → epoch ms. */
export function expiryMs(v: string | number): number {
  return typeof v === "number" ? v : Date.parse(v);
}

/** Un turno que se cortó: «Me quedé a medias» + Retomar. */
function closeCut(s: PilotState, reason: string, turnId?: string, canContinue?: boolean, now: number = Date.now()): PilotState {
  return {
    ...s,
    elsewhere: false,
    streaming: false,
    busy: false,
    turnStartedAt: 0,
    error: null,
    notice: null,
    permissions: keepIndependent(s.permissions, now),
    interrupted: { reason, turnId, ...(canContinue ? { canContinue } : {}) } as Interrupted,
    effects: [{ type: "turn-interrupted", reason, turnId }],
  };
}

/**
 * Un paso sin `id` (EasyBits manda sólo `title` + `status`): el que arranca abre uno nuevo; el que
 * termina cierra el ÚLTIMO del mismo título que siga corriendo.
 */
function syntheticToolId(s: PilotState, d: Obj): string {
  const last = s.streaming ? s.turns[s.turns.length - 1] : undefined;
  const tools = last?.role === "assistant" ? (last.tools ?? []) : [];
  if (d.status !== "in_progress" && d.status !== "pending") {
    for (let i = tools.length - 1; i >= 0; i--) {
      const t = tools[i];
      if (t.title === d.title && t.status !== "completed" && t.status !== "failed") return t.id;
    }
  }
  return `tool-${tools.length + 1}`;
}

/**
 * `snapshot{turnId, text, tools: string[], cortes}`: el estado entero de un turno vivo, al
 * re-engancharse (EasyBits `?attach=1`). Repinta la burbuja en curso y marca el turno como vivo.
 */
function reduceSnapshot(s0: PilotState, d: Obj, now: number): PilotState {
  const names: string[] = Array.isArray(d.tools) ? d.tools.filter((x: unknown) => typeof x === "string") : [];
  const tools: ToolEntry[] = names.map((title, i) => ({ id: `tool-${i + 1}`, title, status: i === names.length - 1 ? "in_progress" : "completed" }));
  const cuts = Array.isArray(d.cortes) ? d.cortes.filter((x: unknown) => typeof x === "number") : undefined;
  let s: PilotState = {
    ...stillAlive(s0),
    busy: true,
    phase: "session",
    turnStartedAt: s0.turnStartedAt || now,
    currentTurnId: typeof d.turnId === "string" ? d.turnId : s0.currentTurnId,
  };
  s = patchCurrent(s, (t) => ({ ...t, text: typeof d.text === "string" ? d.text : t.text, tools, ...(cuts?.length ? { cuts } : {}) }));
  return s;
}

/**
 * `done`. `reposo: true` = el servidor no tiene turno vivo en este hilo: llega al abrir el stream
 * (normal) y al RECONECTAR tras un reinicio. Trae, si aplica, qué pasó con el último turno:
 * `interrumpido` (se cortó por falla del servidor) o `ultimo` (terminó sin este cliente conectado).
 */
function reduceDone(s0: PilotState, d: Obj, now: number): PilotState {
  let s: PilotState = { ...s0, elsewhere: false };
  const waiting = Boolean(s.turnStartedAt);
  const isMine = (id?: string) => id != null && id === s.currentTurnId;
  const cut = (reason: string, turnId?: string): PilotState => closeCut(s, reason, turnId, undefined, now);
  const interrupted = isObj(d.interrumpido) ? (d.interrumpido as Obj) : null;
  if (!waiting) {
    // Sin turno encargado por este cliente (abrir el hilo, F5, o un turno de otra superficie): si el
    // último se cortó, se ofrece Retomar aunque haya sido hace horas.
    if (interrupted) return cut(interrupted.motivo, interrupted.turnId);
    if (d.reposo) return s;
  } else if (interrupted) {
    // En la primera suscripción puede hablar del turno ANTERIOR: sólo cuenta si es el de este cliente.
    if (isMine(interrupted.turnId) || s.connections > 1) return cut(interrupted.motivo, interrupted.turnId);
    return s;
  } else if (d.reposo) {
    const last = isObj(d.ultimo) ? (d.ultimo as Obj) : null;
    if (!(last?.estado === "done" && isMine(last.turnId))) {
      // En la PRIMERA suscripción el `done{reposo}` puede llegar justo después de mandar y no
      // significa nada. En una RECONEXIÓN, el servidor no tiene vivo el turno de este cliente: se cortó.
      if (s.connections > 1) return cut("se cortó la conexión");
      return s;
    }
    // Terminó mientras la conexión estaba caída: se pinta su respuesta y se cierra como cualquiera.
    const text = typeof last.text === "string" ? last.text : "";
    if (text) s = patchCurrent(s, (t) => ({ ...t, text }));
  }
  const effects: PilotEffect[] = [];
  s = { ...s, streaming: false, busy: false, permissions: keepIndependent(s.permissions, now) };
  if (s.needAccount) {
    s = { ...s, needAccount: false };
    effects.push({ type: "needs-login" });
  }
  const t0 = s.turnStartedAt;
  s = { ...s, turnStartedAt: 0 };
  let seconds: number | undefined;
  if (t0) {
    seconds = Math.round((now - t0) / 1000);
    const turns = [...s.turns];
    const last = turns[turns.length - 1];
    if (last?.role === "assistant") turns[turns.length - 1] = { ...last, seconds };
    s = { ...s, turns };
  }
  const last = s.turns[s.turns.length - 1];
  effects.push({
    type: "turn-done",
    text: last?.role === "assistant" ? last.text : "",
    turnId: typeof d.turnId === "string" ? d.turnId : undefined,
    ...(seconds !== undefined ? { seconds } : {}),
  });
  return { ...s, effects };
}

// ── Acciones locales (lo que hace el cliente, no el servidor) ──────────────────────────

/**
 * El usuario manda un mensaje. Con turno en vuelo es una CORRECCIÓN: el servidor intenta meterlo
 * al turno (steer) y, hasta saber si entró, la burbuja viva se conserva.
 */
export function beginSend(prev: PilotState, text: string, attachments: Attachment[], now: number = Date.now()): PilotState {
  const inFlight = prev.busy;
  let s: PilotState = {
    ...prev,
    effects: [],
    interrupted: null,
    notice: prev.notice === RESTART_NOTICE ? null : prev.notice,
    turns: [...prev.turns, { role: "user", text, attachments, steer: inFlight }],
  };
  if (!inFlight) {
    s = { ...s, busy: true, streaming: false, turnStartedAt: now, currentTurnId: null, effects: [{ type: "turn-start" }] };
  }
  return s;
}

/** El servidor aceptó el encargo. `inFlight` = había turno en vuelo al mandar. */
export function sendAccepted(prev: PilotState, r: SendResult, inFlight: boolean, now: number = Date.now()): PilotState {
  let s: PilotState = { ...prev, effects: [] };
  if (r.turnId && !r.injected) s.currentTurnId = r.turnId;
  // La fase sólo llegaba con el `status` al CONECTAR: un turno encargado después se quedaba en
  // «despertando» aunque el agente ya estuviera pensando.
  if (r.state) s.phase = r.state === "queued" ? "waking" : "session";
  if (inFlight && !r.injected) {
    // No entró: el servidor cortó el anterior y abrió un turno nuevo. Se pinta como tal.
    s = {
      ...s,
      turns: s.turns.map((t, i) => (i === s.turns.length - 1 ? { ...t, steer: false } : t)),
      busy: true,
      streaming: false,
      turnStartedAt: now,
    };
  }
  return s;
}

/**
 * El servidor ya tiene un turno corriendo (409 `turn_busy`): el mensaje de este cliente NO entró.
 * Se quita de la pantalla y se avisa; el transporte se re-engancha al turno que sí corre.
 */
export function sendRejectedBusy(prev: PilotState, message: string): PilotState {
  const turns = [...prev.turns];
  if (turns[turns.length - 1]?.role === "user") turns.pop();
  return { ...prev, turns, busy: false, streaming: false, turnStartedAt: 0, notice: message, effects: [] };
}

/** El encargo fue rechazado (sin saldo, sin cuenta…): se DICE, para que no se quede pensando. */
export function sendFailed(prev: PilotState, message: string, needsLogin = false): PilotState {
  return { ...prev, busy: false, error: message, effects: needsLogin ? [{ type: "needs-login" }] : [] };
}

/** Detener el turno en curso (el POST de cancelar lo hace el transporte). */
export function stopTurn(prev: PilotState): PilotState {
  return { ...prev, busy: false, streaming: false, turnStartedAt: 0, effects: [] };
}

/** Quita el último intercambio (las respuestas del final y el último mensaje del usuario). */
export function dropLastExchange(prev: PilotState): PilotState {
  const turns = [...prev.turns];
  while (turns.length && turns[turns.length - 1].role === "assistant") turns.pop();
  return { ...prev, turns: turns.slice(0, -1), streaming: false, effects: [] };
}

/**
 * El usuario contestó una tarjeta: sale de las abiertas y queda anotada en la última respuesta
 * («Aprobaste: correr la purga»). `resolved: false` = ya no estaba abierta (venció o la contestó otro).
 */
export function resolvePermission(
  prev: PilotState,
  id: string,
  optionId: string,
  resolved: boolean,
  detail?: string,
  /** La tarjeta como estaba al contestarla (el stream pudo retirarla mientras tanto). */
  asked?: PermissionRequest,
): PilotState {
  const req = prev.permissions.find((p) => p.id === id) ?? asked;
  let s: PilotState = { ...prev, effects: [], permissions: prev.permissions.filter((p) => p.id !== id) };
  if (!req) return s;
  const option = req.options.find((o) => o.optionId === optionId);
  const rejected = /^reject|deny|cancel/i.test(option?.kind ?? optionId);
  const decision: Decision = { id, title: req.title, status: !resolved ? "expired" : rejected ? "rejected" : "approved", ...(detail ? { detail } : {}) };
  const turns = [...s.turns];
  let i = turns.length - 1;
  while (i >= 0 && turns[i].role !== "assistant") i--;
  if (i >= 0) turns[i] = { ...turns[i], decisions: [...(turns[i].decisions ?? []), decision] };
  else turns.push({ role: "assistant", text: "", decisions: [decision] });
  s = { ...s, turns };
  return s;
}

/** Un mensaje del agente que entró fuera de un turno (el remate de los subagentes). */
export function appendAgentMessages(prev: PilotState, texts: string[]): PilotState {
  if (!texts.length) return prev;
  return { ...prev, effects: [], turns: [...prev.turns, ...texts.map((text) => ({ role: "assistant" as const, text, arrived: true }))] };
}

/** La copia del hilo cambió: trae los mensajes que el usuario mandó desde OTRO cliente. Sólo en reposo. */
export function reconcileWith(prev: PilotState, fresh: Turn[]): PilotState {
  if (prev.streaming || prev.turnStartedAt) return prev;
  const turns = reconcileTurns(prev.turns, fresh);
  return turns === prev.turns ? prev : { ...prev, turns, effects: [] };
}

/** El último mensaje del usuario (para reintentar o retomar). */
export function lastUserTurn(turns: Turn[]): Turn | null {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "user") return turns[i];
  return null;
}

/**
 * «Retomar»: si el agente alcanzó a trabajar (texto o pasos tras el último mensaje), se le pide
 * CONTINUAR; si no, es reenviar el mensaje tal cual.
 */
export function resumeMode(turns: Turn[]): "continue" | "resend" {
  const i = turns.map((t) => t.role).lastIndexOf("user");
  const last = i >= 0 ? turns[i] : null;
  const worked = turns.slice(i + 1).some((t) => t.role === "assistant" && (t.text.trim() || t.tools?.length));
  if (last && !worked && last.text !== RESUME_TEXT) return "resend";
  return "continue";
}
