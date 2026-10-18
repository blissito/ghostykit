// Los plugins de <Piloto>: la ÚNICA forma de personalizarlo. Cada plugin es un objeto con `name` y
// puntos de extensión con nombre (textos, pasos, eventos, estado, mensajes, composer, paneles). Todo
// lo que dibuja un plugin es un COMPONENTE de React (se monta como `<Render ctx={…} />`, puede usar
// hooks). El orden de la lista decide la precedencia:
//   · mapas (strings, verbs, icons, markdown, formatUserText): se combinan y el de después gana;
//   · eventos y estado: se llama a TODOS los que atienden la llave, en orden;
//   · dibujos con llave (tools.render, message.custom) y únicos (empty, waiting, attachments): gana el
//     PRIMER plugin que lo declara (en desarrollo se avisa del choque);
//   · listas (header, sidePanel, aboveThread, composer.actions/above, message.user/assistant): se
//     dibujan todos, en orden, cada uno envuelto en `data-plugin="<name>"`.
import type { ComponentType } from "react";
import type { BaseEvent } from "@ag-ui/core";
import type { ToolVerbs } from "../core/steps";
import type { Attachment, CustomEntry, Reference, ToolEntry, Turn } from "../core/types";
import type { UploadResult } from "./Composer";
import type { MarkdownOptions, PilotIcon } from "./context";
import type { PilotStrings } from "./strings";
import type { Pilot } from "./usePilot";

/** Lo que todo plugin recibe: el piloto, el estado del agente y las acciones del chat. */
export interface PluginCtx {
  pilot: Pilot;
  /** `pilot.state.agentState`, a la mano. */
  agentState: Record<string, unknown>;
  strings: PilotStrings;
  send: (text: string, attachments?: Attachment[]) => void;
  addReference: (ref: Reference) => void;
  /** Escribe en la caja sin mandar. */
  setDraft: (text: string) => void;
  /** Los plugins montados, en orden. */
  plugins: readonly PilotoPlugin[];
}

/** Un componente de plugin: recibe `ctx` y, según el punto, lo que dibuja. */
export type PluginView<P = object> = ComponentType<P & { ctx: PluginCtx }>;

/** Un evento AG-UI como lo recibe `events` (los CUSTOM traen `name` y `value`). */
export type PluginEvent = BaseEvent & { name?: string; value?: unknown; [k: string]: unknown };

export interface PilotoPlugin {
  /** Único: aparece en `data-plugin`, en los avisos y en `pilotDevtools()`. */
  name: string;
  /**
   * Lo que el plugin atiende, como documentación visible. Si falta, se deriva de `events`, `state` y
   * `message.custom`; si está y no coincide, en desarrollo se avisa.
   */
  requires?: { events?: string[]; state?: string[] };

  /** Textos (se combinan sobre los del idioma). */
  strings?: Partial<PilotStrings>;
  /** `transform` se encadena en orden; `onLinkClick` se pregunta en orden hasta que uno lo maneje. */
  markdown?: MarkdownOptions;
  /** Variables `--piloto-*` y clases extra para la raíz (branding fino sobre la piel). */
  vars?: Record<string, string>;
  className?: string;

  tools?: {
    /** Cómo se nombra cada herramienta (`one`, `many`, `running`). */
    verbs?: ToolVerbs;
    /** Ícono por nombre de herramienta o por `kind`. */
    icons?: Record<string, PilotIcon>;
    /** Una vista propia por nombre de herramienta (p. ej. la vista previa de `create_image`), bajo los pasos. */
    render?: Record<string, PluginView<{ tool: ToolEntry; turn: Turn; live: boolean }>>;
  };

  /** Por tipo AG-UI (`STATE_DELTA`), por nombre de CUSTOM (`ghosty.page`) o `*` para todos. */
  events?: Record<string, (event: PluginEvent, ctx: PluginCtx) => void>;
  /** Por llave de `agentState` (`model`, `subagents`): se llama cuando cambia. */
  state?: Record<string, (value: unknown, ctx: PluginCtx) => void>;

  message?: {
    /** Bajo cada mensaje del usuario. */
    user?: PluginView<{ turn: Turn }>;
    /** Bajo cada respuesta. */
    assistant?: PluginView<{ turn: Turn; live: boolean }>;
    /** Una entrada de `turn.custom` por su nombre (`ghosty.delivery`, tarjetas CRM…). */
    custom?: Record<string, PluginView<{ entry: CustomEntry; turn: Turn; live: boolean }>>;
    /** El texto del usuario como se pinta (se encadena en orden). */
    formatUserText?: (text: string) => string;
  };

