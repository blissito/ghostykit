// ghostykit (y ghostykit/react) — el chat de Piloto para React.
export { Piloto, Piloto as default, type PilotoFeatures, type PilotoHandle, type PilotoProps, type PilotoSlots } from "./Piloto";
export { usePilot, useSseTransport, type Pilot, type SendOptions, type TurnDoneInfo, type UsePilotOptions } from "./usePilot";
export { AgentBubble, CopyUserMessage, DeliveryChips, ReplyOptionButtons, TurnFooter, UsageStats, UserBubble, type AgentBubbleProps } from "./Bubble";
export { AgentSteps, ClawIcon, DEFAULT_TOOL_ICONS, Narration, ToolRow } from "./Steps";
export { LinkSafetyModal, Markdown } from "./Markdown";
export { useTextAtPace } from "./TextAtPace";
export { Composer, ModelPicker, mimeOf, type ComposerProps, type UploadResult } from "./Composer";
export { ConfirmCard } from "./ConfirmCard";
export { ReferenceChips, Suggestions } from "./Chips";
export { ConnectingState, TypingDots, WaitLabel } from "./Status";
export { PilotoContext, usePiloto, type MarkdownOptions, type PilotIcon, type PilotoConfig, type PilotTheme } from "./context";
export { STRINGS_EN, STRINGS_ES, type PilotStrings } from "./strings";
// Lo de core y transport, para quien sólo instala `ghostykit`.
export * from "../core";
export { PilotHttpError, createSseTransport, type PilotListener, type PilotTransport, type SseTransportOptions, type SubscribeOptions } from "../transport";
