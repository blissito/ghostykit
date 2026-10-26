/**
 * `<Piloto transport={…} />` — el chat completo. Todo lo demás es opcional: textos, verbos e íconos
 * de los pasos, adjuntos (`upload`), voz (`transcribe`), contexto por turno, referencias,
 * sugerencias, aprobación de permisos y slots para lo propio de cada app.
 *
 * El scroll es el de claude.ai: al abrir, al final; al mandar, tu mensaje sube UNA vez hasta arriba y
 * la respuesta crece debajo sin mover nada (un espaciador encoge lo que ella crece). Cuando ya no
 * cabe, el chat la sigue… salvo que subas: ahí se suelta hasta que vuelvas al final.
 */
import { ArrowDown } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { TextBlock } from "../core/narration";
import { isRunning, TOOL_VERBS_EN, TOOL_VERBS_ES } from "../core/steps";
import { applyReferences, cleanUserText } from "../core/text";
import type { Attachment, Decision, PermissionRequest, Reference, Turn } from "../core/types";
import type { PilotTransport } from "../transport";
import { AgentBubble, UserBubble } from "./Bubble";
import { ReferenceChips, Suggestions } from "./Chips";
import { Composer, type ComposerHandle, type ComposerIcons } from "./Composer";
import { ConfirmCard } from "./ConfirmCard";
import { PilotoContext, rootProps, usePiloto, type PilotoConfig, type PilotTheme } from "./context";
import { BUILTIN_CUSTOM, isDev, resolvePlugins, type PilotoPlugin, type PluginCtx, type PluginEvent, type PluginView } from "./plugins";
import { TypingDots, WaitLabel } from "./Status";
import { STRINGS_EN, STRINGS_ES, type PilotStrings } from "./strings";
import type { BaseEvent } from "@ag-ui/core";
import { usePilot, type Pilot, type UsePilotOptions } from "./usePilot";

export interface PilotoFeatures {
  /** Botones de adjuntar. Default: sí si hay `upload`. */
  attachments?: boolean;
  /** «Reintentar» en la última respuesta. Default: sí. */
  retry?: boolean;
  /** «Copiar» en las burbujas. Default: sí. */
  copy?: boolean;
  /** Tokens y costo bajo cada respuesta. Default: sí. */
  usage?: boolean;
  /** Las opciones finales de la última respuesta como botones. Default: sí. */
  replyOptions?: boolean;
  /** «· 12 s» junto a la frase de espera. Default: sí. */
  duration?: boolean;
  /** Mandar con el run vivo (steer). Default: lo que diga el agente en `state.caps.steer`. */
  steer?: boolean;
  /**
   * Lo que el agente dice ANTES de cada herramienta como pasos con palomita («Reviso tus crons.»).
   * Default: sí. `false`: todo el texto es respuesta (los pasos siguen en su caja).
   */
  narration?: boolean;
}

export interface PilotoProps extends UsePilotOptions {
  transport: PilotTransport | null;
  /** Si la app ya usa `usePilot` (para leer el estado afuera), pásalo aquí. */
  pilot?: Pilot;
  agentName?: string;
  locale?: "es" | "en";
  theme?: PilotTheme;
  /** La piel: `ghosty` (default), `easybits`, `neutral`, o el nombre de una propia (`[data-skin]`). */
  skin?: string;
  className?: string;
  style?: CSSProperties;
  /** Saludo del hilo vacío. */
  welcome?: ReactNode;
  avatar?: ReactNode;
  placeholder?: string;
  /** Íconos del botón redondo del composer: `send` (mandar) y `stop` (detener). Default: flecha y cuadrito. */
  icons?: ComposerIcons;
  suggestions?: string[];
  features?: PilotoFeatures;
  /**
   * Una pregunta lista en la caja (sin mandarla) y el foco en ella: al abrir el piloto desde una
   * fila («Pídeselo»). Cambiar el texto —o `key`, para repetir el mismo— la vuelve a poner.
   */
  draft?: string | { text: string; key?: string | number } | null;
  /** Referencias controladas (si no, Piloto las guarda; agrégalas con `ref.addReference`). */
  references?: Reference[];
  onReferencesChange?: (refs: Reference[]) => void;
  /** Clic en un chip de referencia (resaltar la tarjeta en la app). */
  onReferenceClick?: (ref: Reference) => void;
  /**
   * La ÚNICA forma de personalizar: textos, pasos, eventos, entregas, composer y paneles (ver
   * `PilotoPlugin`). Créalos una vez (fuera del render o con `useMemo`).
   */
  plugins?: readonly PilotoPlugin[];
}

