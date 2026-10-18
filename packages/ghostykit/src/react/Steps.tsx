// Lo que el agente hizo, paso a paso. PORTADO de Ghosty Studio (`ToolSummary.tsx`, `ToolRow` y
// `Narracion` de `ChatView.tsx`) con el MISMO markup y clases: sólo cambian los textos (strings) y los
// verbos/íconos propios de la app (toolVerbs/toolIcons) en lugar de los de la plataforma de Ghosty.
//
// En vivo cada herramienta es un renglón debajo de tu mensaje; al cerrar el turno la MISMA vista se
// vuelve tarjeta (sólo aparecen borde y fondo), así que nada brinca. Tocarla despliega el detalle.
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  AppWindow,
  BookOpen,
  Check,
  ChevronRight,
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  FilePenLine,
  FileSpreadsheet,
  FileText,
  Folder,
  Globe,
  ImageIcon,
  Inbox,
  ListChecks,
  Loader2,
  OctagonX,
  Search,
  Send,
  UsersRound,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { groupSteps, isRunning, stepLabel, summarizeTools, toolNames } from "../core/steps";
import type { ToolEntry } from "../core/types";
import { usePiloto, type PilotIcon } from "./context";
import { InlineMarkdown } from "./InlineMarkdown";

/** La garra de máquina de peluches: el ícono de «usó una herramienta» (baja, cierra y sube en bucle). */
export function ClawIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={`gs-garra ${className ?? ""}`} aria-hidden="true">
      <g className="gs-garra-rig">
        <path d="M12 2v4" />
        <rect x="8.5" y="6" width="7" height="3.5" rx="1" />
        <g className="gs-garra-l">
          <path d="M9.5 9.5 6 14l2 4.5" />
        </g>
        <g className="gs-garra-r">
          <path d="M14.5 9.5 18 14l-2 4.5" />
        </g>
        <path d="M12 9.5v4" />
      </g>
    </svg>
  );
}

/** Brazo robot agarrando — «Robot grab» de Delapouite (game-icons.net, CC BY 3.0): los pasos técnicos. */
export function RobotArmIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" fill="currentColor" className={className} aria-hidden="true">
      <path d="M301.4 51.96c-46.6.1-85.3 18.16-105.2 50.84c-13.2 21.8-16.8 49.4-9.2 78q3 11.4 8.4 23.1q1.65-1.95 3.6-3.9c7.8-7.8 16.8-13.6 26.4-17.5c-1.5-3.8-2.7-7.4-3.6-10.9c-5.5-20.7-2.7-37 5.2-50.1c15.9-26.16 57.6-42.41 114.7-28.49l8.6-34.98c-16.9-4.11-33.3-6.09-48.9-6.07M454 161.7l-35 8.6c13.9 57.1-2.3 98.8-28.5 114.7c-13.1 7.9-29.4 10.7-50.1 5.2c-3.5-.9-7.1-2.1-10.7-3.5c-3.9 9.6-9.8 18.6-17.6 26.4c-1.3 1.3-2.5 2.5-3.9 3.6c7.8 3.5 15.4 6.3 23 8.3c28.6 7.6 56.2 4 78-9.2c43.6-26.5 61.3-86.6 44.8-154.1m-198.4 32.8c-15.9 0-31.8 6-43.9 18.2c-24.3 24.3-24.2 63.4 0 87.7c24.3 24.2 63.4 24.2 87.7 0c24.3-24.3 24.2-63.4 0-87.7c-12.1-12.2-28-18.2-43.8-18.2m0 21.1c10.5 0 21 4 28.9 11.9c16 15.9 16 42.1.1 58c-16 16-42.1 15.9-58 0s-16-42 0-58c7.9-8 18.5-11.9 29-11.9m0 17.9c-5.9 0-11.7 2.3-16.3 6.8c-9.1 9-9.1 23.4 0 32.5c9 9 23.5 9 32.5 0c9.1-9.1 9.1-23.5 0-32.5c-4.5-4.5-10.3-6.8-16.2-6.8m-80 25.1l-54.5 54.5l43.7 43.7l34.2 34.1l54.4-54.5c-19.8-.5-39.4-8.3-54.4-23.3c-15.1-15.1-22.9-34.7-23.4-54.5M63.41 313.2l8.11 40.6l86.68 86.7l40.6 8.1l-8.1-40.6l-86.7-86.6zM18.1 358.5l8.13 40.7l86.57 86.6l40.7 8.1l-8.1-40.6l-86.59-86.7zm-.1 57.9v64.8l32.45-32.4zm45.2 45.2L30.8 494h64.78z" />
    </svg>
  );
}

