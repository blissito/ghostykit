// Tipos del hilo de Piloto. Los nombres van en inglés; el contrato SSE (en español, el de Ghosty)
// se traduce a estos tipos dentro del reductor, en un solo lugar.

/** Por dónde va la conexión con el agente antes de que conteste. */
export type ConnectPhase = "waking" | "connecting" | "session";

/** Un modelo que el agente ofrece para la sesión (selector ACP). */
export interface ModelOption {
  value: string;
  name: string;
}

/**
 * Un adjunto listo para el agente: base64 sin prefijo + su MIME, o una URL ya subida.
 * Viaja en el cuerpo del POST como `images` (nombre histórico del contrato).
 */
export interface Attachment {
  name?: string;
  mimeType: string;
  /** Base64 sin el prefijo `data:`. Vacío cuando el archivo viaja por `uri`. */
  data: string;
  /** URL del archivo ya subido (lo que el agente descarga cuando no es imagen ni texto). */
  uri?: string;
  /** Id del archivo en la app, si la app lo guarda. */
  fileId?: string;
}

/** Un paso del agente (una herramienta), según ACP: pending → in_progress → completed | failed. */
export interface ToolEntry {
  id: string;
  title?: string;
  kind?: string;
  status?: string;
  path?: string;
  /** Qué hace, en palabras de persona (el comando, el archivo, el prompt de la imagen). */
  detail?: string;
}

/** Lo que el agente ENTREGÓ en el turno (evento `artifact`). `raw` es el payload tal cual. */
export interface Delivery {
  kind: "file" | "artifact";
  name: string;
  fileId?: string;
  /** Documento editable de la app (Ghosty: `@ghostystudio/docs`). */
  docId?: string;
  mime?: string;
  size?: number;
  /** Captura de pantalla del navegador: se pinta en su tira, no como entrega suelta. */
  capture?: boolean;
  raw?: Record<string, unknown>;
}

/** Una sección de la página que el turno arma (constructor por secciones). */
export interface PageBuildSection {
  id: string;
  label: string;
  kind: string;
  status: "pending" | "building" | "done" | "failed";
  html?: string;
}

/** La revisión de la página armada: corriendo, o terminada con sus arreglos. */
export interface PageReview {
  status: "running" | "done";
  fixes: { name: string; sectionId: string }[];
  skipped: string[];
  thumb?: string | null;
  seconds?: number;
}

/** Una página que el turno está armando, por `pageId` (eventos `page-plan` … `page-ready`). */
export interface PageBuild {
  pageId: string;
  title: string;
  /** Opaco para Piloto: lo interpreta quien pinta la página (slot `renderDeliveries`). */
  theme: unknown;
  sections: PageBuildSection[];
  startedAt: number;
  readyAt?: number;
  url?: string | null;
  n?: number;
  error?: string;
  mode?: "build" | "edit";
  focus?: { sectionId: string; nodeId: string };
  editLabel?: string;
  editSummary?: string;
  review?: PageReview;
}

export interface Usage {
  used: number;
  size: number;
  cost: number;
  input?: number;
  output?: number;
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
  /** Llegó entero fuera de un turno (el remate de los subagentes): se escribe al ritmo. */
  arrived?: boolean;
  deliveries?: Delivery[];
  /** Cuánto tardó, en segundos. Se rellena al cerrar el turno. */
  seconds?: number;
  thought?: string;
  tools?: ToolEntry[];
  /** Largo del texto cuando arrancó cada herramienta: lo de antes es narración (`splitNarration`). */
  cuts?: number[];
  attachments?: Attachment[];
  usage?: Usage;
  /** Mensaje del usuario que ENTRÓ al turno en vuelo (steer): la respuesta sigue arriba. */
  steer?: boolean;
  pages?: PageBuild[];
  /** El servidor ya está planeando una página (antes de que llegue su plan). */
  planning?: boolean;
  planningAt?: number;
}

