import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Group, Panel, Separator, usePanelRef, type LayoutChangedMeta } from "react-resizable-panels";
import { Drawer } from "vaul";
import { AnimatePresence, motion } from "motion/react";
import { SquarePen, X } from "lucide-react";

// El piloto al lado de la app (pieza única; nació en EasyBits /dash/admin/crons).
// Escritorio: panel redimensionable que EMPUJA el contenido, no lo tapa (abrir y cerrar se animan;
// arrastrar, no). Móvil: hoja de vaul desde abajo con dos alturas. Se monta al abrirlo por primera
// vez y queda vivo: cerrar no pierde el hilo. Estilos en `ghostykit/split.css`.

/** Hoja móvil: a media pantalla (se ve el contenido) o casi completa. */
const SHEET_SNAPS = [0.6, 0.94];
/** Lo que dura abrir o cerrar el panel (igual que la transición de `split.css`). */
const OPEN_MS = 320;
/** ⌘I (piloto) y ⌘K (paleta, lo que la gente prueba primero). */
const DEFAULT_SHORTCUT = ["i", "k"];

export type PilotoSplitVariant = "panel" | "sheet";

export type PilotoSplitOptions = {
  /** Llave de localStorage donde se recuerda el ancho que el usuario eligió arrastrando. */
  widthKey: string;
  /** Ancho inicial del panel en px (default 420). */
  defaultWidth?: number;
  /** Desde qué ancho de ventana es panel y no hoja (default 1024, el `lg` de Tailwind). */
  desktopMinWidth?: number;
  /** Se llama cada vez que se abre o se cierra (p. ej. para contraer el menú lateral de la app). */
  onOpenChange?: (open: boolean) => void;
  /** Atajo para abrir/cerrar con ⌘/Ctrl + esta(s) tecla(s) (default ["i", "k"]; `false` lo apaga). */
  shortcut?: string | string[] | false;
  /** Esc cierra el panel de escritorio (default true; en la hoja lo maneja vaul). */
  escapeToClose?: boolean;
};

export function usePilotoSplit(options: PilotoSplitOptions | string) {
  const { widthKey, defaultWidth = 420, desktopMinWidth = 1024, onOpenChange, shortcut = DEFAULT_SHORTCUT, escapeToClose = true } =
    typeof options === "string" ? ({ widthKey: options } as PilotoSplitOptions) : options;
  const isDesktop = useIsDesktop(desktopMinWidth);
  const panelRef = usePanelRef();
  const [panelOpen, setPanelOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Mientras abre o cierra, el piloto va a su ancho final (no se reacomoda a cada cuadro).
  const [animating, setAnimating] = useState(false);
  const animTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const animate = useCallback(() => {
    setAnimating(true);
    clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setAnimating(false), OPEN_MS + 40);
  }, []);

  // Al pasar a móvil con el panel abierto, se cierra el panel y sigue en la hoja.
  useEffect(() => {
    const panel = panelRef.current;
    if (isDesktop || !panel || panel.isCollapsed()) return;
    panel.collapse();
    setSheetOpen(true);
  }, [isDesktop, panelRef]);

  const open = useCallback(() => {
    setMounted(true);
    if (!isDesktop) return setSheetOpen(true);
    const panel = panelRef.current;
    if (!panel || !panel.isCollapsed()) return;
    animate();
    panel.expand();
    panel.resize(`${readWidth(widthKey, defaultWidth)}px`);
  }, [isDesktop, panelRef, widthKey, defaultWidth, animate]);

  const close = useCallback(() => {
    const panel = panelRef.current;
    if (panel && !panel.isCollapsed()) animate();
    panel?.collapse();
    setSheetOpen(false);
  }, [panelRef, animate]);

  const isOpen = isDesktop ? panelOpen : sheetOpen;
  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;
  useEffect(() => {
    notify.current?.(isOpen);
  }, [isOpen]);

  // ⌘/Ctrl + tecla abre o cierra; Esc cierra (si nadie más lo atendió, p. ej. un modal).
  const toggleRef = useRef<() => void>(() => {});
  toggleRef.current = isOpen ? close : open;
  const keys = (shortcut === false ? [] : Array.isArray(shortcut) ? shortcut : [shortcut]).map((k) => k.toLowerCase());
  const keysId = keys.join(",");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // En un editor enriquecido ⌘I/⌘K son itálica y liga: no se los robamos.
      const editing = (e.target as HTMLElement | null)?.isContentEditable;
      if (!editing && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && keys.includes(e.key.toLowerCase())) {
        e.preventDefault();
        toggleRef.current();
      } else if (escapeToClose && e.key === "Escape" && !e.defaultPrevented && isDesktop && isOpen) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysId, escapeToClose, isDesktop, isOpen, close]);

  return {
    isDesktop,
    panelRef,
    panelOpen,
    setPanelOpen,
    sheetOpen,
    setSheetOpen,
    mounted,
    widthKey,
    animating,
    targetWidth: readWidth(widthKey, defaultWidth),
    /** Abierto en la forma que toca (panel o hoja). */
    isOpen,
    open,
    close,
    toggle: useCallback(() => (isOpen ? close() : open()), [isOpen, open, close]),
  };
}

