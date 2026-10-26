// 0.8.0: lo que necesitó Deník para que Nik se vea como su chat — barra de arriba con dos lados
// (`header: { start, end }`), íconos propios del botón de mandar/detener (`icons`), la cola de tu
// burbuja (`--piloto-radius-bubble-tail`) y la piel `denik`.
import { memo } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createPilotState, type PilotState, type Turn } from "../src/core";
import { Piloto, pluginPoints, resolvePlugins, type Pilot } from "../src/react";

const fakePilot = (state: Partial<PilotState>): Pilot =>
  ({ state: { ...createPilotState(), ...state }, threadId: "t", canSteer: false, loadingOlder: false }) as unknown as Pilot;
const turns: Turn[] = [
  { role: "user", text: "hola" },
  { role: "assistant", text: "¿Qué hacemos?" },
];

describe("header: { start, end }", () => {
  it("una vista sola sigue yendo a la derecha; start/end se separan; memo cuenta como vista", () => {
    const Memo = memo(() => null);
    const r = resolvePlugins([
      { name: "viejo", header: () => null },
      { name: "nik", header: { start: () => null, end: () => null } },
      { name: "memo", header: Memo },
    ]);
    expect(r.header.map((h) => h.plugin)).toEqual(["viejo", "nik", "memo"]);
    expect(r.headerStart.map((h) => h.plugin)).toEqual(["nik"]);
    expect(pluginPoints({ name: "nik", header: { start: () => null } })).toEqual(["header.start"]);
    expect(pluginPoints({ name: "viejo", header: () => null })).toEqual(["header"]);
  });

  it("start a la izquierda y end a la derecha, en el hilo y en el hilo vacío", () => {
    const plugin = { name: "nik", header: { start: () => <b>Nik</b>, end: () => <button type="button">cerrar</button> } };
    for (const state of [{ turns }, {}]) {
      const html = renderToString(<Piloto transport={null} pilot={fakePilot(state)} plugins={[plugin]} />);
      const start = html.indexOf("piloto-header-start");
      const end = html.indexOf("piloto-header-end");
      expect(html).toContain("piloto-header");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      expect(html.indexOf("<b>Nik</b>")).toBeGreaterThan(start);
      expect(html.indexOf("cerrar")).toBeGreaterThan(end);
    }
  });

  it("sin header no hay barra", () => {
    const html = renderToString(<Piloto transport={null} pilot={fakePilot({ turns })} />);
    expect(html).not.toContain("piloto-header");
  });
});

describe("icons", () => {
  it("send propio en el botón; default, la flecha de siempre", () => {
    const own = renderToString(<Piloto transport={null} pilot={fakePilot({ turns })} icons={{ send: <i data-avion /> }} />);
    expect(own).toContain("data-avion");
    expect(own).toMatch(/gc-send[^>]*data-state="send"|data-state="send"[^>]*gc-send/);
    const plain = renderToString(<Piloto transport={null} pilot={fakePilot({ turns })} />);
    expect(plain).not.toContain("data-avion");
    expect(plain).toContain("lucide-arrow-up");
  });

  it("stop propio mientras responde", () => {
    const html = renderToString(<Piloto transport={null} pilot={fakePilot({ turns, busy: true })} icons={{ stop: <i data-alto /> }} />);
    expect(html).toContain("data-alto");
    expect(html).toContain('data-state="stop"');
  });
});

describe("piel y cola de la burbuja", () => {
  it("tu burbuja usa la cola con respaldo al radio normal", () => {
    const html = renderToString(<Piloto transport={null} pilot={fakePilot({ turns })} />);
    expect(html).toContain("rounded-br-[var(--piloto-radius-bubble-tail,var(--piloto-radius-bubble))]");
  });

  it("la piel denik existe en claro, oscuro y auto", () => {
    const css = readFileSync(join(__dirname, "../src/styles/base.css"), "utf8");
    expect(css).toContain('.piloto[data-skin="denik"] {');
    expect(css).toContain('.piloto[data-skin="denik"][data-theme="dark"]');
    expect(css).toContain('.piloto[data-skin="denik"][data-theme="auto"]');
    expect(css).toMatch(/data-skin="denik"\] \{[^}]*--piloto-radius-bubble-tail: 8px/);
  });
});
