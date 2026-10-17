// ghostykit/core — el estado del chat sin React: tipos, reductor puro y parsers.
export * from "./types";
export {
  RESTART_NOTICE,
  RESUME_TEXT,
  appendAgentMessages,
  beginSend,
  createPilotState,
  dropLastExchange,
  expiryMs,
  lastUserTurn,
  reconcileWith,
  reducePilotEvent,
  resolvePermission,
  resumeMode,
  sendAccepted,
  sendFailed,
  sendRejectedBusy,
  stopTurn,
} from "./reducer";
export { reconcileTurns } from "./reconcile";
export { isNarration, narrationToMarkdown, splitNarration } from "./narration";
export { cleanReplyOption, extractReplyOptions, type ReplyOptions } from "./options";
export {
  TOOL_VERBS_EN,
  TOOL_VERBS_ES,
  groupSteps,
  isRunning,
  stepLabel,
  summarizeTools,
  toolName,
  type ToolVerb,
  type ToolVerbs,
} from "./steps";
export { applyReferences, cleanUserText, formatDuration, systemNoteOf } from "./text";
