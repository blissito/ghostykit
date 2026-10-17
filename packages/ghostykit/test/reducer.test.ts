// Secuencias SSE reales (el contrato de `conversation-sse.server.ts` de Ghosty) reproducidas contra
// el reductor. Cada prueba cuenta una sesión: abrir el hilo, mandar, recibir, cortarse, reconectar.
import { describe, expect, it } from "vitest";
import {
  RESTART_NOTICE,
  RESUME_TEXT,
  beginSend,
  createPilotState,
  dropLastExchange,
  reconcileWith,
  reducePilotEvent,
  resumeMode,
  sendAccepted,
  sendFailed,
  stopTurn,
  type PilotState,
  type Turn,
} from "../src/core";

type Ev = [name: string, data?: unknown];

/** Reproduce eventos con un reloj que avanza 100 ms por evento. */
function replay(s: PilotState, events: Ev[], clock = { now: 1_000 }): PilotState {
  for (const [name, data] of events) {
    clock.now += 100;
    s = reducePilotEvent(s, name, data ?? {}, clock.now);
  }
  return s;
}

/** Abrir un hilo en reposo: lo que manda el servidor al suscribirse. */
const OPEN: Ev[] = [
  ["started", { latidoMs: 25_000 }],
  ["caps", { image: true }],
  ["models", { options: [{ value: "sonnet", name: "Sonnet" }], current: "sonnet" }],
  ["done", { reposo: true }],
];

function sent(text = "hola", now = 2_000): PilotState {
  let s = replay(createPilotState(), OPEN);
  s = beginSend(s, text, [], now);
  return sendAccepted(s, { turnId: "t1", state: "running" }, false, now);
}

describe("abrir el hilo", () => {
  it("queda conectado, en reposo y sin burbuja fantasma", () => {
    const s = replay(createPilotState(), OPEN);
    expect(s.connected).toBe(true);
    expect(s.busy).toBe(false);
    expect(s.turns).toEqual([]);
    expect(s.heartbeatMs).toBe(25_000);
    expect(s.models).toHaveLength(1);
    expect(s.currentModel).toBe("sonnet");
    expect(s.effects).toEqual([]);
  });

  it("un hilo cuyo último turno se cortó ofrece Retomar aunque haya sido hace horas", () => {
    const s = replay(createPilotState([{ role: "user", text: "haz algo" }]), [
      ["started", {}],
      ["done", { reposo: true, interrumpido: { turnId: "t0", motivo: "el servidor se reinició" } }],
    ]);
    expect(s.interrupted).toEqual({ reason: "el servidor se reinició", turnId: "t0" });
    expect(s.effects).toEqual([{ type: "turn-interrupted", reason: "el servidor se reinició", turnId: "t0" }]);
  });
});

