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
import { isRunning, TOOL_VERBS_EN, TOOL_VERBS_ES, type ToolVerbs } from "../core/steps";
import { applyReferences, cleanUserText } from "../core/text";
import type { Attachment, PermissionRequest, Reference, Turn } from "../core/types";
import type { PilotTransport } from "../transport";
import { AgentBubble, UserBubble } from "./Bubble";
import { Suggestions } from "./Chips";
import { Composer, type UploadResult } from "./Composer";
import { ConfirmCard } from "./ConfirmCard";
import { PilotoContext, rootProps, type MarkdownOptions, type PilotIcon, type PilotoConfig, type PilotTheme } from "./context";
import { ConnectingState, TypingDots, WaitLabel } from "./Status";
import { STRINGS_EN, STRINGS_ES, type PilotStrings } from "./strings";
import { usePilot, type PermissionHandler, type Pilot, type UsePilotOptions } from "./usePilot";

export interface PilotoFeatures {
  /** Botones de adjuntar. Default: sí si hay `upload`. */
  attachments?: boolean;
  /** «Reintentar» en la última respuesta. Default: sí. */
  retry?: boolean;
  /** «Copiar» en las burbujas. Default: sí. */
  copy?: boolean;
  /** Tokens y costo bajo cada respuesta. Default: sí. */
  usage?: boolean;
  /** Selector de modelo (si el agente ofrece varios). Default: sí. */
  models?: boolean;
  /** Las opciones finales de la última respuesta como botones. Default: sí. */
  replyOptions?: boolean;
  /** «· 12 s» junto a la frase de espera. Default: sí. */
  duration?: boolean;
}

export interface PilotoSlots {
  /** Las entregas de cada respuesta (archivos, páginas, tarjetas propias). */
  renderDeliveries?: (turn: Turn, live: boolean) => ReactNode;
  /** Botones propios en la barra del composer. */
  composerExtras?: ReactNode;
  /** Lo que se ve con el hilo vacío (en lugar del saludo de casa). */
  emptyState?: ReactNode;
  /** Arriba a la derecha, sobre el hilo (compartir, abrir en grande…). */
  headerActions?: ReactNode;
  /** Pegado arriba del composer (un aviso, un banner). */
  aboveComposer?: ReactNode;
}

export interface PilotoProps extends UsePilotOptions {
  transport: PilotTransport | null;
  /** Si la app ya usa `usePilot` (para leer el estado afuera), pásalo aquí. */
  pilot?: Pilot;
  agentName?: string;
  locale?: "es" | "en";
  strings?: Partial<PilotStrings>;
  theme?: PilotTheme;
  /** La piel: `ghosty` (default), `easybits`, `neutral`, o el nombre de una propia (`[data-skin]`). */
  skin?: string;
  className?: string;
  style?: CSSProperties;
  toolVerbs?: ToolVerbs;
  toolIcons?: Record<string, PilotIcon>;
  /** El texto del usuario como se pinta (quita la fontanería que la app pega al prompt). */
  formatUserText?: (text: string) => string;
  markdown?: MarkdownOptions;
  /** Saludo del hilo vacío. */
  welcome?: ReactNode;
  avatar?: ReactNode;
  placeholder?: string;
  suggestions?: string[];
  upload?: (file: File) => Promise<UploadResult>;
  transcribe?: (audio: Blob) => Promise<string>;
  voiceNoteText?: (transcript: string) => string;
  features?: PilotoFeatures;
  /**
   * Contestar un permiso (p. ej. el POST de aprobación de la app, con su sesión). Default:
   * `transport.respondPermission`. Devuelve `{resolved:false}` si ya no estaba abierto.
   */
  onPermission?: PermissionHandler;
  /** Referencias controladas (si no, Piloto las guarda; agrégalas con `ref.addReference`). */
  references?: Reference[];
  onReferencesChange?: (refs: Reference[]) => void;
  /** Clic en un chip de referencia (resaltar la tarjeta en la app). */
  onReferenceClick?: (ref: Reference) => void;
  slots?: PilotoSlots;
}

