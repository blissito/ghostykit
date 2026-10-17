// El contrato de EasyBits (`/api/v2/admin/copilot/chat`, POST que devuelve el stream) contra el
// MISMO reductor: pasos sin id, `snapshot` al re-engancharse, `idle`, `interrupted`, `capacity`,
// `error` final y tarjetas de permiso que viven más que el turno.
import { describe, expect, it } from "vitest";
import { beginSend, createPilotState, reducePilotEvent, resolvePermission, sendAccepted, type PilotState } from "../src/core";

type Ev = [name: string, data?: unknown];
function replay(s: PilotState, events: Ev[], clock = { now: 1_000 }): PilotState {
  for (const [name, data] of events) {
    clock.now += 100;
    s = reducePilotEvent(s, name, data ?? {}, clock.now);
  }
  return s;
}

const FUTURE = new Date(10 * 60_000).toISOString();
const card = {
  id: "act_1",
  title: "Correr purge-notifications",
  tool: "run_cron",
  expiresAt: FUTURE,
  options: [
    { optionId: "approve", name: "Aprobar", kind: "allow_once" },
    { optionId: "reject", name: "Rechazar", kind: "reject_once" },
  ],
};

/** Abrir el panel: el attach no encuentra turno vivo. */
function opened(): PilotState {
  return replay(createPilotState(), [["started", {}], ["idle", {}]]);
}

function posted(text = "¿por qué falló el monitor?"): PilotState {
  let s = beginSend(opened(), text, [], 2_000);
  s = sendAccepted(s, { turnId: "e1", state: "running" }, false, 2_000);
  // El POST devuelve su propio stream: otro `started`, ahora con el turno.
  return replay(s, [["started", { turnId: "e1" }]]);
}

describe("EasyBits: turno por POST que devuelve el stream", () => {
  it("abrir sin turno vivo: conectado y en reposo", () => {
    const s = opened();
    expect(s.connected).toBe(true);
    expect(s.busy).toBe(false);
    expect(s.effects).toEqual([]);
  });

  it("pasos sin id: el que termina cierra al que arrancó con el mismo título", () => {
    let s = posted();
    expect(s.phase).toBe("session");
    expect(s.currentTurnId).toBe("e1");
    s = replay(s, [
      ["chunk", { text: "Reviso.", turnId: "e1" }],
      ["tool", { title: "mcp__easybits__list_crons", status: "in_progress" }],
      ["tool", { title: "mcp__easybits__list_crons", status: "completed" }],
      ["tool", { title: "mcp__easybits__get_cron_runs", status: "in_progress" }],
      ["tool", { title: "mcp__easybits__get_cron_runs", status: "failed" }],
      ["chunk", { text: "\n\nFalló por timeout.", turnId: "e1" }],
      ["done", { turnId: "e1", text: "Reviso.\n\nFalló por timeout." }],
    ]);
    expect(s.busy).toBe(false);
    expect(s.turns).toHaveLength(2);
    expect(s.turns[1].tools?.map((t) => [t.title, t.status])).toEqual([
      ["mcp__easybits__list_crons", "completed"],
      ["mcp__easybits__get_cron_runs", "failed"],
    ]);
    expect(s.turns[1].cuts).toEqual([7]);
    expect(s.effects.at(-1)).toMatchObject({ type: "turn-done", turnId: "e1" });
  });

  it("`done{text}` sin chunks pinta la respuesta", () => {
    const s = replay(posted(), [["done", { turnId: "e1", text: "Listo." }]]);
    expect(s.turns[1]).toMatchObject({ role: "assistant", text: "Listo." });
  });

  it("la tarjeta con `expiresAt` sobrevive al cierre del turno; la vencida no", () => {
    let s = replay(posted(), [
      ["permission", card],
      ["permission", { ...card, id: "act_old", expiresAt: new Date(0).toISOString() }],
      ["chunk", { text: "Te dejé la tarjeta." }],
      ["done", { turnId: "e1", text: "Te dejé la tarjeta." }],
    ]);
    expect(s.permissions.map((p) => p.id)).toEqual(["act_1"]);
    expect(s.permissions[0].expiresAt).toBe(FUTURE);
    // Aprobar: sale de las abiertas y queda anotada en la respuesta.
    s = resolvePermission(s, "act_1", "approve", true, "ejecutada");
    expect(s.permissions).toEqual([]);
    expect(s.turns[1].decisions).toEqual([{ id: "act_1", title: card.title, status: "approved", detail: "ejecutada" }]);
  });

  it("rechazar y vencida se anotan distinto", () => {
    const base = replay(posted(), [["permission", card], ["permission", { ...card, id: "act_2" }]]);
    let s = resolvePermission(base, "act_1", "reject", true);
    s = resolvePermission(s, "act_2", "approve", false);
    expect(s.turns.at(-1)!.decisions!.map((d) => d.status)).toEqual(["rejected", "expired"]);
  });

  it("`error` es final: el transporte cierra con `done` y el error se queda a la vista", () => {
    const s = replay(posted(), [["chunk", { text: "Voy" }], ["error", { message: "El agente no respondió" }], ["done", {}]]);
    expect(s.busy).toBe(false);
    expect(s.error).toBe("El agente no respondió");
  });

  it("`capacity`: se dice y el turno se suelta", () => {
    const s = replay(posted(), [["capacity", { message: "Tu flota está llena", retryAfter: 10 }]]);
    expect(s.busy).toBe(false);
    expect(s.error).toBe("Tu flota está llena");
    expect(s.effects.at(-1)).toMatchObject({ type: "turn-done" });
  });

  it("`interrupted{canContinue}`: Retomar continuará ESE turno", () => {
    const s = replay(posted(), [["chunk", { text: "a medias" }], ["interrupted", { turnId: "e1", canContinue: true }]]);
    expect(s.busy).toBe(false);
    expect(s.interrupted).toEqual({ reason: "se interrumpió", turnId: "e1", canContinue: true });
    expect(s.effects).toEqual([{ type: "turn-interrupted", reason: "se interrumpió", turnId: "e1" }]);
  });

  it("`idle` con un turno esperado = se perdió; sin esperar, nada", () => {
    expect(replay(posted(), [["idle", {}]]).interrupted?.reason).toBe("se cortó la conexión");
    const s0 = opened();
    expect(reducePilotEvent(s0, "idle", {})).toEqual({ ...s0, effects: [] });
  });
});