describe("turno normal", () => {
  it("texto, pasos con narración, uso y cierre con segundos", () => {
    let s = createPilotState();
    s = replay(s, OPEN);
    s = beginSend(s, "¿qué hay en mis archivos?", [], 2_000);
    expect(s.busy).toBe(true);
    expect(s.effects).toEqual([{ type: "turn-start" }]);
    s = sendAccepted(s, { turnId: "t1", state: "running" }, false, 2_000);
    expect(s.currentTurnId).toBe("t1");
    expect(s.phase).toBe("session");

    const clock = { now: 2_000 };
    s = replay(
      s,
      [
        ["status", { phase: "session" }],
        ["chunk", { text: "Reviso tus archivos.", turnId: "t1" }],
        ["tool", { id: "a", title: "Leyendo reporte.pdf", kind: "read", status: "pending", detalle: "reporte.pdf" }],
        ["tool", { id: "a", status: "completed" }],
        ["chunk", { text: "\n\nTienes **un** reporte.", turnId: "t1" }],
        ["usage", { used: 1200, size: 200_000, cost: 0.01 }],
        ["done", { turnId: "t1" }],
      ],
      clock,
    );
    expect(s.busy).toBe(false);
    expect(s.streaming).toBe(false);
    expect(s.turns).toHaveLength(2);
    const a = s.turns[1];
    expect(a.role).toBe("assistant");
    expect(a.text).toBe("Reviso tus archivos.\n\nTienes **un** reporte.");
    expect(a.cuts).toEqual([20]);
    expect(a.tools).toEqual([{ id: "a", title: "Leyendo reporte.pdf", kind: "read", status: "completed", detail: "reporte.pdf" }]);
    expect(a.usage).toEqual({ used: 1200, size: 200_000, cost: 0.01 });
    expect(a.seconds).toBe(1); // 2.0 s → 2.7 s
    expect(s.effects).toEqual([{ type: "turn-done", text: a.text, turnId: "t1", seconds: 1 }]);
  });

  it("un `done{reposo}` justo después de mandar (primera suscripción) no cierra nada", () => {
    let s = createPilotState();
    s = replay(s, [["started", {}]]);
    s = beginSend(s, "hola", [], 2_000);
    s = replay(s, [["done", { reposo: true }]]);
    expect(s.busy).toBe(true);
    expect(s.interrupted).toBeNull();
    expect(s.effects).toEqual([]);
  });

  it("pensamiento y entrega quedan en la misma burbuja", () => {
    let s = sent();
    s = replay(s, [
      ["thought", { text: "Debo leer" }],
      ["thought", { text: " el archivo" }],
      ["artifact", { tipo: "archivo", nombre: "reporte.pdf", fileId: "f1", mime: "application/pdf", contenidoBase64: "AAAA" }],
      ["chunk", { text: "Listo" }],
      ["done", { turnId: "t1" }],
    ]);
    expect(s.turns).toHaveLength(2);
    expect(s.turns[1].thought).toBe("Debo leer el archivo");
    expect(s.turns[1].deliveries?.[0]).toMatchObject({ kind: "file", name: "reporte.pdf", fileId: "f1", size: 3 });
  });

  it("`tool` y `done` en el mismo paquete no abren una burbuja nueva (bug del 1-oct)", () => {
    let s = sent();
    s = replay(s, [
      ["chunk", { text: "Armo" }],
      ["tool", { id: "x", title: "Paso", status: "completed" }],
      ["done", { turnId: "t1" }],
      ["usage", { used: 1, size: 2, cost: 0 }],
    ]);
    expect(s.turns.filter((t) => t.role === "assistant")).toHaveLength(1);
  });
});

describe("steer (mensaje que entra al turno en vuelo)", () => {
  it("si entró: la respuesta sigue en una burbuja NUEVA debajo de tu mensaje", () => {
    let s = sent();
    s = replay(s, [["chunk", { text: "Primero esto" }]]);
    s = beginSend(s, "mejor en inglés", [], 3_000);
    expect(s.effects).toEqual([]); // no es un turno nuevo
    expect(s.turns[2]).toMatchObject({ role: "user", steer: true });
    s = sendAccepted(s, { injected: true, turnId: "t1" }, true, 3_000);
    expect(s.currentTurnId).toBe("t1");
    expect(s.turns[2].steer).toBe(true);
    s = replay(s, [["chunk", { text: "Now in English" }], ["done", { turnId: "t1" }]]);
    expect(s.turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "hola"],
      ["assistant", "Primero esto"],
      ["user", "mejor en inglés"],
      ["assistant", "Now in English"],
    ]);
  });

  it("si NO entró: el servidor abrió otro turno y se pinta como turno normal", () => {
    let s = sent("hola", 2_000);
    s = replay(s, [["chunk", { text: "Primero" }]]);
    s = beginSend(s, "cambio de planes", [], 5_000);
    s = sendAccepted(s, { injected: false, turnId: "t2" }, true, 5_000);
    expect(s.turns[2].steer).toBe(false);
    expect(s.currentTurnId).toBe("t2");
    expect(s.turnStartedAt).toBe(5_000);
    expect(s.streaming).toBe(false);
    s = replay(s, [["chunk", { text: "Va" }], ["done", { turnId: "t2" }]]);
    expect(s.turns[3]).toMatchObject({ role: "assistant", text: "Va" });
  });
});

