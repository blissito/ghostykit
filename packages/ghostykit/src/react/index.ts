// ghostykit (y ghostykit/react) — el chat de Piloto para React, sobre AG-UI.
export { Piloto, Piloto as default, type PilotoFeatures, type PilotoHandle, type PilotoProps } from "./Piloto";
export {
  definePlugin,
  pluginPoints,
  pluginRequires,
  resolvePlugins,
  type PilotoPlugin,
  type PluginCtx,
  type PluginEvent,
  type PluginView,
  type ResolvedPlugins,
} from "./plugins";
export { toAgUiContext, usePilot, type Pilot, type SendOptions, type TurnDoneInfo, type UsePilotOptions } from "./usePilot";
export { AgentBubble, CopyUserMessage, ReplyOptionButtons, TurnFooter, UsageStats, UserBubble, type AgentBubbleProps } from "./Bubble";
export { AgentSteps, ArcadeIcon, ClawIcon, DEFAULT_TOOL_ICONS, Narration, RobotArmIcon, ToolRow } from "./Steps";
export { LinkSafetyModal, Markdown } from "./Markdown";
export { InlineMarkdown, renderInline } from "./InlineMarkdown";
export { useTextAtPace } from "./TextAtPace";
export { Composer, ModelPicker, mimeOf, type ComposerProps, type ModelOption, type UploadResult } from "./Composer";
export { ConfirmCard, DecisionLines } from "./ConfirmCard";
export { ReferenceChips, Suggestions } from "./Chips";
export { TypingDots, WaitLabel } from "./Status";
export { Subagents, type SubagentsProps } from "./Subagents";
export { PilotoContext, usePiloto, type MarkdownOptions, type PilotIcon, type PilotoConfig, type PilotTheme } from "./context";
export { STRINGS_EN, STRINGS_ES, type PilotStrings } from "./strings";
// Lo de core y transport, para quien sólo instala `ghostykit`.
export * from "../core";
export { PilotHttpError, createAgUiTransport, readSse, type AgUiTransportOptions, type PilotTransport, type SseMessage } from "../transport";