describe("EasyBits: re-enganche (`GET ?attach=1`)", () => {
  it("otra pestaña con un turno vivo: tarjetas abiertas + snapshot y sigue en vivo", () => {
    let s = createPilotState([{ role: "user", text: "¿por qué falló?" }]);
    s = replay(s, [
      ["started", {}],
      ["permission", card],
      ["snapshot", { turnId: "e9", text: "Reviso.Leo el historial.", tools: ["mcp__easybits__list_crons", "mcp__easybits__get_cron_runs"], cortes: [7] }],
    ]);
    expect(s.busy).toBe(true);
    expect(s.phase).toBe("session");
    expect(s.currentTurnId).toBe("e9");
    expect(s.permissions).toHaveLength(1);
    expect(s.turns[1].tools?.map((t) => t.status)).toEqual(["completed", "in_progress"]);
    s = replay(s, [
      ["tool", { title: "mcp__easybits__get_cron_runs", status: "completed" }],
      ["chunk", { text: "\n\nListo." }],
      ["done", { turnId: "e9", text: "Reviso.Leo el historial.\n\nListo." }],
    ]);
    expect(s.busy).toBe(false);
    expect(s.turns).toHaveLength(2);
    expect(s.turns[1].tools?.[1].status).toBe("completed");
    expect(s.turns[1].text).toBe("Reviso.Leo el historial.\n\nListo.");
  });

  it("se cortó el POST a medias: el attach repinta la burbuja UNA vez", () => {
    let s = replay(posted(), [["chunk", { text: "Hola " }], ["tool", { title: "x", status: "in_progress" }]]);
    s = replay(s, [
      ["started", {}],
      ["snapshot", { turnId: "e1", text: "Hola mundo", tools: ["x"], cortes: [5] }],
      ["chunk", { text: "!" }],
      ["done", { turnId: "e1", text: "Hola mundo!" }],
    ]);
    expect(s.turns).toHaveLength(2);
    expect(s.turns[1].text).toBe("Hola mundo!");
    expect(s.turns[1].tools).toHaveLength(1);
  });
});
