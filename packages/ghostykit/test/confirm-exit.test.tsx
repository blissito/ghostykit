// @vitest-environment jsdom
// El pase de permiso: el sello se ve, la tarjeta sale animada y SÓLO entonces se anota la decisión.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionRequest } from "../src/core";
import { ConfirmCard } from "../src/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STAMP_MS = 1100;
const EXIT_MS = 240;

const request = (extra: Partial<PermissionRequest> = {}): PermissionRequest => ({
  id: "int-1",
  title: "Registrar asistencia el 2026-11-02T11:00:00-06:00",
  tool: "check_in_member",
  options: [
    { optionId: "reject", name: "Descartar", kind: "reject_once" },
    { optionId: "allow", name: "Aprobar", kind: "allow_once" },
  ],
  ...extra,
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
  // jsdom no trae matchMedia: sin preferencia de movimiento reducido.
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const ticket = () => host.querySelector(".piloto-ticket") as HTMLElement;
// Rechazar es el botón discreto; aprobar, el de color (los textos son de la app).
const button = (kind: "reject" | "approve") =>
  host.querySelector(kind === "reject" ? ".piloto-btn-quiet" : ".piloto-btn-go") as HTMLButtonElement;

describe("ConfirmCard: salida", () => {
  it("rechazar: sello, salida animada y luego onSettled", () => {
    const onRespond = vi.fn();
    const onSettled = vi.fn();
    act(() => root.render(<ConfirmCard request={request()} onRespond={onRespond} onSettled={onSettled} />));
    act(() => button("reject").click());
    expect(onRespond).toHaveBeenCalledWith("int-1", false);
    expect(ticket().dataset.state).toBe("rejected");
    expect(ticket().dataset.leaving).toBeUndefined();

    act(() => vi.advanceTimersByTime(STAMP_MS));
    expect(ticket().dataset.leaving).toBe("true");
    expect(onSettled).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(EXIT_MS));
    expect(onSettled).toHaveBeenCalledWith("int-1", "rejected");
  });

  it("vencer: sello de vencida y onExpire tras la salida", () => {
    const onExpire = vi.fn();
    const deadline = Date.now() + 2000;
    act(() => root.render(<ConfirmCard request={request({ deadline })} onRespond={vi.fn()} onExpire={onExpire} />));
    act(() => vi.advanceTimersByTime(3000));
    expect(ticket().dataset.state).toBe("expired");
    act(() => vi.advanceTimersByTime(STAMP_MS + EXIT_MS));
    expect(onExpire).toHaveBeenCalledWith("int-1");
  });

  it("con movimiento reducido sale sin esperar la animación", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const onSettled = vi.fn();
    act(() => root.render(<ConfirmCard request={request()} onRespond={vi.fn()} onSettled={onSettled} />));
    act(() => button("approve").click());
    act(() => vi.advanceTimersByTime(STAMP_MS));
    // Un milisegundo después del sello, no los 240 de la animación.
    act(() => vi.advanceTimersByTime(1));
    expect(onSettled).toHaveBeenCalledWith("int-1", "approved");
  });

  it("desmontar a medio sello no avisa después", () => {
    const onSettled = vi.fn();
    act(() => root.render(<ConfirmCard request={request()} onRespond={vi.fn()} onSettled={onSettled} />));
    act(() => button("reject").click());
    act(() => root.render(<></>));
    act(() => vi.advanceTimersByTime(STAMP_MS + EXIT_MS));
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("el título lee la fecha ISO como fecha", () => {
    act(() => root.render(<ConfirmCard request={request()} onRespond={vi.fn()} />));
    expect(host.querySelector(".piloto-ticket-title")?.textContent?.replace(/[\u00a0\u202f]/g, " ")).toBe(
      "Registrar asistencia el lunes 2 de noviembre, 11:00 a. m.",
    );
  });
});
