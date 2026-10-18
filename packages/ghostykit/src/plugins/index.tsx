// Plugins de ejemplo, listos para usar: `import { modelPicker, livePage, pilotDevtools } from "ghostykit/plugins"`.
// Cada uno es un `PilotoPlugin` normal; sirven también de plantilla para escribir los propios.
// Créalos UNA vez (fuera del render o con `useMemo`): `livePage()` guarda su estado en el plugin.
import { useEffect, useState, useSyncExternalStore } from "react";
import { ModelPicker, type ModelOption } from "../react/Composer";
import { definePlugin, pluginPoints, pluginRequires, type PilotoPlugin, type PluginCtx, type PluginEvent } from "../react/plugins";

// ── modelPicker ─────────────────────────────────────────────────────────────

export interface ModelPickerOptions {
  /** La llave de `agentState` con `{current, options: [{value, name}]}`. Default: `model`. */
  stateKey?: string;
  /** Cambiar de modelo es API de la app (no un run): aquí la llamas. */
  onChange: (value: string, ctx: PluginCtx) => void | Promise<void>;
}

/**
 * El selector de modelo en la barra del composer, con lo que el agente anuncia en
 * `agentState.model = {current, options}`.
 */
export function modelPicker({ stateKey = "model", onChange }: ModelPickerOptions): PilotoPlugin {
  function Picker({ ctx }: { ctx: PluginCtx }) {
    const model = ctx.agentState[stateKey] as { current?: string; options?: ModelOption[] } | undefined;
    // Lo elegido se ve al instante; el siguiente STATE_* del agente manda.
    const [chosen, setChosen] = useState<string | null>(null);
    useEffect(() => setChosen(null), [model?.current]);
    if (!model?.options?.length) return null;
    return (
      <ModelPicker
        models={model.options}
        current={chosen ?? model.current ?? null}
        onChange={(value) => {
          setChosen(value);
          void onChange(value, ctx);
        }}
      />
    );
  }
  return definePlugin({ name: "modelPicker", requires: { state: [stateKey] }, composer: { actions: Picker } });
}

// ── livePage ────────────────────────────────────────────────────────────────

/** Una página que el agente arma en vivo (`CUSTOM ghosty.page`). */
export interface LivePage {
  pageId: string;
  title: string;
  sections: { id: string; title?: string; status: "pending" | "building" | "done" | "failed" }[];
  url: string | null;
  error?: string;
}

export interface LivePageOptions {
  /** Ancho del panel. Default: 320 px. */
  width?: number;
}

/**
 * El panel de la página en vivo: escucha `ghosty.page` (plan, secciones, lista, error) y pinta el
 * avance a un lado del chat, con el enlace al terminar.
 */
export function livePage({ width = 320 }: LivePageOptions = {}): PilotoPlugin {
  let page: LivePage | null = null;
  const listeners = new Set<() => void>();
  const set = (next: LivePage | null) => {
    page = next;
    for (const l of listeners) l();
  };
  const store = {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    get: () => page,
  };
  const status = (id: string, s: LivePage["sections"][number]["status"]) =>
    page && set({ ...page, sections: page.sections.map((x) => (x.id === id ? { ...x, status: s } : x)) });

  function onPage(e: PluginEvent) {
    const v = (e.value ?? {}) as Record<string, any>;
    switch (v.event) {
      case "page-plan":
        return set({ pageId: v.pageId, title: v.title, url: null, sections: (v.sections ?? []).map((x: { id: string; title?: string }) => ({ id: x.id, title: x.title, status: "pending" })) });
      case "section-building":
        return status(v.id, "building");
      case "section":
        return status(v.id, v.ok === false ? "failed" : "done");
      case "page-ready":
        return page && set({ ...page, title: v.title ?? page.title, url: v.url ?? null });
      case "page-error":
        return page && set({ ...page, error: v.message });
      case "page-drop":
        return page?.pageId === v.pageId && set(null);
    }
  }

  function Panel({ ctx }: { ctx: PluginCtx }) {
    const p = useSyncExternalStore(store.subscribe, store.get, store.get);
    if (!p) return null;
    const done = p.sections.filter((x) => x.status === "done").length;
    return (
      <aside style={{ width }} className="hidden shrink-0 flex-col gap-3 overflow-y-auto border-l border-border-primary bg-background-secondary p-4 text-sm md:flex">
        <div>
          <p className="font-medium text-text-primary">{p.title}</p>
          <p className="text-xs text-text-tertiary">
            {done}/{p.sections.length} {ctx.strings.numberLocale.startsWith("en") ? "sections" : "secciones"}
          </p>
        </div>
        <ul className="flex flex-col gap-1.5">
          {p.sections.map((x) => (
            <li key={x.id} data-status={x.status} className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  x.status === "done" ? "bg-text-success" : x.status === "failed" ? "bg-text-danger" : x.status === "building" ? "animate-pulse bg-brand-500" : "bg-border-primary"
                }`}
              />
              <span className="truncate text-text-secondary">{x.title ?? x.id}</span>
            </li>
          ))}
        </ul>
        {p.error && <p className="text-xs text-text-danger">{p.error}</p>}
        {p.url && (
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="self-start rounded-full bg-brand-500 px-3 py-1 text-white hover:bg-brand-600">
            {ctx.strings.linkOpen}
          </a>
        )}
      </aside>
    );
  }

  return definePlugin({ name: "livePage", requires: { events: ["ghosty.page"] }, events: { "ghosty.page": onPage }, sidePanel: Panel });
}

// ── pilotDevtools ───────────────────────────────────────────────────────────

export interface DevtoolsOptions {
  /** Además de la lista de plugins, cada evento con quién lo atiende. Default: no. */
  events?: boolean;
}

/** Imprime en consola los plugins montados, sus puntos y lo que atienden (y, si quieres, cada evento). */
export function pilotDevtools({ events = false }: DevtoolsOptions = {}): PilotoPlugin {
  function Devtools({ ctx }: { ctx: PluginCtx }) {
    const names = ctx.plugins.map((p) => p.name).join(",");
    useEffect(() => {
      console.groupCollapsed(`[ghostykit] ${ctx.plugins.length} plugins`);
      console.table(
        ctx.plugins.map((p) => {
          const req = pluginRequires(p);
          return { plugin: p.name, points: pluginPoints(p).join(" "), events: req.events.join(" "), state: req.state.join(" ") };
        }),
      );
      console.groupEnd();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [names]);
    return null;
  }
  return definePlugin({
    name: "pilotDevtools",
    aboveThread: Devtools,
    ...(events
      ? {
          events: {
            "*": (e: PluginEvent, ctx: PluginCtx) => {
              const key = e.type === "CUSTOM" ? e.name : e.type;
              const who = ctx.plugins.filter((p) => p.name !== "pilotDevtools" && (p.events?.[e.type] || (key && (p.events?.[key] || p.message?.custom?.[key])))).map((p) => p.name);
              console.debug(`[ghostykit] ${e.type}${e.type === "CUSTOM" ? ` ${e.name}` : ""}`, who.length ? `→ ${who.join(", ")}` : "", e);
            },
          },
        }
      : {}),
  });
}
