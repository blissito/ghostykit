// Lo que el agente hizo, paso a paso (como claude.ai). En vivo cada herramienta es un renglón; al
// terminar el turno la MISMA vista se vuelve tarjeta (sólo aparecen borde y fondo), así nada brinca.
// Tocarla despliega la lista completa con el detalle.
import {
  AppWindow,
  BookOpen,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  FilePenLine,
  FileSpreadsheet,
  FileText,
  Folder,
  Globe,
  ImageIcon,
  ListChecks,
  Loader2,
  Search,
  Send,
  SquareTerminal,
  UsersRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { groupSteps, isRunning, stepLabel, summarizeTools, toolName } from "../core/steps";
import type { ToolEntry } from "../core/types";
import { usePiloto, type PilotIcon } from "./context";

/** La garra de máquina de peluches: el ícono de «usó una herramienta» que no tiene clase propia. */
export function ClawIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={`piloto-claw ${className ?? ""}`} aria-hidden="true">
      <g className="piloto-claw-rig">
        <path d="M12 2v4" />
        <rect x="8.5" y="6" width="7" height="3.5" rx="1" />
        <g className="piloto-claw-l">
          <path d="M9.5 9.5 6 14l2 4.5" />
        </g>
        <g className="piloto-claw-r">
          <path d="M14.5 9.5 18 14l-2 4.5" />
        </g>
        <path d="M12 9.5v4" />
      </g>
    </svg>
  );
}

/** Íconos de casa por `kind`. Lo desconocido cae en la garra. */
export const DEFAULT_TOOL_ICONS: Record<string, PilotIcon> = {
  tool_search: Search,
  bash: SquareTerminal,
  shell: SquareTerminal,
  terminal: SquareTerminal,
  execute: SquareTerminal,
  code: SquareTerminal,
  script: SquareTerminal,
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
  fetch: Globe,
  browser: Globe,
  site_publish: Globe,
  pdf: FileText,
  todo: ListChecks,
  list: ListChecks,
  folder: Folder,
  image: ImageIcon,
  delegate: UsersRound,
  guide: BookOpen,
  deliver: Send,
  sheet: FileSpreadsheet,
  view: AppWindow,
};

function iconFor(t: ToolEntry, icons: Record<string, PilotIcon>): PilotIcon {
  const name = toolName(t);
  return (name && icons[name]) || (t.kind && (icons[t.kind] ?? DEFAULT_TOOL_ICONS[t.kind])) || ClawIcon;
}

/** Cuántos pasos se ven sin desplegar. En vivo y plegada son los MISMOS: al cerrar no cambia el alto. */
const VISIBLE = 5;

export function AgentSteps({ tools, live }: { tools: ToolEntry[]; live: boolean }) {
  const { strings: t, toolVerbs } = usePiloto();
  const [open, setOpen] = useState(false);
  const label = (x: ToolEntry) => stepLabel(x, toolVerbs, t.step);
  const failed = tools.filter((x) => x.status === "failed").length;
  const groups = groupSteps(tools, label);
  const shown = groups.slice(-VISIBLE);
  const hidden = groups.length - shown.length;
  return (
    <div className="piloto-steps mb-3 rounded-(--piloto-radius-card) border px-3 py-2.5 transition-[background-color,border-color] duration-300" data-live={live || undefined}>
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
        <ul className="mt-2 flex flex-col gap-1">
          {tools.map((x) => (
            <ToolRow key={x.id} tool={x} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Un renglón: estado a la izquierda, ícono de la clase y el rótulo con su detalle. */
function StepLine({ tool, times, live }: { tool: ToolEntry; times: number; live: boolean }) {
  const { strings: t, toolVerbs, toolIcons } = usePiloto();
  const Icon = iconFor(tool, toolIcons);
  // Con el turno cerrado, una herramienta sin estado final ya no corre: sin giro eterno.
  const spins = isRunning(tool) && live;
  const label = stepLabel(tool, toolVerbs, t.step);
  return (
    <li className="piloto-step flex min-w-0 items-center gap-2 text-[13px] leading-6 text-text-secondary">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-label={spins ? t.running : tool.status === "failed" ? t.failed : t.done}>
        {spins ? (
          <Loader2 className="h-4 w-4 animate-spin text-text-info" />
        ) : tool.status === "failed" ? (
          <CircleX className="h-4 w-4 text-text-danger" />
        ) : (
          <CircleCheck className="h-4 w-4 text-text-success" />
        )}
      </span>
      <Icon className="h-[22px] w-[22px] shrink-0 text-text-secondary" />
      <span className="min-w-0 truncate">
        <span className={spins ? "text-text-primary" : undefined}>{label}</span>
        {tool.detail && <span className="text-text-tertiary"> · {tool.detail}</span>}
        {times > 1 && <span className="ml-1 tabular-nums text-text-tertiary">×{times}</span>}
      </span>
    </li>
  );
}

const STATUS: Record<string, { Icon: PilotIcon; className: string; key: "running" | "done" | "failed" | "step" }> = {
  pending: { Icon: Clock, className: "text-text-tertiary", key: "step" },
  in_progress: { Icon: Loader2, className: "animate-spin text-text-info", key: "running" },
  completed: { Icon: CircleCheck, className: "text-text-success", key: "done" },
  failed: { Icon: CircleX, className: "text-text-danger", key: "failed" },
};

/** El detalle de un paso (lista desplegada): rótulo, detalle y ruta. */
export function ToolRow({ tool }: { tool: ToolEntry }) {
  const { strings: t, toolVerbs, toolIcons } = usePiloto();
  const s = STATUS[tool.status ?? "pending"] ?? STATUS.pending;
  const KindIcon = iconFor(tool, toolIcons);
  return (
    <li className="piloto-tool-row flex items-start gap-2.5 rounded-(--piloto-radius-input) border border-border-secondary bg-background-secondary/50 px-3 py-2 transition-colors hover:border-border-primary hover:bg-background-secondary">
      <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background-primary text-text-secondary shadow-sm">
        <KindIcon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block min-w-0 truncate text-xs font-medium text-text-primary">{stepLabel(tool, toolVerbs, tool.id)}</span>
        {tool.detail && <span className="mt-0.5 block truncate text-[11px] text-text-tertiary">{tool.detail}</span>}
        {tool.path && <span className="mt-0.5 block truncate font-mono text-[10px] text-text-tertiary">{tool.path}</span>}
      </span>
      <span className="mt-0.5 shrink-0" title={t[s.key]} aria-label={t[s.key]}>
        <s.Icon className={`h-3.5 w-3.5 ${s.className}`} />
      </span>
    </li>
  );
}

/** La narración del agente como avance: una palomita por lo que ya dijo que hacía. */
export function Narration({ steps, children }: { steps: string[]; children?: ReactNode }) {
  return (
    <ul className="piloto-narration mb-3 flex flex-col gap-1.5">
      {steps.map((p, i) => (
        <li key={i} className="piloto-fade-up flex items-start gap-2 text-text-secondary">
          <span className="mt-[3px] grid size-4 shrink-0 place-items-center rounded-full bg-brand-500/15 text-brand-600">
            <CheckMini />
          </span>
          <span className="min-w-0">{p}</span>
        </li>
      ))}
      {children}
    </ul>
  );
}

function CheckMini() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
