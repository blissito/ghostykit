# Ghosty Autopilot — protocol

Ghosty Autopilot speaks **[AG-UI](https://docs.ag-ui.com) 1.0**, the open agent ↔ app protocol that
LangGraph, CrewAI, Mastra, Pydantic AI and Google ADK speak. There is no Ghosty dialect. A backend
that follows this page works with Ghosty Autopilot and with any other AG-UI client (`@ag-ui/client`,
CopilotKit).

This page is the contract for backends (EasyBits, Ghosty Studio, yours). Field names and shapes come
from `@ag-ui/core` 1.0.3, the reference implementation of the spec.

**One endpoint per agent:** `POST <url>`. It takes a `RunAgentInput` and answers with a stream of
AG-UI events. Nothing else: no separate GET for events, no `/cancel`, no `/permission`.

---

## 1. Request

```http
POST /api/agent HTTP/1.1
Content-Type: application/json
Accept: text/event-stream
Cookie: …                      (or Authorization: …; whatever the app already uses)
```

Body: `RunAgentInput`.

```json
{
  "threadId": "th_2f1c",
  "runId": "run_8a77",
  "messages": [
    { "id": "msg_01", "role": "user", "content": "Why did the monitor fail?" }
  ],
  "tools": [],
  "context": [
    { "description": "screen", "value": "{\"page\":\"crons\",\"job\":\"monitor\"}" }
  ],
  "state": {},
  "forwardedProps": {}
}
```

| Field | What Ghosty Autopilot sends | What the backend does |
|---|---|---|
| `threadId` | Stable per conversation: the app passes it, or the client makes a UUID v4 | Key under which the backend stores the thread. **The backend owns the history.** (Use UUIDs: LangGraph requires them.) |
| `runId` | New for every request | Echo it in `RUN_STARTED`/`RUN_FINISHED`. Use it to make retries idempotent. |
| `messages` | **Only what is new in this request**: the user's message, or nothing (see §5) | Append to the stored thread. Never trust the client for older history. |
| `context` | What the user sees right now, one entry per key; `value` is a string (JSON when structured) | Give it to the agent for this run only. |
| `resume` | Answers to pending approvals (see §4) | Continue the paused run. |
| `forwardedProps` | Empty, except `{"cancel": "<runId>"}` to stop a run, `{"steer": "<runId>"}` to add the message to a live run (§6), or `{"stopSubagent": "<taskId>"}` to stop one subagent (§3). The app may add its own keys (`forwardedProps` option), e.g. Ghosty Studio's `{"permissions": "ask" \| "auto"}` | Stop that run / inject the message / stop that subagent. Ignore keys you don't know. |
| `tools`, `state` | Empty | Ignore unless your agent uses them. |

Attachments go in the user message as AG-UI content parts:
`{"type":"text","text":"…"}`, `{"type":"image","source":{"type":"url","value":"https://…"}}`,
`{"type":"document","source":{"type":"url","value":"https://…"},"mimeType":"application/pdf"}`.

## 2. Response

`200`, `Content-Type: text/event-stream`. Each event is one SSE message, JSON in `data:` and no
`event:` line, which is exactly what `@ag-ui/encoder` writes:

```
data: {"type":"RUN_STARTED","threadId":"th_2f1c","runId":"run_8a77"}

data: {"type":"TEXT_MESSAGE_START","messageId":"msg_02","role":"assistant"}

```

Send an SSE comment (`: ping`) every ~15 s while nothing else happens, so proxies don't close the
connection.

## 3. Events of a turn

Only standard AG-UI events. In order:

```text
RUN_STARTED            {threadId, runId}
  TEXT_MESSAGE_START   {messageId, role: "assistant"}
  TEXT_MESSAGE_CONTENT {messageId, delta}            ← the text as it is written (n times)
  TEXT_MESSAGE_END     {messageId}
  TOOL_CALL_START      {toolCallId, toolCallName, parentMessageId?}
  TOOL_CALL_ARGS       {toolCallId, delta}           ← JSON of the arguments, in pieces (0..n)
  TOOL_CALL_END        {toolCallId}
  TOOL_CALL_RESULT     {messageId, toolCallId, content}
  … more text and tools, in the order they happen …
RUN_FINISHED           {threadId, runId, outcome: {type: "success"}, usage?: [...]}
```

How each one shows up in the chat:

| Event | In the chat |
|---|---|
| `TEXT_MESSAGE_*` (assistant) | The answer, written live. Text before a tool call becomes a "narration" step (✓ line). |
| `TOOL_CALL_START` … `END` | A step ("Reading the history…") with a spinner. The tool name is the label key, so apps can name it in their own words; a `CUSTOM ghosty.tool` (§7) overrides it with the server's label. |
| `TOOL_CALL_RESULT` | The step turns into a check. If the tool failed, add `"metadata": {"error": true}` to the event and the step turns red. |
| `REASONING_MESSAGE_*` | Optional: the collapsible "Thinking…" block. |
| `STEP_STARTED` / `STEP_FINISHED` | Optional. While nothing else is on screen, a step whose `stepName` the app has a label for (`strings.steps`, built in: `waking`, `session`, `compacting`) replaces the waiting phrase. Other names are not drawn, so framework node names never leak into the chat. |
| `STATE_SNAPSHOT` / `STATE_DELTA` | Optional. The agent's shared state, given to the app as `pilot.state.agentState` (`STATE_DELTA` is an RFC 6902 JSON Patch over the last snapshot; a patch that doesn't apply is ignored until the next snapshot). Keys with meaning for the client: `caps.steer: true` turns on steer (§6), and `subagents.tasks` (below). |
| `CUSTOM` | Kept in the turn as `turn.custom[]` (`{name, value, timestamp}`) for the app to draw (`renderDeliveries`), except the protocol ones in §7. |
| `RUN_FINISHED` `usage` | Optional: tokens under the answer (`TokenUsage[]`: `[{model, inputTokens, outputTokens}]`). The cost, in USD, goes in `metadata.costUsd`. |
| `RUN_ERROR` `{message, code?}` | The run ends here, with the message shown in red. Do **not** send `RUN_FINISHED` after it. |

