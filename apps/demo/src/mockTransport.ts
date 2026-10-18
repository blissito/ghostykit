// Un agente de mentira que habla AG-UI de verdad (los mismos eventos que manda un agente LangGraph por
// su adaptador): texto en vivo, pasos, y una aprobación con `RUN_FINISHED.outcome: interrupt` que se
// contesta con `resume`. Es el playground: todo lo que se ve aquí es lo que vería una app real.
import type { BaseEvent, PilotTransport, RunAgentInput } from "ghosty-autopilot";

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

let seq = 0;
const id = (p: string) => `${p}_${++seq}`;

const CRONS_TABLE = `| Cron | Última corrida | Estado |
|---|---|---|
| purge-files | hace 2 h | ✅ ok |
| purge-notifications | hace 26 h | ⚠️ atrasado |
| monitor | hace 4 min | ❌ falló (timeout) |`;

/** Lo que el agente de mentira tiene pendiente por hilo (la aprobación abierta). */
const paused = new Map<string, { interruptId: string; toolCallId: string; screen?: string }>();

export function createMockTransport(): PilotTransport {
  return {
    async run(input: RunAgentInput, emit: (e: BaseEvent) => void, signal?: AbortSignal) {
      const e = (ev: Record<string, unknown>) => emit(ev as unknown as BaseEvent);
      const { threadId, runId } = input;
      const say = async (text: string) => {
        const messageId = id("msg");
        e({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
        for (const piece of text.match(/.{1,7}/gs) ?? []) {
          e({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: piece });
          await sleep(18 + Math.random() * 30, signal);
        }
        e({ type: "TEXT_MESSAGE_END", messageId });
      };
      const tool = async (name: string, args: Record<string, unknown>, result: string, ms = 900) => {
        const toolCallId = id("call");
        e({ type: "TOOL_CALL_START", toolCallId, toolCallName: name });
        e({ type: "TOOL_CALL_ARGS", toolCallId, delta: JSON.stringify(args) });
        e({ type: "TOOL_CALL_END", toolCallId });
        await sleep(ms, signal);
        e({ type: "TOOL_CALL_RESULT", messageId: id("tool"), toolCallId, content: result });
        return toolCallId;
      };

      e({ type: "RUN_STARTED", threadId, runId });
      await sleep(400, signal);

      // Contestaron la aprobación.
      const answer = input.resume?.[0];
      const open = paused.get(threadId);
      if (answer && open) {
        paused.delete(threadId);
        const approved = answer.status === "resolved" && (answer.payload as { approved?: boolean })?.approved;
        if (approved) {
          await sleep(1200, signal);
          e({ type: "TOOL_CALL_RESULT", messageId: id("tool"), toolCallId: open.toolCallId, content: "ok en 1.8 s" });
          await say(`${open.screen ? `Veo que estás en **${open.screen}**. ` : ""}Así van:\n\n${CRONS_TABLE}\n\nEl **monitor** falló por *timeout* contra la base. La purga ya corrió (corrida \`manual\`, 1.8 s, 312 notificaciones borradas).\n\nSi quieres, puedo:\n- Reintentar el monitor\n- Subirle el timeout a 30 s\n- Dejarlo así`);
        } else {
          e({ type: "TOOL_CALL_RESULT", messageId: id("tool"), toolCallId: open.toolCallId, content: "Rechazado por la persona." });
          await say("No corrí la purga. Cuando quieras, me dices.");
        }
        e({ type: "RUN_FINISHED", threadId, runId, outcome: { type: "success" }, usage: [{ model: "demo", inputTokens: 16_200, outputTokens: 2_200 }] });
        return;
      }

      const text = input.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join(" ");
      if (!text) {
        // Abrir el hilo: aquí no se guarda nada, así que no hay historia que mandar.
        e({ type: "MESSAGES_SNAPSHOT", messages: [] });
        e({ type: "RUN_FINISHED", threadId, runId, outcome: { type: "success" } });
        return;
      }

      if (/cafeter/i.test(text)) {
        await sleep(500, signal);
        await say("1. Café Brasa Nocturna\n2. Grano & Calle\n3. Cúmulo Café");
        e({ type: "RUN_FINISHED", threadId, runId, outcome: { type: "success" } });
        return;
      }

      if (/cron|monitor|purga|falló|fallo|run|fail/i.test(text)) {
        await say("Reviso tus crons.");
        await tool("list_crons", {}, "3 crons");
        await say("Leo el historial del monitor.");
        await tool("get_cron_runs", { job: "monitor", limit: 5 }, "5 corridas", 1100);
        await say("La purga de notificaciones lleva un día sin correr: te pido permiso para correrla.");
        const toolCallId = id("call");
        e({ type: "TOOL_CALL_START", toolCallId, toolCallName: "run_cron" });
        e({ type: "TOOL_CALL_ARGS", toolCallId, delta: JSON.stringify({ job: "purge-notifications" }) });
        e({ type: "TOOL_CALL_END", toolCallId });
        const interruptId = id("int");
        const screen = input.context.find((c) => c.description === "screen")?.value;
        paused.set(threadId, { interruptId, toolCallId, screen });
        e({
          type: "RUN_FINISHED",
          threadId,
          runId,
          outcome: {
            type: "interrupt",
            interrupts: [
              {
                id: interruptId,
                reason: "confirmation",
                message: "Correr ahora la purga de notificaciones (purge-notifications)",
                toolCallId,
                expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
                responseSchema: { type: "object", properties: { approved: { type: "boolean" } }, required: ["approved"] },
              },
            ],
          },
        });
        return;
      }

      await say(
        `Recibí: «${text.slice(0, 80)}».\n\nEsto es el **playground** de Ghosty Autopilot: el agente es de mentira, pero habla **AG-UI** de verdad. Prueba con *«¿por qué falló el monitor?»* para ver pasos y una tarjeta de aprobación.\n\n\`\`\`ts\nimport { Piloto, createAgUiTransport } from "ghosty-autopilot";\nimport "ghosty-autopilot/styles.css";\n\n<Piloto transport={createAgUiTransport({ url: "/api/agent" })} />\n\`\`\``,
      );
      e({ type: "RUN_FINISHED", threadId, runId, outcome: { type: "success" } });
    },
  };
}
