// @vitest-environment jsdom
// 0.7.0: los plugins son la única forma de personalizar <Piloto>. Precedencia, eventos, estado,
// dibujos con llave, listas marcadas con su nombre, avisos de desarrollo y los plugins de ejemplo.
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseEvent } from "@ag-ui/core";
import { createPilotState, type PilotState } from "../src/core";
import { Piloto, definePlugin, pluginPoints, pluginRequires, resolvePlugins, type Pilot, type PilotoPlugin } from "../src/react";
import { livePage, modelPicker, pilotDevtools } from "../src/plugins";
import type { PilotTransport } from "../src/transport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo ??= function () {};

const fakePilot = (state: Partial<PilotState>): Pilot =>
  ({ state: { ...createPilotState(), ...state }, threadId: "t", canSteer: false, loadingOlder: false }) as unknown as Pilot;

afterEach(() => vi.restoreAllMocks());

describe("resolvePlugins: orden y precedencia", () => {
  const a = definePlugin({
    name: "a",
    strings: { stop: "Para" },
    tools: { verbs: { x: { one: "A", many: "A" } }, render: { create_image: () => null } },
    message: { custom: { "ghosty.delivery": () => null }, formatUserText: (t) => t.toUpperCase() },
    markdown: { transform: (md) => `${md}!` },
    header: () => null,
  });
  const b = definePlugin({
    name: "b",
    strings: { stop: "Alto" },
    tools: { verbs: { x: { one: "B", many: "B" } }, render: { create_image: () => null } },
    message: { formatUserText: (t) => `«${t}»` },
    markdown: { transform: (md) => `¡${md}` },
    header: () => null,
  });

  it("mapas: el de después gana; dibujos con llave: el primero gana y se avisa; listas: todos en orden", () => {
    const r = resolvePlugins([a, b]);
    expect(r.strings.stop).toBe("Alto");
    expect(r.verbs.x.one).toBe("B");
    expect(r.toolRenders.create_image.plugin).toBe("a");
    expect(r.warnings).toEqual(["«b» y «a» dibujan tools.render[create_image]: gana «a» (va antes)."]);
    expect(r.header.map((h) => h.plugin)).toEqual(["a", "b"]);
    expect(r.formatUserText!("hola")).toBe("«HOLA»");
    expect(r.markdown.transform!("x")).toBe("¡x!");
  });

  it("nombres repetidos y requires que no cuadra se avisan", () => {
    const r = resolvePlugins([
      { name: "dup" },
      { name: "dup", requires: { events: ["ghosty.page"] }, events: { "ghosty.page": () => {}, "ghosty.ui": () => {} } },
    ]);
    expect(r.warnings).toEqual(["Hay dos plugins «dup»: el nombre debe ser único.", "«dup» atiende «ghosty.ui» sin declararlo en requires."]);
  });

  it("pluginRequires deriva lo que atiende; pluginPoints nombra sus puntos", () => {
    const p: PilotoPlugin = { name: "crm", events: { "ghosty.ui": () => {} }, state: { model: () => {} }, message: { custom: { "crm.card": () => null } }, composer: { actions: () => null } };
    expect(pluginRequires(p)).toEqual({ events: ["ghosty.ui", "crm.card"], state: ["model"] });
    expect(pluginPoints(p)).toEqual(["events[ghosty.ui]", "state[model]", "message.custom[crm.card]", "composer.actions"]);
  });
});