/** Máquina arcade (Iconoir «arcade», MIT): las herramientas de un MCP conectado. */
export function ArcadeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <path d="M11 8.5L9.8 9l-7.448 3.386a.6.6 0 0 0-.352.546v.136a.6.6 0 0 0 .352.546l8.82 4.01a2 2 0 0 0 1.656 0l8.82-4.01a.6.6 0 0 0 .352-.546v-.136a.6.6 0 0 0-.352-.546L14.2 9L13 8.5" />
      <path d="M22 13v4.112a.6.6 0 0 1-.354.547l-8.825 3.972a2 2 0 0 1-1.642 0l-8.825-3.972A.6.6 0 0 1 2 17.112V13" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8a3 3 0 1 1 0-6a3 3 0 0 1 0 6" />
      <path d="M11 8v5a1 1 0 1 0 2 0V8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 13h1" />
    </svg>
  );
}

/** Un ícono por tipo de herramienta (los de Ghosty); lo desconocido cae en la garra. */
export const DEFAULT_TOOL_ICONS: Record<string, PilotIcon> = {
  tool_search: Search,
  bash: RobotArmIcon,
  shell: RobotArmIcon,
  terminal: RobotArmIcon,
  execute: RobotArmIcon,
  read: FileText,
  read_file: FileText,
  write: FilePenLine,
  write_file: FilePenLine,
  edit: FilePenLine,
  edit_file: FilePenLine,
  grep: Search,
  glob: Search,
  search: Search,
  web_search: Globe,
  web_fetch: Globe,
  site_publish: Globe,
  pdf: FileText,
  connector: ArcadeIcon,
  fetch: Globe,
  browser: Globe,
  todo: ListChecks,
  list: ListChecks,
  code: RobotArmIcon,
  script: RobotArmIcon,
  folder: Folder,
  mcp: ArcadeIcon,
  image: ImageIcon,
  delegate: UsersRound,
  guide: BookOpen,
  deliver: Send,
  sheet: FileSpreadsheet,
  view: AppWindow,
  collect: Inbox,
  status: Activity,
  stop: OctagonX,
};

function iconFor(t: ToolEntry, icons: Record<string, PilotIcon>): PilotIcon {
  for (const name of toolNames(t)) if (icons[name]) return icons[name];
  // Sin ícono propio: una llave de herramienta (se entiende sola; la garra no).
  return (t.kind && (icons[t.kind] ?? DEFAULT_TOOL_ICONS[t.kind])) || icons["*"] || Wrench;
}

/** Cuántos pasos se ven sin desplegar. En vivo y plegada son los MISMOS: al cerrar no cambia el alto. */
const VISIBLE = 5;

