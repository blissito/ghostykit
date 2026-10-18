// Streams AG-UI GRABADOS de un servidor real: el agente de examples/langgraph (LangGraph 1.5) servido
// por su adaptador oficial (`@ag-ui/langgraph` 0.0.45, `emitInterruptOutcome`). Se reproducen contra el
// reductor y contra el transporte, tal cual llegaron por la red.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { beginSend, createPilotState, messagesToTurns, reduceAgUiEvent, resolvePermission, splitNarration, type PilotState } from "../src/core";
import { PilotHttpError, createAgUiTransport, readSse } from "../src/transport";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const events = (name: string) =>
  fixture(name)
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));

function replay(s: PilotState, name: string, clock = { now: 10_000 }) {
  for (const e of events(name)) {
    clock.now += 50;
    s = reduceAgUiEvent(s, e, clock.now);
  }
  return s;
}

describe("un turno con pasos que termina pidiendo aprobación (LangGraph por AG-UI)", () => {
  const sent = beginSend(createPilotState(), "¿Por qué falló el monitor?", [], 10_000);
  const s = replay(sent, "agui-turn-interrupt.sse");

  it("arma UN turno del asistente: narración, dos pasos y el texto", () => {
    expect(s.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    const a = s.turns[1];
    expect(a.tools?.map((t) => [t.title, t.status, t.detail])).toEqual([
      ["list_crons", "completed", undefined],
      ["run_cron", "pending", "job: purge-notifications"],
    ]);
    const { steps, rest } = splitNarration(a.text, a.cuts);
    expect(steps).toEqual(["Reviso tus crons.", "El **monitor** falló por *timeout* y la purga de notificaciones lleva un día sin correr. Te pido permiso para correrla."]);
    expect(rest).toBe("");
  });

  it("el run se detiene: una tarjeta con título, herramienta y vencimiento; ya no está ocupado", () => {
    expect(s.busy).toBe(false);
    expect(s.permissions).toHaveLength(1);
    expect(s.permissions[0]).toMatchObject({ title: "Correr ahora purge-notifications", tool: "run_cron", toolCallId: "call_run_cron_3", reason: "confirmation" });
    expect(typeof s.permissions[0].expiresAt).toBe("string");
    expect(s.effects).toEqual([expect.objectContaining({ type: "turn-done", interrupted: true })]);
  });

  it("aprobar: el run del resume sigue en la MISMA burbuja, corre la tool y cierra con la respuesta", () => {
    const id = s.permissions[0].id;
    let r = resolvePermission(s, id, "approved");
    r = beginSend(r, "", [], 20_000);
    expect(r.turns).toHaveLength(2); // contestar no agrega burbuja del usuario
    r = replay(r, "agui-resume-approved.sse", { now: 20_000 });
    expect(r.turns).toHaveLength(2);
    const a = r.turns[1];
    expect(a.tools?.map((t) => [t.title, t.status])).toEqual([
      ["list_crons", "completed"],
      ["run_cron", "completed"],
    ]);
    expect(splitNarration(a.text, a.cuts).rest).toBe("Listo: la purga corrió (corrida manual, 1.8 s).");
    expect(a.decisions).toEqual([{ id, title: "Correr ahora purge-notifications", status: "approved" }]);
    expect(r.permissions).toEqual([]);
    expect(r.busy).toBe(false);
  });
});

describe("rechazar", () => {
  it("la herramienta no corre y el agente lo dice", () => {
    let s = createPilotState(messagesToTurns(events("agui-resume-rejected.sse").find((e) => e.type === "MESSAGES_SNAPSHOT").messages.slice(0, 4)));
    s = beginSend(s, "", [], 1);
    s = replay(s, "agui-resume-rejected.sse");
    const a = s.turns[1];
    expect(a.tools?.find((t) => t.title === "run_cron")?.status).toBe("completed"); // su ToolMessage es «Rechazado»
    expect(splitNarration(a.text, a.cuts).rest).toBe("No corrí la purga. Cuando quieras, me dices.");
  });
});

describe("abrir un hilo (POST sin mensaje nuevo)", () => {
  it("en pausa: MESSAGES_SNAPSHOT pinta el hilo y la tarjeta sigue abierta, sin «fin de turno»", () => {
    const s = replay(createPilotState(), "agui-open-paused.sse");
    expect(s.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(s.turns[1].tools?.map((t) => t.status)).toEqual(["completed", "pending"]);
    expect(s.permissions[0].tool).toBe("run_cron");
    expect(s.busy).toBe(false);
    expect(s.effects).toEqual([]);
  });

  it("terminado: el hilo completo y nada abierto", () => {
    const s = replay(createPilotState(), "agui-open-done.sse");
    expect(s.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(s.permissions).toEqual([]);
  });

  it("el snapshot que llega al final de un run no duplica nada y conserva segundos y decisiones", () => {
    const live = replay(beginSend(createPilotState(), "¿Por qué falló el monitor?", [], 10_000), "agui-turn-interrupt.sse");
    expect(live.turns[1].seconds).toBeGreaterThan(0);
    const again = reduceAgUiEvent(live, events("agui-turn-interrupt.sse").find((e) => e.type === "MESSAGES_SNAPSHOT"));
    expect(again.turns).toHaveLength(2);
    expect(again.turns[1].seconds).toBe(live.turns[1].seconds);
  });
});

describe("errores y otros eventos", () => {
  it("RUN_ERROR termina el turno con su mensaje", () => {
    let s = beginSend(createPilotState(), "hola", [], 1);
    s = reduceAgUiEvent(s, { type: "RUN_STARTED", threadId: "t", runId: "r" });
    s = reduceAgUiEvent(s, { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "Voy" });
    s = reduceAgUiEvent(s, { type: "RUN_ERROR", message: "Se acabó el saldo", code: "quota" });
    expect(s.busy).toBe(false);
    expect(s.error).toBe("Se acabó el saldo");
    expect(s.effects[0]).toMatchObject({ type: "turn-done", error: "Se acabó el saldo" });
  });

  it("herramienta fallida (metadata.error), pensamiento, uso y título", () => {
    let s = beginSend(createPilotState(), "hola", [], 1);
    for (const e of [
      { type: "RUN_STARTED", threadId: "t", runId: "r" },
      { type: "REASONING_MESSAGE_CONTENT", messageId: "x", delta: "Debo leer" },
      { type: "TOOL_CALL_START", toolCallId: "a", toolCallName: "read" },
      { type: "TOOL_CALL_RESULT", messageId: "y", toolCallId: "a", content: "ENOENT", metadata: { error: true } },
      { type: "CUSTOM", name: "ghosty.title", value: { title: "Lectura" } },
    ]) s = reduceAgUiEvent(s, e);
    expect(s.effects).toEqual([{ type: "title", title: "Lectura" }]);
    s = reduceAgUiEvent(s, { type: "RUN_FINISHED", threadId: "t", runId: "r", outcome: { type: "success" }, usage: [{ inputTokens: 100, outputTokens: 20 }] });
    expect(s.turns[1]).toMatchObject({ thought: "Debo leer", tools: [{ id: "a", title: "read", status: "failed" }], usage: { used: 120, input: 100, output: 20 } });
  });

  it("los CHUNK compactos también valen", () => {
    let s = beginSend(createPilotState(), "hola", [], 1);
    for (const e of [
      { type: "TEXT_MESSAGE_CHUNK", messageId: "m", role: "assistant", delta: "Ho" },
      { type: "TEXT_MESSAGE_CHUNK", messageId: "m", delta: "la" },
      { type: "TOOL_CALL_CHUNK", toolCallId: "c", toolCallName: "web_search", delta: '{"q":' },
      { type: "TOOL_CALL_CHUNK", toolCallId: "c", delta: '"x"}' },
    ]) s = reduceAgUiEvent(s, e);
    expect(s.turns[1].text).toBe("Hola");
    expect(s.turns[1].tools?.[0]).toMatchObject({ title: "web_search", args: '{"q":"x"}' });
  });
});

describe("createAgUiTransport", () => {
  const stream = (text: string, pieces = 7) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        // En pedazos arbitrarios, como llega por la red.
        for (let i = 0; i < text.length; i += Math.ceil(text.length / pieces)) c.enqueue(enc.encode(text.slice(i, i + Math.ceil(text.length / pieces))));
        c.close();
      },
    });

  it("POST con el RunAgentInput y entrega los eventos del stream grabado, en orden", async () => {
    const calls: [string, RequestInit][] = [];
    const t = createAgUiTransport({
      url: "/agent",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push([url, init]);
        return new Response(stream(fixture("agui-turn-interrupt.sse")), { headers: { "content-type": "text/event-stream" } });
      }) as unknown as typeof fetch,
    });
    const got: string[] = [];
    await t.run({ threadId: "t", runId: "r", messages: [{ id: "u", role: "user", content: "hola" }], tools: [], context: [] }, (e) => got.push(e.type));
    expect(calls[0][0]).toBe("/agent");
    expect(calls[0][1].method).toBe("POST");
    expect((calls[0][1].headers as Record<string, string>).accept).toBe("text/event-stream");
    expect(JSON.parse(String(calls[0][1].body))).toMatchObject({ threadId: "t", runId: "r" });
    expect(got).toEqual(events("agui-turn-interrupt.sse").map((e) => e.type));
  });

  it("503 reintenta el MISMO run tras Retry-After; 409 se lanza con su código", async () => {
    const waits: number[] = [];
    const bodies: string[] = [];
    let n = 0;
    const t = createAgUiTransport({
      url: "/agent",
      sleep: async (ms) => void waits.push(ms),
      fetch: (async (_u: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return n++ === 0
          ? new Response("{}", { status: 503, headers: { "Retry-After": "2" } })
          : new Response(stream(fixture("agui-open-done.sse")), { headers: { "content-type": "text/event-stream" } });
      }) as unknown as typeof fetch,
    });
    await t.run({ threadId: "t", runId: "r1", messages: [], tools: [], context: [] }, () => {});
    expect(waits).toEqual([2000]);
    expect(bodies[0]).toBe(bodies[1]);

    const busy = createAgUiTransport({ url: "/agent", fetch: (async () => Response.json({ error: "interrupt_pending", message: "Hay aprobaciones pendientes" }, { status: 409 })) as unknown as typeof fetch });
    const err = await busy.run({ threadId: "t", runId: "r2", messages: [], tools: [], context: [] }, () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(PilotHttpError);
    expect(err).toMatchObject({ status: 409, code: "interrupt_pending", message: "Hay aprobaciones pendientes" });
  });

  it("readSse ignora comentarios (: ping) y junta data partida", async () => {
    const got: string[] = [];
    await readSse(stream(': ping\n\ndata: {"type":"RUN_STARTED"}\n\n', 9), (m) => got.push(m.data));
    expect(got).toEqual(['{"type":"RUN_STARTED"}']);
  });
});

describe("un run sobrevive a su cliente y se detiene sólo explícito", () => {
  it("abrir el hilo con un run vivo: snapshot y luego sus eventos en vivo, hasta la tarjeta", () => {
    let s = replay(createPilotState(), "agui-open-live.sse");
    expect(s.busy).toBe(false);
    expect(s.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(s.turns[1].tools?.map((t) => t.title)).toEqual(["list_crons", "run_cron"]);
    expect(s.permissions[0]).toMatchObject({ tool: "run_cron" });
    // Mientras corría, estaba ocupado (los puntitos y «Detener»).
    s = createPilotState();
    s = reduceAgUiEvent(s, events("agui-open-live.sse")[0]);
    expect(s.busy).toBe(true);
  });

  it("detener: el run leído termina en `cancelled` sin tarjetas, y la respuesta del cancel también", () => {
    let s = replay(beginSend(createPilotState(), "¿Por qué falló el monitor?", [], 1), "agui-cancelled-run.sse");
    expect(s.busy).toBe(false);
    expect(s.permissions).toEqual([]);
    expect(s.turns[1].text).toContain("Reviso tus crons.");
    s = replay(s, "agui-cancel.sse");
    expect(s.busy).toBe(false);
  });
});
