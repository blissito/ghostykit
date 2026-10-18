// El agente LangGraph servido por AG-UI, con el adaptador oficial (`@ag-ui/langgraph`): exactamente lo
// que pide docs/protocol.md — UN `POST /agent` con `RunAgentInput` que contesta SSE de eventos AG-UI.
//
//   npm run dev      # langgraph dev en :2024 (el grafo de src/agent.ts)
//   npm run agui     # este puente en :8000
//
// El adaptador hace §3–§4 (eventos, interrupt/resume). Este archivo agrega lo que es del servidor:
// §5 (abrir el hilo: MESSAGES_SNAPSHOT y, si hay run vivo, sus eventos en vivo) y §6 (un run no
// muere porque el cliente se vaya; se detiene sólo con `forwardedProps.cancel`; 409 si ya hay uno).
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

/**
 * Los runs vivos por hilo. Un run NO depende de la conexión que lo pidió (docs/protocol.md §6):
 * sigue aunque el cliente se vaya, y quien abra el hilo después se engancha a sus eventos en vivo.
 */
type Live = { runId: string; agent: LangGraphAgent; listeners: Set<(e: BaseEvent | null) => void> };
const live = new Map<string, Live>();

function startRun(input: RunAgentInput): Live {
  const agent = new LangGraphAgent({ graphId: GRAPH_ID, deploymentUrl: LANGGRAPH_URL, emitInterruptOutcome: true });
  const run: Live = { runId: input.runId, agent, listeners: new Set() };
  live.set(input.threadId, run);
  const end = () => {
    if (live.get(input.threadId) === run) live.delete(input.threadId);
    for (const l of run.listeners) l(null);
  };
  agent.run(input).subscribe({
    // El adaptador también emite RAW (los eventos crudos de LangGraph): no son para la UI.
    next: (e: BaseEvent) => {
      if (e.type !== EventType.RAW) for (const l of run.listeners) l(e);
    },
    error: (err: unknown) => {
      for (const l of run.listeners) l({ type: EventType.RUN_ERROR, message: err instanceof Error ? err.message : String(err) } as BaseEvent);
      end();
    },
    complete: end,
  });
  return run;
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
  const { threadId, runId } = input;
  const active = live.get(threadId);
  const cancel = (input.forwardedProps as { cancel?: string } | undefined)?.cancel;
  const opening = input.messages.length === 0 && !input.resume?.length && !cancel;

  // §6: un run nuevo mientras otro corre → 409 (el cliente abre el hilo y se engancha).
  if (!opening && !cancel && active) {
    return void res.writeHead(409, { "content-type": "application/json" }).end(JSON.stringify({ error: "run_active", message: "Ya hay un turno en curso.", runId: active.runId }));
  }

  const encoder = new EventEncoder({ accept: req.headers.accept });
  res.writeHead(200, { "content-type": encoder.getContentType(), "cache-control": "no-cache", connection: "keep-alive" });
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  const write = (e: BaseEvent) => res.write(encoder.encode(e));
  const done = () => {
    clearInterval(ping);
    res.end();
  };

  // §6: detener es explícito. El run se corta en LangGraph y quien lo lea recibe `cancelled`.
  if (cancel) {
    if (active && active.runId === cancel) {
      active.agent.abortRun();
      for (const l of active.listeners) l({ type: EventType.RUN_FINISHED, threadId, runId: cancel, outcome: { type: "cancelled" } } as BaseEvent);
      for (const l of active.listeners) l(null);
      live.delete(threadId);
    }
    write({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);
    write({ type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: "cancelled" } } as BaseEvent);
    return done();
  }

  // Leer un run: si la conexión se va, sólo se deja de escribir (el run sigue).
  const follow = (run: Live) => {
    const listener = (e: BaseEvent | null) => (e ? write(e) : (run.listeners.delete(listener), done()));
    run.listeners.add(listener);
    req.on("close", () => run.listeners.delete(listener));
  };

  if (opening) {
    // §5: si hay un run vivo, su historia y luego sus eventos en vivo; si no, historia + pausa/éxito.
    if (active) {
      write({ type: EventType.RUN_STARTED, threadId, runId: active.runId } as BaseEvent);
      const state = await client.threads.getState(threadId).catch(() => null);
      write({ type: EventType.MESSAGES_SNAPSHOT, messages: toAgUi(((state?.values ?? {}) as { messages?: Parameters<typeof toAgUi>[0] }).messages ?? []) } as BaseEvent);
      return follow(active);
    }
    for await (const e of openThread(input)) write(e);
    return done();
  }

  follow(startRun(input));
}).listen(PORT, () => console.log(`AG-UI → http://localhost:${PORT}/agent  (LangGraph ${LANGGRAPH_URL}, grafo ${GRAPH_ID})`));
