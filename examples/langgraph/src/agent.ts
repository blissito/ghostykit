// Un agente LangGraph de ejemplo para Ghosty Autopilot: revisa crons con una tool, pide permiso con
// `interrupt()` antes de correr uno, y corre (o no) según lo que conteste la persona con
// `Command({ resume })`. El modelo es de mentira (guionado y en streaming) para que el ejemplo corra
// sin llave de API; cámbialo por `new ChatOpenAI(...)`/`ChatAnthropic` y es un agente real.
import { AIMessageChunk, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { tool } from "@langchain/core/tools";
import { END, interrupt, MemorySaver, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";

const listCrons = tool(async () => JSON.stringify([
  { name: "purge-files", last: "hace 2 h", status: "ok" },
  { name: "purge-notifications", last: "hace 26 h", status: "atrasado" },
  { name: "monitor", last: "hace 4 min", status: "falló (timeout)" },
]), { name: "list_crons", description: "Lista los crons y su última corrida.", schema: z.object({}) });

const runCron = tool(async ({ job }) => `Corrida manual de ${job}: ok en 1.8 s.`, {
  name: "run_cron",
  description: "Corre un cron ahora. Requiere aprobación humana.",
  schema: z.object({ job: z.string() }),
});

/** Qué contesta el «modelo» según cómo va la conversación. */
function script(messages: BaseMessage[]): { text: string; call?: { name: string; args: Record<string, unknown> } } {
  const last = messages[messages.length - 1];
  if (last.getType() === "human") return { text: "Reviso tus crons.", call: { name: "list_crons", args: {} } };
  if (last.getType() === "tool" && (last as ToolMessage).name === "list_crons") {
    return {
      text: "El **monitor** falló por *timeout* y la purga de notificaciones lleva un día sin correr. Te pido permiso para correrla.",
      call: { name: "run_cron", args: { job: "purge-notifications" } },
    };
  }
  const rejected = String(last.content).includes("Rechazado");
  return { text: rejected ? "No corrí la purga. Cuando quieras, me dices." : "Listo: la purga corrió (corrida manual, 1.8 s)." };
}

class ScriptedChatModel extends BaseChatModel {
  _llmType() {
    return "scripted";
  }
  bindTools() {
    return this as never;
  }
  async _generate(): Promise<ChatResult> {
    throw new Error("sólo streaming");
  }
  async *_streamResponseChunks(messages: BaseMessage[], _o: unknown, runManager?: { handleLLMNewToken: (t: string, i?: unknown, r?: unknown, p?: unknown, t2?: unknown, f?: { chunk: ChatGenerationChunk }) => Promise<void> }) {
    const { text, call } = script(messages);
    // Como un modelo real: el texto por pedacitos y al final la llamada a la tool.
    for (const piece of text.match(/\S+\s*/g) ?? []) {
      await new Promise((r) => setTimeout(r, 40));
      const chunk = new ChatGenerationChunk({ text: piece, message: new AIMessageChunk({ content: piece }) });
      yield chunk;
      await runManager?.handleLLMNewToken(piece, undefined, undefined, undefined, undefined, { chunk });
    }
    if (call) {
      const id = `call_${call.name}_${messages.length}`;
      const chunk = new ChatGenerationChunk({
        text: "",
        message: new AIMessageChunk({ content: "", tool_call_chunks: [{ name: call.name, args: JSON.stringify(call.args), id, index: 0, type: "tool_call_chunk" }] }),
      });
      yield chunk;
      await runManager?.handleLLMNewToken("", undefined, undefined, undefined, undefined, { chunk });
    }
  }
}

const model = new ScriptedChatModel({});
const tools = new ToolNode([listCrons, runCron]);

async function agent(state: typeof MessagesAnnotation.State) {
  return { messages: [await model.invoke(state.messages)] };
}

/** Antes de correr un cron, se pregunta. El grafo se DETIENE aquí hasta que llegue `Command({resume})`. */
async function approval(state: typeof MessagesAnnotation.State) {
  const ai = state.messages[state.messages.length - 1] as { tool_calls?: { id?: string; name: string; args: { job?: string } }[] };
  const call = ai.tool_calls![0];
  // La forma del interrupt es la de AG-UI (el adaptador la pasa tal cual): la tarjeta pinta `message`,
  // la herramienta de `toolCallId` y la cuenta regresiva de `expiresAt`.
  const answer = interrupt({
    reason: "confirmation",
    message: `Correr ahora ${call.args.job}`,
    toolCallId: call.id,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    responseSchema: { type: "object", properties: { approved: { type: "boolean" } }, required: ["approved"] },
  }) as { approved?: boolean } | undefined;
  const decision = answer?.approved ? "approve" : "reject";
  if (decision === "approve") return { messages: [] };
  return { messages: [new ToolMessage({ content: "Rechazado por la persona.", tool_call_id: call.id ?? "", name: call.name })] };
}

function route(state: typeof MessagesAnnotation.State) {
  const ai = state.messages[state.messages.length - 1] as { tool_calls?: { name: string }[] };
  const call = ai.tool_calls?.[0];
  if (!call) return END;
  return call.name === "run_cron" ? "approval" : "tools";
}

export const graph = new StateGraph(MessagesAnnotation)
  .addNode("agent", agent)
  .addNode("tools", tools)
  .addNode("approval", approval)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", route, ["tools", "approval", END])
  // Aprobado → corre la tool; rechazado → el agente lee el rechazo.
  .addConditionalEdges("approval", (s) => (s.messages[s.messages.length - 1].getType() === "tool" ? "agent" : "tools"), ["tools", "agent"])
  .addEdge("tools", "agent")
  .compile({ checkpointer: new MemorySaver() });
