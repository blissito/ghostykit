// @vitest-environment jsdom
// 0.5.0: estado del agente (STATE_SNAPSHOT/DELTA), CUSTOM por turno, pasos con nombre, steer, snapshot
// a media respuesta e historial paginado.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/core";
import { applyJsonPatch, beginSend, createPilotState, prependHistory, reduceAgUiEvent, type PilotState } from "../src/core";
import { Piloto, usePilot, type Pilot } from "../src/react";
import { PilotHttpError, type PilotTransport } from "../src/transport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const run = (s: PilotState, events: Record<string, unknown>[], now = 10_000) => events.reduce((x, e) => reduceAgUiEvent(x, e as never, now), s);

describe("JSON Patch (RFC 6902) del STATE_DELTA", () => {
  it("aplica add/remove/replace/move/copy/test sin mutar el original", () => {
    const doc = { caps: { steer: false }, list: [1, 2], a: { "b/c": 1 } };
    const { doc: out, ok } = applyJsonPatch(doc, [
      { op: "replace", path: "/caps/steer", value: true },
      { op: "add", path: "/list/-", value: 3 },
      { op: "add", path: "/list/0", value: 0 },
      { op: "remove", path: "/list/1" },
      { op: "copy", from: "/a/b~1c", path: "/x" },
      { op: "move", from: "/x", path: "/y" },
      { op: "test", path: "/y", value: 1 },
    ]);
    expect(ok).toBe(true);
    expect(out).toEqual({ caps: { steer: true }, list: [0, 2, 3], a: { "b/c": 1 }, y: 1 });
    expect(doc).toEqual({ caps: { steer: false }, list: [1, 2], a: { "b/c": 1 } });
  });

  it("un patch que no aplica deja el documento como estaba", () => {
    const doc = { a: 1 };
    expect(applyJsonPatch(doc, [{ op: "replace", path: "/a", value: 2 }, { op: "remove", path: "/nope" }])).toEqual({ doc, ok: false });
    expect(applyJsonPatch(doc, [{ op: "test", path: "/a", value: 2 }]).ok).toBe(false);
  });
});

