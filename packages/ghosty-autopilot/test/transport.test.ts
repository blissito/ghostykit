import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotHttpError, createSseTransport } from "../src/transport";

/** Un EventSource de mentira: se le empujan eventos con `emit`. */
class FakeES {
  static all: FakeES[] = [];
  url: string;
  withCredentials: boolean;
  closed = false;
  listeners = new Map<string, ((e: { data?: string }) => void)[]>();
  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = Boolean(init?.withCredentials);
    FakeES.all.push(this);
  }
  addEventListener(name: string, fn: (e: { data?: string }) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, data?: unknown) {
    for (const fn of this.listeners.get(name) ?? []) fn({ data: data === undefined ? undefined : JSON.stringify(data) });
  }
}

let clock = 0;
beforeEach(() => {
  FakeES.all = [];
  clock = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function setup(busy = { v: false }) {
  const events: [string, unknown][] = [];
  const t = createSseTransport("/api/conv/1/", { EventSource: FakeES as unknown as typeof EventSource, now: () => clock, withCredentials: true });
  const off = t.subscribe((n, d) => events.push([n, d]), { isBusy: () => busy.v });
  return { t, events, off, busy };
}

describe("createSseTransport", () => {
  it("abre `${base}/events` y entrega los eventos con nombre ya parseados", () => {
    const { events } = setup();
    const es = FakeES.all[0];
    expect(es.url).toBe("/api/conv/1/events");
    expect(es.withCredentials).toBe(true);
    es.emit("started", { latidoMs: 25_000 });
    es.emit("chunk", { text: "hola" });
    expect(events).toEqual([
      ["started", { latidoMs: 25_000 }],
      ["chunk", { text: "hola" }],
    ]);
  });

  it("el `error` nativo (sin data) no llega; el del servidor sí", () => {
    const { events } = setup();
    FakeES.all[0].emit("error");
    FakeES.all[0].emit("error", { message: "sin saldo" });
    expect(events).toEqual([["error", { message: "sin saldo" }]]);
  });

  it("`closed` cierra el stream", () => {
    setup();
    FakeES.all[0].emit("closed", {});
    expect(FakeES.all[0].closed).toBe(true);
  });

  it("silencio con turno vivo y latido anunciado → reabre tras 4 latidos (piso 90 s)", () => {
    const { busy } = setup();
    FakeES.all[0].emit("started", { latidoMs: 25_000 });
    busy.v = true;
    clock = 99_000;
    vi.advanceTimersByTime(15_000);
    expect(FakeES.all).toHaveLength(1);
    clock = 100_001;
    vi.advanceTimersByTime(15_000);
    expect(FakeES.all).toHaveLength(2);
    expect(FakeES.all[0].closed).toBe(true);
  });

  it("sin latido, el tope es de 11 min; sin turno vivo, nunca", () => {
    const { busy } = setup();
    clock = 60 * 60_000;
    vi.advanceTimersByTime(15_000);
    expect(FakeES.all).toHaveLength(1); // en reposo no se reconecta
    busy.v = true;
    vi.advanceTimersByTime(15_000);
    expect(FakeES.all).toHaveLength(2);
  });

  it("un evento de la conexión vieja ya no llega", () => {
    const { busy, events } = setup();
    busy.v = true;
    clock = 12 * 60_000;
    vi.advanceTimersByTime(15_000);
    FakeES.all[0].emit("chunk", { text: "viejo" });
    FakeES.all[1].emit("chunk", { text: "nuevo" });
    expect(events).toEqual([["chunk", { text: "nuevo" }]]);
  });

  it("cerrar la suscripción para el reloj y el stream", () => {
    const { off, busy } = setup();
    busy.v = true;
    off();
    clock = 60 * 60_000;
    vi.advanceTimersByTime(60_000);
    expect(FakeES.all).toHaveLength(1);
    expect(FakeES.all[0].closed).toBe(true);
  });
});

describe("POSTs", () => {
  function withFetch(res: Response) {
    const calls: [string, RequestInit][] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return res;
    });
    const t = createSseTransport("/c", { fetch: fetch as unknown as typeof globalThis.fetch, EventSource: FakeES as unknown as typeof EventSource });
    return { t, calls };
  }

  it("send manda el contrato de Ghosty y traduce la respuesta", async () => {
    const { t, calls } = withFetch(Response.json({ inyectado: false, estado: "queued", turnId: "t9" }));
    const r = await t.send({ text: "hola", attachments: [], firstTurn: true, resume: true, context: { screen: "crons" } });
    expect(r).toEqual({ injected: false, state: "queued", turnId: "t9" });
    expect(calls[0][0]).toBe("/c/messages");
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ content: "hola", images: [], primerTurno: true, retomar: true, context: { screen: "crons" } });
  });

  it("un rechazo se lanza con su texto y si pide cuenta", async () => {
    const { t } = withFetch(new Response("Sin mensajes", { status: 402, headers: { "X-Needs-Login": "1" } }));
    const err = await t.send({ text: "x", attachments: [], firstTurn: false }).catch((e) => e);
    expect(err).toBeInstanceOf(PilotHttpError);
    expect(err).toMatchObject({ message: "Sin mensajes", status: 402, needsLogin: true });
  });

  it("permiso: POST con id y optionId", async () => {
    const { t, calls } = withFetch(Response.json({ resuelto: true }));
    expect(await t.respondPermission!("p1", "allow")).toEqual({ resolved: true });
    expect(calls[0][0]).toBe("/c/permission");
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ id: "p1", optionId: "allow" });
  });
});