/** Un turno que se cortó por falla del servidor (deploy, caja caída). Lo dice el servidor. */
export interface Interrupted {
  reason: string;
  turnId?: string;
}

/** Una opción de un pedido de permiso, tal cual la manda el agente (ACP). */
export interface PermissionOption {
  optionId: string;
  name: string;
  /** `allow_once` | `allow_always` | `reject_once` | `reject_always` | otra. */
  kind?: string;
}

/** El agente pide permiso antes de algo riesgoso: el turno está DETENIDO hasta que alguien conteste. */
export interface PermissionRequest {
  id: string;
  title: string;
  tool?: string;
  options: PermissionOption[];
}

/** Lo que una transición pide hacer FUERA del estado (avisos a la app). */
export type PilotEffect =
  | { type: "turn-start" }
  | { type: "turn-done"; text: string; turnId?: string; seconds?: number }
  | { type: "turn-interrupted"; reason: string; turnId?: string }
  | { type: "needs-login" }
  | { type: "title"; title?: string }
  | { type: "disconnected" };

export interface PilotState {
  turns: Turn[];
  busy: boolean;
  connected: boolean;
  phase: ConnectPhase;
  error: string | null;
  notice: string | null;
  usage: Usage | null;
  models: ModelOption[];
  currentModel: string | null;
  /** Qué puede el agente. Empieza en `true` para no bloquear mientras se conecta. */
  canSeeImages: boolean;
  /** El último turno se cortó por falla del servidor: el chat ofrece Retomar. */
  interrupted: Interrupted | null;
  /** El turno sigue en OTRA instancia del servidor (deploy azul/verde): «sigo trabajando». */
  elsewhere: boolean;
  /** Permisos abiertos, en el orden en que llegaron. */
  permissions: PermissionRequest[];
  /** Cuándo empezó el turno que ESTE cliente encargó (0 = ninguno). */
  turnStartedAt: number;
  // ── Lo que en el hook original eran refs ───────────────────────────────────────
  /** Hay una burbuja del asistente recibiendo eventos del turno en curso. */
  streaming: boolean;
  /** El `turnId` del turno que este cliente encargó (lo devuelve el POST). */
  currentTurnId: string | null;
  /** Cuántas veces se abrió el stream: >1 = reconexión. */
  connections: number;
  /** El servidor avisó (`caps.needAccount`) que hace falta cuenta: se avisa al cerrar el turno. */
  needAccount: boolean;
  /** Cada cuánto promete el servidor su latido (`started.latidoMs`). */
  heartbeatMs: number | null;
  /** Efectos de la ÚLTIMA transición. El hook los ejecuta y los descarta. */
  effects: PilotEffect[];
}

/** Lo que se le pide al transporte al mandar un mensaje. */
export interface SendInput {
  text: string;
  attachments: Attachment[];
  /** Es el primer mensaje del hilo (el servidor lo bautiza al cerrar el turno). */
  firstTurn: boolean;
  /** «Retomar» un turno cortado: el servidor arma la continuación. */
  resume?: boolean;
  /** Lo que el usuario ve en pantalla, para este turno. */
  context?: unknown;
  /** Las referencias que viajaron en el texto, también estructuradas. */
  references?: Reference[];
}

/** Lo que contesta el servidor al encargo. */
export interface SendResult {
  /** El mensaje entró al turno en vuelo (steer). */
  injected?: boolean;
  /** `queued` = la caja está despertando. */
  state?: string;
  turnId?: string;
}

/**
 * Una referencia que acompaña al mensaje (una tarjeta del tablero, un elemento señalado).
 * Con `prompt`, ese renglón va ANTES del mensaje; sin él, las etiquetas van juntas como
 * `[#12 Rosa, #7 Javier] ` (el formato del tablero de Ghosty).
 */
export interface Reference {
  id: string;
  label: string;
  prompt?: string;
  /** Texto secundario del chip («el texto señalado»). */
  hint?: string;
}