describe("reductor 0.5.0", () => {
  it("STATE_SNAPSHOT y STATE_DELTA arman `agentState` y avisan a la app", () => {
    let s = run(createPilotState(), [{ type: "STATE_SNAPSHOT", snapshot: { caps: { steer: false }, page: { blocks: [] } } }]);
    expect(s.effects).toEqual([{ type: "state", state: s.agentState }]);
    s = run(s, [{ type: "STATE_DELTA", delta: [{ op: "replace", path: "/caps/steer", value: true }, { op: "add", path: "/page/blocks/-", value: { id: "hero" } }] }]);
    expect(s.agentState).toEqual({ caps: { steer: true }, page: { blocks: [{ id: "hero" }] } });
    const same = run(s, [{ type: "STATE_DELTA", delta: [{ op: "remove", path: "/missing" }] }]);
    expect(same.agentState).toBe(s.agentState);
  });

  it("los CUSTOM de contenido van al turno; los del protocolo no", () => {
    const s = run(beginSend(createPilotState(), "hazme el pdf", [], 1), [
      { type: "RUN_STARTED", runId: "r1" },
      { type: "CUSTOM", name: "ghosty.injected", value: { messageId: "m9" } },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "Listo." },
      { type: "CUSTOM", name: "ghosty.delivery", value: { tipo: "archivo", nombre: "cotizacion.pdf", url: "https://x/c.pdf" }, timestamp: 5 },
      { type: "CUSTOM", name: "ghosty.title", value: { title: "Cotización" } },
    ]);
    expect(s.turns[1].custom).toEqual([{ name: "ghosty.delivery", value: { tipo: "archivo", nombre: "cotizacion.pdf", url: "https://x/c.pdf" }, timestamp: 5 }]);
  });

  it("al reconstruir desde snapshot, las entregas salen de `metadata.custom` del mensaje", () => {
    const s = run(createPilotState(), [
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [
          { id: "u1", role: "user", content: "hazme el pdf" },
          { id: "a1", role: "assistant", content: "Listo.", metadata: { custom: [{ name: "ghosty.delivery", value: { url: "https://x/c.pdf" } }] } },
        ],
      },
    ]);
    expect(s.turns.map((t) => t.id)).toEqual(["u1", "a1"]);
    expect(s.turns[1].custom).toEqual([{ name: "ghosty.delivery", value: { url: "https://x/c.pdf" } }]);
  });

  it("STEP_STARTED/FINISHED: el paso con nombre en curso, que se limpia al terminar", () => {
    let s = run(createPilotState(), [{ type: "RUN_STARTED", runId: "r" }, { type: "STEP_STARTED", stepName: "waking" }]);
    expect(s.step).toBe("waking");
    s = run(s, [{ type: "STEP_FINISHED", stepName: "other" }]);
    expect(s.step).toBe("waking");
    s = run(s, [{ type: "STEP_FINISHED", stepName: "waking" }, { type: "STEP_STARTED", stepName: "session" }, { type: "RUN_FINISHED", outcome: { type: "success" } }]);
    expect(s.step).toBeNull();
  });

  it("MESSAGES_SNAPSHOT a media respuesta reemplaza el texto sin soltar el run vivo", () => {
    let s = run(beginSend(createPilotState(), "hola", [], 1), [
      { type: "RUN_STARTED", runId: "r1" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "Texto con un error" },
      { type: "TOOL_CALL_START", toolCallId: "t1", toolCallName: "read_file" },
    ]);
    s = run(s, [
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [
          { id: "u1", role: "user", content: "hola" },
          { id: "a1", role: "assistant", content: "Texto corregido", toolCalls: [{ id: "t1", type: "function", function: { name: "read_file", arguments: "{}" } }] },
        ],
      },
    ]);
    expect(s.busy).toBe(true);
    expect(s.runId).toBe("r1");
    expect(s.turnStartedAt).toBe(1);
    expect(s.turns[1].text).toBe("Texto corregido");
    expect(s.turns[1].tools?.[0].status).toBe("in_progress");
    // El run sigue: lo que llega después se pega a la respuesta reemplazada.
    s = run(s, [
      { type: "TOOL_CALL_RESULT", toolCallId: "t1", messageId: "x", content: "ok" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "a2", delta: " y más." },
      { type: "RUN_FINISHED", runId: "r1", outcome: { type: "success" } },
    ]);
    expect(s.turns[1].text).toBe("Texto corregido y más.");
    expect(s.turns[1].tools?.[0].status).toBe("completed");
    expect(s.busy).toBe(false);
  });

  it("historial: ghosty.history antes del snapshot, páginas antepuestas y un snapshot nuevo las conserva", () => {
    const tail: Message[] = [
      { id: "u3", role: "user", content: "tres" },
      { id: "a3", role: "assistant", content: "3" },
    ];
    let s = run(createPilotState(), [
      { type: "RUN_STARTED", runId: "o" },
      { type: "CUSTOM", name: "ghosty.history", value: { hasMoreBefore: true, before: "c3" } },
      { type: "MESSAGES_SNAPSHOT", messages: tail },
      { type: "RUN_FINISHED", outcome: { type: "success" } },
    ]);
    expect(s.history).toEqual({ hasMoreBefore: true, before: "c3" });
    s = prependHistory(
      s,
      [
        { id: "u2", role: "user", content: "dos" },
        { id: "a2", role: "assistant", content: "2" },
        { id: "u3", role: "user", content: "tres" },
      ],
      { hasMoreBefore: false },
    );
    expect(s.turns.map((t) => t.text)).toEqual(["dos", "2", "tres", "3"]);
    expect(s.olderCount).toBe(2);
    // Reabrir: el servidor manda la cola otra vez (y su cursor); lo cargado se queda delante.
    s = run(s, [
      { type: "CUSTOM", name: "ghosty.history", value: { hasMoreBefore: true, before: "c3" } },
      { type: "MESSAGES_SNAPSHOT", messages: [...tail, { id: "u4", role: "user", content: "cuatro" }] },
    ]);
    expect(s.turns.map((t) => t.text)).toEqual(["dos", "2", "tres", "3", "cuatro"]);
    expect(s.history).toEqual({ hasMoreBefore: false });
    // Una cola que ya no empieza en un turno conocido suelta lo cargado y toma el cursor nuevo.
    s = run(s, [
      { type: "CUSTOM", name: "ghosty.history", value: { hasMoreBefore: true, before: "c9" } },
      { type: "MESSAGES_SNAPSHOT", messages: [{ id: "u9", role: "user", content: "nueve" }] },
    ]);
    expect(s.turns.map((t) => t.text)).toEqual(["nueve"]);
    expect(s.olderCount).toBe(0);
    expect(s.history).toEqual({ hasMoreBefore: true, before: "c9" });
  });
});