export function AgentSteps({ tools, live }: { tools: ToolEntry[]; live: boolean }) {
  const { strings: t, toolVerbs } = usePiloto();
  const [open, setOpen] = useState(false);
  const failed = tools.filter((x) => x.status === "failed").length;
  // Pasos iguales (mismo rótulo y detalle) en UN renglón con «×3».
  const groups = groupSteps(tools, (x) => stepLabel(x, toolVerbs, t.step));
  const shown = groups.slice(-VISIBLE);
  const hidden = groups.length - shown.length;
  return (
    <div
      className={`piloto-steps mb-3 rounded-2xl border px-3 py-2.5 transition-[background-color,border-color] duration-300 ${
        live ? "border-transparent bg-transparent" : "border-border-primary bg-background-primary hover:bg-background-secondary/60"
      }`}
    >
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={open ? t.stepsCollapse : t.stepsExpand} className="block w-full cursor-pointer text-left">
        {open ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 rotate-90 text-text-tertiary" />
            <span className="truncate">
              {summarizeTools(tools, toolVerbs)}
              {failed > 0 && <span className="text-text-danger"> · {t.withProblems(failed)}</span>}
            </span>
          </span>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {hidden > 0 && <li className="text-[11px] font-medium text-text-tertiary">{t.earlierSteps(hidden)}</li>}
            {shown.map((g) => (
              <StepLine key={g.tool.id} tool={g.tool} times={g.times} live={live} />
            ))}
          </ul>
        )}
      </button>
      {open && (
        <div className="mt-2">
          <ul className="flex flex-col gap-1">
            {tools.map((x) => (
              <ToolRow key={x.id} tool={x} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Un renglón: estado a la izquierda, ícono de la clase y el rótulo con su detalle. */
function StepLine({ tool, times, live }: { tool: ToolEntry; times: number; live: boolean }) {
  const { strings: t, toolVerbs, toolIcons } = usePiloto();
  const KindIcon = iconFor(tool, toolIcons);
  // Con el turno cerrado, una herramienta sin estado final ya no corre: sin giro eterno.
  const spins = isRunning(tool) && live;
  const label = stepLabel(tool, toolVerbs, t.step);
  return (
    <li className="gs-paso-in flex min-w-0 items-center gap-2 text-[13px] leading-6 text-text-secondary">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-label={spins ? t.running : tool.status === "failed" ? t.failed : t.done}>
        {spins ? (
          <Loader2 className="h-4 w-4 animate-spin text-text-info" />
        ) : tool.status === "cancelled" ? (
          // El run se detuvo antes de que terminara.
          <CircleSlash className="h-4 w-4 text-text-tertiary" />
        ) : tool.status === "pending" ? (
          // Espera aprobación (el run se detuvo en un interrupt): ni gira ni está lista.
          <Clock className="h-4 w-4 text-text-tertiary" />
        ) : tool.status === "failed" ? (
          <CircleX className="h-4 w-4 text-text-danger" />
        ) : (
          <CircleCheck className="h-4 w-4 text-text-success" />
        )}
      </span>
      <KindIcon className="h-[22px] w-[22px] shrink-0 text-text-secondary" />
      <span className="min-w-0 truncate">
        <span className={spins ? "text-text-primary" : undefined}>{label}</span>
        {tool.detail && <span className="text-text-tertiary"> · {tool.detail}</span>}
        {times > 1 && <span className="ml-1 tabular-nums text-text-tertiary">×{times}</span>}
      </span>
    </li>
  );
}

// Una herramienta del agente, con su estado según ACP: pending → in_progress → completed | failed.
const STATUS: Record<string, { Icon: PilotIcon; className: string; key: "step" | "running" | "done" | "failed" }> = {
  pending: { Icon: Clock, className: "text-text-tertiary", key: "step" },
  in_progress: { Icon: Loader2, className: "animate-spin text-text-info", key: "running" },
  completed: { Icon: CircleCheck, className: "text-text-success", key: "done" },
  cancelled: { Icon: CircleSlash, className: "text-text-tertiary", key: "step" },
  failed: { Icon: CircleX, className: "text-text-danger", key: "failed" },
};

export function ToolRow({ tool }: { tool: ToolEntry }) {
  const { strings: t, toolVerbs, toolIcons } = usePiloto();
  const s = STATUS[tool.status ?? "pending"] ?? STATUS.pending;
  const StatusIcon = s.Icon;
  const KindIcon = iconFor(tool, toolIcons);
  return (
    <li className="flex items-start gap-2.5 rounded-lg border border-border-secondary bg-background-secondary/50 px-3 py-2 transition-colors hover:border-border-primary hover:bg-background-secondary">
      <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background-primary text-text-secondary shadow-sm">
        <KindIcon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-xs font-medium text-text-primary">{stepLabel(tool, toolVerbs, tool.id)}</span>
        </span>
        {tool.detail && <span className="mt-0.5 block truncate text-[11px] text-text-tertiary">{tool.detail}</span>}
        {tool.path && <span className="mt-0.5 block truncate font-mono text-[10px] text-text-tertiary">{tool.path}</span>}
      </span>
      <span className="mt-0.5 shrink-0" title={t[s.key]} aria-label={t[s.key]}>
        <StatusIcon className={`h-3.5 w-3.5 ${s.className}`} />
      </span>
    </li>
  );
}

/** La narración del agente como avance: una palomita por lo que ya dijo que hacía. */
export function Narration({ steps }: { steps: string[] }) {
  return (
    <ul className="gs-narracion mb-3 flex flex-col gap-1.5">
      <AnimatePresence initial={false}>
        {steps.map((p, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="flex items-start gap-2 text-text-secondary"
          >
            <span className="mt-[3px] grid size-4 shrink-0 place-items-center rounded-full bg-brand-500/15 text-brand-500">
              <Check size={11} strokeWidth={3} />
            </span>
            <span className="piloto-narration-text min-w-0">
              <InlineMarkdown>{p}</InlineMarkdown>
            </span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