/** Lo que la app puede hacer desde afuera (`<Piloto ref={…} />`). */
export interface PilotoHandle {
  send: (text: string, attachments?: Attachment[]) => void;
  addReference: (ref: Reference) => void;
  /** Escribe en la caja sin mandar. */
  setDraft: (text: string) => void;
  focus: () => void;
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Aire entre el borde de arriba y tu mensaje cuando sube. */
const ANCHOR_GAP = 24;

export const Piloto = forwardRef<PilotoHandle, PilotoProps>(function Piloto(props, handle) {
  const { transport, pilot: external, locale = "es", theme = "light", features = {}, slots = {} } = props;
  const own = usePilot(external ? null : transport, props);
  const pilot = external ?? own;
  const { state } = pilot;
  const { turns, busy, connected, phase, error, notice, interrupted, permissions } = state;

  const strings = useMemo<PilotStrings>(() => ({ ...(locale === "en" ? STRINGS_EN : STRINGS_ES), ...props.strings }), [locale, props.strings]);
  const config = useMemo<PilotoConfig>(
    () => ({
      strings,
      toolVerbs: { ...(locale === "en" ? TOOL_VERBS_EN : TOOL_VERBS_ES), ...props.toolVerbs },
      toolIcons: props.toolIcons ?? {},
      formatUserText: props.formatUserText ?? cleanUserText,
      theme,
      skin: props.skin ?? "ghosty",
      markdown: props.markdown ?? {},
    }),
    [strings, locale, props.toolVerbs, props.toolIcons, props.formatUserText, theme, props.skin, props.markdown],
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

  const [draft, setDraftState] = useState<{ text: string; n: number }>({ text: "", n: 0 });
  const composerBox = useRef<HTMLDivElement>(null);

  const send = useCallback(
    (text: string, attachments: Attachment[] = []) => {
      const current = refsRef.current;
      const full = applyReferences(text, current);
      if (current.length) setRefs([]);
      void pilot.send(full, attachments, current.length ? { references: current } : {});
    },
    [pilot, setRefs],
  );

  useImperativeHandle(
    handle,
    () => ({
      send,
      addReference: (r) => {
        const current = refsRef.current;
        if (!current.some((x) => x.id === r.id)) setRefs([...current, r]);
        requestAnimationFrame(() => composerBox.current?.querySelector("textarea")?.focus());
      },
      setDraft: (text) => setDraftState((d) => ({ text, n: d.n + 1 })),
      focus: () => composerBox.current?.querySelector("textarea")?.focus(),
    }),
    [send, setRefs],
  );

  // Una tarjeta contestada se queda a la vista mientras cae su sello, aunque el stream ya la haya
  // retirado (`permission-resolved` llega antes de que la app termine de contestar).
  const [held, setHeld] = useState<Record<string, PermissionRequest>>({});
  const releaseHeld = (id: string) => setHeld(({ [id]: _, ...rest }) => rest);
  const respond = async (id: string, optionId: string) => {
    const req = permissions.find((p) => p.id === id);
    if (req) setHeld((h) => ({ ...h, [id]: req }));
    const handler = props.onPermission ?? (transport?.respondPermission ? (a: string, b: string) => transport.respondPermission!(a, b) : undefined);
    if (!handler) throw new Error("ghostykit: falta `onPermission` (el transporte no contesta permisos)");
    try {
      return await handler(id, optionId);
    } catch (e) {
      releaseHeld(id);
      throw e;
    }
  };
  const settle = (id: string, optionId: string, answer: Parameters<Pilot["recordDecision"]>[2]) => {
    pilot.recordDecision(id, optionId, answer, held[id]);
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

  // Al abrir el hilo: al final, sin animación.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || turns.length === 0) return;
    placed.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length]);

  // El ancla: tu último mensaje (no los steers ni las líneas de sistema). Cambia cuando aparece uno NUEVO.
  let mineIndex = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    const x = turns[i];
    if (x.role === "user" && !x.steer && !x.text.startsWith("⏰ ")) {
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
    if (mine) setAnchor(mineIndex);
    following.current = true;
  }, [mine, mineIndex]);

  const gapAbove = (a: HTMLElement) => (anchor === 0 ? a.offsetTop : ANCHOR_GAP);
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
  const pageInProgress = last?.role === "assistant" && (Boolean(last.planning) || (last.pages ?? []).some((p) => !p.error && (!p.readyAt || p.review?.status === "running")));
  const toolRunning = busy && last?.role === "assistant" && ((last.tools ?? []).some(isRunning) || pageInProgress);
  const empty = turns.length === 0 && !busy;
  const placeholder = !connected ? t.placeholderConnecting : (props.placeholder ?? t.placeholder(props.agentName ?? (locale === "en" ? "the agent" : "el agente")));
  const showFiles = features.attachments ?? Boolean(props.upload);

  // El estado de conexión sólo si tarda: una conexión rápida no debe parpadear.
  const [slowConnect, setSlowConnect] = useState(false);
  useEffect(() => {
    if (connected) return setSlowConnect(false);
    const id = setTimeout(() => setSlowConnect(true), 800);
    return () => clearTimeout(id);
  }, [connected]);

  const composer = (
    <div ref={composerBox}>
      <Composer
        key={draft.n}
        initialValue={draft.text}
        onSubmit={send}
        onStop={pilot.stop}
        busy={busy}
        canSteer={(external ? true : transport?.steer) !== false}
        placeholder={placeholder}
        canSeeImages={state.canSeeImages}
        attachments={showFiles}
        upload={props.upload}
        transcribe={props.transcribe}
        voiceNoteText={props.voiceNoteText}
        models={features.models === false ? [] : state.models}
        currentModel={state.currentModel}
        onModelChange={pilot.setModel}
        references={refs}
        onRemoveReference={(id) => setRefs(refsRef.current.filter((r) => r.id !== id))}
        onActivateReference={props.onReferenceClick}
        extras={slots.composerExtras}
      />
    </div>
  );

  const permissionCards = cards.map((p: PermissionRequest) => (
    <ConfirmCard key={p.id} request={p} onRespond={respond} onSettled={settle} onExpire={pilot.expirePermission} />
  ));

  return (
    <PilotoContext.Provider value={config}>
      <div {...rootProps(theme, props.skin)} data-busy={busy || undefined} className={`piloto ${props.className ?? ""}`} style={props.style}>
        {empty ? (
          <div className="piloto-empty flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-[8vh]">
            {slots.headerActions && <div className="absolute right-4 top-3 flex gap-2">{slots.headerActions}</div>}
            {!connected && slowConnect ? (
              <ConnectingState phase={phase} error={error} avatar={props.avatar} />
            ) : (
              (slots.emptyState ?? (
                <div className="piloto-welcome mb-6 flex flex-col items-center gap-3 text-center">
                  {props.avatar}
                  {props.welcome && <div className="text-2xl font-semibold text-text-primary">{props.welcome}</div>}
                </div>
              ))
            )}
            <div className="w-full max-w-3xl">
              {slots.aboveComposer}
              {composer}
              {props.suggestions && <Suggestions items={props.suggestions} onPick={(s) => send(s)} onPrefill={(s) => setDraftState((d) => ({ text: s, n: d.n + 1 }))} />}
            </div>
          </div>
        ) : (
          <>
            {slots.headerActions && <div className="flex shrink-0 justify-end gap-2 px-4 pt-3">{slots.headerActions}</div>}
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
              className="piloto-scroll relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
            >
              <div ref={column} className="piloto-column mx-auto flex w-full flex-col gap-6 px-4 py-6">
                {turns.map((turn, i) => {
                  const isLast = i === turns.length - 1;
                  const live = busy && isLast;
                  return (
                    <div key={i} data-turn={i}>
                      {turn.role === "user" ? (
                        <UserBubble turn={turn} />
                      ) : (
                        <AgentBubble
                          turn={turn}
                          live={live}
                          onRetry={isLast && features.retry !== false ? pilot.retry : undefined}
                          onOption={isLast && !busy && features.replyOptions !== false ? (text) => send(text) : undefined}
                          showUsage={features.usage !== false}
                          showCopy={features.copy !== false}
                          renderDeliveries={slots.renderDeliveries}
                        />
                      )}
                    </div>
                  );
                })}
                {permissionCards}
                {busy && !toolRunning && !cards.length && (
                  <div className="flex flex-col gap-1.5">
                    <TypingDots />
                    <WaitLabel phase={phase} since={state.turnStartedAt} elsewhere={state.elsewhere} onLost={pilot.abandonAndRetry} showDuration={features.duration !== false} />
                  </div>
                )}
                {/* El turno se cortó por falla del servidor: en primera persona y con salida. */}
                {interrupted && !busy && (
                  <p className="piloto-interrupted text-sm text-text-secondary">
                    {/me quedé a medias|i stopped halfway/i.test(last?.text ?? "") ? t.interruptedOurFault : t.interrupted(interrupted.reason)}{" "}
                    <button type="button" onClick={pilot.resume} className="cursor-pointer text-text-primary underline underline-offset-2">
                      {interrupted.canContinue ? t.continueTurn : t.resume}
                    </button>
                  </p>
                )}
                {notice && <p className="piloto-notice text-sm text-text-tertiary">{notice}</p>}
                {error && <p className="piloto-error text-sm text-text-danger">{error}</p>}
              </div>
              <div ref={spacer} aria-hidden />
            </div>
            <div className="piloto-dock relative mx-auto w-full px-4 pb-4">
              {!atBottom && (
                <button
                  type="button"
                  onClick={toBottom}
                  aria-label={t.goToLatest}
                  className="piloto-to-bottom absolute -top-12 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border-primary bg-background-secondary text-text-secondary shadow-(--piloto-shadow-card) transition hover:text-text-primary"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              )}
              {slots.aboveComposer}
              {composer}
            </div>
          </>
        )}
      </div>
    </PilotoContext.Provider>
  );
});

export default Piloto;