// ── El hook ────────────────────────────────────────────────────────────────

type Script = (input: RunAgentInput, emit: (e: Record<string, unknown>) => void, signal?: AbortSignal) => Promise<void> | void;

function scripted(...scripts: Script[]) {
  const inputs: RunAgentInput[] = [];
  const transport: PilotTransport = {
    async run(input, onEvent, signal) {
      inputs.push(input);
      const next = scripts.shift();
      if (next) await next(input, (e) => onEvent(e as BaseEvent), signal);
    },
  };
  return { transport, inputs };
}

async function mount(transport: PilotTransport, opts: Parameters<typeof usePilot>[1] = {}) {
  const ref: { current: Pilot | null } = { current: null };
  function Probe() {
    ref.current = usePilot(transport, opts);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
  return { pilot: () => ref.current!, root };
}

/** Un run que se queda vivo hasta que lo suelten (o lo aborten). */
function hanging() {
  let release!: () => void;
  const done = new Promise<void>((r) => (release = r));
  return { release, wait: (signal?: AbortSignal) => new Promise<void>((r) => { done.then(r); signal?.addEventListener("abort", () => r()); }) };
}

describe("usePilot 0.5.0", () => {
  it("steer: con caps.steer, mandar con el run vivo es un POST con forwardedProps.steer y la burbuja entra al hilo", async () => {
    const live = hanging();
    const states: Record<string, unknown>[] = [];
    const { transport, inputs } = scripted(
      async (input, emit, signal) => {
        emit({ type: "RUN_STARTED", runId: input.runId });
        emit({ type: "STATE_SNAPSHOT", snapshot: { caps: { steer: true } } });
        emit({ type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "Reviso…" });
        await live.wait(signal);
      },
      (input, emit) => {
        emit({ type: "RUN_STARTED", runId: input.forwardedProps.steer });
        emit({ type: "CUSTOM", name: "ghosty.injected", value: { messageId: input.messages[0].id } });
        emit({ type: "TEXT_MESSAGE_CONTENT", messageId: "b", delta: "Va, también eso." });
        emit({ type: "RUN_FINISHED", runId: input.forwardedProps.steer, outcome: { type: "success" } });
      },
    );
    const { pilot } = await mount(transport, { onState: (s) => states.push(s) });
    let first!: Promise<void>;
    await act(async () => {
      first = pilot().send("revisa el monitor");
    });
    expect(pilot().state.busy).toBe(true);
    expect(pilot().canSteer).toBe(true);
    expect(states).toEqual([{ caps: { steer: true } }]);
    const liveRunId = inputs[0].runId;
    await act(async () => void (await pilot().send("y la purga")));
    await act(async () => {
      live.release();
      await first;
    });
    expect(inputs[1]).toMatchObject({ messages: [{ role: "user", content: "y la purga" }], forwardedProps: { steer: liveRunId } });
    expect(inputs[1].runId).not.toBe(liveRunId);
    const s = pilot().state;
    expect(s.turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "revisa el monitor"],
      ["assistant", "Reviso…"],
      ["user", "y la purga"],
      ["assistant", "Va, también eso."],
    ]);
    expect(s.busy).toBe(false);
    expect(s.turns[3].custom).toBeUndefined();
  });

  it("sin steer, mandar con el run vivo no sale", async () => {
    const live = hanging();
    const { transport, inputs } = scripted(async (input, emit, signal) => {
      emit({ type: "RUN_STARTED", runId: input.runId });
      await live.wait(signal);
    });
    const { pilot } = await mount(transport);
    let first!: Promise<void>;
    await act(async () => {
      first = pilot().send("hola");
    });
    expect(pilot().canSteer).toBe(false);
    await act(async () => void (await pilot().send("otra")));
    expect(inputs).toHaveLength(1);
    await act(async () => {
      live.release();
      await first;
    });
  });

  it("un steer rechazado (409 run_active) no suelta el run: reabre el hilo", async () => {
    const live = hanging();
    const { transport, inputs } = scripted(
      async (input, emit, signal) => {
        emit({ type: "RUN_STARTED", runId: input.runId });
        await live.wait(signal);
      },
      () => {
        throw new PilotHttpError("Ya hay un turno en curso.", 409, "run_active");
      },
      (input, emit) => {
        emit({ type: "RUN_STARTED", runId: "r-live" });
        emit({ type: "MESSAGES_SNAPSHOT", messages: [{ id: "u1", role: "user", content: "hola" }] });
        emit({ type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "Sigo." });
      },
    );
    const { pilot } = await mount(transport, { steer: true });
    let first!: Promise<void>;
    await act(async () => {
      first = pilot().send("hola");
    });
    await act(async () => void (await pilot().send("otra")));
    expect(inputs[2].messages).toEqual([]);
    expect(pilot().state.notice).toBe("Ya hay un turno en curso.");
    expect(pilot().state.turns.map((t) => t.text)).toEqual(["hola", "Sigo."]);
    await act(async () => {
      live.release();
      await first;
    });
  });

  it("loadOlder pide la página con el cursor y la antepone", async () => {
    const { transport } = scripted((input, emit) => {
      emit({ type: "RUN_STARTED", runId: input.runId });
      emit({ type: "CUSTOM", name: "ghosty.history", value: { hasMoreBefore: true, before: "c2" } });
      emit({ type: "MESSAGES_SNAPSHOT", messages: [{ id: "u2", role: "user", content: "dos" }] });
      emit({ type: "RUN_FINISHED", outcome: { type: "success" } });
    });
    const asked: (string | undefined)[] = [];
    const { pilot } = await mount(transport, {
      threadId: "11111111-1111-4111-8111-111111111111",
      loadOlder: async (before) => {
        asked.push(before);
        return { messages: [{ id: "u1", role: "user", content: "uno" }, { id: "a1", role: "assistant", content: "1" }], hasMoreBefore: false };
      },
    });
    expect(pilot().state.history).toEqual({ hasMoreBefore: true, before: "c2" });
    await act(async () => void (await pilot().loadOlder()));
    expect(asked).toEqual(["c2"]);
    expect(pilot().state.turns.map((t) => t.text)).toEqual(["uno", "1", "dos"]);
    expect(pilot().state.history).toEqual({ hasMoreBefore: false });
    await act(async () => void (await pilot().loadOlder()));
    expect(asked).toHaveLength(1);
  });
});