describe("reconexión", () => {
  it("con backlog duplicado: la burbuja en curso se repinta UNA vez", () => {
    let s = sent();
    s = replay(s, [
      ["status", { phase: "session" }],
      ["chunk", { text: "Hola " }],
      ["tool", { id: "a", title: "Busco", kind: "search", status: "in_progress" }],
      ["chunk", { text: "mundo" }],
    ]);
    // Se cae la red; el EventSource reconecta y el servidor manda `started` + backlog entero.
    s = replay(s, [
      ["started", { latidoMs: 25_000 }],
      ["chunk", { text: "Hola " }],
      ["tool", { id: "a", title: "Busco", kind: "search", status: "in_progress" }],
      ["chunk", { text: "mundo" }],
      ["tool", { id: "a", status: "completed" }],
      ["chunk", { text: "!" }],
      ["done", { turnId: "t1" }],
    ]);
    expect(s.connections).toBe(2);
    expect(s.turns).toHaveLength(2);
    expect(s.turns[1].text).toBe("Hola mundo!");
    expect(s.turns[1].tools).toHaveLength(1);
    expect(s.turns[1].tools?.[0].status).toBe("completed");
  });

  it("al reconectar sin turno vivo en el servidor: el turno se cortó", () => {
    let s = sent();
    s = replay(s, [["chunk", { text: "a medias" }], ["started", {}], ["done", { reposo: true }]]);
    expect(s.busy).toBe(false);
    expect(s.interrupted).toEqual({ reason: "se cortó la conexión", turnId: undefined });
    expect(s.effects[0]).toMatchObject({ type: "turn-interrupted" });
  });

  it("terminó mientras la conexión estaba caída: se pinta la respuesta del `ultimo`", () => {
    let s = sent();
    s = replay(s, [
      ["chunk", { text: "Empie" }],
      ["started", {}],
      ["done", { reposo: true, ultimo: { turnId: "t1", estado: "done", text: "Respuesta completa." } }],
    ]);
    expect(s.busy).toBe(false);
    expect(s.turns).toHaveLength(2);
    expect(s.turns[1].text).toBe("Respuesta completa.");
    expect(s.effects.at(-1)).toMatchObject({ type: "turn-done", text: "Respuesta completa." });
  });

  it("el `ultimo` de OTRO turno no se pinta: se da por cortado", () => {
    let s = sent();
    s = replay(s, [["started", {}], ["done", { reposo: true, ultimo: { turnId: "t0", estado: "done", text: "vieja" } }]]);
    expect(s.interrupted?.reason).toBe("se cortó la conexión");
  });

  it("deploy azul/verde: el turno sigue en la otra caja y cierra con `reemplazo`", () => {
    let s = sent();
    s = replay(s, [
      ["chunk", { text: "Reviso." }],
      ["started", {}],
      ["status", { phase: "session", otraCaja: true }],
      ["chunk", { text: "Reviso." }],
    ]);
    expect(s.elsewhere).toBe(true);
    s = replay(s, [["reemplazo", { text: "- ✓ Reviso.\n\nListo." }], ["done", { turnId: "t1" }]]);
    expect(s.elsewhere).toBe(false);
    expect(s.turns).toHaveLength(2);
    expect(s.turns[1].text).toBe("- ✓ Reviso.\n\nListo.");
  });
});