`TEXT_MESSAGE_CHUNK` and `TOOL_CALL_CHUNK` (the compact forms) are accepted too.

### Agent state keys (optional)

```json
{
  "caps": { "image": true, "steer": true, "permissions": true, "modelSwitch": true },
  "model": { "current": "claude-sonnet-5", "options": [ { "value": "…", "name": "…" } ] },
  "subagents": { "tasks": [ { "id": "…", "title": "…", "status": "running|completed|failed|stopped",
     "startedAt": 0, "endedAt": 0, "usage": { "tokens": 0, "toolUses": 0 }, "lastTool": "…",
     "summary": "…", "model": "…", "effort": "…", "delivered": false } ] }
}
```

- `STATE_SNAPSHOT` right after `RUN_STARTED` (and after `MESSAGES_SNAPSHOT` when reconnecting), then
  `STATE_DELTA` while the run lasts. Replacing a whole key is fine:
  `[{"op": "add", "path": "/subagents", "value": {"tasks": [...]}}]`.
- **Subagents** are `pilot.subagents` (tasks without an `id` are dropped). To stop one, the client
  posts a request of its own, with no message and the task in `forwardedProps.stopSubagent`; the
  backend answers `RUN_STARTED` → `RUN_FINISHED {outcome: {type: "success"}}` and **does not touch
  the live run**. The new status arrives as a `STATE_DELTA` on the live run's stream; with nothing
  live, the client asks for the thread again (§5) to get a fresh `STATE_SNAPSHOT`. Subagents that
  keep working after the run are the backend's to announce out of band (Ghosty Studio: its account
  bus); the app then calls `pilot.refresh()`.
- `model` is informative: switching models is the app's own API, not a run.

## 4. Human approval (interrupt / resume)

Risky actions (run a job, send an email, delete something) must not happen until the user says
yes. This uses AG-UI's **interrupts**: the run stops and ends with `outcome.type: "interrupt"`.

```json
{
  "type": "RUN_FINISHED",
  "threadId": "th_2f1c",
  "runId": "run_8a77",
  "outcome": {
    "type": "interrupt",
    "interrupts": [
      {
        "id": "int_7c1",
        "reason": "confirmation",
        "message": "Run purge-notifications now",
        "toolCallId": "tc_44",
        "expiresAt": "2026-10-18T16:40:00Z",
        "responseSchema": {
          "type": "object",
          "properties": { "approved": { "type": "boolean" } },
          "required": ["approved"]
        },
        "metadata": { "tool": "run_cron" }
      }
    ]
  }
}
```