describe("Piloto 0.5.0", () => {
  it("la frase de espera de un paso con nombre sale de strings.steps", () => {
    const state: PilotState = { ...createPilotState([{ role: "user", text: "hola" }]), busy: true, step: "waking" };
    const pilot = { state, threadId: "t", canSteer: false, loadingOlder: false } as unknown as Pilot;
    const html = renderToString(<Piloto transport={null} pilot={pilot} />);
    expect(html).toContain("Despertando al agente…");
    const other = renderToString(<Piloto transport={null} pilot={{ ...pilot, state: { ...state, step: "model" } }} />);
    expect(other).not.toContain(">model<");
  });

  it("muestra «Cargar mensajes anteriores» y el sidePanel con el estado", () => {
    const state: PilotState = { ...createPilotState([{ role: "user", text: "hola" }]), history: { hasMoreBefore: true, before: "c" }, agentState: { n: 3 } };
    const pilot = { state, threadId: "t", canSteer: false, loadingOlder: false } as unknown as Pilot;
    const html = renderToString(<Piloto transport={null} pilot={pilot} slots={{ sidePanel: (st) => <aside>{`subagentes ${String(st.n)}`}</aside> }} />);
    expect(html).toContain("Cargar mensajes anteriores");
    expect(html).toContain("subagentes 3");
  });
});