describe("<Piloto plugins>", () => {
  it("dibuja cada punto como componente, marcado con su plugin", () => {
    const turns = [
      { role: "user" as const, text: "hola" },
      { role: "assistant" as const, text: "listo", tools: [{ id: "c1", title: "create_image", status: "in_progress" }], custom: [{ name: "crm.card", value: { lead: "Rosa" } }, { name: "otro", value: 1 }] },
    ];
    const crm = definePlugin({
      name: "crm",
      message: {
        custom: { "crm.card": ({ entry }) => <b>{`lead ${(entry.value as { lead: string }).lead}`}</b> },
        user: ({ turn }) => <i>{`dijo ${turn.text}`}</i>,
        assistant: ({ live }) => <i>{live ? "en vivo" : "cerrada"}</i>,
      },
      tools: { render: { create_image: ({ tool }) => <em>{`imagen ${tool.status}`}</em> }, verbs: { create_image: { one: "Creé una imagen", many: "Creé %n", running: "Creando imagen…" } } },
      header: () => <button type="button">compartir</button>,
      composer: { actions: () => <button type="button">señalar</button>, above: () => <p>chips</p> },
      aboveThread: () => <p>arriba</p>,
      sidePanel: ({ ctx }) => <aside>{`n=${String(ctx.agentState.n)}`}</aside>,
      vars: { "--piloto-accent": "#f00" },
      className: "mi-marca",
    });
    const html = renderToString(<Piloto transport={null} pilot={fakePilot({ turns, agentState: { n: 2 } })} plugins={[crm]} />);
    for (const s of ["lead Rosa", "dijo hola", "cerrada", "imagen in_progress", "compartir", "señalar", "chips", "arriba", "n=2"]) expect(html).toContain(s);
    expect(html).toContain('data-plugin="crm"');
    expect(html).toContain("mi-marca");
    expect(html).toContain("--piloto-accent:#f00");
  });

  it("empty y waiting: el primer plugin que los declara", () => {
    const html = renderToString(
      <Piloto transport={null} pilot={fakePilot({})} plugins={[{ name: "a", empty: () => <p>vacío propio</p> }, { name: "b", empty: () => <p>otro</p> }]} />,
    );
    expect(html).toContain("vacío propio");
    expect(html).not.toContain("otro");
    const waiting = renderToString(
      <Piloto transport={null} pilot={fakePilot({ turns: [{ role: "user", text: "x" }], busy: true, step: "waking" })} plugins={[{ name: "img", waiting: ({ step }) => <p>{`esperando ${step}`}</p> }]} />,
    );
    expect(waiting).toContain("esperando waking");
  });

  it("strings, verbos y adjuntos vienen de plugins", () => {
    const html = renderToString(
      <Piloto
        transport={null}
        pilot={fakePilot({ turns: [{ role: "user", text: "x" }, { role: "assistant", text: "", tools: [{ id: "1", title: "run_cron", status: "completed" }] }] })}
        plugins={[{ name: "t", strings: { placeholderDefault: "Pregúntale al piloto" }, tools: { verbs: { run_cron: { one: "Corrí un cron", many: "Corrí %n" } } }, composer: { attachments: { upload: async () => ({ url: "x" }) } } }]}
      />,
    );
    expect(html).toContain("Pregúntale al piloto");
    expect(html).toContain("Corrí un cron");
    expect(html).toContain("Adjuntar");
  });

  it("events y state llegan a los plugins con el piloto vivo; un CUSTOM sin dueño se avisa una vez", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    const transport: PilotTransport = {
      async run(input, onEvent) {
        const e = (x: Record<string, unknown>) => onEvent(x as unknown as BaseEvent);
        e({ type: "RUN_STARTED", runId: input.runId });
        e({ type: "STATE_SNAPSHOT", snapshot: { model: { current: "m1" } } });
        e({ type: "CUSTOM", name: "ghosty.ui", value: { action: "open", id: 7 } });
        e({ type: "CUSTOM", name: "nadie.lo.atiende", value: 1 });
        e({ type: "CUSTOM", name: "nadie.lo.atiende", value: 2 });
        e({ type: "STATE_DELTA", delta: [{ op: "replace", path: "/model/current", value: "m2" }] });
        e({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } });
      },
    };
    const board = definePlugin({
      name: "board",
      events: { "ghosty.ui": (e) => seen.push(`ui ${JSON.stringify(e.value)}`), "*": (e) => e.type === "RUN_FINISHED" && seen.push("fin") },
      state: { model: (v) => seen.push(`model ${(v as { current: string }).current}`) },
    });
    const el = document.createElement("div");
    const root = createRoot(el);
    let api: { send: (t: string) => void } | null = null;
    function App() {
      const [plugins] = useState(() => [board]);
      return <Piloto ref={(h) => void (api = h)} transport={transport} plugins={plugins} />;
    }
    await act(async () => root.render(<App />));
    await act(async () => {
      api!.send("hola");
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(seen).toEqual(["ui {\"action\":\"open\",\"id\":7}", "fin", "model m2"]);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("nadie.lo.atiende"))).toHaveLength(1);
    await act(async () => root.unmount());
  });
});

describe("ghostykit/plugins", () => {
  it("modelPicker pinta las opciones del agente y livePage escucha ghosty.page", async () => {
    const changed: string[] = [];
    const transport: PilotTransport = {
      async run(input, onEvent) {
        const e = (x: Record<string, unknown>) => onEvent(x as unknown as BaseEvent);
        e({ type: "RUN_STARTED", runId: input.runId });
        e({ type: "STATE_SNAPSHOT", snapshot: { model: { current: "a", options: [{ value: "a", name: "Rápido" }, { value: "b", name: "Listo" }] } } });
        const page = (v: Record<string, unknown>) => e({ type: "CUSTOM", name: "ghosty.page", value: v });
        page({ event: "page-plan", pageId: "p", title: "Café", sections: [{ id: "hero", title: "Portada" }, { id: "menu", title: "Menú" }] });
        page({ event: "section", pageId: "p", id: "hero", ok: true });
        page({ event: "page-ready", pageId: "p", url: "https://x.test/cafe", title: "Café" });
        e({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } });
      },
    };
    const plugins = [modelPicker({ onChange: (v) => void changed.push(v) }), livePage()];
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    let api: { send: (t: string) => void } | null = null;
    await act(async () => root.render(<Piloto ref={(h) => void (api = h)} transport={transport} plugins={plugins} />));
    await act(async () => {
      api!.send("arma una landing");
      await new Promise((r) => setTimeout(r, 10));
    });
    const picker = el.querySelector('[data-plugin="modelPicker"]')!;
    expect(picker.textContent).toContain("Rápido");
    const panel = el.querySelector('[data-plugin="livePage"]')!;
    expect(panel.textContent).toContain("Café");
    expect(panel.textContent).toContain("1/2");
    expect(panel.querySelector('a[href="https://x.test/cafe"]')).not.toBeNull();
    await act(async () => root.unmount());
    el.remove();
  });

  it("pilotDevtools lista los plugins y sus puntos en consola", async () => {
    const group = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    const el = document.createElement("div");
    const root = createRoot(el);
    const plugins = [livePage(), pilotDevtools()];
    await act(async () => root.render(<Piloto transport={null} pilot={fakePilot({ turns: [{ role: "user", text: "x" }] })} plugins={plugins} />));
    expect(group).toHaveBeenCalledWith("[ghostykit] 2 plugins");
    expect(table.mock.calls[0][0]).toEqual([
      { plugin: "livePage", points: "events[ghosty.page] sidePanel", events: "ghosty.page", state: "" },
      { plugin: "pilotDevtools", points: "aboveThread", events: "", state: "" },
    ]);
    await act(async () => root.unmount());
  });
});
