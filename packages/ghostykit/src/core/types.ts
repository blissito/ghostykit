// Los tipos del hilo de Ghosty Autopilot. El cable es AG-UI (`@ag-ui/core`): aquí sólo vive cómo se
// PINTA un hilo (turnos, pasos, tarjetas de aprobación), que se deriva de esos eventos.
import type { BaseEvent, Interrupt, Message, RunAgentInput } from "@ag-ui/core";

export type { BaseEvent, Interrupt, Message, RunAgentInput };

/** Un adjunto del mensaje del usuario (viaja como parte de contenido AG-UI). */
export interface Attachment {
  name?: string;
  mimeType: string;
  /** Base64 sin el prefijo `data:` (imágenes y texto que caben en el mensaje). */
  data?: string;
  /** URL del archivo ya subido (lo demás). */
  url?: string;
}

/** Un paso del agente: una llamada a herramienta (TOOL_CALL_*). */
export interface ToolEntry {
  id: string;
  /** El nombre de la herramienta (`toolCallName`): es la llave de los verbos de la app. */
  title?: string;
  /** El rótulo que puso el servidor (`CUSTOM ghosty.tool`): gana sobre los verbos de la app. */
  label?: string;
  kind?: string;
  /** `in_progress` mientras corre; `completed` | `failed` con su resultado; `pending` = espera
   *  aprobación; `cancelled` = el run se detuvo antes de que terminara. */
  status?: string;
  path?: string;
  /** Los argumentos, en corto («job: purge-notifications»). */
  detail?: string;
  /** Los argumentos en JSON tal como llegaron (TOOL_CALL_ARGS). */
  args?: string;
}

export interface Usage {
  used: number;
  size: number;
  cost: number;
  input?: number;
  output?: number;
}

/** Una tarjeta de aprobación ya contestada. */
export interface Decision {
  id: string;
  title: string;
  status: "approved" | "rejected" | "expired" | "cancelled";
  detail?: string;
}

/** Un evento `CUSTOM` del turno (entregas de archivos, avisos propios de la app). */
export interface CustomEntry {
  name: string;
  value: unknown;
  timestamp?: number;
}

/** Un subagente del agente (`state.subagents.tasks[]`, gs-agui 1 §0.5). */
export interface SubagentTask {
  id: string;
  title?: string;
  status: "running" | "completed" | "failed" | "stopped" | (string & {});
  /** Epoch ms. */
  startedAt?: number;
  endedAt?: number;
  usage?: { tokens?: number; toolUses?: number };
  /** La última herramienta que usó (para el renglón «Leyendo…»). */
  lastTool?: string;
  /** Lo que dijo al terminar. */
  summary?: string;
  model?: string;
  effort?: string;
  /** Su resultado ya entró al hilo. */
  delivered?: boolean;
}

/** Un mensaje que no pudo entrar al run vivo (409 `run_active`): sale solo al terminar el run. */
export interface QueuedMessage {
  text: string;
  attachments?: Attachment[];
  /** Cuántas veces el servidor lo rechazó (se rinde a la tercera). */
  tries: number;
}

/** Hay mensajes más viejos que los del snapshot (`CUSTOM ghosty.history`). */
export interface HistoryPage {
  hasMoreBefore: boolean;
  /** Cursor opaco del servidor: se le regresa a `loadOlder`. */
  before?: string;
}

export interface Turn {
  /** El id del primer mensaje AG-UI del turno (sólo los que vienen de un snapshot). */
  id?: string;
  role: "user" | "assistant";
  text: string;
  /** Cuánto tardó, en segundos (sólo los turnos vistos en vivo). */
  seconds?: number;
  thought?: string;
  tools?: ToolEntry[];
  /** Largo del texto cuando arrancó cada herramienta: lo de antes es narración (`splitNarration`). */
  cuts?: number[];
  attachments?: Attachment[];
  usage?: Usage;
  /** Lo que el usuario decidió en las tarjetas de este turno (sólo en vivo). */
  decisions?: Decision[];
  /** Los `CUSTOM` del turno (p. ej. `ghosty.delivery`), para `renderDeliveries`. Del snapshot salen
   *  del campo `custom` de cada mensaje del asistente. */
  custom?: CustomEntry[];
}

/** Una opción de la tarjeta de aprobación. */
export interface PermissionOption {
  optionId: string;
  name: string;
  /** `allow_once` | `reject_once`. */
  kind?: string;
}

/** Una aprobación pendiente (un `Interrupt` de AG-UI, listo para pintar). */
export interface PermissionRequest {
  /** El `id` del interrupt: con él se contesta (`resume[].interruptId`). */
  id: string;
  title: string;
  tool?: string;
  toolCallId?: string;
  reason?: string;
  options: PermissionOption[];
  /** Hasta cuándo se puede contestar (ISO, reloj del SERVIDOR). */
  expiresAt?: string | number;
  /**
   * El mismo vencimiento en el reloj de ESTE navegador (epoch ms): `expiresAt` menos la hora del
   * servidor al mandar el evento, más la hora local al recibirlo. Así un reloj local desfasado no
   * adelanta ni atrasa la cuenta regresiva.
   */
  deadline?: number;
}

/** Lo que una transición pide hacer FUERA del estado (avisos a la app). */
export type PilotEffect =
  | { type: "turn-start" }
  | { type: "turn-done"; text: string; runId?: string; seconds?: number; error?: string; interrupted?: boolean }
  | { type: "title"; title?: string }
  | { type: "state"; state: Record<string, unknown> };

export interface PilotState {
  turns: Turn[];
  /** Hay un run corriendo. */
  busy: boolean;
  error: string | null;
  notice: string | null;
  usage: Usage | null;
  /** Aprobaciones abiertas (del último RUN_FINISHED con outcome interrupt). */
  permissions: PermissionRequest[];
  /** Cuándo empezó el turno que ESTE cliente encargó (0 = ninguno). */
  turnStartedAt: number;
  runId: string | null;
  /** El estado compartido del agente (`STATE_SNAPSHOT`, con `STATE_DELTA` aplicado encima). */
  agentState: Record<string, unknown>;
  /** El paso con nombre en curso (`STEP_STARTED`), p. ej. `waking`. */
  step: string | null;
  /** Si hay mensajes más viejos por cargar (`loadOlder`). */
  history: HistoryPage | null;
  /** Cuántos de `turns` llegaron con `loadOlder` (van antes del snapshot). */
  olderCount: number;
  /** El `ghosty.history` que acompaña al snapshot que viene. */
  historyNext?: HistoryPage | null;
  /** Mensajes en espera de que termine el run vivo (steer rechazado). */
  queued: QueuedMessage[];
  /** Lo que estaba en espera cuando la persona detuvo: regresa a la caja (`n` cambia en cada vez). */
  returnedDraft?: { text: string; attachments?: Attachment[]; n: number } | null;
  /** El `TEXT_MESSAGE` abierto y dónde empieza en el texto del último turno: si el servidor lo
   *  re-emite (reconexión, §0.7b-4) con el mismo `messageId`, se reescribe en vez de duplicarse. */
  openText?: { id: string; start: number } | null;
  /** Efectos de la ÚLTIMA transición. El hook los ejecuta y los descarta. */
  effects: PilotEffect[];
}

/**
 * Una referencia que acompaña al mensaje (una tarjeta del tablero, un elemento señalado).
 * Con `prompt`, ese renglón va ANTES del mensaje; sin él, las etiquetas van juntas como
 * `[#12 Rosa, #7 Javier] `.
 */
export interface Reference {
  id: string;
  label: string;
  prompt?: string;
  hint?: string;
}