describe("interrumpido", () => {
  it("en la primera suscripción, el `interrumpido` de un turno ANTERIOR no cuenta", () => {
    let s = sent();
    s = replay(s, [["done", { reposo: true, interrumpido: { turnId: "t0", motivo: "viejo" } }]]);
    expect(s.busy).toBe(true);
    expect(s.interrupted).toBeNull();
  });

  it("el de ESTE turno sí: se ofrece Retomar y se limpian error y aviso", () => {
    let s = sent();
    s = replay(s, [
      ["chunk", { text: "Trabajando" }],
      ["warning", { message: RESTART_NOTICE }],
      ["error", { message: "la caja se cayó" }],
      ["done", { turnId: "t1", interrumpido: { turnId: "t1", motivo: "se reinició el servidor" } }],
    ]);
    expect(s.busy).toBe(false);
    expect(s.error).toBeNull();
    expect(s.notice).toBeNull();
    expect(s.interrupted).toEqual({ reason: "se reinició el servidor", turnId: "t1" });
    expect(s.turnStartedAt).toBe(0);
  });

  it("si el agente vuelve a mandar algo, el aviso de reinicio era falso y se retira", () => {
    let s = sent();
    s = replay(s, [["warning", { message: RESTART_NOTICE }]]);
    expect(s.notice).toBe(RESTART_NOTICE);
    s = replay(s, [["chunk", { text: "sigo" }]]);
    expect(s.notice).toBeNull();
    s = replay(s, [["warning", { message: "otro aviso" }], ["chunk", { text: "." }]]);
    expect(s.notice).toBe("otro aviso");
  });
});

describe("error a media respuesta", () => {
  it("el error se enseña y el turno sigue hasta su `done`", () => {
    let s = sent();
    s = replay(s, [["chunk", { text: "Voy" }], ["error", { message: "se acabó el saldo" }]]);
    expect(s.error).toBe("se acabó el saldo");
    expect(s.busy).toBe(true);
    s = replay(s, [["done", { turnId: "t1" }]]);
    expect(s.busy).toBe(false);
    expect(s.error).toBe("se acabó el saldo");
  });

  it("un `error` sin datos (el del EventSource al perder la red) no pinta nada", () => {
    const s = replay(sent(), [["error", null]]);
    expect(s.error).toBeNull();
  });

  it("encargo rechazado: se dice y no se queda pensando", () => {
    let s = createPilotState();
    s = beginSend(s, "hola", [], 1);
    s = sendFailed(s, "Sin saldo", true);
    expect(s.busy).toBe(false);
    expect(s.error).toBe("Sin saldo");
    expect(s.effects).toEqual([{ type: "needs-login" }]);
  });
});

describe("permisos", () => {
  it("se pinta, no se duplica al reenviarse y se retira con `permission-resolved`", () => {
    const req = {
      id: "p1",
      title: "Correr la purga de notificaciones",
      tool: "run_cron",
      options: [
        { optionId: "allow", name: "Permitir", kind: "allow_once" },
        { optionId: "deny", name: "Rechazar", kind: "reject_once" },
      ],
    };
    let s = sent();
    s = replay(s, [["tool", { id: "a", title: "run_cron", status: "pending" }], ["permission", req]]);
    expect(s.permissions).toEqual([req]);
    // Reconexión: el servidor reenvía los permisos abiertos.
    s = replay(s, [["started", {}], ["permission", req]]);
    expect(s.permissions).toHaveLength(1);
    s = replay(s, [["permission-resolved", { id: "p1" }]]);
    expect(s.permissions).toEqual([]);
  });

  it("al cerrar el turno no queda ninguna tarjeta colgada", () => {
    let s = sent();
    s = replay(s, [["permission", { id: "p1", title: "x", options: [] }], ["done", { turnId: "t1" }]]);
    expect(s.permissions).toEqual([]);
  });
});

