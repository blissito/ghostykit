// ghostykit/core — el estado del chat sin React: tipos, reductor puro sobre eventos AG-UI y parsers.
export * from "./types";
export {
  argsDetail,
  beginSend,
  beginSteer,
  createPilotState,
  dropLastExchange,
  expiryMs,
  lastUserTurn,
  markSubagent,
  messagesToTurns,
  prependHistory,
  queueMessage,
  reduceAgUiEvent,
  resolvePermission,
  sendFailed,
  stopTurn,
  subagentsOf,
  takeQueued,
  toPermission,
} from "./reducer";
export { applyJsonPatch, type PatchOp } from "./jsonPatch";
export { extractBlocks, isNarration, narrationToMarkdown, splitNarration, type TextBlock } from "./narration";
export { cleanReplyOption, extractReplyOptions, type ReplyOptions } from "./options";
export {
  TOOL_VERBS_EN,
  TOOL_VERBS_ES,
  groupSteps,
  isRunning,
  stepLabel,
  summarizeTools,
  toolName,
  toolNames,
  type ToolVerb,
  type ToolVerbs,
} from "./steps";
export { applyReferences, cleanUserText, formatDuration, systemNoteOf } from "./text";
