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

export interface Turn {
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
  | { type: "title"; title?: string };

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
