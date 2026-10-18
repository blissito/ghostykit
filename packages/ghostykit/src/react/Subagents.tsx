// La barra de subagentes: «2 agentes trabajando» encima del composer y, al abrirla, uno por renglón
// con su última herramienta y «Detener». Sale de `state.subagents.tasks` (gs-agui 1 §0.5); va en el
// slot `aboveComposer` o `sidePanel` (`(pilot) => <Subagents pilot={pilot} />`).
import { useState } from "react";
import type { SubagentTask } from "../core/types";
import { usePiloto } from "./context";
import type { Pilot } from "./usePilot";

export interface SubagentsProps {
  pilot: Pick<Pilot, "subagents" | "stopSubagent">;
  /** Abierta de entrada. Default: no. */
  defaultOpen?: boolean;
  /** Los que ya entregaron también se listan. Default: sí. */
  showFinished?: boolean;
  className?: string;
}

const DOT: Record<string, string> = {
  running: "bg-brand-500 animate-pulse",
  completed: "bg-text-tertiary",
  failed: "bg-text-danger",
  stopped: "bg-text-disabled",
};

export function Subagents({ pilot, defaultOpen = false, showFinished = true, className = "" }: SubagentsProps) {
  const { strings: t } = usePiloto();
  const [open, setOpen] = useState(defaultOpen);
  const all = pilot.subagents;
  const tasks = showFinished ? all : all.filter((x) => x.status === "running");
  if (!tasks.length) return null;
  const running = all.filter((x) => x.status === "running").length;
  return (
    <div data-subagents className={`mb-2 rounded-2xl border border-border-primary bg-background-secondary text-sm ${className}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary">
        <span className={`h-2 w-2 shrink-0 rounded-full ${running ? DOT.running : DOT.completed}`} />
        <span className="flex-1 truncate">{running ? t.subagentsWorking(running) : t.subagentsDone(tasks.length)}</span>
        <span aria-hidden className={`text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open && (
        <ul className="flex flex-col border-t border-border-primary">
          {tasks.map((task) => (
            <SubagentRow key={task.id} task={task} onStop={() => void pilot.stopSubagent(task.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SubagentRow({ task, onStop }: { task: SubagentTask; onStop: () => void }) {
  const { strings: t } = usePiloto();
  const line = task.status === "running" ? task.lastTool : (task.summary ?? task.lastTool);
  return (
    <li data-subagent={task.id} data-status={task.status} className="flex items-center gap-2 px-3 py-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[task.status] ?? DOT.completed}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-text-primary">{task.title ?? task.id}</div>
        <div className="truncate text-xs text-text-tertiary">
          {t.subagentStatus[task.status] ?? task.status}
          {line ? ` · ${line}` : ""}
        </div>
      </div>
      {task.status === "running" && (
        <button type="button" onClick={onStop} className="shrink-0 rounded-full border border-border-primary px-2.5 py-0.5 text-xs text-text-secondary transition hover:text-text-danger">
          {t.subagentStop}
        </button>
      )}
    </li>
  );
}
