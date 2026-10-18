// @vitest-environment jsdom
// 0.6.0 — al día con «gs-agui 1»: subagentes (state.subagents + forwardedProps.stopSubagent), mensajes
// en espera tras un 409 run_active (§0.7b-6), reconexión a media respuesta sin duplicar (§0.7b-4),
// forwardedProps propios y slots con el piloto.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { beginSend, createPilotState, markSubagent, queueMessage, reduceAgUiEvent, subagentsOf, takeQueued, type PilotState } from "../src/core";
import { Piloto, Subagents, usePilot, type Pilot } from "../src/react";
import { PilotHttpError, type PilotTransport } from "../src/transport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom no hace scroll ni mide.
Element.prototype.scrollTo ??= function () {};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

const run = (s: PilotState, events: Record<string, unknown>[], now = 10_000) => events.reduce((x, e) => reduceAgUiEvent(x, e as never, now), s);

const task = (id: string, status = "running", extra: Record<string, unknown> = {}) => ({ id, title: `Tarea ${id}`, status, startedAt: 1, usage: { tokens: 10, toolUses: 1 }, ...extra });

describe("reconexión a media respuesta (§0.7b-4)", () => {
  it("snapshot con lo cerrado y luego lo abierto con el mismo messageId: el texto no se duplica", () => {
    // En vivo: narración, una tool cerrada, y una respuesta a medias con una tool abierta.
    let s = run(beginSend(createPilotState(), "revisa", [], 1), [
      { type: "RUN_STARTED", runId: "r1" },
      { type: "TEXT_MESSAGE_START", messageId: "r1:a0", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "r1:a0", delta: "Reviso." },
      { type: "TEXT_MESSAGE_END", messageId: "r1:a0" },
      { type: "TOOL_CALL_START", toolCallId: "t1", toolCallName: "Read", parentMessageId: "r1:a0" },
      { type: "TOOL_CALL_RESULT", toolCallId: "t1", messageId: "r1:tt1", content: "" },
      { type: "TOOL_CALL_START", toolCallId: "t2", toolCallName: "Bash", parentMessageId: "r1:a0" },
      { type: "TOOL_CALL_ARGS", toolCallId: "t2", delta: "{}" },
      { type: "TEXT_MESSAGE_START", messageId: "r1:a1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "r1:a1", delta: "Ya casi" },
    ]);
    // Se cortó la red; al reconectar: RUN_STARTED, snapshot (sólo lo cerrado), re-emisión de lo abierto.
    s = run(s, [
      { type: "RUN_STARTED", runId: "r1" },
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [
          { id: "r1:u", role: "user", content: "revisa" },
          { id: "r1:a0", role: "assistant", content: "Reviso.", toolCalls: [{ id: "t1", type: "function", function: { name: "Read", arguments: "{}" } }] },
          { id: "r1:tt1", role: "tool", toolCallId: "t1", content: "" },
        ],
      },
      { type: "STATE_SNAPSHOT", snapshot: { caps: { steer: true } } },
      { type: "TOOL_CALL_START", toolCallId: "t2", toolCallName: "Bash", parentMessageId: "r1:a0" },
      { type: "TOOL_CALL_ARGS", toolCallId: "t2", delta: "{}" },
      { type: "TEXT_MESSAGE_START", messageId: "r1:a1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "r1:a1", delta: "Ya casi" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "r1:a1", delta: " termino." },
    ]);
    const t = s.turns[1];
    expect(s.turns).toHaveLength(2);
    expect(t.text).toBe("Reviso.\n\nYa casi termino.");
    expect(t.tools?.map((x) => [x.id, x.status, x.args])).toEqual([
      ["t1", "completed", "{}"],
      ["t2", "in_progress", "{}"],
    ]);
    expect(s.busy).toBe(true);
    expect(s.runId).toBe("r1");
  });

  it("el mismo TEXT_MESSAGE_START otra vez (sin snapshot) reescribe ese mensaje, no lo repite", () => {
    let s = run(createPilotState([{ role: "user", text: "hola" }]), [
      { type: "RUN_STARTED", runId: "r" },
      { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Primero." },
      { type: "TEXT_MESSAGE_END", messageId: "m1" },
      { type: "TEXT_MESSAGE_START", messageId: "m2", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m2", delta: "Va a" },
    ]);
    s = run(s, [
      { type: "TEXT_MESSAGE_START", messageId: "m2", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m2", delta: "Va a medias." },
    ]);
    expect(s.turns[1].text).toBe("Primero.\n\nVa a medias.");
    // Un mensaje cerrado no se reescribe: otro START con un id nuevo sigue en párrafo aparte.
    s = run(s, [{ type: "TEXT_MESSAGE_END", messageId: "m2" }, { type: "TEXT_MESSAGE_START", messageId: "m3" }, { type: "TEXT_MESSAGE_CONTENT", messageId: "m3", delta: "Fin." }]);
    expect(s.turns[1].text).toBe("Primero.\n\nVa a medias.\n\nFin.");
  });
});

describe("subagentes en el estado (§0.5)", () => {
  it("subagentsOf lee state.subagents.tasks y el STATE_DELTA de gs (add /subagents) lo reemplaza", () => {
    let s = run(createPilotState(), [{ type: "STATE_SNAPSHOT", snapshot: { caps: { steer: true }, subagents: { tasks: [task("a")] } } }]);
    expect(subagentsOf(s.agentState).map((x) => x.id)).toEqual(["a"]);
    s = run(s, [{ type: "STATE_DELTA", delta: [{ op: "add", path: "/subagents", value: { tasks: [task("a", "completed", { summary: "Listo" }), task("b"), { title: "sin id" }] } }] }]);
    expect(subagentsOf(s.agentState).map((x) => [x.id, x.status])).toEqual([
      ["a", "completed"],
      ["b", "running"],
    ]);
    expect(subagentsOf({})).toEqual([]);
    expect(subagentsOf({ subagents: { tasks: "x" } })).toEqual([]);
  });

  it("markSubagent cambia sólo ese y avisa el estado", () => {
    const s = run(createPilotState(), [{ type: "STATE_SNAPSHOT", snapshot: { subagents: { tasks: [task("a"), task("b")] } } }]);
    const next = markSubagent(s, "b", "stopped");
    expect(subagentsOf(next.agentState).map((x) => x.status)).toEqual(["running", "stopped"]);
    expect(next.effects[0]).toMatchObject({ type: "state" });
    expect(markSubagent(s, "zz", "stopped")).toBe(s);
  });
});

describe("mensajes en espera (§0.7b-6)", () => {
  it("queueMessage saca la burbuja del hilo y takeQueued los entrega", () => {
    const s0 = beginSend(createPilotState([{ role: "user", text: "hola" }, { role: "assistant", text: "ok" }]), "y esto", [], 1);
    const s = queueMessage(s0, "y esto");
    expect(s.turns.map((t) => t.text)).toEqual(["hola", "ok"]);
    expect(s.queued).toEqual([{ text: "y esto", tries: 1 }]);
    const { state, queued } = takeQueued(s);
    expect(queued).toHaveLength(1);
    expect(state.queued).toEqual([]);
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

function hanging() {
  let release!: () => void;
  const done = new Promise<void>((r) => (release = r));
  return { release, wait: (signal?: AbortSignal) => new Promise<void>((r) => { done.then(r); signal?.addEventListener("abort", () => r()); }) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("usePilot gs-agui 1", () => {
  it("expone los subagentes y stopSubagent manda forwardedProps.stopSubagent sin soltar el run vivo", async () => {
    const live = hanging();
    const { transport, inputs } = scripted(
      async (input, emit, signal) => {
        emit({ type: "RUN_STARTED", runId: input.runId });
        emit({ type: "STATE_SNAPSHOT", snapshot: { subagents: { tasks: [task("nat_x_1"), task("nat_x_2")] } } });
        await live.wait(signal);
        if (signal?.aborted) return;
        emit({ type: "STATE_DELTA", delta: [{ op: "add", path: "/subagents", value: { tasks: [task("nat_x_1", "stopped"), task("nat_x_2", "completed")] } }] });
        emit({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } });
      },
      (input, emit) => {
        emit({ type: "RUN_STARTED", runId: input.runId });
        emit({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } });
      },
    );
    const { pilot } = await mount(transport);
    let first!: Promise<void>;
    await act(async () => {
      first = pilot().send("reparte el trabajo");
    });
    expect(pilot().subagents.map((x) => x.id)).toEqual(["nat_x_1", "nat_x_2"]);
    await act(async () => void (await pilot().stopSubagent("nat_x_1")));
    expect(inputs[1]).toMatchObject({ messages: [], forwardedProps: { stopSubagent: "nat_x_1" } });
    expect(inputs[1].threadId).toBe(inputs[0].threadId);
    // Optimista mientras llega el delta; el run sigue vivo y no se reconecta.
    expect(pilot().subagents.map((x) => x.status)).toEqual(["stopped", "running"]);
    expect(pilot().state.busy).toBe(true);
    expect(inputs).toHaveLength(2);
    await act(async () => {
      live.release();
      await first;
    });
    expect(pilot().subagents.map((x) => x.status)).toEqual(["stopped", "completed"]);
  });

  it("sin run vivo, detener un subagente vuelve a pedir el hilo para traer el estado fresco", async () => {
    const { transport, inputs } = scripted(
      (input, emit) => {
        emit({ type: "RUN_STARTED", runId: input.runId });
        emit({ type: "MESSAGES_SNAPSHOT", messages: [] });
        emit({ type: "STATE_SNAPSHOT", snapshot: { subagents: { tasks: [task("a")] } } });
        emit({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } });
      },
      (input, emit) => {
        emit({ type: "RUN_STARTED", runId: input.runId });
        emit({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } });
      },
      (input, emit) => {
        emit({ type: "RUN_STARTED", runId: input.runId });
        emit({ type: "MESSAGES_SNAPSHOT", messages: [] });
        emit({ type: "STATE_SNAPSHOT", snapshot: { subagents: { tasks: [task("a", "stopped", { endedAt: 5 })] } } });
        emit({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } });
      },
    );
    const { pilot } = await mount(transport, { threadId: "22222222-2222-4222-8222-222222222222" });
    expect(pilot().subagents).toHaveLength(1);
    await act(async () => void (await pilot().stopSubagent("a")));
    expect(inputs.map((i) => i.forwardedProps)).toEqual([{}, { stopSubagent: "a" }, {}]);
    expect(pilot().subagents[0]).toMatchObject({ status: "stopped", endedAt: 5 });
  });

  it("un steer con 409 run_active queda en espera y sale como run normal al RUN_FINISHED", async () => {
    const live = hanging();
    const { transport, inputs } = scripted(
      async (input, emit, signal) => {
        emit({ type: "RUN_STARTED", runId: input.runId });
        emit({ type: "STATE_SNAPSHOT", snapshot: { caps: { steer: true } } });
        emit({ type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "Trabajo…" });
        await live.wait(signal);
      },
      () => {
        throw new PilotHttpError("Este agente no acepta mensajes con el run en curso.", 409, "run_active");
      },
      // Al reabrir, se engancha al run vivo hasta que termina.
      async (_input, emit) => {
        emit({ type: "RUN_STARTED", runId: "r-live" });
        emit({ type: "MESSAGES_SNAPSHOT", messages: [{ id: "u1", role: "user", content: "empieza" }] });
        emit({ type: "TEXT_MESSAGE_START", messageId: "r-live:a0", role: "assistant" });
        emit({ type: "TEXT_MESSAGE_CONTENT", messageId: "r-live:a0", delta: "Trabajo… listo." });
        await live.wait();
        emit({ type: "RUN_FINISHED", runId: "r-live", outcome: { type: "success" } });
      },
      (input, emit) => {
        emit({ type: "RUN_STARTED", runId: input.runId });
        emit({ type: "TEXT_MESSAGE_CONTENT", messageId: "b", delta: "Ahora eso." });
        emit({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } });
      },
    );
    const done: string[] = [];
    const { pilot } = await mount(transport, { onTurnDone: (i) => done.push(i.text) });
    let first!: Promise<void>;
    await act(async () => {
      first = pilot().send("empieza");
    });
    let steer!: Promise<void>;
    await act(async () => {
      steer = pilot().send("y también la purga");
    });
    expect(inputs[1].forwardedProps).toMatchObject({ steer: inputs[0].runId });
    expect(inputs[2].messages).toEqual([]);
    expect(pilot().state.queued.map((q) => q.text)).toEqual(["y también la purga"]);
    expect(pilot().state.turns.map((t) => t.text)).toEqual(["empieza", "Trabajo… listo."]);
    expect(pilot().state.busy).toBe(true);
    await act(async () => {
      live.release();
      await first;
      await steer;
      await tick();
    });
    expect(inputs).toHaveLength(4);
    expect(inputs[3]).toMatchObject({ messages: [{ role: "user", content: "y también la purga" }] });
    expect(inputs[3].forwardedProps?.steer).toBeUndefined();
    const s = pilot().state;
    expect(s.queued).toEqual([]);
    expect(s.turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "empieza"],
      ["assistant", "Trabajo… listo."],
      ["user", "y también la purga"],
      ["assistant", "Ahora eso."],
    ]);
    expect(s.busy).toBe(false);
    expect(done).toEqual(["Trabajo… listo.", "Ahora eso."]);
  });

  it("un mensaje normal con 409 run_active (el run lo abrió otra pantalla) también espera su turno", async () => {
    const live = hanging();
    const { transport, inputs } = scripted(
      () => {
        throw new PilotHttpError("Hay un run en curso.", 409, "run_active");
      },
      async (_input, emit) => {
        emit({ type: "RUN_STARTED", runId: "otro" });
        emit({ type: "MESSAGES_SNAPSHOT", messages: [{ id: "u0", role: "user", content: "desde la Mac" }] });
        await live.wait();
        emit({ type: "TEXT_MESSAGE_CONTENT", messageId: "x", delta: "Hecho." });
        emit({ type: "RUN_FINISHED", runId: "otro", outcome: { type: "success" } });
      },
      (input, emit) => {
        emit({ type: "RUN_STARTED", runId: input.runId });
        emit({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } });
      },
    );
    const { pilot } = await mount(transport);
    let p!: Promise<void>;
    await act(async () => {
      p = pilot().send("hola");
    });
    expect(pilot().state.queued.map((q) => q.text)).toEqual(["hola"]);
    expect(pilot().state.turns.map((t) => t.text)).toEqual(["desde la Mac"]);
    await act(async () => {
      live.release();
      await p;
      await tick();
    });
    expect(inputs[2].messages[0]).toMatchObject({ role: "user", content: "hola" });
    expect(pilot().state.queued).toEqual([]);
  });

  it("si el servidor sigue rechazando, a la tercera se rinde y lo dice", async () => {
    const reject = () => {
      throw new PilotHttpError("Hay un run en curso.", 409, "run_active");
    };
    const reopen: Script = (input, emit) => {
      emit({ type: "RUN_STARTED", runId: input.runId });
      emit({ type: "MESSAGES_SNAPSHOT", messages: [] });
      emit({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } });
    };
    const { transport, inputs } = scripted(reject, reopen, reject, reopen, reject, reopen, reject);
    const { pilot } = await mount(transport);
    await act(async () => {
      await pilot().send("hola");
      for (let i = 0; i < 6; i++) await tick();
    });
    expect(inputs.filter((i) => i.messages.length)).toHaveLength(3);
    expect(inputs).toHaveLength(5);
    expect(pilot().state.queued).toEqual([]);
    expect(pilot().state.error).toBe("Hay un run en curso.");
    expect(pilot().state.turns.map((t) => t.text)).toEqual(["hola"]);
  });

  it("forwardedProps propios viajan en cada run, junto a cancel", async () => {
    const live = hanging();
    const { transport, inputs } = scripted(async (input, emit, signal) => {
      emit({ type: "RUN_STARTED", runId: input.runId });
      await live.wait(signal);
    });
    const { pilot } = await mount(transport, { forwardedProps: () => ({ permissions: "ask" }) });
    await act(async () => void pilot().send("hola"));
    expect(inputs[0].forwardedProps).toEqual({ permissions: "ask" });
    await act(async () => {
      pilot().stop();
      await tick();
    });
    expect(inputs[1].forwardedProps).toEqual({ permissions: "ask", cancel: inputs[0].runId });
    live.release();
  });

  it("refresh vuelve a pedir el hilo (para el bus /me/events)", async () => {
    const { transport, inputs } = scripted((input, emit) => {
      emit({ type: "RUN_STARTED", runId: input.runId });
      emit({ type: "MESSAGES_SNAPSHOT", messages: [{ id: "u", role: "user", content: "hola" }] });
      emit({ type: "STATE_SNAPSHOT", snapshot: { subagents: { tasks: [task("a", "completed")] } } });
      emit({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } });
    });
    const { pilot } = await mount(transport);
    await act(async () => void (await pilot().refresh()));
    expect(inputs[0].messages).toEqual([]);
    expect(pilot().subagents[0].status).toBe("completed");
    expect(pilot().state.turns).toHaveLength(1);
  });
});