  composer?: {
    /** Botones en la barra del composer (selector de modelo, «Señalar»…). */
    actions?: PluginView;
    /** Pegado arriba de la caja (chips, avisos, subagentes). */
    above?: PluginView;
    /** Adjuntos y voz. */
    attachments?: {
      upload?: (file: File) => Promise<UploadResult>;
      transcribe?: (audio: Blob) => Promise<string>;
      voiceNoteText?: (transcript: string) => string;
    };
  };

  /** Arriba a la derecha, sobre el hilo. */
  header?: PluginView;
  /** Junto al chat. */
  sidePanel?: PluginView;
  /** Arriba de los mensajes, dentro del hilo. */
  aboveThread?: PluginView;
  /** El hilo vacío (en lugar del saludo). */
  empty?: PluginView;
  /** Lo que se ve mientras el agente no contesta (en lugar de la frase de espera). */
  waiting?: PluginView<{ step: string | null; since: number }>;
}

/** Ayuda de tipos: `definePlugin({ name: "crm", … })`. */
export function definePlugin<T extends PilotoPlugin>(plugin: T): T {
  return plugin;
}

type Owned<T> = { plugin: string; value: T };

/** Los plugins ya combinados: lo que lee <Piloto>. */
export interface ResolvedPlugins {
  list: readonly PilotoPlugin[];
  strings: Partial<PilotStrings>;
  verbs: ToolVerbs;
  icons: Record<string, PilotIcon>;
  markdown: MarkdownOptions;
  formatUserText?: (text: string) => string;
  vars: Record<string, string>;
  className: string;
  toolRenders: Record<string, Owned<NonNullable<NonNullable<PilotoPlugin["tools"]>["render"]>[string]>>;
  customRenders: Record<string, Owned<NonNullable<NonNullable<PilotoPlugin["message"]>["custom"]>[string]>>;
  attachments: NonNullable<NonNullable<PilotoPlugin["composer"]>["attachments"]>;
  empty?: Owned<PluginView>;
  waiting?: Owned<NonNullable<PilotoPlugin["waiting"]>>;
  header: Owned<PluginView>[];
  sidePanel: Owned<PluginView>[];
  aboveThread: Owned<PluginView>[];
  composerActions: Owned<PluginView>[];
  composerAbove: Owned<PluginView>[];
  messageUser: Owned<NonNullable<NonNullable<PilotoPlugin["message"]>["user"]>>[];
  messageAssistant: Owned<NonNullable<NonNullable<PilotoPlugin["message"]>["assistant"]>>[];
  events: Record<string, Owned<NonNullable<PilotoPlugin["events"]>[string]>[]>;
  state: Record<string, Owned<NonNullable<PilotoPlugin["state"]>[string]>[]>;
  /** Choques y declaraciones que no cuadran (se avisan en desarrollo). */
  warnings: string[];
}

/** Lo que atiende un plugin: lo declarado en `requires` o, si falta, lo que se deriva de sus puntos. */
export function pluginRequires(p: PilotoPlugin): { events: string[]; state: string[] } {
  const derived = {
    events: [...Object.keys(p.events ?? {}).filter((k) => k !== "*"), ...Object.keys(p.message?.custom ?? {})],
    state: Object.keys(p.state ?? {}),
  };
  if (!p.requires) return derived;
  return { events: p.requires.events ?? [], state: p.requires.state ?? [] };
}

/** Los puntos de extensión que usa un plugin, por nombre (para `pilotDevtools()` y los avisos). */
export function pluginPoints(p: PilotoPlugin): string[] {
  const out: string[] = [];
  const add = (cond: unknown, name: string) => cond && out.push(name);
  add(p.strings, "strings");
  add(p.markdown, "markdown");
  add(p.vars || p.className, "branding");
  add(p.tools?.verbs, "tools.verbs");
  add(p.tools?.icons, "tools.icons");
  for (const k of Object.keys(p.tools?.render ?? {})) out.push(`tools.render[${k}]`);
  for (const k of Object.keys(p.events ?? {})) out.push(`events[${k}]`);
  for (const k of Object.keys(p.state ?? {})) out.push(`state[${k}]`);
  add(p.message?.user, "message.user");
  add(p.message?.assistant, "message.assistant");
  for (const k of Object.keys(p.message?.custom ?? {})) out.push(`message.custom[${k}]`);
  add(p.message?.formatUserText, "message.formatUserText");
  add(p.composer?.actions, "composer.actions");
  add(p.composer?.above, "composer.above");
  add(p.composer?.attachments, "composer.attachments");
  add(p.header, "header");
  add(p.sidePanel, "sidePanel");
  add(p.aboveThread, "aboveThread");
  add(p.empty, "empty");
  add(p.waiting, "waiting");
  return out;
}

