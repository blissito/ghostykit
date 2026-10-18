// Los pasos del agente en palabras de persona: «Leí 2 archivos · Busqué en la web».
// Puro (sin React) para poder probarlo y para que otras superficies (notificaciones, el teléfono)
// digan lo mismo.
import type { ToolEntry } from "./types";

/** El verbo con el que una persona nombraría un paso. `%n` = cuántas veces. */
export interface ToolVerb {
  one: string;
  many: string;
  /** Rótulo mientras corre (p. ej. «Compactando la memoria…»); si falta, `one`. */
  running?: string;
}

/** Por `kind` de ACP (`read`, `execute`…) o por NOMBRE de herramienta (`crm_card_update`). */
export type ToolVerbs = Record<string, ToolVerb>;

/** ¿Sigue corriendo? `pending` también: es el instante entre pedirla y arrancarla. */
export const isRunning = (t: ToolEntry) => t.status !== "completed" && t.status !== "failed";

/** `mcp__servidor__nombre` → `nombre`; cualquier otro título, tal cual. */
export function toolName(t: ToolEntry): string | null {
  const title = t.title ?? "";
  const m = /^mcp__[^_]+(?:_[^_]+)*?__([a-z0-9_]+)$/i.exec(title);
  if (m) return m[1];
  return title || null;
}

/** El verbo propio de ESTA herramienta (por nombre), si la app lo dio. */
function namedVerb(t: ToolEntry, verbs: ToolVerbs): { key: string; verb: ToolVerb } | null {
  const name = toolName(t);
  if (name && verbs[name]) return { key: name, verb: verbs[name] };
  return null;
}

/** El rótulo de un paso: el verbo de su nombre, o el título que manda el servidor, o su clase. */
export function stepLabel(t: ToolEntry, verbs: ToolVerbs, fallback = "Paso"): string {
  const named = namedVerb(t, verbs);
  if (named) return isRunning(t) && named.verb.running ? named.verb.running : named.verb.one;
  return t.title ?? t.kind ?? fallback;
}

/** El resumen de una línea: los pasos agrupados por nombre o clase, con su verbo. */
export function summarizeTools(tools: ToolEntry[], verbs: ToolVerbs): string {
  const groups = new Map<string, { n: number; verb?: ToolVerb }>();
  for (const t of tools) {
    const named = namedVerb(t, verbs);
    const key = named?.key ?? t.kind ?? "other";
    const g = groups.get(key) ?? { n: 0, verb: named?.verb ?? verbs[key] };
    g.n++;
    groups.set(key, g);
  }
  const parts: string[] = [];
  for (const [key, { n, verb }] of groups) {
    if (verb) parts.push(n === 1 ? verb.one : verb.many.replace("%n", String(n)));
    // Una herramienta desconocida NUNCA se esconde: se humaniza. Con lista blanca, el agente
    // corría ocho y la lista enseñaba tres.
    else parts.push(`${n} × ${key.replace(/[_-]/g, " ")}`);
  }
  return parts.join(" · ");
}

/**
 * Pasos iguales (mismo rótulo y detalle) en UN renglón con «×3», en el orden en que aparecieron.
 * El representante es el ÚLTIMO (su estado es el vigente), salvo que otro siga corriendo o haya
 * fallado: eso manda.
 */
export function groupSteps(tools: ToolEntry[], label: (t: ToolEntry) => string): { tool: ToolEntry; times: number }[] {
  const groups = new Map<string, { tool: ToolEntry; times: number }>();
  for (const t of tools) {
    const k = `${label(t)}\u0000${t.detail ?? ""}`;
    const g = groups.get(k);
    if (!g) {
      groups.set(k, { tool: t, times: 1 });
      continue;
    }
    g.times++;
    const wins = isRunning(t) || t.status === "failed" || !(isRunning(g.tool) || g.tool.status === "failed");
    if (wins) g.tool = { ...t, id: g.tool.id };
  }
  return [...groups.values()];
}