describe("ghosty.tool", () => {
  it("pone el rótulo del servidor, que gana sobre los verbos, y no queda en turn.custom", async () => {
    const { stepLabel } = await import("../src/core");
    const s = run(createPilotState(), [
      { type: "RUN_STARTED", runId: "r" },
      { type: "TOOL_CALL_START", toolCallId: "t1", toolCallName: "Read" },
      { type: "CUSTOM", name: "ghosty.tool", value: { toolCallId: "t1", title: "Leyendo cotizacion.pdf", kind: "read", path: "/w/cotizacion.pdf" } },
    ]);
    const tool = s.turns[0].tools![0];
    expect(tool).toMatchObject({ title: "Read", label: "Leyendo cotizacion.pdf", kind: "read", path: "/w/cotizacion.pdf", status: "in_progress" });
    expect(stepLabel(tool, { Read: { one: "Leyó", many: "Leyó %n", running: "Leyendo…" } })).toBe("Leyendo cotizacion.pdf");
    expect(s.turns[0].custom).toBeUndefined();
  });
});

describe("ghosty.replace, ghosty.page y costUsd", () => {
  it("ghosty.replace cambia el texto final del turno y deja la narración", async () => {
    const { splitNarration } = await import("../src/core");
    const s = run(beginSend(createPilotState(), "hola", [], 1), [
      { type: "RUN_STARTED", runId: "r" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "Reviso tus crons." },
      { type: "TOOL_CALL_START", toolCallId: "t1", toolCallName: "list_crons" },
      { type: "TOOL_CALL_RESULT", toolCallId: "t1", messageId: "x", content: "[]" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "b", delta: "Texto con un dato sensible." },
      { type: "CUSTOM", name: "ghosty.replace", value: { messageId: "b", content: "Texto corregido." } },
    ]);
    const t = s.turns[1];
    expect(splitNarration(t.text, t.cuts)).toEqual({ steps: ["Reviso tus crons."], rest: "Texto corregido." });
    expect(t.custom).toBeUndefined();
    const plain = run(beginSend(createPilotState(), "hola", [], 1), [
      { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "Mal." },
      { type: "CUSTOM", name: "ghosty.replace", value: { content: "Bien." } },
    ]);
    expect(plain.turns[1].text).toBe("Bien.");
  });

  it("ghosty.page no se guarda en el turno (la app lo lee por onEvent)", () => {
    const s = run(beginSend(createPilotState(), "hola", [], 1), [{ type: "CUSTOM", name: "ghosty.page", value: { event: "section", id: "hero" } }]);
    expect(s.turns).toHaveLength(1);
  });

  it("RUN_FINISHED.metadata.costUsd es el costo del turno", () => {
    const s = run(beginSend(createPilotState(), "hola", [], 1), [
      { type: "RUN_STARTED", runId: "r" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "ok" },
      { type: "RUN_FINISHED", outcome: { type: "success" }, usage: [{ model: "m", inputTokens: 100, outputTokens: 20 }], metadata: { costUsd: 0.0123 } },
    ]);
    expect(s.turns[1].usage).toMatchObject({ used: 120, input: 100, output: 20, cost: 0.0123 });
  });
});