describe("reemplazo y avisos", () => {
  it("un `reemplazo` sin turno de este cliente se ignora", () => {
    const s = replay(createPilotState(), [["started", {}], ["reemplazo", { text: "x" }]]);
    expect(s.turns).toEqual([]);
  });

  it("`caps.needAccount` pide cuenta al CERRAR el turno, no a media respuesta", () => {
    let s = sent();
    s = replay(s, [["caps", { needAccount: true }], ["chunk", { text: "ok" }]]);
    expect(s.effects).toEqual([]);
    s = replay(s, [["done", { turnId: "t1" }]]);
    expect(s.effects.map((e) => e.type)).toEqual(["needs-login", "turn-done"]);
  });

  it("`caps.image:false` apaga las imágenes; `title` y `closed` son efectos", () => {
    let s = replay(createPilotState(), [["caps", { image: false }]]);
    expect(s.canSeeImages).toBe(false);
    s = replay(s, [["title", { title: "Reporte" }]]);
    expect(s.effects).toEqual([{ type: "title", title: "Reporte" }]);
    s = replay(s, [["closed", {}]]);
    expect(s.connected).toBe(false);
    expect(s.effects).toEqual([{ type: "disconnected" }]);
  });

  it("un evento desconocido no cambia nada", () => {
    const s0 = replay(createPilotState(), OPEN);
    expect(reducePilotEvent(s0, "algo-nuevo", { x: 1 })).toBe(s0);
  });
});

describe("constructor de páginas", () => {
  it("plan → secciones → lista", () => {
    let s = sent();
    s = replay(s, [
      ["page-planning", {}],
      ["page-plan", { pageId: "pg", title: "Mi landing", theme: { primary: "#000" }, sections: [{ id: "h", label: "Hero", kind: "hero" }] }],
      ["section-building", { pageId: "pg", id: "h" }],
      ["section-update", { pageId: "pg", id: "h", html: "<h1>" }],
      ["section", { pageId: "pg", id: "h", html: "<h1>Hola</h1>", ok: true }],
      ["page-ready", { pageId: "pg", n: 1, url: "https://x" }],
    ]);
    const page = s.turns[1].pages![0];
    expect(s.turns[1].planning).toBe(false);
    expect(page.sections[0]).toMatchObject({ status: "done", html: "<h1>Hola</h1>" });
    expect(page).toMatchObject({ url: "https://x", n: 1 });
    expect(page.readyAt).toBeGreaterThan(0);
  });
});

describe("acciones locales", () => {
  it("detener suelta el turno", () => {
    const s = stopTurn(sent());
    expect(s.busy).toBe(false);
    expect(s.turnStartedAt).toBe(0);
  });

  it("reintentar quita la última respuesta y el mensaje", () => {
    let s = sent();
    s = replay(s, [["chunk", { text: "mal" }], ["done", { turnId: "t1" }]]);
    expect(dropLastExchange(s).turns).toEqual([]);
  });

  it("retomar: continuar si alcanzó a trabajar, reenviar si no", () => {
    const user: Turn = { role: "user", text: "haz x" };
    expect(resumeMode([user])).toBe("resend");
    expect(resumeMode([user, { role: "assistant", text: "", tools: [{ id: "a" }] }])).toBe("continue");
    expect(resumeMode([{ role: "user", text: RESUME_TEXT }])).toBe("continue");
  });

  it("reconciliar trae el mensaje que llegó de otro cliente, sólo en reposo", () => {
    let s = sent();
    s = replay(s, [["chunk", { text: "uno" }], ["done", { turnId: "t1" }]]);
    const fresh: Turn[] = [
      { role: "user", text: "hola" },
      { role: "user", text: "desde el teléfono" },
      { role: "assistant", text: "uno" },
    ];
    const r = reconcileWith(s, fresh);
    expect(r.turns.map((t) => t.text)).toEqual(["hola", "desde el teléfono", "uno"]);
    expect(r.turns[2].seconds).toBe(s.turns[1].seconds);
    // Con turno en vuelo, la burbuja viva manda.
    expect(reconcileWith(sent(), fresh).turns).toHaveLength(1);
  });
});