/** Los verbos de casa, en español. Las apps agregan los suyos (por nombre) con `toolVerbs`. */
export const TOOL_VERBS_ES: ToolVerbs = {
  read: { one: "Leí un archivo", many: "Leí %n archivos" },
  read_file: { one: "Leí un archivo", many: "Leí %n archivos" },
  write: { one: "Escribí un archivo", many: "Escribí %n archivos" },
  write_file: { one: "Escribí un archivo", many: "Escribí %n archivos" },
  edit: { one: "Edité un archivo", many: "Edité %n archivos" },
  edit_file: { one: "Edité un archivo", many: "Edité %n archivos" },
  bash: { one: "Corrí un comando", many: "Corrí %n comandos" },
  shell: { one: "Corrí un comando", many: "Corrí %n comandos" },
  terminal: { one: "Corrí un comando", many: "Corrí %n comandos" },
  execute: { one: "Corrí un comando", many: "Corrí %n comandos" },
  grep: { one: "Busqué en el código", many: "Busqué en el código" },
  glob: { one: "Busqué archivos", many: "Busqué archivos" },
  search: { one: "Busqué", many: "Busqué %n veces" },
  tool_search: { one: "Busqué una herramienta", many: "Busqué %n herramientas" },
  web_search: { one: "Busqué en la web", many: "Busqué en la web" },
  web_fetch: { one: "Abrí una página", many: "Abrí %n páginas" },
  fetch: { one: "Abrí una página", many: "Abrí %n páginas" },
  site_publish: { one: "Publiqué una página", many: "Publiqué %n páginas" },
  pdf: { one: "Generé un PDF", many: "Generé %n PDF" },
  connector: { one: "Usé tu sistema", many: "Usé tu sistema %n veces" },
  mcp: { one: "Usé una herramienta", many: "Usé %n herramientas" },
  browser: { one: "Usé el navegador", many: "Usé el navegador" },
  todo: { one: "Anoté el plan", many: "Anoté el plan" },
  delete: { one: "Borré un archivo", many: "Borré %n archivos" },
  move: { one: "Moví un archivo", many: "Moví %n archivos" },
  think: { one: "Lo pensé", many: "Lo pensé" },
  image: { one: "Creé una imagen", many: "Creé %n imágenes" },
  delegate: { one: "Delegué una tarea", many: "Delegué %n tareas" },
  collect: { one: "Recogí un resultado", many: "Recogí %n resultados" },
  status: { one: "Pregunté cómo iba", many: "Pregunté %n veces cómo iba" },
  stop: { one: "Detuve una tarea", many: "Detuve %n tareas" },
  guide: { one: "Leí una guía", many: "Leí %n guías" },
  deliver: { one: "Entregué un archivo", many: "Entregué %n archivos" },
  sheet: { one: "Consulté una hoja", many: "Consulté %n hojas" },
  view: { one: "Armé una vista", many: "Armé %n vistas" },
};

export const TOOL_VERBS_EN: ToolVerbs = {
  read: { one: "Read a file", many: "Read %n files" },
  read_file: { one: "Read a file", many: "Read %n files" },
  write: { one: "Wrote a file", many: "Wrote %n files" },
  write_file: { one: "Wrote a file", many: "Wrote %n files" },
  edit: { one: "Edited a file", many: "Edited %n files" },
  edit_file: { one: "Edited a file", many: "Edited %n files" },
  bash: { one: "Ran a command", many: "Ran %n commands" },
  shell: { one: "Ran a command", many: "Ran %n commands" },
  terminal: { one: "Ran a command", many: "Ran %n commands" },
  execute: { one: "Ran a command", many: "Ran %n commands" },
  grep: { one: "Searched the code", many: "Searched the code" },
  glob: { one: "Searched for files", many: "Searched for files" },
  search: { one: "Searched", many: "Searched %n times" },
  tool_search: { one: "Looked for a tool", many: "Looked for %n tools" },
  web_search: { one: "Searched the web", many: "Searched the web" },
  web_fetch: { one: "Opened a page", many: "Opened %n pages" },
  fetch: { one: "Opened a page", many: "Opened %n pages" },
  site_publish: { one: "Published a page", many: "Published %n pages" },
  pdf: { one: "Generated a PDF", many: "Generated %n PDFs" },
  connector: { one: "Used your system", many: "Used your system %n times" },
  mcp: { one: "Used a tool", many: "Used %n tools" },
  browser: { one: "Used the browser", many: "Used the browser" },
  todo: { one: "Wrote down the plan", many: "Wrote down the plan" },
  delete: { one: "Deleted a file", many: "Deleted %n files" },
  move: { one: "Moved a file", many: "Moved %n files" },
  think: { one: "Thought it through", many: "Thought it through" },
  image: { one: "Created an image", many: "Created %n images" },
  delegate: { one: "Delegated a task", many: "Delegated %n tasks" },
  collect: { one: "Collected a result", many: "Collected %n results" },
  status: { one: "Checked how it was going", many: "Checked %n times how it was going" },
  stop: { one: "Stopped a task", many: "Stopped %n tasks" },
  guide: { one: "Read a guide", many: "Read %n guides" },
  deliver: { one: "Delivered a file", many: "Delivered %n files" },
  sheet: { one: "Checked a sheet", many: "Checked %n sheets" },
  view: { one: "Built a view", many: "Built %n views" },
};
