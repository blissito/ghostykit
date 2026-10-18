// @vitest-environment jsdom
// El autofocus del composer no desplaza la página: en un panel lateral (EasyBits) la hacía saltar.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Piloto } from "../src/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.restoreAllMocks());

describe("autofocus", () => {
  it("enfoca la caja con preventScroll", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Piloto transport={null} draft="hola" />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50)); // el rAF del autofocus
    });
    const calls = focus.mock.calls.filter((_, i) => (focus.mock.contexts[i] as HTMLElement).tagName === "TEXTAREA");
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args[0]).toEqual({ preventScroll: true });
    act(() => root.unmount());
  });
});
