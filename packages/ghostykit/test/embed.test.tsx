// @vitest-environment jsdom
// GhostyKit.mount: botón flotante, panel que se abre, hilo recordado por `url`.
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "../src/embed";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const URL_ = "/__ghosty/agent";
const sse = (events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.innerHTML = "";
  document.getElementById("ghostykit-embed-css")?.remove();
});

describe("embed mount", () => {
  it("pinta el botón, abre el panel y guarda el hilo", async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const input = JSON.parse(String(init.body));
      return sse([
        { type: "RUN_STARTED", threadId: input.threadId, runId: input.runId },
        { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "hola" },
        { type: "TEXT_MESSAGE_END", messageId: "m1" },
        { type: "RUN_FINISHED", threadId: input.threadId, runId: input.runId },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);
    let h!: ReturnType<typeof mount>;
    await act(async () => {
      h = mount(null, { url: URL_, agentName: "Barbería" });
    });
    expect(document.getElementById("ghostykit-embed-css")).not.toBeNull();
    const launcher = document.querySelector<HTMLButtonElement>(".gk-launcher");
    expect(launcher).not.toBeNull();
    // Cerrado: nada de red.
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => launcher!.click());
    expect(document.querySelector(".gk-panel")?.getAttribute("data-open")).toBe("true");
    expect(document.querySelector(".gk-launcher")).toBeNull();

    const box = document.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(box, "hola");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(fetchMock).toHaveBeenCalled();
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(fetchMock.mock.calls[0][1].credentials).toBe("same-origin");
    expect(localStorage.getItem(`ghostykit:thread:${URL_}`)).toBe(sent.threadId);

    await act(async () => h.close());
    expect(document.querySelector(".gk-panel")?.getAttribute("data-open")).toBe("false");
    act(() => h.destroy());
    expect(document.querySelector(".gk-embed")).toBeNull();
  });

  it("reconecta con el hilo guardado", async () => {
    localStorage.setItem(`ghostykit:thread:${URL_}`, "t-guardado");
    const fetchMock = vi.fn(async () => sse([{ type: "MESSAGES_SNAPSHOT", messages: [] }]));
    vi.stubGlobal("fetch", fetchMock);
    let h!: ReturnType<typeof mount>;
    await act(async () => {
      h = mount(null, { url: URL_, open: true });
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).threadId).toBe("t-guardado");
    act(() => h.destroy());
  });
});

describe("embed: pegar imágenes", () => {
  const pasteInto = (box: Element, items: object[]) => {
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: { items } });
    box.dispatchEvent(ev);
    return ev;
  };

  it("cmd/ctrl+V con una captura la adjunta; con texto no estorba", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse([{ type: "MESSAGES_SNAPSHOT", messages: [] }])));
    URL.createObjectURL ??= () => "blob:x";
    URL.revokeObjectURL ??= () => {};
    let h!: ReturnType<typeof mount>;
    await act(async () => {
      h = mount(null, { url: URL_, open: true });
      await new Promise((r) => setTimeout(r, 30));
    });
    const box = document.querySelector("textarea")!;
    // Sólo texto: el pegado sigue su curso normal.
    let ev!: Event;
    await act(async () => {
      ev = pasteInto(box, [{ kind: "string", type: "text/plain", getAsFile: () => null }]);
    });
    expect(ev.defaultPrevented).toBe(false);
    // Una captura llega como `image.png`, a veces sin `type`: manda la extensión.
    const shot = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "" });
    await act(async () => {
      ev = pasteInto(box, [{ kind: "file", type: "image/png", getAsFile: () => shot }]);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.querySelector(".gk-panel")?.innerHTML).toContain("blob:");
    act(() => h.destroy());
  });

  it("con attachments: false no adjunta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse([{ type: "MESSAGES_SNAPSHOT", messages: [] }])));
    let h!: ReturnType<typeof mount>;
    await act(async () => {
      h = mount(null, { url: URL_, open: true, attachments: false });
      await new Promise((r) => setTimeout(r, 30));
    });
    const shot = new File([new Uint8Array([1])], "image.png", { type: "image/png" });
    let ev!: Event;
    await act(async () => {
      ev = pasteInto(document.querySelector("textarea")!, [{ kind: "file", type: "image/png", getAsFile: () => shot }]);
    });
    expect(ev.defaultPrevented).toBe(false);
    act(() => h.destroy());
  });
});
