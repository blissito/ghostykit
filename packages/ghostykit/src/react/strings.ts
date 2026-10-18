// Todo lo que Piloto dice, en español (default) e inglés. Una app cambia lo que quiera con `strings`.

export interface PilotStrings {
  /** Para formatear números y moneda. */
  numberLocale: string;
  placeholder: (agentName: string) => string;
  /** Sin `agentName`. */
  placeholderDefault: string;
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
  /** Qué dice el agente de un turno del que sólo sabe cuánto lleva. */
  howItGoes: (seconds: number) => string;
  /** Frases propias mientras piensa (rotan cada 4 s en lugar de `howItGoes`). */
  thinkingPhrases?: string[];
  stillWorking: string;
  retry: string;
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
  linkTitle: string;
  linkCopy: string;
  linkCopied: string;
  linkOpen: string;
  close: string;
  goToLatest: string;
  /** La frase de espera de cada paso con nombre (`STEP_STARTED.stepName`). Los que no estén aquí no se pintan. */
  steps: Record<string, string>;
  loadOlder: string;
  loadingOlder: string;
  /** Bajo un mensaje que espera a que termine el run vivo. */
  queued: string;
  /** «2 agentes trabajando». */
  subagentsWorking: (n: number) => string;
  /** Sin ninguno corriendo. */
  subagentsDone: (n: number) => string;
  subagentStop: string;
  subagentStatus: Record<string, string>;
  confirmTitle: string;
  approve: string;
  reject: string;
  /** «Vence en 14:32». */
  expiresIn: (mmss: string) => string;
  expiredNow: string;
  decisionApproved: string;
  decisionRejected: string;
  decisionExpired: string;
  decisionCancelled: string;
  stampCancelled: string;
  stampApproved: string;
  stampRejected: string;
  stampExpired: string;
}

export const STRINGS_ES: PilotStrings = {
  numberLocale: "es-MX",
  placeholder: (agent) => `Escríbele a ${agent}`,
  placeholderDefault: "Escríbele al agente",
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
  howItGoes: (s) =>
    s < 6 ? "Pensando…"
    : s < 15 ? "Trabajando…"
    : s < 60 ? "Estoy en ello…"
    : s < 120 ? "Esto me lleva un poco…"
    : s < 300 ? "Llevo un buen rato…"
    : "Me está tomando mucho — puedes detenerme",
  stillWorking: "Estoy en ello…",
  retry: "Reintentar",
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
  linkTitle: "Vas a salir de aquí",
  linkCopy: "Copiar",
  linkCopied: "Copiado",
  linkOpen: "Abrir",
  close: "Cerrar",
  goToLatest: "Ir al último mensaje",
  steps: { waking: "Despertando al agente…", session: "Preparando la sesión…", compacting: "Resumiendo la conversación…" },
  loadOlder: "Cargar mensajes anteriores",
  loadingOlder: "Cargando…",
  queued: "Se manda cuando termine",
  subagentsWorking: (n) => (n === 1 ? "1 agente trabajando" : `${n} agentes trabajando`),
  subagentsDone: (n) => (n === 1 ? "1 agente terminó" : `${n} agentes terminaron`),
  subagentStop: "Detener",
  subagentStatus: { running: "Trabajando", completed: "Terminó", failed: "Falló", stopped: "Detenido" },
  confirmTitle: "Necesito tu permiso para",
  approve: "Aprobar",
  reject: "Rechazar",
  expiresIn: (t) => `Vence en ${t}`,
  expiredNow: "Venció sin respuesta",
  decisionApproved: "Aprobaste",
  decisionRejected: "Rechazaste",
  decisionExpired: "Venció",
  decisionCancelled: "Descartaste",
  stampCancelled: "Descartado",
  stampApproved: "Aprobado",
  stampRejected: "Rechazado",
  stampExpired: "Vencido",
};

export const STRINGS_EN: PilotStrings = {
  numberLocale: "en-US",
  placeholder: (agent) => `Message ${agent}`,
  placeholderDefault: "Message the agent",
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
  howItGoes: (s) =>
    s < 6 ? "Thinking…"
    : s < 15 ? "Working…"
    : s < 60 ? "On it…"
    : s < 120 ? "This is taking a bit…"
    : s < 300 ? "Been at it a while…"
    : "This is taking long — you can stop me",
  stillWorking: "On it…",
  retry: "Retry",
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
  linkTitle: "You're about to leave",
  linkCopy: "Copy",
  linkCopied: "Copied",
  linkOpen: "Open",
  close: "Close",
  goToLatest: "Go to latest message",
  steps: { waking: "Waking the agent…", session: "Starting the session…", compacting: "Compacting the conversation…" },
  loadOlder: "Load earlier messages",
  loadingOlder: "Loading…",
  queued: "Sends when this finishes",
  subagentsWorking: (n) => (n === 1 ? "1 agent working" : `${n} agents working`),
  subagentsDone: (n) => (n === 1 ? "1 agent finished" : `${n} agents finished`),
  subagentStop: "Stop",
  subagentStatus: { running: "Working", completed: "Done", failed: "Failed", stopped: "Stopped" },
  confirmTitle: "I need your permission to",
  approve: "Approve",
  reject: "Reject",
  expiresIn: (t) => `Expires in ${t}`,
  expiredNow: "Expired without an answer",
  decisionApproved: "You approved",
  decisionRejected: "You rejected",
  decisionExpired: "Expired",
  decisionCancelled: "You dismissed",
  stampCancelled: "Dismissed",
  stampApproved: "Approved",
  stampRejected: "Rejected",
  stampExpired: "Expired",
};