export type PilotoSplitState = ReturnType<typeof usePilotoSplit>;

export function PilotoSplit({
  id,
  split,
  title,
  piloto,
  children,
  minContent = 420,
  className = "",
  sheetClassName = "",
  style,
}: {
  /** Id del layout (react-resizable-panels lo usa para el estado). */
  id: string;
  split: PilotoSplitState;
  /** Nombre para lectores de pantalla en la hoja móvil. */
  title: string;
  /** Lo que va en el panel o la hoja: normalmente un `<Piloto>`. Recibe la variante. */
  piloto: (variant: PilotoSplitVariant) => ReactNode;
  /** El contenido de la app que el panel empuja. */
  children: ReactNode;
  /** Ancho mínimo del contenido en escritorio, en px. */
  minContent?: number;
  className?: string;
  /** Clases extra para la hoja móvil (borde, radio, fondo). */
  sheetClassName?: string;
  /** Variables de color: `--gk-split-handle`, `--gk-split-accent`, `--gk-split-sheet-bg`, `--gk-split-overlay`. */
  style?: CSSProperties;
}) {
  const { isDesktop, panelRef, panelOpen, setPanelOpen, sheetOpen, setSheetOpen, mounted, widthKey, animating, targetWidth } = split;
  const [sheetSnap, setSheetSnap] = useState<number>(SHEET_SNAPS[0]);
  const sheetChat = useRef<HTMLDivElement>(null);
  const [sheetChatH, setSheetChatH] = useState<number | null>(null);

  // Lo visible de la hoja = de donde empieza el chat hasta el borde de abajo; se mide mientras vaul la acomoda.
  useEffect(() => {
    if (!sheetOpen) return;
    let frame = 0;
    const until = performance.now() + 700;
    const measure = () => {
      const el = sheetChat.current;
      if (el) setSheetChatH(Math.max(240, Math.round(window.innerHeight - el.getBoundingClientRect().top)));
      if (performance.now() < until) frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [sheetOpen, sheetSnap]);

  // El ancho que el usuario eligió arrastrando se recuerda (sólo el ancho: siempre arranca cerrado).
  const onLayoutChanged = (_: unknown, meta: LayoutChangedMeta) => {
    const px = panelRef.current?.getSize().inPixels ?? 0;
    if (meta.isUserInteraction && px > 0) writeWidth(widthKey, px);
  };

  return (
    <>
      <div className={className} style={style}>
        <Group id={id} className="gk-split" style={{ overflow: "clip" }} onLayoutChanged={onLayoutChanged}>
          <Panel id={`${id}-content`} minSize={isDesktop ? minContent : 0} style={{ overflow: "clip", minWidth: 0 }}>
            {children}
          </Panel>
          <Separator
            className="gk-split-separator"
            style={!isDesktop || !panelOpen ? { visibility: "hidden" } : undefined}
            aria-label="Cambiar el ancho del piloto"
          />
          <Panel
            id={`${id}-piloto`}
            panelRef={panelRef}
            collapsible
            collapsedSize={0}
            defaultSize={0}
            minSize={320}
            maxSize="60%"
            style={{ overflow: "clip", minWidth: 0 }}
            onResize={(size) => setPanelOpen(size.inPixels > 0)}
          >
            {/* Cerrado sigue montado (el hilo no se pierde), pero fuera del foco y del lector de pantalla. */}
            {mounted && isDesktop && (
              <div style={{ height: "100%", width: animating ? `${targetWidth}px` : "100%" }} inert={!panelOpen}>
                {piloto("panel")}
              </div>
            )}
          </Panel>
        </Group>
      </div>
      {!isDesktop && (
        <Drawer.Root
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          snapPoints={SHEET_SNAPS}
          activeSnapPoint={sheetSnap}
          setActiveSnapPoint={(p) => setSheetSnap(typeof p === "number" ? p : SHEET_SNAPS[0])}
        >
          <Drawer.Portal>
            <Drawer.Overlay className="gk-split-overlay" />
            <Drawer.Content aria-describedby={undefined} className={`gk-split-sheet ${sheetClassName}`} style={style}>
              <Drawer.Handle className="gk-split-handle" />
              <Drawer.Title className="gk-split-sr">{title}</Drawer.Title>
              {/* vaul desplaza la hoja: el chat mide lo VISIBLE en cada punto, para que el composer no quede abajo de la pantalla. */}
              <div
                ref={sheetChat}
                style={{ minHeight: 0, height: sheetChatH ? `${sheetChatH}px` : `calc(${Math.round(sheetSnap * 100)}dvh - 3rem)` }}
              >
                {mounted && piloto("sheet")}
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}
    </>
  );
}

/**
 * Para el `<aside>` del panel: alto = de donde empieza hasta abajo de la ventana (el composer siempre a la
 * vista), aunque la página tenga scroll. Úsalo con `position: sticky; top: 0` y `height: var(--gk-split-h)`.
 * La primera medida va ANTES de pintar: Piloto enfoca la caja al montar y, con la altura provisional
 * (100vh), la caja quedaría bajo el borde y el navegador desplazaría la página.
 */
export function useStickyPanelHeight(enabled = true) {
  const ref = useRef<HTMLElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffectSafe(() => {
    if (!enabled) return;
    const fit = () => {
      const el = ref.current;
      if (el) setHeight(Math.max(320, window.innerHeight - Math.max(el.getBoundingClientRect().top, 0)));
    };
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [enabled]);
  const style: CSSProperties = enabled
    ? { position: "sticky", top: 0, height: height ? `${height}px` : "100vh" }
    : { height: "100%" };
  return { ref, style };
}

const useLayoutEffectSafe = typeof window === "undefined" ? useEffect : useLayoutEffect;

function readWidth(key: string, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    if (n >= 320) return n;
  } catch {
    /* sin almacenamiento: ancho por defecto */
  }
  return fallback;
}

function writeWidth(key: string, px: number) {
  try {
    localStorage.setItem(key, String(Math.round(px)));
  } catch {
    /* sin almacenamiento */
  }
}

/** Panel lateral desde `minWidth` px (default 1024, el `lg` de Tailwind), hoja debajo. En el servidor, escritorio. */
export function useIsDesktop(minWidth = 1024) {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [minWidth]);
  return desktop;
}

/**
 * El botón para abrir el piloto: una pastilla con el avatar y «Hablar con …» que entra y sale con
 * resorte (como el tablero de Ventas de gs). Se muestra sólo con el piloto cerrado.
 */
export function PilotoLauncher({
  split,
  label,
  avatarSrc,
  className = "",
  style,
}: {
  split: PilotoSplitState;
  /** Texto de la pastilla, p. ej. «Hablar con Ghosty». Sin texto, sólo el avatar. */
  label?: string;
  avatarSrc: string;
  /** Posición y colores (`fixed bottom-6 right-6 …`). */
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <AnimatePresence>
      {!split.isOpen && (
        <motion.button
          key="gk-launcher"
          type="button"
          onClick={split.open}
          aria-label={label ?? "Abrir el piloto"}
          title={label ? `${label} · ⌘I` : undefined}
          initial={{ opacity: 0, scale: 0.6, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6, y: 20 }}
          transition={{ type: "spring", stiffness: 400, damping: 24 }}
          className={`gk-launcher ${label ? "" : "gk-launcher-icon"} ${className}`}
          style={style}
        >
          <img src={avatarSrc} alt="" />
          {label && <span>{label}</span>}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/**
 * La conversación visible: una llave que se guarda en el navegador y cambia con «Nueva conversación».
 * La app arma con ella el `threadId` (p. ej. `${base}-${key}`); el hilo anterior NO se borra (sigue en
 * el servidor), sólo deja de verse. Sin almacenamiento, arranca en "1".
 */
export function useConversationKey(storageKey: string) {
  const [key, setKey] = useState<string>(() => {
    try {
      return localStorage.getItem(storageKey) || "1";
    } catch {
      return "1";
    }
  });
  const rotate = useCallback(() => {
    const next = Date.now().toString(36);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* sin almacenamiento: dura lo que la pestaña */
    }
    setKey(next);
  }, [storageKey]);
  return [key, rotate] as const;
}

const PANEL_LABELS = {
  es: { newConversation: "Nueva conversación", close: "Cerrar" },
  en: { newConversation: "New conversation", close: "Close" },
};

/**
 * La carcasa estándar del piloto en el panel o la hoja: encabezado (avatar, nombre y acciones:
 * «Nueva conversación» y cerrar) y el chat debajo. En el panel queda pegado a la ventana aunque la
 * página tenga scroll (el composer siempre a la vista). Va dentro de `PilotoSplit` (`piloto={(v) => …}`).
 */
export function PilotoPanel({
  variant,
  title,
  avatar,
  onClose,
  onNewConversation,
  canStartNew = true,
  actions,
  locale = "es",
  className = "",
  children,
}: {
  variant: PilotoSplitVariant;
  title: ReactNode;
  avatar?: ReactNode;
  onClose?: () => void;
  /** Sin esto no sale el botón. Normalmente `rotate` de `useConversationKey`. */
  onNewConversation?: () => void;
  /** Ocultar «Nueva conversación» (p. ej. con el hilo vacío). */
  canStartNew?: boolean;
  /** Más botones a la derecha del encabezado, antes de los estándar. */
  actions?: ReactNode;
  locale?: "es" | "en";
  className?: string;
  children: ReactNode;
}) {
  const sticky = useStickyPanelHeight(variant === "panel");
  const t = PANEL_LABELS[locale];
  return (
    <aside
      ref={sticky.ref}
      aria-label={typeof title === "string" ? title : undefined}
      style={sticky.style}
      className={`gk-panel ${variant === "panel" ? "gk-panel-side" : ""} ${className}`}
    >
      <header className="gk-panel-header">
        <div className="gk-panel-title">
          {avatar}
          <span>{title}</span>
        </div>
        <div className="gk-panel-actions">
          {actions}
          {onNewConversation && canStartNew && (
            <button type="button" className="gk-panel-btn" onClick={onNewConversation} title={t.newConversation} aria-label={t.newConversation}>
              <SquarePen size={17} strokeWidth={1.8} />
            </button>
          )}
          {onClose && variant === "panel" && (
            <button type="button" className="gk-panel-btn" onClick={onClose} title={t.close} aria-label={t.close}>
              <X size={18} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </header>
      <div className="gk-panel-body">{children}</div>
    </aside>
  );
}