/**
 * Lo que la app puede hacer desde afuera (`<Piloto ref={…} />`): lo MISMO que recibe un plugin en
 * `ctx`. Con `pilot` (estado, `reconnect`, `stop`, `continueRun`…) nadie necesita `usePilot` aparte.
 */
export type PilotoHandle = Omit<PluginCtx, "plugins" | "strings" | "agentState">;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Aire entre el borde de arriba y tu mensaje cuando sube. */
const ANCHOR_GAP = 24;

export const Piloto = forwardRef<PilotoHandle, PilotoProps>(function Piloto(props, handle) {
  const { transport, pilot: external, locale = "es", theme = "light", features = {} } = props;
  const own = usePilot(external ? null : transport, features.steer === undefined ? props : { ...props, steer: features.steer });
  const pilot = external ?? own;
  const { state } = pilot;
  const { turns, busy, error, notice, permissions, olderCount } = state;

  const plugins = useMemo(() => resolvePlugins(props.plugins), [props.plugins]);
  useEffect(() => {
    if (isDev()) for (const w of plugins.warnings) warnOnce(w);
  }, [plugins]);
  // Los componentes de markdown de los plugins, con su `ctx` (leído al pintar: no se recrean).
  const ctxForComponents = useRef<PluginCtx | null>(null);
  const boundComponents = useMemo(() => {
    const entries = Object.entries(plugins.components);
    if (!entries.length) return undefined;
    return Object.fromEntries(
      entries.map(([tag, { plugin, value: C }]) => [
        tag,
        // Como toda vista de plugin: marcada con su nombre y, si es de la app, aislada de las utilidades.
        (p: Record<string, unknown>) => (
          <span {...pluginAttrs(plugin, plugins.ghostykitStyled)} style={{ display: "contents" }}>
            <C {...p} ctx={ctxForComponents.current!} />
          </span>
        ),
      ]),
    );
  }, [plugins]);
  const strings = useMemo<PilotStrings>(() => ({ ...(locale === "en" ? STRINGS_EN : STRINGS_ES), ...plugins.strings }), [locale, plugins]);
  const config = useMemo<PilotoConfig>(
    () => ({
      strings,
      toolVerbs: { ...(locale === "en" ? TOOL_VERBS_EN : TOOL_VERBS_ES), ...plugins.verbs },
      toolIcons: plugins.icons,
      formatUserText: plugins.formatUserText ? (x: string) => plugins.formatUserText!(cleanUserText(x)) : cleanUserText,
      theme,
      skin: props.skin ?? "ghosty",
      markdown: { ...plugins.markdown, ...(boundComponents ? { components: boundComponents } : {}) },
    }),
    [strings, locale, plugins, theme, props.skin, boundComponents],
  );
  const t = strings;

  // ── Referencias (controladas o propias) ───────────────────────────────────────
  const [ownRefs, setOwnRefs] = useState<Reference[]>([]);
  const refs = props.references ?? ownRefs;
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const setRefs = useCallback(
    (next: Reference[]) => {
      if (!props.references) setOwnRefs(next);
      props.onReferencesChange?.(next);
    },
    [props.references, props.onReferencesChange],
  );


  const composerBox = useRef<HTMLDivElement>(null);
  const draftText = typeof props.draft === "string" ? props.draft : props.draft?.text;
  const draftKey = typeof props.draft === "object" && props.draft ? props.draft.key : undefined;
  const [draft, setDraftState] = useState<{ text: string; n: number }>(() => ({ text: draftText ?? "", n: 0 }));
  const draftSeen = useRef(`${draftText}\u0000${draftKey}`);
  useEffect(() => {
    const id = `${draftText}\u0000${draftKey}`;
    if (draftText == null || id === draftSeen.current) return;
    draftSeen.current = id;
    // El composer se vuelve a montar con el texto y se enfoca solo (cursor al final).
    setDraftState((d) => ({ text: draftText, n: d.n + 1 }));
  }, [draftText, draftKey]);

  // Al detener, lo que esperaba turno regresa a la caja, delante de lo que ya se estuviera escribiendo.
  const returned = state.returnedDraft;
  useEffect(() => {
    if (!returned) return;
    const typed = composerBox.current?.querySelector("textarea")?.value ?? "";
    const text = [returned.text, typed].filter((x) => x.trim()).join("\n\n");
    setDraftState((d) => ({ text, n: d.n + 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returned?.n]);

  const send = useCallback(
    (text: string, attachments: Attachment[] = []) => {
      const current = refsRef.current;
      const before = pluginsRef.current.beforeSend;
      const full = applyReferences(before && ctxRef.current ? before(text, ctxRef.current) : text, current);
      if (current.length) setRefs([]);
      void pilot.send(full, attachments, current.length ? { references: current } : {});
    },
    [pilot, setRefs],
  );

  const pluginsRef = useRef(plugins);
  pluginsRef.current = plugins;
  const ctxRef = useRef<PluginCtx>(null as unknown as PluginCtx);

  // ── Lo que se puede hacer desde afuera: el `ref` de <Piloto> y el `ctx` de los plugins ───────
  const composerHandle = useRef<ComposerHandle>(null);
  const focus = useCallback(() => composerBox.current?.querySelector("textarea")?.focus({ preventScroll: true }), []);
  const addReference = useCallback(
    (r: Reference) => {
      const current = refsRef.current;
      if (!current.some((x) => x.id === r.id)) setRefs([...current, r]);
      requestAnimationFrame(focus);
    },
    [setRefs, focus],
  );
  const setDraft = useCallback((text: string) => setDraftState((d) => ({ text, n: d.n + 1 })), []);
  const addAttachments = useCallback((items: (File | Attachment)[]) => composerHandle.current?.addAttachments(items), []);
  const actions: PilotoHandle = { pilot, send, addReference, addAttachments, setDraft, focus };
  useImperativeHandle(handle, () => actions, [pilot, send, addReference, addAttachments, setDraft, focus]);

  // ── Plugins: el contexto que reciben, sus eventos y su estado ──────────────────
  const ctx: PluginCtx = { ...actions, agentState: state.agentState, strings, plugins: plugins.list };
  ctxForComponents.current = ctx;
  /** Los atributos del envoltorio de lo que dibuja un plugin: su nombre y, si es de la app, el aislamiento. */
  const mark = (plugin: string) => pluginAttrs(plugin, plugins.ghostykitStyled);
  ctxRef.current = ctx;
  const unattended = useRef(new Set<string>());
  useEffect(
    () =>
      pilot.subscribe?.((event: BaseEvent) => {
        const e = event as PluginEvent;
        const r = pluginsRef.current;
        const handlers = [...(r.events[e.type] ?? []), ...(e.type === "CUSTOM" && e.name ? (r.events[e.name] ?? []) : []), ...(r.events["*"] ?? [])];
        for (const h of handlers) {
          try {
            h.value(e, ctxRef.current);
          } catch (err) {
            console.error(`[ghostykit] el plugin «${h.plugin}» falló con ${e.type}${e.name ? ` ${e.name}` : ""}`, err);
          }
        }
        // En desarrollo: un CUSTOM que nadie atiende (ni ghostykit ni un plugin) se avisa una vez.
        if (e.type === "CUSTOM" && e.name && isDev() && !BUILTIN_CUSTOM.has(e.name) && !r.events[e.name] && !r.customRenders[e.name] && !unattended.current.has(e.name)) {
          const declared = r.list.some((p) => p.requires?.events?.includes(e.name!));
          if (!declared) {
            unattended.current.add(e.name);
            warnOnce(`Ningún plugin atiende CUSTOM «${e.name}».`);
          }
        }
      }),
    [pilot.subscribe],
  );
  const seenState = useRef<Record<string, unknown>>({});
  useEffect(() => {
    const r = pluginsRef.current;
    for (const [key, handlers] of Object.entries(r.state)) {
      const value = state.agentState[key];
      if (value === seenState.current[key]) continue;
      seenState.current[key] = value;
      if (value === undefined) continue;
      for (const h of handlers) {
        try {
          h.value(value, ctxRef.current);
        } catch (err) {
          console.error(`[ghostykit] el plugin «${h.plugin}» falló con state.${key}`, err);
        }
      }
    }
  }, [state.agentState, plugins]);

  useEffect(
    () =>
      pilot.onTurn?.((e) => {
        const r = pluginsRef.current;
        const run = (plugin: string, fn: () => void) => {
          try {
            fn();
          } catch (err) {
            console.error(`[ghostykit] el plugin «${plugin}» falló al ${e.type === "start" ? "empezar" : "terminar"} el turno`, err);
          }
        };
        if (e.type === "start") for (const h of r.turnStart) run(h.plugin, () => h.value(ctxRef.current));
        else for (const h of r.turnDone) run(h.plugin, () => h.value(e.info, ctxRef.current));
      }),
    [pilot.onTurn],
  );

  // Un rechazo HTTP nuevo (403 de prueba agotada, 429…) se avisa a los plugins que lo atienden.
  useEffect(() => {
    const err = state.httpError;
    if (!err) return;
    for (const h of pluginsRef.current.httpError) {
      try {
        h.value(err, ctxRef.current);
      } catch (e) {
        console.error(`[ghostykit] el plugin «${h.plugin}» falló con onHttpError`, e);
      }
    }
  }, [state.httpError]);

  // Una tarjeta contestada se queda a la vista mientras cae su sello (el run que la contesta puede
  // traer un snapshot que ya no la incluye).
  const [held, setHeld] = useState<Record<string, PermissionRequest>>({});
  // En un ref también: `settle` corre en un setTimeout del render en que se contestó.
  const heldRef = useRef(held);
  heldRef.current = held;
  const releaseHeld = (id: string) => setHeld(({ [id]: _, ...rest }) => rest);
  const respond = (id: string, approved: boolean) => {
    const req = permissions.find((p) => p.id === id);
    if (req) {
      heldRef.current = { ...heldRef.current, [id]: req };
      setHeld((h) => ({ ...h, [id]: req }));
    }
    pilot.respondPermission(id, approved);
  };
  const settle = (id: string, status: Decision["status"]) => {
    pilot.recordDecision(id, status, heldRef.current[id]);
    releaseHeld(id);
  };
  const cards = [...permissions, ...Object.values(held).filter((h) => !permissions.some((p) => p.id === h.id))];

  // ── Scroll ──────────────────────────────────────────────────────────────────
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const touchY = useRef<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const message = (n: number) => scroller.current?.querySelector<HTMLElement>(`[data-turn="${n}"]`) ?? null;

  // Al anteponer mensajes viejos, lo que se veía se queda en su lugar.
  const olderSeen = useRef(olderCount);
  const heightBefore = useRef(0);
  useIsoLayoutEffect(() => {
    const el = scroller.current;
    if (el && olderCount > olderSeen.current && heightBefore.current) el.scrollTop += el.scrollHeight - heightBefore.current;
    olderSeen.current = olderCount;
    heightBefore.current = 0;
  }, [olderCount]);
  const loadOlder = () => {
    heightBefore.current = scroller.current?.scrollHeight ?? 0;
    void pilot.loadOlder();
  };

  // Al abrir el hilo: al final, sin animación.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || turns.length === 0) return;
    placed.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length]);

  // El ancla: tu último mensaje (no las líneas de sistema). Cambia cuando aparece uno NUEVO.
  let mineIndex = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    const x = turns[i];
    if (x.role === "user" && !x.text.startsWith("⏰ ")) {
      mineIndex = i;
      break;
    }
  }
  const mine = mineIndex >= 0 ? turns[mineIndex] : null;
  const mineSeen = useRef(mine);
  const [anchor, setAnchor] = useState<number | null>(null);
  useEffect(() => {
    if (mine === mineSeen.current) return;
    mineSeen.current = mine;
    // Al ABRIR un hilo (snapshot, sin turno de este cliente) no se ancla tu último mensaje arriba: se
    // va al final y lo sigue aunque el contenido crezca después (imágenes que cargan tarde).
    if (!state.turnStartedAt) {
      following.current = true;
      return;
    }
    // `data-turn` cuenta desde el snapshot: lo anterior (`loadOlder`) va en negativo y no lo mueve.
    if (mine) setAnchor(mineIndex - olderCount);
    following.current = true;
  }, [mine, mineIndex]);

  const gapAbove = (a: HTMLElement) => (anchor === -olderCount ? a.offsetTop : ANCHOR_GAP);
  const measureSpacer = useCallback(() => {
    const sc = scroller.current;
    const sp = spacer.current;
    if (!sc || !sp) return;
    const a = anchor != null ? message(anchor) : null;
    if (!a) {
      sp.style.height = "0px";
      return;
    }
    const fromAnchor = sp.getBoundingClientRect().top - a.getBoundingClientRect().top;
    sp.style.height = `${Math.max(0, sc.clientHeight - fromAnchor - gapAbove(a))}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);
  useIsoLayoutEffect(() => {
    measureSpacer();
    const sc = scroller.current;
    const a = anchor != null ? message(anchor) : null;
    if (sc && a) sc.scrollTo({ top: a.offsetTop - gapAbove(a), behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, measureSpacer]);
  useEffect(() => {
    const col = column.current;
    const sc = scroller.current;
    if (!col || !sc || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      measureSpacer();
      // Instantáneo, no `smooth`: una animación a medias dispara `onScroll` lejos del final.
      if (following.current && spacer.current?.style.height === "0px") sc.scrollTop = sc.scrollHeight;
    });
    ro.observe(col);
    ro.observe(sc);
    return () => ro.disconnect();
  }, [measureSpacer]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const end = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(end);
    if (end) following.current = true;
  };
  const release = () => {
    following.current = false;
  };
  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  // ── Lo que se pinta ─────────────────────────────────────────────────────────
  const last = turns[turns.length - 1];
  const toolRunning = busy && last?.role === "assistant" && (last.tools ?? []).some(isRunning);
  const empty = turns.length === 0 && !busy;
  const placeholder = props.placeholder ?? (props.agentName ? t.placeholder(props.agentName) : t.placeholderDefault);
  const { upload, transcribe, voiceNoteText, accept, maxFiles, maxBytes } = plugins.attachments;
  const showFiles = features.attachments ?? Boolean(upload);

  // Lo señalado (referencias con `prompt`) va ARRIBA de la caja, como el chip de «Señalar» de Ghosty;
  // las tarjetas del tablero, dentro.
  const pointedRefs = refs.filter((r) => r.prompt);
  const plainRefs = refs.filter((r) => !r.prompt);
  const removeRef = (id: string) => setRefs(refsRef.current.filter((r) => r.id !== id));
  // `composer.replace`: el primer plugin cuyo `when` es verdad dibuja en lugar de la caja.
  const replacer = plugins.replacers.find((r) => {
    try {
      return r.value.when(ctx);
    } catch {
      return false;
    }
  });
  const Replacement = replacer?.value.view;
  const composer = Replacement ? (
    <div {...mark(replacer!.plugin)}>
      <Replacement ctx={ctx} />
    </div>
  ) : (
    <div ref={composerBox}>
      <ReferenceChips references={pointedRefs} onRemove={removeRef} onActivate={props.onReferenceClick} />
      <Composer
        key={draft.n}
        initialValue={draft.text}
        onSubmit={send}
        onStop={pilot.stop}
        busy={busy}
        canSteer={pilot.canSteer}
        placeholder={placeholder}
        attachments={showFiles}
        upload={upload}
        transcribe={transcribe}
        voiceNoteText={voiceNoteText}
        references={plainRefs}
        onRemoveReference={removeRef}
        onActivateReference={props.onReferenceClick}
        extras={plugins.composerActions.length ? <Views items={plugins.composerActions} ctx={ctx} styled={plugins.ghostykitStyled} inline /> : undefined}
        extrasEnd={plugins.composerActionsEnd.length ? <Views items={plugins.composerActionsEnd} ctx={ctx} styled={plugins.ghostykitStyled} inline /> : undefined}
        handleRef={composerHandle}
        icons={props.icons}
        accept={accept}
        {...(maxFiles ? { maxFiles } : {})}
        {...(maxBytes ? { maxFileMb: maxBytes / (1024 * 1024) } : {})}
      />
    </div>
  );

  // Con `sidePanel`, el chat y el panel van lado a lado (el panel lo dibuja la app).
  const withPanel = (chat: ReactNode) =>
    plugins.sidePanel.length ? (
      <div className="flex min-h-0 flex-1 flex-row">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">{chat}</div>
        <Views items={plugins.sidePanel} ctx={ctx} styled={plugins.ghostykitStyled} className="flex min-h-0 shrink-0" />
      </div>
    ) : (
      chat
    );

  const aboveComposer = plugins.composerAbove.length ? <Views items={plugins.composerAbove} ctx={ctx} styled={plugins.ghostykitStyled} /> : null;
  const belowComposer = plugins.composerBelow.length ? <Views items={plugins.composerBelow} ctx={ctx} styled={plugins.ghostykitStyled} /> : null;
  // La barra de arriba: `header.start` a la izquierda (quién es), `header`/`header.end` a la derecha.
  const headerStart = plugins.headerStart.length ? <Views items={plugins.headerStart} ctx={ctx} styled={plugins.ghostykitStyled} inline /> : null;
  const headerEnd = plugins.header.length ? <Views items={plugins.header} ctx={ctx} styled={plugins.ghostykitStyled} inline /> : null;
  const headerSides = (headerStart || headerEnd) && (
    <>
      {headerStart && <div className="piloto-header-start flex min-w-0 items-center gap-2">{headerStart}</div>}
      {headerEnd && <div className="piloto-header-end ml-auto flex items-center gap-2">{headerEnd}</div>}
    </>
  );

  const Empty = plugins.empty?.value;
  const Waiting = plugins.waiting?.value;

  // Bajo cada respuesta: las entradas de `turn.custom` que un plugin dibuja y los extras de mensaje.
  const renderDeliveries = (turn: Turn, live: boolean) => {
    const custom = (turn.custom ?? []).map((entry, i) => {
      const owner = plugins.customRenders[entry.name];
      if (!owner) return null;
      const C = owner.value;
      return (
        <div key={`c${i}`} {...mark(owner.plugin)}>
          <C ctx={ctx} entry={entry} turn={turn} live={live} />
        </div>
      );
    });
    const extras = plugins.messageAssistant.map((o, i) => (
      <div key={`a${i}`} {...mark(o.plugin)}>
        <o.value ctx={ctx} turn={turn} live={live} />
      </div>
    ));
    return custom.some(Boolean) || extras.length ? (
      <>
        {custom}
        {extras}
      </>
    ) : null;
  };
  // Bajo los pasos: la vista propia de cada herramienta que un plugin dibuja.
  const renderTools = (turn: Turn, live: boolean) => {
    const views = (turn.tools ?? []).flatMap((tool) => {
      const owner = plugins.toolRenders[tool.title ?? ""] ?? (tool.kind ? plugins.toolRenders[tool.kind] : undefined);
      if (!owner) return [];
      const C = owner.value;
      return [
        <div key={tool.id} {...mark(owner.plugin)}>
          <C ctx={ctx} tool={tool} turn={turn} live={live} />
        </div>,
      ];
    });
    return views.length ? <div className="mb-3 flex flex-col gap-2">{views}</div> : null;
  };
  // Antes del texto de cada respuesta.
  const renderBefore = plugins.messageBefore.length
    ? (turn: Turn, live: boolean) => (
        <>
          {plugins.messageBefore.map((o, i) => (
            <div key={i} {...mark(o.plugin)}>
              <o.value ctx={ctx} turn={turn} live={live} />
            </div>
          ))}
        </>
      )
    : undefined;
  // Los bloques con nombre del texto (```eb-file```), como tarjetas.
  const blockLangs = Object.keys(plugins.blockRenders);
  const blocks = blockLangs.length
    ? {
        langs: blockLangs,
        render: (list: TextBlock[], turn: Turn, live: boolean) => (
          <div className="mt-2 flex flex-col gap-2">
            {list.map((block, i) => {
              const owner = plugins.blockRenders[block.lang];
              const C = owner.value;
              return (
                <div key={i} {...mark(owner.plugin)}>
                  <C ctx={ctx} block={block} turn={turn} live={live} />
                </div>
              );
            })}
          </div>
        ),
      }
    : undefined;

  // `wrap`: proveedores alrededor de TODO el chat; el primer plugin queda afuera.
  const wrapAll = (tree: ReactNode) =>
    plugins.wraps.reduceRight<ReactNode>((inner, { value: W }) => <W ctx={ctx}>{inner}</W>, tree);

  const permissionCards = cards.map((p: PermissionRequest) => (
    <ConfirmCard key={p.id} request={p} onRespond={respond} onSettled={settle} onExpire={pilot.expirePermission} />
  ));

  // ── PORTADO de `ChatView` de Ghosty Studio: mismo layout (estado vacío centrado, columna de
  // 784 px, composer abajo), mismas clases.
  return (
    <PilotoContext.Provider value={config}>
      {wrapAll(
      <div
        {...rootProps(theme, props.skin)}
        data-busy={busy || undefined}
        className={`piloto ${plugins.className} ${props.className ?? ""}`}
        style={Object.keys(plugins.vars).length ? ({ ...plugins.vars, ...props.style } as CSSProperties) : props.style}
      >
        {withPanel(empty ? (
          // Un hilo vacío enseña lo mismo que la portada: la cara, el saludo, la caja y por dónde
          // empezar. Si no cabe (panel bajo), se desplaza: `safe center` nunca empuja nada fuera.
          <div className="gs-scroll flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-[10vh] [justify-content:safe_center]">
            {headerSides && <div className="piloto-header absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-4 pt-3">{headerSides}</div>}
            {Empty ? (
              <div {...mark(plugins.empty!.plugin)}>
                <Empty ctx={ctx} />
              </div>
            ) : (
                <div className="mb-6 flex flex-col items-center">
                  {props.avatar && <div className="mb-3">{props.avatar}</div>}
                  {props.welcome && (
                    // Un saludo largo (una explicación del piloto) baja a letra de lectura.
                    <h1
                      className={
                        typeof props.welcome === "string" && props.welcome.length > 60
                          ? "max-w-xl text-center text-base font-medium leading-6 text-metal"
                          : "text-center text-3xl font-extrabold tracking-tight text-dark"
                      }
                    >
                      {props.welcome}
                    </h1>
                  )}
                </div>
            )}
            <div className="w-full max-w-3xl">
              {aboveComposer}
              {composer}
              {belowComposer}
              {props.suggestions && <Suggestions items={props.suggestions} onPick={(s) => send(s)} onPrefill={(s) => setDraftState((d) => ({ text: s, n: d.n + 1 }))} />}
            </div>
          </div>
        ) : (
          <>
            {headerSides && <div className="piloto-header flex shrink-0 items-center gap-2 px-4 pt-3 sm:px-6">{headerSides}</div>}
            <div
              ref={scroller}
              onScroll={onScroll}
              onWheel={(e) => e.deltaY < 0 && release()}
              onTouchStart={(e) => {
                touchY.current = e.touches[0]?.clientY ?? null;
              }}
              onTouchMove={(e) => {
                const y = e.touches[0]?.clientY;
                if (touchY.current != null && y != null && y > touchY.current + 4) release();
              }}
              onKeyDown={(e) => ["ArrowUp", "PageUp", "Home"].includes(e.key) && release()}
              className="gs-scroll relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
            >
              <div ref={column} className="mx-auto flex w-full max-w-[784px] flex-col gap-6 px-4 py-8 sm:px-6">
                {plugins.aboveThread.length > 0 && <Views items={plugins.aboveThread} ctx={ctx} styled={plugins.ghostykitStyled} />}
                {state.history?.hasMoreBefore && (external || props.loadOlder) && (
                  <button
                    type="button"
                    onClick={loadOlder}
                    disabled={pilot.loadingOlder}
                    className="self-center rounded-full border border-border-primary px-3 py-1 text-sm text-text-secondary transition hover:text-text-primary disabled:opacity-60"
                  >
                    {pilot.loadingOlder ? t.loadingOlder : t.loadOlder}
                  </button>
                )}
                {turns.map((turn, i) => {
                  const isLast = i === turns.length - 1;
                  const live = busy && isLast;
                  return (
                    <div key={i - olderCount} data-turn={i - olderCount}>
                      {turn.role === "user" ? (
                        <>
                          <UserBubble turn={turn} />
                          {plugins.messageUser.map((o, j) => (
                            <div key={j} {...mark(o.plugin)}>
                              <o.value ctx={ctx} turn={turn} />
                            </div>
                          ))}
                        </>
                      ) : (
                        <AgentBubble
                          turn={turn}
                          live={live}
                          onRetry={isLast && features.retry !== false ? pilot.retry : undefined}
                          onOption={isLast && !busy && features.replyOptions !== false ? (text) => send(text) : undefined}
                          showUsage={features.usage !== false}
                          showCopy={features.copy !== false}
                          showDuration={features.duration !== false}
                          renderDeliveries={renderDeliveries}
                          renderTools={renderTools}
                          renderBefore={renderBefore}
                          blocks={blocks}
                          narration={features.narration !== false}
                          avatar={
                            plugins.avatar ? (
                              <span {...mark(plugins.avatar.plugin)}>
                                <plugins.avatar.value ctx={ctx} turn={turn} />
                              </span>
                            ) : undefined
                          }
                        />
                      )}
                      {turn.role === "assistant" && <TurnNotes turn={turn} />}
                    </div>
                  );
                })}
                {busy && state.stalled && <p className="text-sm text-text-tertiary">{state.stalled.message ?? t.stalled}</p>}
                {state.queued.map((q, i) => (
                  // Esperan a que termine el run vivo (el servidor no los dejó entrar): salen solos.
                  <div key={`q${i}`} data-queued className="flex flex-col items-end gap-1 opacity-60">
                    <UserBubble turn={{ role: "user", text: q.text, ...(q.attachments ? { attachments: q.attachments } : {}) }} />
                    <span className="text-xs text-text-tertiary">{t.queued}</span>
                  </div>
                ))}
                {permissionCards}
                {busy && !toolRunning && !cards.length && (
                  Waiting ? (
                    <div {...mark(plugins.waiting!.plugin)}>
                      <Waiting ctx={ctx} step={state.step} since={state.turnStartedAt} />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <TypingDots />
                      <WaitLabel since={state.turnStartedAt} step={state.step} showDuration={features.duration !== false} />
                    </div>
                  )
                )}
                {notice && <p className="text-sm text-text-tertiary">{notice}</p>}
                {error && <p className="text-sm text-text-danger">{error}</p>}
              </div>
              <div ref={spacer} aria-hidden />
            </div>
            <div className="relative mx-auto w-full max-w-[784px] px-4 pb-4 sm:px-6 sm:pb-6">
              {!atBottom && (
                <button
                  type="button"
                  onClick={toBottom}
                  aria-label={t.goToLatest}
                  className="absolute -top-12 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border-primary bg-background-secondary text-text-secondary shadow-lg transition hover:text-text-primary"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              )}
              {state.cutRun && !busy && (
                // El servidor cortó la respuesta (deploy, caja caída): la persona decide si sigue.
                <div data-cut-run role="status" className="mb-2 flex items-center gap-3 rounded-2xl border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-secondary">
                  <span className="min-w-0 flex-1">{state.cutRun.reason ?? t.runCut}</span>
                  <button
                    type="button"
                    onClick={() => void pilot.continueRun()}
                    className="shrink-0 rounded-full bg-brand-500 px-3 py-1 text-sm font-medium text-white transition hover:bg-brand-600"
                  >
                    {t.continueRun}
                  </button>
                </div>
              )}
              {aboveComposer}
              {composer}
              {belowComposer}
            </div>
          </>
        ))}
      </div>,
      )}
    </PilotoContext.Provider>
  );
});

const warned = new Set<string>();
/** Un aviso de desarrollo, una sola vez (los plugins escritos en línea se recrean en cada render). */
function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[ghostykit] ${message}`);
}

/** Los componentes de varios plugins, en orden, cada uno marcado con su nombre. */
/**
 * Lo que dibuja un plugin va marcado con su nombre. Si sus estilos son de la app (default), además
 * con `data-piloto-isolate`: las utilidades de ghostykit no entran ahí y no pisan las clases de la app.
 */
function pluginAttrs(plugin: string, styled: Set<string>): { "data-plugin": string; "data-piloto-isolate"?: "" } {
  return styled.has(plugin) ? { "data-plugin": plugin } : { "data-plugin": plugin, "data-piloto-isolate": "" };
}

function Views({ items, ctx, inline, className, styled }: { items: { plugin: string; value: PluginView }[]; ctx: PluginCtx; inline?: boolean; className?: string; styled: Set<string> }) {
  return (
    <>
      {items.map(({ plugin, value: C }) =>
        inline ? (
          <span key={plugin} {...pluginAttrs(plugin, styled)} style={{ display: "contents" }}>
            <C ctx={ctx} />
          </span>
        ) : (
          <div key={plugin} {...pluginAttrs(plugin, styled)} className={className}>
            <C ctx={ctx} />
          </div>
        ),
      )}
    </>
  );
}

/** Los avisos del servidor bajo una respuesta: adjuntos que no pudo leer y respuesta recortada. */
function TurnNotes({ turn }: { turn: Turn }) {
  const { strings: t } = usePiloto();
  const failed = (turn.custom ?? [])
    .filter((c) => c.name === "ghosty.attachments_failed")
    .flatMap((c) => ((c.value as { files?: { name?: string; reason?: string }[] } | undefined)?.files ?? []).filter((f) => f?.name));
  if (!failed.length && !turn.truncated) return null;
  return (
    <div data-turn-notes className="mt-1 flex flex-col gap-0.5 text-xs text-text-tertiary">
      {failed.map((f, i) => (
        <p key={i}>{t.attachmentFailed(f.name!, f.reason)}</p>
      ))}
      {turn.truncated && <p>{turn.truncated.reason ?? t.truncated}</p>}
    </div>
  );
}

export default Piloto;
