// La entrada `embed`: Piloto con un `<script>`, sin React en la app anfitriona.
//
//   <script src=".../piloto.js" defer></script>
//   <script>addEventListener("DOMContentLoaded", () => GhostyKit.mount(null, { url: "/__ghosty/agent" }))</script>
//
// Se construye aparte (IIFE, `globalName: "GhostyKit"`) con React, motion y streamdown adentro, y
// con `dist/styles.css` incrustado: un solo archivo, nada que sincronizar.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { X } from "lucide-react";
import css from "piloto:styles";
import { Piloto, type PilotoHandle } from "./react/Piloto";
import type { PilotTheme } from "./react/context";
import { createAgUiTransport } from "./transport";

export interface MountOptions {
  /** El endpoint AG-UI (`POST <url>`, SSE). Mismo origen: la cookie de sesión viaja sola. */
  url: string;
  agentName?: string;
  /** `light` (default), `dark` o `auto` (sigue al sistema). */
  theme?: PilotTheme;
  /** La piel: `ghosty` (default), `easybits`, `neutral`, `denik`. */
  skin?: string;
  /** Saludo del hilo vacío. */
  welcome?: string;
  placeholder?: string;
  suggestions?: string[];
  locale?: "es" | "en";
  /** Cabeceras extra para cada petición (en una app propia normalmente no hacen falta). */
  headers?: Record<string, string>;
  /** `false` = no inyectar el CSS incrustado (la app ya carga `ghostykit/styles.css` por su cuenta). */
  css?: boolean;
  /** Abrir el panel al montar. */
  open?: boolean;
}

export interface EmbedHandle {
  open: () => void;
  close: () => void;
  destroy: () => void;
}

const STYLE_ID = "ghostykit-embed-css";

// El cascarón (botón y panel). Todo bajo `.gk-embed`, sin `!important`. El botón y la cabecera van
// con `data-piloto-isolate`: el blindaje de `.piloto button` (más específico) no les quita el fondo.
const SHELL_CSS = `
.gk-embed .gk-launcher{padding:0;margin:0;position:fixed;right:20px;bottom:20px;z-index:2147483000;width:56px;height:56px;border-radius:999px;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;background:var(--piloto-inverse);color:var(--piloto-text-inverse);box-shadow:0 6px 20px rgba(0,0,0,.18)}
.gk-embed .gk-launcher:focus-visible{outline:2px solid var(--piloto-focus);outline-offset:3px}
.gk-embed .gk-panel{position:fixed;top:0;right:0;bottom:0;z-index:2147483001;width:min(440px,100vw);display:flex;flex-direction:column;background:var(--piloto-bg);color:var(--piloto-text);border-left:1px solid var(--piloto-border);box-shadow:-8px 0 24px rgba(0,0,0,.08)}
.gk-embed .gk-panel[data-open="false"]{display:none}
.gk-embed .gk-head{display:flex;align-items:center;gap:8px;flex-shrink:0;height:48px;padding:0 8px 0 16px;border-bottom:1px solid var(--piloto-border);background:var(--piloto-bg);font:600 15px/1.2 var(--piloto-font)}
.gk-embed .gk-head span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* El cerrar es el mismo botón que el de PilotoPanel (\`gk-panel-btn\`, ícono X de lucide). La cabecera queda
   fuera del reset de \`.piloto\` (\`data-piloto-isolate\`), así que aquí se fija TODO lo que el CSS anfitrión
   suele tocar (\`button{padding:9px 14px}\` dejaba la X en 8 px): padding, márgenes, fuente y tamaño del svg. */
.gk-embed .gk-panel-btn{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:36px;height:36px;min-width:36px;padding:0;margin:0;border:0;border-radius:9999px;background:transparent;color:var(--piloto-text);font:inherit;line-height:1;cursor:pointer;-webkit-appearance:none;appearance:none;box-shadow:none}
.gk-embed .gk-panel-btn:hover{background:var(--piloto-surface);color:var(--piloto-text)}
.gk-embed .gk-panel-btn:focus-visible{outline:2px solid var(--piloto-focus);outline-offset:2px}
.gk-embed .gk-panel-btn svg{display:block;width:20px;height:20px;flex-shrink:0}
.gk-embed .gk-body{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--piloto-bg)}
.gk-embed .gk-body > .piloto{flex:1;min-height:0;height:100%}
@media (max-width:640px){.gk-embed .gk-panel{width:100vw;height:100dvh;bottom:auto;border-left:0;box-shadow:none}}
`;

