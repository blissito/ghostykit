// «Conectando» nunca parpadea: o no sale, o sale y se queda un mínimo.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONNECTING_MIN_MS, initialGate, stepGate } from "../src/react/connectingGate";
import { Piloto } from "../src/react";
import { createPostStreamTransport } from "../src/transport";

/** Simula el reloj: `connectedAt` = cuándo llega la conexión (null = nunca). Devuelve los cambios de visibilidad. */
function run(connectedAt: number | null, until = 5000) {
  let gate = initialGate(0, connectedAt === 0);
  let visible = false;
  const changes: { t: number; visible: boolean }[] = [];
  for (let t = 0; t <= until; t += 10) {
    const r = stepGate(gate, connectedAt !== null && t >= connectedAt, t);
    gate = r.gate;
    if (r.visible !== visible) {
      visible = r.visible;
      changes.push({ t, visible });
    }
  }
  return changes;
}

describe("connectingGate", () => {
  it("una conexión que tarda 900 ms no enseña nada (ni mostrar ni ocultar)", () => {
    expect(run(900)).toEqual([]);
  });

  it("si de verdad tarda, sale y se queda al menos 700 ms aunque la conexión llegue justo después", () => {
    const c = run(1300);
    expect(c[0]).toEqual({ t: 1200, visible: true });
    expect(c[1].visible).toBe(false);
    expect(c[1].t - c[0].t).toBeGreaterThanOrEqual(CONNECTING_MIN_MS);
  });

  it("conectado desde el inicio (transporte por turno): nunca sale", () => {
    expect(run(0)).toEqual([]);
  });

  it("sin conexión, se queda a la vista", () => {
    expect(run(null)).toEqual([{ t: 1200, visible: true }]);
  });
});

describe("transporte POST por turno (EasyBits)", () => {
  it("el hilo vacío sale al instante, sin «conectando» ni en el placeholder", () => {
    const transport = createPostStreamTransport({ url: "/chat", fetch: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch });
    expect(transport.stream).toBe("per-turn");
    const html = renderToString(<Piloto transport={transport} welcome="Hola" placeholder="Pregunta…" />);
    expect(html).toContain("Hola");
    expect(html).toContain('placeholder="Pregunta…"');
    expect(html).not.toContain("Conectando");
  });
});