describe("Piloto: barra de subagentes y mensajes en espera", () => {
  it("aboveComposer recibe el piloto; <Subagents> lista y detiene", async () => {
    const live = hanging();
    const { transport, inputs } = scripted(
      async (input, emit, signal) => {
        emit({ type: "RUN_STARTED", runId: input.runId });
        emit({ type: "MESSAGES_SNAPSHOT", messages: [{ id: "u", role: "user", content: "hola" }] });
        emit({ type: "STATE_SNAPSHOT", snapshot: { subagents: { tasks: [task("a", "running", { lastTool: "Leyendo app.ts" }), task("b", "completed", { summary: "Listo" })] } } });
        await live.wait(signal);
      },
      (input, emit) => {
        emit({ type: "RUN_STARTED", runId: input.runId });
        emit({ type: "RUN_FINISHED", runId: input.runId, outcome: { type: "success" } });
      },
    );
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () =>
      root.render(
        <Piloto transport={transport} threadId="33333333-3333-4333-8333-333333333333" slots={{ aboveComposer: (p) => <Subagents pilot={p} defaultOpen /> }} />,
      ),
    );
    expect(el.textContent).toContain("1 agente trabajando");
    expect(el.textContent).toContain("Trabajando · Leyendo app.ts");
    expect(el.textContent).toContain("Terminó · Listo");
    const stop = [...el.querySelectorAll("button")].find((b) => b.textContent === "Detener")!;
    await act(async () => {
      stop.click();
      await tick();
    });
    expect(inputs[1].forwardedProps).toMatchObject({ stopSubagent: "a" });
    expect(el.querySelector('[data-subagent="a"]')?.getAttribute("data-status")).toBe("stopped");
    live.release();
    await act(async () => root.unmount());
    el.remove();
  });

  it("pinta los mensajes en espera con su aviso", async () => {
    const { renderToString } = await import("react-dom/server");
    const state: PilotState = { ...createPilotState([{ role: "user", text: "hola" }]), busy: true, queued: [{ text: "y la purga", tries: 1 }] };
    const pilot = { state, threadId: "t", canSteer: true, loadingOlder: false, subagents: [] } as unknown as Pilot;
    const html = renderToString(<Piloto transport={null} pilot={pilot} />);
    expect(html).toContain("y la purga");
    expect(html).toContain("Se manda cuando termine");
  });
});
