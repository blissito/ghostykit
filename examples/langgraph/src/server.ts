// El agente LangGraph servido por AG-UI, con el adaptador oficial (`@ag-ui/langgraph`): exactamente lo
// que pide docs/protocol.md — UN `POST /agent` con `RunAgentInput` que contesta SSE de eventos AG-UI.
//
//   npm run dev      # langgraph dev en :2024 (el grafo de src/agent.ts)
//   npm run agui     # este puente en :8000
//
// Lo único que agrega este archivo al adaptador es §5 del protocolo: una petición SIN mensaje nuevo ni
// `resume` es «abrir el hilo» y contesta MESSAGES_SNAPSHOT + la aprobación pendiente (si hay), en vez de
// volver a correr el grafo.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { EventType, type BaseEvent, type Message, type RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { LangGraphAgent } from "@ag-ui/langgraph";
import { Client } from "@langchain/langgraph-sdk";

const LANGGRAPH_URL = process.env.LANGGRAPH_URL ?? "http://localhost:2024";
const GRAPH_ID = process.env.GRAPH_ID ?? "crons";
const PORT = Number(process.env.PORT ?? 8000);
const client = new Client({ apiUrl: LANGGRAPH_URL });

/** Los mensajes de LangGraph (`human`/`ai`/`tool`) como mensajes AG-UI. */
function toAgUi(messages: { id?: string; type: string; content: unknown; tool_calls?: { id?: string; name: string; args: unknown }[]; tool_call_id?: string; status?: string }[]): Message[] {
  const text = (c: unknown) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p as { text?: string }).text ?? "").join("") : "");
  return messages.map((m): Message => {
    const id = m.id ?? randomUUID();
    if (m.type === "human") return { id, role: "user", content: text(m.content) };
    if (m.type === "tool") return { id, role: "tool", toolCallId: m.tool_call_id ?? "", content: text(m.content), ...(m.status === "error" ? { error: text(m.content) } : {}) };
    return {
      id,
      role: "assistant",
      content: text(m.content),
      ...(m.tool_calls?.length ? { toolCalls: m.tool_calls.map((c) => ({ id: c.id ?? randomUUID(), type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) } : {}),
    };
  });
}

/** §5: abrir el hilo — su historia, y si está en pausa, la aprobación pendiente. */
async function* openThread(input: RunAgentInput): AsyncGenerator<BaseEvent> {
  const { threadId, runId } = input;
  yield { type: EventType.RUN_STARTED, threadId, runId } as BaseEvent;
  const state = await client.threads.getState(threadId).catch(() => null);
  const values = (state?.values ?? {}) as { messages?: Parameters<typeof toAgUi>[0] };
  yield { type: EventType.MESSAGES_SNAPSHOT, messages: toAgUi(values.messages ?? []) } as BaseEvent;
  const interrupts = (state?.tasks ?? []).flatMap((t) => (t as { interrupts?: { id: string; value: Record<string, unknown> }[] }).interrupts ?? []);
  if (interrupts.length) {
    yield {
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
      outcome: { type: "interrupt", interrupts: interrupts.map((i) => ({ id: i.id, reason: "confirmation", ...i.value })) },
    } as BaseEvent;
  } else {
    yield { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: "success" } } as BaseEvent;
  }
}

createServer(async (req, res) => {
  // CORS para la demo (Vite en otro puerto).
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  if (req.method !== "POST" || req.url !== "/agent") return void res.writeHead(404).end();

  let body = "";
  for await (const chunk of req) body += chunk;
  let input: RunAgentInput;
  try {
    input = JSON.parse(body);
  } catch {
    return void res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "bad_request", message: "RunAgentInput inválido" }));
  }
  input = { tools: [], context: [], ...input, messages: input.messages ?? [] };

  const encoder = new EventEncoder({ accept: req.headers.accept });
  res.writeHead(200, { "content-type": encoder.getContentType(), "cache-control": "no-cache", connection: "keep-alive" });
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  const write = (e: BaseEvent) => res.write(encoder.encode(e));

  const opening = input.messages.length === 0 && !input.resume?.length;
  if (opening) {
    for await (const e of openThread(input)) write(e);
    clearInterval(ping);
    return void res.end();
  }

  const agent = new LangGraphAgent({ graphId: GRAPH_ID, deploymentUrl: LANGGRAPH_URL, emitInterruptOutcome: true });
  // §6: si la persona cierra (detener), se corta el run en LangGraph.
  req.on("close", () => {
    if (!res.writableEnded) agent.abortRun();
  });
  agent.run(input).subscribe({
    // El adaptador también emite RAW (los eventos crudos de LangGraph): no son para la UI.
    next: (e: BaseEvent) => void (e.type !== EventType.RAW && write(e)),
    error: (err: unknown) => {
      write({ type: EventType.RUN_ERROR, message: err instanceof Error ? err.message : String(err) } as BaseEvent);
      clearInterval(ping);
      res.end();
    },
    complete: () => {
      clearInterval(ping);
      res.end();
    },
  });
}).listen(PORT, () => console.log(`AG-UI → http://localhost:${PORT}/agent  (LangGraph ${LANGGRAPH_URL}, grafo ${GRAPH_ID})`));
