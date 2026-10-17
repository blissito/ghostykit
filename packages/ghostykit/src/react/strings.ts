// Todo lo que Piloto dice, en español (default) e inglés. Una app cambia lo que quiera con `strings`.
import type { ConnectPhase } from "../core/types";

export interface PilotStrings {
  /** Para formatear números y moneda. */
  numberLocale: string;
  placeholder: (agentName: string) => string;
  placeholderConnecting: string;
  send: string;
  stop: string;
  uploading: string;
  uploadingN: (n: number) => string;
  attachImage: string;
  attachFile: string;
  noImages: string;
  removeAttachment: string;
  removeReference: string;
  dropFiles: string;
  dropHint: string;
  tooBig: (name: string, mb: number) => string;
  tooMany: (max: number) => string;
  cantSeeImage: (name: string) => string;
  cantUpload: (name: string) => string;
  uploadFailed: string;
  recordVoice: string;
  voiceNote: string;
  cancelVoice: string;
  stopAndSendVoice: string;
  micDenied: string;
  voiceEmpty: string;
  voiceFailed: string;
  model: string;
  thinking: string;
  steered: string;
  /** Lo que se ve mientras conecta, por fase (en primera persona: habla el agente). */
  waitPhase: Record<ConnectPhase, string>;
  /** Qué dice el agente de un turno del que sólo sabe cuánto lleva. */
  howItGoes: (seconds: number) => string;
  /** Frases propias mientras piensa (rotan cada 4 s en lugar de `howItGoes`). */
  thinkingPhrases?: string[];
  stillWorking: string;
  cantStart: string;
  retry: string;
  resume: string;
  /** Con `interrupted.canContinue`: el servidor continúa ESE turno. */
  continueTurn: string;
  interrupted: (reason: string) => string;
  interruptedOurFault: string;
  copy: string;
  copied: string;
  copyMessage: string;
  worked: (seconds: number) => string;
  stepsExpand: string;
  stepsCollapse: string;
  earlierSteps: (n: number) => string;
  withProblems: (n: number) => string;
  running: string;
  done: string;
  failed: string;
  step: string;
  replyOptions: string;
  connectSteps: { label: string; hint: string }[];
  connectRetry: string;
  linkTitle: string;
  linkCopy: string;
  linkCopied: string;
  linkOpen: string;
  close: string;
  goToLatest: string;
  confirmTitle: string;
  approve: string;
  reject: string;
  confirmExpired: string;
  confirmFailed: string;
  /** «Vence en 14:32». */
  expiresIn: (mmss: string) => string;
  expiredNow: string;
  decisionApproved: string;
  decisionRejected: string;
  decisionExpired: string;
}

export const STRINGS_ES: PilotStrings = {
  numberLocale: "es-MX",
  placeholder: (agent) => `Escríbele a ${agent}`,
  placeholderConnecting: "Conectando con el agente…",
  send: "Enviar",
  stop: "Detener",
  uploading: "Subiendo tu archivo…",
  uploadingN: (n) => `Subiendo tus ${n} archivos…`,
  attachImage: "Adjuntar imagen",
  attachFile: "Adjuntar archivo",
  noImages: "Este agente no ve imágenes",
  removeAttachment: "Quitar adjunto",
  removeReference: "Quitar referencia",
  dropFiles: "Suelta tus archivos",
  dropHint: "Excel, Word, PDF o imágenes",
  tooBig: (name, mb) => `${name} pesa más de ${mb} MB`,
  tooMany: (max) => `no caben más de ${max} archivos por mensaje`,
  cantSeeImage: (name) => `${name}: este agente no ve imágenes`,
  cantUpload: (name) => `${name}: aquí sólo se pueden mandar imágenes y texto`,
  uploadFailed: "no se pudo subir el archivo",
  recordVoice: "Grabar nota de voz",
  voiceNote: "Nota de voz",
  cancelVoice: "Cancelar la nota de voz",
  stopAndSendVoice: "Parar y mandar la nota de voz",
  micDenied: "No tengo permiso para usar el micrófono.",
  voiceEmpty: "no se entendió nada en la nota de voz",
  voiceFailed: "no se pudo mandar la nota de voz",
  model: "Modelo",
  thinking: "Pensando…",
  steered: "Se lo pasé al turno en curso",
  waitPhase: {
    waking: "Me estoy poniendo los lentes 👓",
    connecting: "Estoy abriendo mi libreta",
    session: "Estoy pensando",
  },
  howItGoes: (s) =>
    s < 6 ? "Pensando…"
    : s < 15 ? "Trabajando…"
    : s < 60 ? "Estoy en ello…"
    : s < 120 ? "Esto me lleva un poco…"
    : s < 300 ? "Llevo un buen rato…"
    : "Me está tomando mucho — puedes detenerme",
  stillWorking: "Estoy en ello…",
  cantStart: "No pude arrancar.",
  retry: "Reintentar",
  resume: "Retomar",
  continueTurn: "Continuar",
  interrupted: (reason) => `Me quedé a medias: ${reason}.`,
  interruptedOurFault: "Se cortó por una falla nuestra, no por tu mensaje.",
  copy: "Copiar",
  copied: "Copiado",
  copyMessage: "Copiar mensaje",
  worked: (s) => `Trabajó ${s} s`,
  stepsExpand: "Ver el detalle de los pasos",
  stepsCollapse: "Plegar los pasos",
  earlierSteps: (n) => (n === 1 ? "1 paso antes" : `${n} pasos antes`),
  withProblems: (n) => (n === 1 ? "1 con problemas" : `${n} con problemas`),
  running: "Ejecutando",
  done: "Lista",
  failed: "Falló",
  step: "Paso",
  replyOptions: "Opciones para responder",
  connectSteps: [
    { label: "Despertando al agente", hint: "si estaba dormido, unos segundos" },
    { label: "Abriendo el canal", hint: "conexión segura con su máquina" },
    { label: "Creando la sesión", hint: "el agente carga su contexto" },
  ],
  connectRetry: "Reintentar",
  linkTitle: "Vas a salir de aquí",
  linkCopy: "Copiar",
  linkCopied: "Copiado",
  linkOpen: "Abrir",
  close: "Cerrar",
  goToLatest: "Ir al último mensaje",
  confirmTitle: "El agente pide tu permiso",
  approve: "Aprobar",
  reject: "Rechazar",
  confirmExpired: "Este pedido ya no estaba abierto (se agotó el plazo).",
  confirmFailed: "No se pudo mandar tu respuesta. Intenta de nuevo.",
  expiresIn: (t) => `Vence en ${t}`,
  expiredNow: "Venció sin respuesta",
  decisionApproved: "Aprobaste",
  decisionRejected: "Rechazaste",
  decisionExpired: "Venció",
};

