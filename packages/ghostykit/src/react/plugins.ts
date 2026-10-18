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
import type { ComponentType, ReactNode } from "react";
import type { BaseEvent } from "@ag-ui/core";
import type { TextBlock } from "../core/narration";
import type { ToolVerbs } from "../core/steps";
import type { Attachment, CustomEntry, PilotState, Reference, ToolEntry, Turn } from "../core/types";
import type { UploadResult } from "./Composer";
import type { MarkdownOptions, PilotIcon } from "./context";
import type { PilotStrings } from "./strings";
import type { Pilot, TurnDoneInfo } from "./usePilot";

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
  /**
   * Agrega adjuntos a la caja, como si la persona los eligiera: `File` pasa por `upload`; un
   * `Attachment` (ya subido, p. ej. de «Mis archivos») va tal cual. Se mandan con o sin texto.
   */
  addAttachments: (items: (File | Attachment)[]) => void;
  /** Pone el foco en la caja. */
  focus: () => void;
  /** Los plugins montados, en orden. */
  plugins: readonly PilotoPlugin[];
}

/** Un componente de plugin: recibe `ctx` y, según el punto, lo que dibuja. */
export type PluginView<P = object> = ComponentType<P & { ctx: PluginCtx }>;

/** Un evento AG-UI como lo recibe `events` (los CUSTOM traen `name` y `value`). */
export type PluginEvent = BaseEvent & { name?: string; value?: unknown; [k: string]: unknown };

/** El markdown de las respuestas, desde un plugin. */
export interface PluginMarkdown {
  /** Reescribe el markdown antes de pintarlo, con el turno a la mano. Se encadena en orden. */
  transform?: (md: string, turn?: Turn) => string;
  /** Un clic en un enlace: `true` si el plugin lo manejó. Se pregunta en orden. */
  onLinkClick?: MarkdownOptions["onLinkClick"];
  /**
   * Bloques con nombre del texto (```eb-file …```) que se pintan como tarjeta y salen del markdown,
   * por su nombre. Uno a medio escribir llega con `complete: false`.
   */
  blocks?: Record<string, PluginView<{ block: TextBlock; turn: Turn; live: boolean }>>;
  /**
   * Cómo se pinta un elemento del markdown, por etiqueta (`a`, `code`, `img`…): p. ej. un enlace que
   * es un CTA como botón. Recibe las props del elemento y `ctx`. Por etiqueta, gana el primer plugin.
   */
  components?: Record<string, ComponentType<Record<string, unknown> & { ctx: PluginCtx; children?: ReactNode }>>;
}

/** Un rechazo HTTP del servidor antes del stream (403 con `x-needs-login`, 429…). */
export type PluginHttpError = NonNullable<PilotState["httpError"]>;

export interface PilotoPlugin {
  /** Único: aparece en `data-plugin`, en los avisos y en `pilotDevtools()`. */
  name: string;
  /**
   * De quién son los estilos de lo que dibuja. `host` (default): de la app; las utilidades de
   * ghostykit no lo tocan. `ghostykit`: usa las clases de ghostykit (para componentes de ghostykit
   * como `<Subagents>` o `ModelPicker`).
   */
  styles?: "host" | "ghostykit";
  /**
   * Lo que el plugin atiende, como documentación visible. Si falta, se deriva de `events`, `state` y
   * `message.custom`; si está y no coincide, en desarrollo se avisa.
   */
  requires?: { events?: string[]; state?: string[] };