export function resolvePlugins(list: readonly PilotoPlugin[] = []): ResolvedPlugins {
  const r: ResolvedPlugins = {
    list,
    strings: {},
    verbs: {},
    icons: {},
    markdown: {},
    vars: {},
    className: "",
    toolRenders: {},
    customRenders: {},
    attachments: {},
    header: [],
    sidePanel: [],
    aboveThread: [],
    composerActions: [],
    composerAbove: [],
    messageUser: [],
    messageAssistant: [],
    events: {},
    state: {},
    warnings: [],
  };
  const transforms: ((md: string) => string)[] = [];
  const linkHandlers: NonNullable<MarkdownOptions["onLinkClick"]>[] = [];
  const formatters: ((t: string) => string)[] = [];
  const names = new Set<string>();
  const first = <T,>(slot: Record<string, Owned<T>>, key: string, plugin: string, value: T, point: string) => {
    if (slot[key]) r.warnings.push(`«${plugin}» y «${slot[key].plugin}» dibujan ${point}[${key}]: gana «${slot[key].plugin}» (va antes).`);
    else slot[key] = { plugin, value };
  };
  for (const p of list) {
    if (names.has(p.name)) r.warnings.push(`Hay dos plugins «${p.name}»: el nombre debe ser único.`);
    names.add(p.name);
    const own = <T,>(value: T): Owned<T> => ({ plugin: p.name, value });
    Object.assign(r.strings, p.strings);
    Object.assign(r.verbs, p.tools?.verbs);
    Object.assign(r.icons, p.tools?.icons);
    Object.assign(r.vars, p.vars);
    if (p.className) r.className = `${r.className} ${p.className}`.trim();
    if (p.markdown?.transform) transforms.push(p.markdown.transform);
    if (p.markdown?.onLinkClick) linkHandlers.push(p.markdown.onLinkClick);
    if (p.message?.formatUserText) formatters.push(p.message.formatUserText);
    for (const [k, v] of Object.entries(p.tools?.render ?? {})) first(r.toolRenders, k, p.name, v, "tools.render");
    for (const [k, v] of Object.entries(p.message?.custom ?? {})) first(r.customRenders, k, p.name, v, "message.custom");
    for (const key of ["upload", "transcribe", "voiceNoteText"] as const) {
      const v = p.composer?.attachments?.[key];
      if (!v) continue;
      if (r.attachments[key]) r.warnings.push(`«${p.name}» también da composer.attachments.${key}: gana el primero.`);
      else (r.attachments as Record<string, unknown>)[key] = v;
    }
    if (p.empty) r.empty ? r.warnings.push(`«${p.name}» también dibuja empty: gana «${r.empty.plugin}».`) : (r.empty = own(p.empty));
    if (p.waiting) r.waiting ? r.warnings.push(`«${p.name}» también dibuja waiting: gana «${r.waiting.plugin}».`) : (r.waiting = own(p.waiting));
    if (p.header) r.header.push(own(p.header));
    if (p.sidePanel) r.sidePanel.push(own(p.sidePanel));
    if (p.aboveThread) r.aboveThread.push(own(p.aboveThread));
    if (p.composer?.actions) r.composerActions.push(own(p.composer.actions));
    if (p.composer?.above) r.composerAbove.push(own(p.composer.above));
    if (p.message?.user) r.messageUser.push(own(p.message.user));
    if (p.message?.assistant) r.messageAssistant.push(own(p.message.assistant));
    for (const [k, fn] of Object.entries(p.events ?? {})) (r.events[k] ??= []).push(own(fn));
    for (const [k, fn] of Object.entries(p.state ?? {})) (r.state[k] ??= []).push(own(fn));
    // Lo declarado contra lo que de verdad atiende.
    if (p.requires) {
      const declared = new Set([...(p.requires.events ?? []), ...(p.requires.state ?? [])]);
      const real = [...Object.keys(p.events ?? {}).filter((k) => k !== "*"), ...Object.keys(p.message?.custom ?? {}), ...Object.keys(p.state ?? {})];
      for (const k of real) if (!declared.has(k)) r.warnings.push(`«${p.name}» atiende «${k}» sin declararlo en requires.`);
    }
  }
  if (transforms.length) r.markdown.transform = (md) => transforms.reduce((acc, f) => f(acc), md);
  if (linkHandlers.length) r.markdown.onLinkClick = (href, ev) => linkHandlers.some((f) => f(href, ev));
  if (formatters.length) r.formatUserText = (t) => formatters.reduce((acc, f) => f(acc), t);
  return r;
}

/** Los CUSTOM que ghostykit atiende solo (no hace falta un plugin para ellos). */
export const BUILTIN_CUSTOM = new Set([
  "ghosty.title",
  "ghosty.history",
  "ghosty.injected",
  "ghosty.tool",
  "ghosty.replace",
  "ghosty.stalled",
  "ghosty.attachments_failed",
]);

declare const process: { env: { NODE_ENV?: string } };

/** En desarrollo (lo decide el bundler de la app con `process.env.NODE_ENV`). */
export function isDev(): boolean {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return false;
  }
}