export const STRINGS_EN: PilotStrings = {
  numberLocale: "en-US",
  placeholder: (agent) => `Message ${agent}`,
  placeholderConnecting: "Connecting to the agent…",
  send: "Send",
  stop: "Stop",
  uploading: "Uploading your file…",
  uploadingN: (n) => `Uploading your ${n} files…`,
  attachImage: "Attach image",
  attachFile: "Attach file",
  noImages: "This agent can't see images",
  removeAttachment: "Remove attachment",
  removeReference: "Remove reference",
  dropFiles: "Drop your files",
  dropHint: "Excel, Word, PDF or images",
  tooBig: (name, mb) => `${name} is larger than ${mb} MB`,
  tooMany: (max) => `no more than ${max} files per message`,
  cantSeeImage: (name) => `${name}: this agent can't see images`,
  cantUpload: (name) => `${name}: only images and text can be sent here`,
  uploadFailed: "couldn't upload the file",
  recordVoice: "Record voice note",
  voiceNote: "Voice note",
  cancelVoice: "Cancel voice note",
  stopAndSendVoice: "Stop and send voice note",
  micDenied: "I don't have permission to use the microphone.",
  voiceEmpty: "nothing was understood in the voice note",
  voiceFailed: "couldn't send the voice note",
  model: "Model",
  thinking: "Thinking…",
  steered: "Passed it to the running turn",
  waitPhase: {
    waking: "Putting my glasses on 👓",
    connecting: "Opening my notebook",
    session: "Thinking",
  },
  howItGoes: (s) =>
    s < 6 ? "Thinking…"
    : s < 15 ? "Working…"
    : s < 60 ? "On it…"
    : s < 120 ? "This is taking a bit…"
    : s < 300 ? "Been at it a while…"
    : "This is taking long — you can stop me",
  stillWorking: "On it…",
  cantStart: "Couldn't start.",
  retry: "Retry",
  resume: "Resume",
  continueTurn: "Continue",
  interrupted: (reason) => `I stopped halfway: ${reason}.`,
  interruptedOurFault: "It stopped because of an error on our side, not your message.",
  copy: "Copy",
  copied: "Copied",
  copyMessage: "Copy message",
  worked: (s) => `Worked ${s} s`,
  stepsExpand: "See step details",
  stepsCollapse: "Collapse the steps",
  earlierSteps: (n) => (n === 1 ? "1 earlier step" : `${n} earlier steps`),
  withProblems: (n) => `${n} with problems`,
  running: "Running",
  done: "Done",
  failed: "Failed",
  step: "Step",
  replyOptions: "Reply options",
  connectSteps: [
    { label: "Waking the agent", hint: "if it was asleep, a few seconds" },
    { label: "Opening the channel", hint: "secure connection to its machine" },
    { label: "Creating the session", hint: "the agent loads its context" },
  ],
  connectRetry: "Retry",
  linkTitle: "You're about to leave",
  linkCopy: "Copy",
  linkCopied: "Copied",
  linkOpen: "Open",
  close: "Close",
  goToLatest: "Go to latest message",
  confirmTitle: "The agent asks for your permission",
  approve: "Approve",
  reject: "Reject",
  confirmExpired: "This request was no longer open (it timed out).",
  confirmFailed: "Couldn't send your answer. Try again.",
  expiresIn: (t) => `Expires in ${t}`,
  expiredNow: "Expired without an answer",
  decisionApproved: "You approved",
  decisionRejected: "You rejected",
  decisionExpired: "Expired",
};
