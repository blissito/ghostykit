// @vitest-environment jsdom
// El hook arma bien cada RunAgentInput: mensaje nuevo + contexto, `resume` al contestar, `cancelled`
// para las tarjetas que se dejan, y un POST vacío al abrir un hilo existente.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { RunAgentInput } from "@ag-ui/core";
import { usePilot, type Pilot } from "../src/react";
import type { PilotTransport } from "../src/transport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const events = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));

/** Un transporte que contesta cada run con el siguiente stream grabado. */
function scripted(...streams: string[]) {
  const inputs: RunAgentInput[] = [];
  const transport: PilotTransport = {
    async run(input, onEvent) {
      inputs.push(input);
      for (const e of events(streams.shift() ?? "agui-open-done.sse")) onEvent(e);
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

describe("usePilot sobre AG-UI", () => {
  it("mandar → contestar la tarjeta: el segundo run lleva el resume del interrupt", async () => {
    const { transport, inputs } = scripted("agui-turn-interrupt.sse", "agui-resume-approved.sse");
    const { pilot, root } = await mount(transport, { context: { page: "crons", job: "monitor" } });
    await act(async () => void (await pilot().send("¿Por qué falló el monitor?")));
    expect(inputs[0]).toMatchObject({
      messages: [{ role: "user", content: "¿Por qué falló el monitor?" }],
      context: [
        { description: "page", value: "crons" },
        { description: "job", value: "monitor" },
      ],
    });
    expect(inputs[0].resume).toBeUndefined();
    const card = pilot().state.permissions[0];
    expect(card.tool).toBe("run_cron");

    await act(async () => pilot().respondPermission(card.id, true));
    await act(async () => {});
    expect(inputs[1].threadId).toBe(inputs[0].threadId);
    expect(inputs[1].runId).not.toBe(inputs[0].runId);
    expect(inputs[1].messages).toEqual([]);
    expect(inputs[1].resume).toEqual([{ interruptId: card.id, status: "resolved", payload: { approved: true } }]);
    expect(pilot().state.busy).toBe(false);
    act(() => root.unmount());
  });

  it("escribir con una tarjeta abierta la descarta: el run lleva su resume `cancelled`", async () => {
    const { transport, inputs } = scripted("agui-turn-interrupt.sse", "agui-open-done.sse");
    const { pilot, root } = await mount(transport);
    await act(async () => void (await pilot().send("hola")));
    const id = pilot().state.permissions[0].id;
    await act(async () => void (await pilot().send("mejor otra cosa")));
    expect(inputs[1].resume).toEqual([{ interruptId: id, status: "cancelled" }]);
    expect(inputs[1].messages[0]).toMatchObject({ role: "user", content: "mejor otra cosa" });
    act(() => root.unmount());
  });

  it("con threadId, al montar abre el hilo: un POST sin mensaje nuevo pinta el snapshot y la tarjeta", async () => {
    const { transport, inputs } = scripted("agui-open-paused.sse");
    const { pilot, root } = await mount(transport, { threadId: "a3dc97de-9426-4ba9-9a02-16df577b9ffd" });
    await act(async () => {});
    expect(inputs[0]).toMatchObject({ threadId: "a3dc97de-9426-4ba9-9a02-16df577b9ffd", messages: [] });
    expect(pilot().state.turns).toHaveLength(2);
    expect(pilot().state.permissions).toHaveLength(1);
    act(() => root.unmount());
  });

  it("si el stream se corta sin terminar, reabre el hilo (POST vacío) y el snapshot manda", async () => {
    const inputs: RunAgentInput[] = [];
    let n = 0;
    const transport: PilotTransport = {
      async run(input, onEvent) {
        inputs.push(input);
        if (n++ === 0) {
          onEvent({ type: "RUN_STARTED", threadId: input.threadId, runId: input.runId } as never);
          onEvent({ type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "Empie" } as never);
          return; // se cortó la red
        }
        for (const e of events("agui-open-done.sse")) onEvent(e);
      },
    };
    const { pilot, root } = await mount(transport);
    await act(async () => void (await pilot().send("corre la purga")));
    expect(inputs).toHaveLength(2);
    expect(inputs[1].messages).toEqual([]);
    expect(pilot().state.busy).toBe(false);
    expect(pilot().state.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    act(() => root.unmount());
  });
});