The approval card shows `message` as the title, the tool (`metadata.tool`, or the name from
`toolCallId`'s `TOOL_CALL_START`) and a countdown to `expiresAt`.

**Clocks.** The user's clock may be off by minutes, so the countdown is computed with the
**server's** time, never the browser's: send `timestamp` (epoch ms, the AG-UI base field) on that
`RUN_FINISHED`. Without it, the client uses the response's `Date` header (cross-origin, add
`Access-Control-Expose-Headers: Date`). Either way the card shows `expiresAt − server time`
remaining, counted locally from when the event arrived.

Then:

- **Approve** posts a new run on the **same `threadId`** with a new `runId`, `messages: []` and:
  ```json
  "resume": [ { "interruptId": "int_7c1", "status": "resolved", "payload": { "approved": true } } ]
  ```
- **Reject** sends the same request with `"payload": { "approved": false }`.
- If the card **expires**, or the user **types a new message instead of answering**, the next request
  carries `{"interruptId": "int_7c1", "status": "cancelled"}` for it (with the new message, if any).
  `cancelled` means "no": the backend must not run the action. A `resolved` resume that arrives after
  `expiresAt` gets `RUN_ERROR` with `code: "interrupt_expired"`.

The answer comes back as a normal stream: the action's `TOOL_CALL_RESULT`, the agent's text and
`RUN_FINISHED` (or another interrupt).

Rules, from the spec:

- One `resume` must answer **every** open interrupt of that run.
- Answering the same `(threadId, interruptId, status, payload)` twice must be harmless.
- While a thread has open interrupts, a request without `resume` gets `409` (§6).
- The approval is authorized by whatever authenticates the request (session cookie or token). If
  your app requires the user's own session to approve (EasyBits does), check it here.

## 5. Opening a thread and reconnecting

The thread lives on the server. When the chat opens, or comes back after a reload or a dropped
connection, it posts a run **with no new message**:

```json
{ "threadId": "th_2f1c", "runId": "run_8a90", "messages": [], "context": [ … ] }
```

The backend answers:

```text
RUN_STARTED       {threadId, runId}
MESSAGES_SNAPSHOT {messages: [ …the whole stored thread, AG-UI messages… ]}
then ONE of:
  · a run is still going on this thread → its events from now on, live, until it ends
  · the thread is paused on approvals  → RUN_FINISHED {outcome: {type: "interrupt", interrupts: [...]}}
  · nothing is going on                → RUN_FINISHED {outcome: {type: "success"}}
```

`MESSAGES_SNAPSHOT` uses AG-UI messages:
`{id, role: "user", content}`,
`{id, role: "assistant", content?, toolCalls?: [{id, type: "function", function: {name, arguments}}], metadata?: {custom?: [{name, value}]}}`,
`{id, role: "tool", toolCallId, content, error?}`. The client rebuilds the bubbles and steps from it.
There is no event replay and no `Last-Event-ID`: the snapshot is the source of truth. Message ids
must be stable (the client uses them to join history pages).

- **A response that attaches to a live run opens with that run's id.** Reconnecting, steering (§6)
  or repeating a `runId` all answer `RUN_STARTED {runId: "<the live run's id>"}`, not the request's
  id. That is the id the client sends in `forwardedProps.cancel`. With nothing live, `RUN_STARTED`
  carries the request's `runId`.
- **A live run is part of the snapshot** up to its last closed message; what is still open is re-sent
  right after it (see "Reconnecting in the middle of an answer" below).
