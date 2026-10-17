// Un transporte de mentira que habla el MISMO contrato que el servidor de Ghosty: abre el stream
// en reposo y, al mandar, reproduce un turno realista (narración, pasos, un permiso, markdown, uso).
// Es el playground: todo lo que se ve aquí es lo que vería una app real.
import type { PilotListener, PilotTransport, SendInput } from "ghostykit";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Script = (ctx: { emit: (name: string, data?: unknown) => void; ask: (req: Permission) => Promise<string>; input: SendInput }) => Promise<void>;
type Permission = { id: string; title: string; tool?: string; expiresAt?: string; options: { optionId: string; name: string; kind?: string }[] };

/** Escribe un texto en pedacitos, como llega de un modelo real. */
async function stream(emit: (name: string, data?: unknown) => void, text: string, turnId: string) {
  const parts = text.match(/.{1,7}/gs) ?? [];
  for (const p of parts) {
    emit("chunk", { text: p, turnId });
    await sleep(18 + Math.random() * 30);
  }
}

const CRONS_TABLE = `| Cron | Última corrida | Estado |
|---|---|---|
| purge-files | hace 2 h | ✅ ok |
| purge-notifications | hace 26 h | ⚠️ atrasado |
| monitor | hace 4 min | ❌ falló (timeout) |`;

/** El turno de ejemplo: revisa los crons, pide permiso para correr uno y lo corre (o no). */
const cronsTurn: Script = async ({ emit, ask, input }) => {
  const turnId = `t${Date.now()}`;
  emit("status", { phase: "session" });
  await sleep(500);
  await stream(emit, "Reviso tus crons.", turnId);
  emit("tool", { id: "a", title: "mcp__easybits__list_crons", kind: "mcp", status: "in_progress", detalle: "3 crons" });
  await sleep(900);
  emit("tool", { id: "a", status: "completed" });
  await stream(emit, " Leo el historial del monitor.", turnId);
  emit("tool", { id: "b", title: "mcp__easybits__get_cron_runs", kind: "mcp", status: "in_progress", detalle: "monitor · últimas 5" });
  await sleep(1100);
  emit("tool", { id: "b", status: "completed" });
  await stream(emit, "La purga de notificaciones lleva un día sin correr: te pido permiso para correrla.", turnId);
  emit("tool", { id: "c", title: "mcp__easybits__run_cron", kind: "mcp", status: "pending", detalle: "purge-notifications" });
  const choice = await ask({
    id: `p-${turnId}`,
    title: "Correr ahora la purga de notificaciones (purge-notifications)",
    tool: "run_cron",
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    options: [
      { optionId: "allow", name: "Aprobar y correr", kind: "allow_once" },
      { optionId: "deny", name: "Rechazar", kind: "reject_once" },
    ],
  });
  const ctx = input.context as { screen?: string } | undefined;
  const summary = `${ctx?.screen ? `Veo que estás en **${ctx.screen}**. ` : ""}Así van:\n\n${CRONS_TABLE}\n\nEl **monitor** falló por *timeout* contra la base.`;
  if (choice === "allow") {
    emit("tool", { id: "c", status: "in_progress" });
    await sleep(1400);
    emit("tool", { id: "c", status: "completed" });
    await stream(emit, `\n\n${summary} La purga ya corrió (corrida \`manual\`, 1.8 s, 312 notificaciones borradas).\n\nSi quieres, puedo:\n- Reintentar el monitor\n- Subirle el timeout a 30 s\n- Dejarlo así`, turnId);
  } else {
    emit("tool", { id: "c", status: "failed" });
    await stream(emit, `\n\n${summary} No corrí la purga; cuando quieras, me dices.`, turnId);
  }
  emit("usage", { used: 18_400, size: 200_000, cost: 0.0213 });
  emit("done", { turnId });
};

/** Un turno corto, sin pasos: para cualquier otra pregunta. */
const chatTurn: Script = async ({ emit, input }) => {
  const turnId = `t${Date.now()}`;
  emit("status", { phase: "session" });
  await sleep(700);
  await stream(
    emit,
    `Recibí: «${input.text.slice(0, 80)}».\n\nEsto es el **playground** de Piloto: el transporte es de mentira, pero el chat es el de verdad. Prueba con *«¿por qué falló el monitor?»* para ver pasos y una tarjeta de aprobación.\n\n\`\`\`ts\nimport { Piloto, createSseTransport } from "ghostykit";\nimport "ghostykit/styles.css";\n\n<Piloto transport={createSseTransport("/api/chat")} />\n\`\`\``,
    turnId,
  );
  emit("done", { turnId });
};

export function createMockTransport(): PilotTransport {
  let listener: PilotListener | null = null;
  const emit = (name: string, data: unknown = {}) => listener?.(name, data);
  const waiting = new Map<string, (optionId: string) => void>();
  let cancelled = false;

  return {
    subscribe(l) {
      listener = l;
      // Lo que manda el servidor al abrir un hilo en reposo.
      setTimeout(() => {
        emit("started", { latidoMs: 25_000 });
        emit("caps", { image: true });
        emit("models", {
          options: [
            { value: "sonnet", name: "Sonnet 5.5" },
            { value: "opus", name: "Opus 5.5" },
          ],
          current: "sonnet",
        });
        emit("done", { reposo: true });
      }, 350);
      return () => {
        listener = null;
      };
    },
    async send(input) {
      cancelled = false;
      const script = /cron|monitor|purga|falló|fallo/i.test(input.text) ? cronsTurn : chatTurn;
      const ask = (req: Permission) =>
        new Promise<string>((resolve) => {
          waiting.set(req.id, resolve);
          emit("permission", req);
        });
      const guarded = (name: string, data?: unknown) => {
        if (!cancelled) emit(name, data);
      };
      void script({ emit: guarded, ask, input });
      return { turnId: "t", state: "running" };
    },
    async cancel() {
      cancelled = true;
      emit("done", { turnId: "t" });
    },
    async setModel(value) {
      await sleep(200);
      emit("models", {
        options: [
          { value: "sonnet", name: "Sonnet 5.5" },
          { value: "opus", name: "Opus 5.5" },
        ],
        current: value,
      });
    },
    async respondPermission(id, optionId) {
      const resolve = waiting.get(id);
      if (!resolve) return { resolved: false };
      waiting.delete(id);
      emit("permission-resolved", { id });
      resolve(optionId);
      return { resolved: true };
    },
  };
}