function injectCss(withPiloto: boolean) {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = (withPiloto ? css : "") + SHELL_CSS;
  document.head.appendChild(style);
}

// El hilo se recuerda por `url`: recargar la página reconecta con la misma conversación.
const threadKey = (url: string) => `ghostykit:thread:${url}`;
function readThread(url: string): string | undefined {
  try {
    return localStorage.getItem(threadKey(url)) ?? undefined;
  } catch {
    return undefined;
  }
}
function saveThread(url: string, id: string) {
  try {
    localStorage.setItem(threadKey(url), id);
  } catch {
    // Sin almacenamiento (modo privado): el hilo dura lo que la página.
  }
}

/** Un estado mínimo fuera de React: `open()`/`close()` funcionan aunque React no haya pintado. */
function createOpenStore(initial: boolean) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(v: boolean) {
      if (v === value) return;
      value = v;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const ChatIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
  </svg>
);

function Embed({ opts, store }: { opts: MountOptions; store: ReturnType<typeof createOpenStore> }) {
  const open = useSyncExternalStore(store.subscribe, store.get, store.get);
  const pilotoRef = useRef<PilotoHandle>(null);
  // Piloto se monta la primera vez que se abre (nada de red al cargar la página) y luego se queda.
  const everOpened = useRef(open);
  if (open) everOpened.current = true;
  const transport = useRef(createAgUiTransport({ url: opts.url, headers: opts.headers, credentials: "same-origin" })).current;
  const threadId = useRef(readThread(opts.url)).current;
  const theme = opts.theme ?? "light";
  const skin = opts.skin ?? "ghosty";
  const name = opts.agentName ?? "Asistente";

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => pilotoRef.current?.focus());
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && store.set(false);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, store]);

  let body: ReactNode = null;
  if (everOpened.current)
    body = (
      <Piloto
        ref={pilotoRef}
        transport={transport}
        threadId={threadId}
        agentName={name}
        theme={theme}
        skin={skin}
        locale={opts.locale}
        welcome={opts.welcome}
        placeholder={opts.placeholder}
        suggestions={opts.suggestions}
        // El hilo nuevo se guarda en cuanto arranca su primer turno.
        onTurnStart={() => {
          const id = pilotoRef.current?.pilot.threadId;
          if (id) saveThread(opts.url, id);
        }}
      />
    );

  return (
    <div className="gk-embed">
      {!open && (
        <div className="piloto" data-theme={theme} data-skin={skin} data-piloto-isolate="" style={{ display: "contents" }}>
          <button type="button" className="gk-launcher" aria-label={`Abrir ${name}`} onClick={() => store.set(true)}>
            <ChatIcon />
          </button>
        </div>
      )}
      <div className="piloto gk-panel" data-theme={theme} data-skin={skin} data-open={open ? "true" : "false"} role="dialog" aria-label={name}>
        <div className="gk-head" data-piloto-isolate="">
          <span>{name}</span>
          <button type="button" className="gk-panel-btn" title="Cerrar" aria-label="Cerrar" onClick={() => store.set(false)}>
            <X size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <div className="gk-body">{body}</div>
      </div>
    </div>
  );
}

/** Monta el botón flotante y el panel del agente. `target` = elemento, selector o `null` (un div nuevo en `<body>`). */
export function mount(target: Element | string | null | undefined, opts: MountOptions): EmbedHandle {
  if (!opts?.url) throw new Error("GhostyKit.mount: falta `url`");
  injectCss(opts.css !== false);
  let el: Element | null = typeof target === "string" ? document.querySelector(target) : (target ?? null);
  const own = !el;
  if (!el) {
    el = document.createElement("div");
    document.body.appendChild(el);
  }
  const store = createOpenStore(Boolean(opts.open));
  const root: Root = createRoot(el);
  root.render(<Embed opts={opts} store={store} />);
  let alive = true;
  return {
    open: () => alive && store.set(true),
    close: () => alive && store.set(false),
    destroy() {
      if (!alive) return;
      alive = false;
      root.unmount();
      if (own) el!.remove();
    },
  };
}

export const version = __GHOSTYKIT_VERSION__;