- **What a turn delivered** (files, artifacts: the `CUSTOM` events of §7 that the app draws) goes
  in `metadata.custom` of that assistant message, so it is still there after a reload. (`metadata`
  is AG-UI's open field on messages; a top-level extra field could be dropped by a validator.)
- **Reconnecting in the middle of an answer.** The snapshot carries only **closed** messages. What
  is still open is re-sent right after it, with the same ids: `TEXT_MESSAGE_START` plus one
  `TEXT_MESSAGE_CONTENT` with everything written so far (same `messageId`), and each open tool as
  `TOOL_CALL_START` + `TOOL_CALL_ARGS` (the whole arguments). Then the live deltas follow. The client
  never duplicates text: a `TEXT_MESSAGE_START` for the message that is already open restarts that
  message, and a `TOOL_CALL_START` for a known tool restarts its arguments.
- **A snapshot may also arrive in the middle of a run.** The client replaces the thread and keeps the
  run going: same `runId`, still busy, tool calls without a result still running. To rewrite only the
  answer's text (a guard, a compaction), `CUSTOM ghosty.replace` (§7) is lighter.

### Long threads (optional)

A backend doesn't have to send the whole thread. It can send the latest messages and announce that
there are older ones with a `CUSTOM` **right before** the snapshot:

```text
CUSTOM            {name: "ghosty.history", value: {hasMoreBefore: true, before: "<cursor>"}}
MESSAGES_SNAPSHOT {messages: [ …the last N messages… ]}
```

The chat then shows "Load earlier messages". The app fetches them through its own read API, outside
this endpoint, with the `loadOlder(before)` option. That option returns
`{messages, hasMoreBefore, before}`: AG-UI messages, oldest first, ending right before the cursor.
Pages start at a user message (never in the middle of a turn) and `before` is opaque to the client.
A later snapshot keeps the loaded pages when it starts at a message the client already has.

## 6. Stopping and errors

- **A closed connection never stops anything.** The user may reload, lose the network or the server
  may be deploying: the run keeps going on the server, and the next request for the thread (§5)
  picks it up live. A backend must not cancel a run because its client went away.
- **Stop** is an explicit request to the same endpoint, with no new message and the run to stop in
  `forwardedProps.cancel`:
  ```json
  { "threadId": "th_2f1c", "runId": "run_8b02", "messages": [], "forwardedProps": { "cancel": "run_8a77" } }
  ```
  The backend stops that run (keeping what was already said) and answers
  `RUN_STARTED` → `RUN_FINISHED {outcome: {type: "cancelled"}}`. If anyone is still reading the
  stopped run, its stream also ends with `RUN_FINISHED {outcome: {type: "cancelled"}}`. Stopping a
  run that already ended is harmless (same answer). `cancel` is the `runId` the client sent when it
  started the run.
- **Steer (optional).** With `caps.steer: true` in the agent state (§3), the user can write while a
  run is going. The client posts the message with a new `runId` and the live run in
  `forwardedProps.steer`:
  ```json
  { "threadId": "th_2f1c", "runId": "run_8b10", "messages": [ { "id": "msg_07", "role": "user", "content": "also check the purge" } ], "forwardedProps": { "steer": "run_8a77" } }
  ```
  A user message without `steer` while a run is live gets `409 run_active`.
  The backend adds the message to that run (the agent reads it at its next step) and answers with
  the **rest of the live run**, as if reconnecting: `RUN_STARTED {runId: "run_8a77"}` →
  `CUSTOM ghosty.injected {messageId: "msg_07"}` → the run's events until its `RUN_FINISHED`. The
  client stops reading the old stream and follows this one. The snapshot (§5) stores the message
  where it was injected. If the run already ended or the backend can't inject, it answers
  `409 run_active` (or starts a normal run if nothing is live). The client then **keeps the message**
  (`pilot.state.queued`, drawn faded under the thread with "Sends when this finishes"), reconnects
  (§5) to follow the live run, and sends it as a normal run when that run's `RUN_FINISHED` arrives
  (several waiting messages go together). After three refusals it gives up and shows the error. **Stop**
  empties the queue without sending it: the waiting text goes back to the message box.
  Steer carries text only: attachments wait for the run to end.
- **HTTP errors** (before the stream starts; body `{"error": "<code>", "message": "<for people>"}`):

| Status | When | Client does |
|---|---|---|
| `400` | Malformed `RunAgentInput` | Shows `message`. |
| `401` / `403` | Not signed in / not allowed | Shows `message`; the app may ask to sign in. |
| `409` `{"error":"run_active"}` | A run is already going on this thread | Keeps the message, reconnects (§5) and sends it when the run ends. |
| `409` `{"error":"interrupt_pending"}` | There are unanswered approvals | Keeps the message and reconnects (§5), which shows the cards; it goes out once they are answered and the run ends. |
| `400` `{"error":"resume_incomplete"}` | A `resume` didn't answer every open interrupt | Never sent by this client: one `resume` always answers them all (§4). |
| `402` `{"error":"quota_exceeded"}` | The plan's limit | Shows `message`. |
| `429` + `Retry-After` | Rate limit / no capacity | Shows `message`, then lets the user retry. |
| `503` + `Retry-After` | Server restarting (deploy) | Retries the **same** request after `Retry-After`, so keep requests idempotent by `runId`. |

- **During the stream:** errors are `RUN_ERROR {message, code?}`.

## 7. Custom events

All optional. Names starting with `ghosty.` are reserved for this list. The first five are part of
the protocol, and the client handles them; they and `ghosty.page` are not kept in the turn. The rest are content: they
go to `turn.custom[]` for the app to draw, and every event also reaches the app through `onEvent`.
Unknown names (yours) are kept in the turn too.

| `CUSTOM` name | `value` | Meaning |
|---|---|---|
| `ghosty.title` | `{ "title": "Monitor timeouts" }` | The backend named the thread (for a sidebar). |
| `ghosty.history` | `{ "hasMoreBefore": true, "before": "<cursor>" }` | Sent right before `MESSAGES_SNAPSHOT`: there are older messages (§5). |
| `ghosty.injected` | `{ "messageId": "msg_07" }` | A steer message entered the live run (§6). |
| `ghosty.replace` | `{ "messageId"?, "content": "…" }` | The backend rewrote the answer (a guard, a compaction): `content` replaces the turn's final text, after its last step; the narration before stays. |
| `ghosty.tool` | `{ "toolCallId", "title", "kind", "path"?, "detail"? }` | The localized label of a step, sent after its `TOOL_CALL_START`. `title` wins over the app's `toolVerbs`; `kind` picks the icon. |
| `ghosty.delivery` | `{ "id", "messageId", "url", "tipo": "archivo"\|"artefacto", "subtipo"?, "nombre", "titulo"?, "contenido"?, "fileId"?, "sessionId"?, "docId"?, "mime"?, "size"?, "captura"? }` | The turn delivered a file or artifact; `messageId` is the answer it belongs to. **A signed URL, never base64.** Also stored in the message's `metadata.custom` (§5), including the pages `loadOlder` returns. |
| `ghosty.page` | `{ "event": "…", … }` | A page-builder event (landings), many per run; re-sent when reconnecting to a live run. Read by the app through `onEvent`; not kept in the turn. |
| `ghosty.ui` | `{ "action": "move" \| "open", … }` | The agent asks the app to do something on screen (move or open a board card). The app acts on it through `onEvent`. |
| `ghosty.reply_to` | `{ "messageId": "…" }` | The answer replies to a specific earlier message. |
| `ghosty.attachments_failed` | `{ "names": ["…"], "message": "…" }` | Attachments of the user's message the agent couldn't read; `message` is for people. |

## 8. Checklist for a backend

1. `POST <url>` accepts `RunAgentInput`, stores the thread by `threadId`, appends only `messages`.
2. Streams `RUN_STARTED` → `TEXT_MESSAGE_*` / `TOOL_CALL_*` → `RUN_FINISHED` (or `RUN_ERROR`), as SSE
   `data:` lines, with pings.
3. Risky actions end the run with `outcome: interrupt`, and the backend acts only on a `resume` with
   `approved: true`, once, before `expiresAt`.
4. An empty `messages` with no `resume` answers `MESSAGES_SNAPSHOT` plus the live run, the pending
   interrupt, or success.
5. A closed connection never stops a run; `forwardedProps.cancel` does. `409`/`429`/`503` as in §6.
6. Optional: `STATE_SNAPSHOT`/`STATE_DELTA` with `caps` and `subagents`, steer with `forwardedProps.steer`, `forwardedProps.stopSubagent`,
   `ghosty.history` for long threads, and deliveries in `metadata.custom`.

Reference: an agent written with LangGraph and served through its official AG-UI adapter
(`@ag-ui/langgraph`) is in [`examples/langgraph`](../examples/langgraph).
