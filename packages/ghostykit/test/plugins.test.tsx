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

describe("0.7.0 con la lista de gs (/c)", () => {
  it("extractBlocks saca los bloques con nombre (también el que se está escribiendo) y recorre los cortes", async () => {
    const { extractBlocks } = await import("../src/core");
    const text = "Reviso.\nTe dejo el archivo:\n```eb-file\n{\"id\":\"f1\"}\n```\nY el audio:\n```eb-audio\n{\"id\":\"a1";
    const r = extractBlocks(text, ["eb-file", "eb-audio"], [7]);
    expect(r.blocks).toEqual([
      { lang: "eb-file", body: "{\"id\":\"f1\"}", complete: true },
      { lang: "eb-audio", body: "{\"id\":\"a1", complete: false },
    ]);
    expect(r.text).toBe("Reviso.\nTe dejo el archivo:\n\nY el audio:\n");
    expect(r.cuts).toEqual([7]);
    expect(extractBlocks("```ts\ncode\n```", ["eb-file"]).blocks).toEqual([]);
  });

  it("un turno cerrado que acabó en un paso: lo último que dijo es la respuesta, no narración", async () => {
    const { splitNarration } = await import("../src/core");
    const text = "Reviso tus crons.Aquí está tu respuesta final.";
    expect(splitNarration(text, [17, text.length])).toEqual({ steps: ["Reviso tus crons.", "Aquí está tu respuesta final."], rest: "" });
    expect(splitNarration(text, [17, text.length], true)).toEqual({ steps: ["Reviso tus crons."], rest: "Aquí está tu respuesta final." });
  });

  it("markdown.blocks, markdown.transform(md, turn), message.assistantBefore, wrap, composer.below/actionsEnd y el aislamiento", () => {
    const turns = [
      { role: "user" as const, text: "hola" },
      { id: "a7", role: "assistant" as const, text: "Listo:\n```eb-file\n{\"name\":\"cotizacion.pdf\"}\n```\nCualquier cosa me dices." },
    ];
    const gs = definePlugin({
      name: "gs",
      markdown: {
        blocks: { "eb-file": ({ block }) => <span>{`tarjeta ${(JSON.parse(block.body) as { name: string }).name}`}</span> },
        transform: (md, turn) => `${md} [${turn?.id}]`,
      },
      message: { assistantBefore: () => <span>antes-del-texto</span> },
      wrap: ({ children }) => <section data-proveedor="">{children}</section>,
      composer: { below: () => <span>chips-abajo</span>, actionsEnd: () => <span>tras-el-clip</span> },
    });
    const html = renderToString(<Piloto transport={null} pilot={fakePilot({ turns })} plugins={[gs, { name: "nuestro", styles: "ghostykit", header: () => <b>h</b> }]} />);
    expect(html).toContain("tarjeta cotizacion.pdf");
    expect(html).not.toContain("eb-file");
    expect(html).toContain("[a7]");
    expect(html.indexOf("antes-del-texto")).toBeLessThan(html.indexOf("Cualquier cosa"));
    expect(html.startsWith("<section data-proveedor")).toBe(true);
    expect(html).toContain("chips-abajo");
    expect(html).toContain("tras-el-clip");
    expect(html).toContain('data-plugin="gs" data-piloto-isolate=""');
    expect(html).toMatch(/data-plugin="nuestro"(?! data-piloto-isolate)/);
  });

  it("el ref de <Piloto> es el mismo handle que ctx: addAttachments (sin texto), reconnect y onTurnDone de un plugin", async () => {
    const inputs: RunAgentInputLike[] = [];
    const transport: PilotTransport = {
      async run(input, onEvent) {
        inputs.push(input as unknown as RunAgentInputLike);
        onEvent({ type: "RUN_STARTED", runId: input.runId } as unknown as BaseEvent);
        onEvent({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } } as unknown as BaseEvent);
      },
    };
    const done: string[] = [];
    const plugins = [definePlugin({ name: "fin", onTurnDone: (info) => void done.push(`fin ${info.runId ? "ok" : "?"}`) })];
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    let api: import("../src/react").PilotoHandle | null = null;
    await act(async () => root.render(<Piloto ref={(h) => void (api = h)} transport={transport} plugins={plugins} />));
    expect(Object.keys(api!).sort()).toEqual(["addAttachments", "addReference", "focus", "pilot", "send", "setDraft"]);
    await act(async () => api!.addAttachments([{ name: "contrato.pdf", mimeType: "application/pdf", url: "https://x.test/c.pdf" }]));
    expect(el.textContent).toContain("pdf");
    const sendBtn = el.querySelector('button[aria-label="Enviar"]') as HTMLButtonElement;
    await act(async () => {
      sendBtn.click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(inputs[0].messages[0].content).toEqual([{ type: "document", mimeType: "application/pdf", filename: "contrato.pdf", source: { type: "url", value: "https://x.test/c.pdf" } }]);
    expect(done).toEqual(["fin ok"]);
    await act(async () => void (await api!.pilot.reconnect()));
    expect(inputs[1].messages).toEqual([]);
    await act(async () => root.unmount());
    el.remove();
  });

  it("initialPrompt sale en cuanto el hilo está abierto", async () => {
    const order: string[] = [];
    const transport: PilotTransport = {
      async run(input, onEvent) {
        order.push(input.messages.length ? `manda ${input.messages[0].content}` : "abre");
        onEvent({ type: "RUN_STARTED", runId: input.runId } as unknown as BaseEvent);
        onEvent({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } } as unknown as BaseEvent);
      },
    };
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => {
      root.render(<Piloto transport={transport} threadId="44444444-4444-4444-8444-444444444444" initialPrompt="hazme la cotización" />);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(order).toEqual(["abre", "manda hazme la cotización"]);
    await act(async () => root.unmount());
  });
});

type RunAgentInputLike = { messages: { content: unknown }[] };

describe("0.7.0: gs-agui y MailMask", () => {
  const mmTurn = {
    role: "assistant" as const,
    text: "Revisé tu cuenta. Tienes 1 dominio.\n\nSus registros DNS están bien. [Ver DNS](#ir-dns)",
    cuts: [35],
    tools: [{ id: "c1", title: "list_domains", status: "completed" }],
  };

  it("features.narration=false: el texto antes de la herramienta es respuesta, no paso; el paso lleva una llave, no la garra", () => {
    const pilot = fakePilot({ turns: [{ role: "user", text: "¿cuántos?" }, mmTurn] });
    const on = renderToString(<Piloto transport={null} pilot={pilot} />);
    expect(on).toContain("gs-narracion");
    const off = renderToString(<Piloto transport={null} pilot={pilot} features={{ narration: false }} />);
    expect(off).not.toContain("gs-narracion");
    expect(off).toContain("Revisé tu cuenta");
    expect(off).toContain("lucide-wrench");
  });

  it("markdown.components pinta un enlace como CTA con ctx; message.avatar va junto a la respuesta; beforeSend reescribe lo que sale", async () => {
    const sent: unknown[] = [];
    const transport: PilotTransport = {
      async run(input, onEvent) {
        sent.push(input.messages[0]?.content);
        onEvent({ type: "RUN_STARTED", runId: input.runId } as unknown as BaseEvent);
        onEvent({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } } as unknown as BaseEvent);
      },
    };
    const mm = definePlugin({
      name: "mailmask",
      markdown: {
        components: {
          a: ({ href, children, ctx }) =>
            String(href).startsWith("#ir-") ? (
              <button type="button" data-cta="" onClick={() => ctx.setDraft("ir")}>
                {children}
              </button>
            ) : (
              <a href={String(href)}>{children}</a>
            ),
        },
      },
      message: { avatar: () => <img alt="Mask" src="/mask.png" />, beforeSend: (t) => `[Señalado: dominio] ${t}` },
    });
    const html = renderToString(<Piloto transport={null} pilot={fakePilot({ turns: [{ role: "user", text: "x" }, mmTurn] })} plugins={[mm]} features={{ narration: false }} />);
    expect(html).toMatch(/<button type="button" data-cta="">Ver DNS<\/button>/);
    expect(html).toContain('alt="Mask"');
    const el = document.createElement("div");
    const root = createRoot(el);
    let api: import("../src/react").PilotoHandle | null = null;
    await act(async () => root.render(<Piloto ref={(h) => void (api = h)} transport={transport} plugins={[mm]} />));
    await act(async () => {
      api!.send("hola");
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(sent).toEqual(["[Señalado: dominio] hola"]);
    await act(async () => root.unmount());
  });

  it("403 con x-needs-login: onHttpError avisa y composer.replace cambia la caja por la invitación", async () => {
    const { PilotHttpError } = await import("../src/transport");
    const seen: number[] = [];
    const transport: PilotTransport = {
      async run() {
        throw new PilotHttpError("Se acabó la prueba.", 403, "needs_account", undefined, { "x-needs-login": "1" });
      },
    };
    const demo = definePlugin({
      name: "demo",
      onHttpError: (e) => void seen.push(e.status),
      composer: { replace: { when: (ctx) => ctx.pilot.state.httpError?.headers?.["x-needs-login"] === "1", view: () => <a href="/signup">Crea tu cuenta</a> } },
    });
    const el = document.createElement("div");
    const root = createRoot(el);
    let api: import("../src/react").PilotoHandle | null = null;
    await act(async () => root.render(<Piloto ref={(h) => void (api = h)} transport={transport} plugins={[demo]} />));
    expect(el.querySelector("textarea")).not.toBeNull();
    await act(async () => {
      api!.send("hola");
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(seen).toEqual([403]);
    expect(el.querySelector("textarea")).toBeNull();
    expect(el.textContent).toContain("Crea tu cuenta");
    await act(async () => root.unmount());
  });

  it("composer.attachments.accept: sólo fotos (sin clip) y el filtro de lo que entra", async () => {
    const { accepts } = await import("../src/react/Composer");
    expect(accepts("image/*", "a.png", "image/png")).toBe(true);
    expect(accepts("image/*", "a.pdf", "application/pdf")).toBe(false);
    expect(accepts("image/*,.pdf", "A.PDF", "application/pdf")).toBe(true);
    const html = renderToString(
      <Piloto transport={null} pilot={fakePilot({})} plugins={[{ name: "fotos", composer: { attachments: { upload: async () => ({ url: "x" }), accept: "image/*", maxFiles: 4, maxBytes: 4 * 1024 * 1024 } } }]} />,
    );
    expect(html).toContain("Adjuntar imagen");
    expect(html).not.toContain("Adjuntar archivo");
  });
});
