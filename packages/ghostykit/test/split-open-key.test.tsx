// @vitest-environment jsdom
// `openKey` de usePilotoSplit (useRememberedOpen): el panel de escritorio recuerda si estaba abierto;
// la hoja móvil nunca se reabre sola.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRememberedOpen } from "../src/split";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "test:agent-open";
let host: HTMLDivElement;
let root: Root;
let setOpen: (v: boolean) => void;
let opens: number;

function setDesktop(on: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: on }) as unknown as typeof window.matchMedia;
}

function Harness({ openKey }: { openKey?: string }) {
  const [isOpen, set] = useState(false);
  setOpen = set;
  useRememberedOpen({
    openKey,
    isOpen,
    open: () => {
      opens++;
      set(true);
    },
  });
  return null;
}

const frame = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const mount = async (openKey?: string) => {
  await act(async () => root.render(<Harness openKey={openKey} />));
  await frame();
};

beforeEach(() => {
  localStorage.clear();
  setDesktop(true);
  opens = 0;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

describe("useRememberedOpen", () => {
  it("sin guardado no abre ni escribe nada al montar", async () => {
    await mount(KEY);
    expect(opens).toBe(0);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("guarda al abrir y al cerrar", async () => {
    await mount(KEY);
    await act(async () => setOpen(true));
    expect(localStorage.getItem(KEY)).toBe("1");
    await act(async () => setOpen(false));
    expect(localStorage.getItem(KEY)).toBe("0");
  });

  it("guardado abierto: abre una vez al montar y lo deja guardado", async () => {
    localStorage.setItem(KEY, "1");
    await mount(KEY);
    expect(opens).toBe(1);
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("guardado cerrado: no abre", async () => {
    localStorage.setItem(KEY, "0");
    await mount(KEY);
    expect(opens).toBe(0);
  });

  it("en móvil no abre ni borra lo guardado", async () => {
    setDesktop(false);
    localStorage.setItem(KEY, "1");
    await mount(KEY);
    expect(opens).toBe(0);
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("sin openKey no recuerda nada", async () => {
    localStorage.setItem(KEY, "1");
    await mount();
    await act(async () => setOpen(false));
    expect(opens).toBe(0);
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("sin almacenamiento (modo privado) no truena", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await mount(KEY);
    await act(async () => setOpen(true));
    expect(opens).toBe(0);
    vi.restoreAllMocks();
  });
});