  /** Textos (se combinan sobre los del idioma). */
  strings?: Partial<PilotStrings>;
  markdown?: PluginMarkdown;
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
    /** Antes del texto de cada respuesta, bajo sus pasos (avance de una página, «creando imagen»). */
    assistantBefore?: PluginView<{ turn: Turn; live: boolean }>;
    /** Una entrada de `turn.custom` por su nombre (`ghosty.delivery`, tarjetas CRM…). */
    custom?: Record<string, PluginView<{ entry: CustomEntry; turn: Turn; live: boolean }>>;
    /** El texto del usuario como se pinta (se encadena en orden). */
    formatUserText?: (text: string) => string;
    /** El texto que sale, antes de mandarlo (p. ej. anteponer lo señalado). Se encadena en orden. */
    beforeSend?: (text: string, ctx: PluginCtx) => string;
    /** El avatar del agente junto a cada respuesta. Gana el primer plugin. */
    avatar?: PluginView<{ turn: Turn }>;
  };

  composer?: {
    /** Botones en la barra del composer, entre la imagen y el clip («Mis archivos», «Señalar»). */
    actions?: PluginView;
    /** Botones en la barra del composer, después del clip (selector de modelo). */
    actionsEnd?: PluginView;
    /** Bajo la caja (chips de sugerencias en el hilo vacío). */
    below?: PluginView;
    /** Pegado arriba de la caja (chips, avisos, subagentes). */
    above?: PluginView;
    /** Adjuntos y voz. */
    attachments?: {
      upload?: (file: File) => Promise<UploadResult>;
      transcribe?: (audio: Blob) => Promise<string>;
      voiceNoteText?: (transcript: string) => string;
      /** Qué se puede adjuntar (como el `accept` de un input): `"image/*"` = sólo fotos. */
      accept?: string;
      /** Cuántos archivos a la vez (default 8). */
      maxFiles?: number;
      /** Tamaño máximo por archivo, en bytes (default 25 MB). */
      maxBytes?: number;
    };
    /**
     * En lugar de la caja, cuando `when(ctx)` es verdad (p. ej. la prueba se acabó: 403 con
     * `x-needs-login` → «Crea tu cuenta»). Gana el primer plugin cuyo `when` es verdad.
     */
    replace?: { when: (ctx: PluginCtx) => boolean; view: PluginView };
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
  /** Envuelve TODO el chat (un proveedor: panel de artefactos, contexto propio). El primero va afuera. */
  wrap?: ComponentType<{ ctx: PluginCtx; children: ReactNode }>;
  /** El servidor rechazó un mensaje antes de contestar (`ctx.pilot.state.httpError` también lo guarda). */
  onHttpError?: (error: PluginHttpError, ctx: PluginCtx) => void;
  /** Este cliente mandó un turno. */
  onTurnStart?: (ctx: PluginCtx) => void;
  /** Terminó un turno de este cliente (abrir la última entrega, re-leer datos). */
  onTurnDone?: (info: TurnDoneInfo, ctx: PluginCtx) => void;
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
  blockRenders: Record<string, Owned<NonNullable<PluginMarkdown["blocks"]>[string]>>;
  components: Record<string, Owned<NonNullable<PluginMarkdown["components"]>[string]>>;
  avatar?: Owned<NonNullable<NonNullable<PilotoPlugin["message"]>["avatar"]>>;
  beforeSend?: (text: string, ctx: PluginCtx) => string;
  replacers: Owned<NonNullable<NonNullable<PilotoPlugin["composer"]>["replace"]>>[];
  httpError: Owned<NonNullable<PilotoPlugin["onHttpError"]>>[];
  attachments: NonNullable<NonNullable<PilotoPlugin["composer"]>["attachments"]>;
  empty?: Owned<PluginView>;
  waiting?: Owned<NonNullable<PilotoPlugin["waiting"]>>;
  header: Owned<PluginView>[];
  sidePanel: Owned<PluginView>[];
  aboveThread: Owned<PluginView>[];
  composerActions: Owned<PluginView>[];
  composerAbove: Owned<PluginView>[];
  composerActionsEnd: Owned<PluginView>[];
  composerBelow: Owned<PluginView>[];
  messageBefore: Owned<NonNullable<NonNullable<PilotoPlugin["message"]>["assistantBefore"]>>[];
  wraps: Owned<NonNullable<PilotoPlugin["wrap"]>>[];
  turnStart: Owned<NonNullable<PilotoPlugin["onTurnStart"]>>[];
  turnDone: Owned<NonNullable<PilotoPlugin["onTurnDone"]>>[];
  /** Los plugins cuyos dibujos usan los estilos de ghostykit (`styles: "ghostykit"`). */
  ghostykitStyled: Set<string>;
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
  add(p.markdown?.transform || p.markdown?.onLinkClick, "markdown");
  add(p.vars || p.className, "branding");
  add(p.tools?.verbs, "tools.verbs");
  add(p.tools?.icons, "tools.icons");
  for (const k of Object.keys(p.tools?.render ?? {})) out.push(`tools.render[${k}]`);
  for (const k of Object.keys(p.events ?? {})) out.push(`events[${k}]`);
  for (const k of Object.keys(p.state ?? {})) out.push(`state[${k}]`);
  for (const k of Object.keys(p.markdown?.blocks ?? {})) out.push(`markdown.blocks[${k}]`);
  add(p.message?.assistantBefore, "message.assistantBefore");
  add(p.message?.user, "message.user");
  add(p.message?.assistant, "message.assistant");
  for (const k of Object.keys(p.message?.custom ?? {})) out.push(`message.custom[${k}]`);
  add(p.message?.formatUserText, "message.formatUserText");
  add(p.message?.beforeSend, "message.beforeSend");
  add(p.message?.avatar, "message.avatar");
  for (const k of Object.keys(p.markdown?.components ?? {})) out.push(`markdown.components[${k}]`);
  add(p.composer?.replace, "composer.replace");
  add(p.onHttpError, "onHttpError");
  add(p.composer?.actions, "composer.actions");
  add(p.composer?.actionsEnd, "composer.actionsEnd");
  add(p.composer?.above, "composer.above");
  add(p.composer?.below, "composer.below");
  add(p.composer?.attachments, "composer.attachments");
  add(p.header, "header");
  add(p.sidePanel, "sidePanel");
  add(p.aboveThread, "aboveThread");
  add(p.empty, "empty");
  add(p.waiting, "waiting");
  add(p.wrap, "wrap");
  add(p.onTurnStart, "onTurnStart");
  add(p.onTurnDone, "onTurnDone");
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
    blockRenders: {},
    components: {},
    replacers: [],
    httpError: [],
    attachments: {},
    header: [],
    sidePanel: [],
    aboveThread: [],
    composerActions: [],
    composerAbove: [],
    composerActionsEnd: [],
    composerBelow: [],
    messageBefore: [],
    wraps: [],
    turnStart: [],
    turnDone: [],
    ghostykitStyled: new Set(),
    messageUser: [],
    messageAssistant: [],
    events: {},
    state: {},
    warnings: [],
  };
  const transforms: NonNullable<PluginMarkdown["transform"]>[] = [];
  const linkHandlers: NonNullable<MarkdownOptions["onLinkClick"]>[] = [];
  const formatters: ((t: string) => string)[] = [];
  const beforeSends: ((t: string, ctx: PluginCtx) => string)[] = [];
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
    for (const [k, v] of Object.entries(p.markdown?.blocks ?? {})) first(r.blockRenders, k, p.name, v, "markdown.blocks");
    if (p.styles === "ghostykit") r.ghostykitStyled.add(p.name);
    for (const [k, v] of Object.entries(p.markdown?.components ?? {})) first(r.components, k, p.name, v, "markdown.components");
    if (p.message?.avatar) r.avatar ? r.warnings.push(`«${p.name}» también da message.avatar: gana «${r.avatar.plugin}».`) : (r.avatar = own(p.message.avatar));
    if (p.message?.beforeSend) beforeSends.push(p.message.beforeSend);
    if (p.composer?.replace) r.replacers.push(own(p.composer.replace));
    if (p.onHttpError) r.httpError.push(own(p.onHttpError));
    if (p.composer?.actionsEnd) r.composerActionsEnd.push(own(p.composer.actionsEnd));
    if (p.composer?.below) r.composerBelow.push(own(p.composer.below));
    if (p.message?.assistantBefore) r.messageBefore.push(own(p.message.assistantBefore));
    if (p.wrap) r.wraps.push(own(p.wrap));
    if (p.onTurnStart) r.turnStart.push(own(p.onTurnStart));
    if (p.onTurnDone) r.turnDone.push(own(p.onTurnDone));
    for (const key of ["upload", "transcribe", "voiceNoteText", "accept", "maxFiles", "maxBytes"] as const) {
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
  if (transforms.length) r.markdown.transform = (md, turn) => transforms.reduce((acc, f) => f(acc, turn), md);
  if (linkHandlers.length) r.markdown.onLinkClick = (href, ev) => linkHandlers.some((f) => f(href, ev));
  if (beforeSends.length) r.beforeSend = (t, ctx) => beforeSends.reduce((acc, f) => f(acc, ctx), t);
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
