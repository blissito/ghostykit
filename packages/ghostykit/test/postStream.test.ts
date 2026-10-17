import { describe, expect, it } from "vitest";
import { PilotHttpError, createPostStreamTransport, readSse } from "../src/transport";

const enc = new TextEncoder();
const sse = (events: [string, unknown][]) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");

/** Un body que entrega `chunks` y (opcional) se queda abierto hasta que lo cierren. */
function body(chunks: string[], keepOpen = false) {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      if (!keepOpen) c.close();
    },
  });
  return { stream, push: (s: string) => ctrl.enqueue(enc.encode(s)), close: () => ctrl.close() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 10) {
  for (let i = 0; i < n; i++) await tick();
}

type Call = { url: string; init?: RequestInit };
function fakeFetch(responses: ((call: Call) => Response)[]) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`fetch inesperado: ${url}`);
    return next(call);
  };
  return { fetch: f as unknown as typeof fetch, calls };
}

const stream = (s: ReadableStream<Uint8Array>) => new Response(s, { headers: { "content-type": "text/event-stream" } });

describe("readSse", () => {
  it("separa eventos con nombre, junta data multilínea e ignora comentarios, aunque lleguen en pedazos", async () => {
    const got: [string, string][] = [];
    const b = body(["event: chunk\ndata: {\"te", "xt\":\"a\"}\n\n: ka\n\nevent: done\r\ndata: 1\r\ndata: 2\r\n\r\n"]);
    await readSse(b.stream, (m) => got.push([m.event, m.data]));
    expect(got).toEqual([
      ["chunk", '{"text":"a"}'],
      ["done", "1\n2"],
    ]);
  });
});

describe("createPostStreamTransport (contrato de EasyBits)", () => {
  it("al suscribirse se re-engancha; el POST manda {text, context, turnId} con la cookie y su stream llega al listener", async () => {
    const live = body([sse([["started", { turnId: "T1" }], ["chunk", { text: "Hola", turnId: "T1" }]])], true);
    const { fetch, calls } = fakeFetch([
      () => stream(body([sse([["started", {}], ["idle", {}]])]).stream),
      () => stream(live.stream),
    ]);
    const events: [string, unknown][] = [];
    const t = createPostStreamTransport("/api/v2/admin/copilot/chat", { fetch, newTurnId: () => "T1" });
    expect(t.steer).toBe(false);
    t.subscribe((n, d) => events.push([n, d]), { isBusy: () => true });
    await settle();
    expect(calls[0].url).toBe("/api/v2/admin/copilot/chat?attach=1");
    expect(calls[0].init?.credentials).toBe("same-origin");

    const r = await t.send({ text: "hola", attachments: [], firstTurn: true, context: { page: "crons", job: "monitor" } });
    expect(r).toEqual({ turnId: "T1", state: "running" });
    expect(calls[1].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ text: "hola", context: { page: "crons", job: "monitor" }, turnId: "T1" });
    expect((calls[1].init?.headers as Record<string, string>).authorization).toBeUndefined();
    live.push(sse([["done", { turnId: "T1", text: "Hola" }]]));
    live.close();
    await settle();
    expect(events.map((e) => e[0])).toEqual(["started", "idle", "started", "chunk", "done"]);
  });

  it("503 (deploy): reintenta con el MISMO turnId tras Retry-After", async () => {
    const waits: number[] = [];
    const { fetch, calls } = fakeFetch([
      () => new Response(JSON.stringify({ error: "draining" }), { status: 503, headers: { "Retry-After": "3" } }),
      () => stream(body([sse([["started", { turnId: "T2" }], ["done", { turnId: "T2", text: "ok" }]])]).stream),
    ]);
    const t = createPostStreamTransport("/chat", { fetch, newTurnId: () => "T2", attachUrl: null, sleep: async (ms) => void waits.push(ms) });
    await t.send({ text: "x", attachments: [], firstTurn: false });
    expect(waits).toEqual([3000]);
    expect(JSON.parse(String(calls[0].init?.body)).turnId).toBe("T2");
    expect(JSON.parse(String(calls[1].init?.body)).turnId).toBe("T2");
  });

  it("409 turn_busy se lanza con su mensaje", async () => {
    const { fetch } = fakeFetch([() => Response.json({ error: "turn_busy", message: "Ya hay un turno en curso" }, { status: 409 })]);
    const t = createPostStreamTransport("/chat", { fetch, attachUrl: null });
    const err = await t.send({ text: "x", attachments: [], firstTurn: false }).catch((e) => e);
    expect(err).toBeInstanceOf(PilotHttpError);
    expect(err).toMatchObject({ status: 409, message: "Ya hay un turno en curso" });
  });

  it("`error` es final: se cierra con un `done` sintético", async () => {
    const events: string[] = [];
    const { fetch } = fakeFetch([() => stream(body([sse([["started", {}], ["error", { message: "falló" }]])]).stream)]);
    const t = createPostStreamTransport("/chat", { fetch, attachUrl: null });
    t.subscribe((n) => events.push(n));
    await t.send({ text: "x", attachments: [], firstTurn: false });
    await settle();
    expect(events).toEqual(["started", "error", "done"]);
  });

  it("el stream se corta sin evento final: se re-engancha y el attach termina el turno", async () => {
    const events: string[] = [];
    const urls: string[] = [];
    let attaches = 0;
    const fetch = (async (url: string, init?: RequestInit) => {
      urls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "POST") return stream(body([sse([["started", { turnId: "T3" }], ["chunk", { text: "a" }]])]).stream); // se cierra a medias
      attaches++;
      if (attaches === 1) return stream(body([sse([["started", {}], ["idle", {}]])]).stream);
      return stream(body([sse([["started", {}], ["snapshot", { turnId: "T3", text: "ab", tools: [] }], ["done", { turnId: "T3", text: "ab" }]])]).stream);
    }) as unknown as typeof globalThis.fetch;
    const t = createPostStreamTransport("/chat", { fetch, sleep: async () => {} });
    t.subscribe((n) => events.push(n), { isBusy: () => true });
    await settle();
    await t.send({ text: "x", attachments: [], firstTurn: false });
    await settle(30);
    expect(urls).toEqual(["GET /chat?attach=1", "POST /chat", "GET /chat?attach=1"]);
    expect(events).toEqual(["started", "idle", "started", "chunk", "started", "snapshot", "done"]);
  });

  it("historial: `{messages:[{role,text}]}` → turnos", async () => {
    const { fetch } = fakeFetch([() => Response.json({ messages: [{ role: "user", text: "hola" }, { role: "agent", text: "- ✓ Reviso.\n\nListo." }], pending: [] })]);
    const t = createPostStreamTransport("/chat", { fetch });
    expect(await t.history!()).toEqual([
      { role: "user", text: "hola" },
      { role: "assistant", text: "- ✓ Reviso.\n\nListo." },
    ]);
  });

  it("continuar un turno interrumpido manda `continueTurnId`", async () => {
    const { fetch, calls } = fakeFetch([() => stream(body([sse([["done", {}]])]).stream)]);
    const t = createPostStreamTransport("/chat", { fetch, attachUrl: null, newTurnId: () => "T4" });
    await t.send({ text: "Continúa donde te quedaste.", attachments: [], firstTurn: false, resume: true, resumeTurnId: "T0" });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ text: "Continúa donde te quedaste.", turnId: "T4", continueTurnId: "T0" });
  });
});
