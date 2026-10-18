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
| `forwardedProps` | Empty, except `{"cancel": "<runId>"}` to stop a run, or `{"steer": "<runId>"}` to add the message to a live run (§6) | Stop that run / inject the message. |
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
| `TOOL_CALL_START` … `END` | A step ("Reading the history…") with a spinner. The tool name is the label key, so apps can name it in their own words. |
| `TOOL_CALL_RESULT` | The step turns into a check. If the tool failed, add `"metadata": {"error": true}` to the event and the step turns red. |
| `REASONING_MESSAGE_*` | Optional: the collapsible "Thinking…" block. |
| `STEP_STARTED` / `STEP_FINISHED` | Optional. While nothing else is on screen, a step whose `stepName` the app has a label for (`strings.steps`, built in: `waking`, `session`) replaces the waiting phrase. Other names are not drawn, so framework node names never leak into the chat. |
| `STATE_SNAPSHOT` / `STATE_DELTA` | Optional. The agent's shared state, given to the app as `pilot.state.agentState` (`STATE_DELTA` is an RFC 6902 JSON Patch over the last snapshot; a patch that doesn't apply is ignored until the next snapshot). One key has meaning for the client: `caps.steer: true` turns on steer (§6). |
| `CUSTOM` | Kept in the turn as `turn.custom[]` (`{name, value, timestamp}`) for the app to draw (`renderDeliveries`), except the protocol ones in §7. |
| `RUN_FINISHED` `usage` | Optional: tokens/cost under the answer (`[{model, inputTokens, outputTokens}]`). |
| `RUN_ERROR` `{message, code?}` | The run ends here, with the message shown in red. Do **not** send `RUN_FINISHED` after it. |

`TEXT_MESSAGE_CHUNK` and `TOOL_CALL_CHUNK` (the compact forms) are accepted too.

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
RUN_STARTED       {threadId, runId: "run_8a90"}
MESSAGES_SNAPSHOT {messages: [ …the whole stored thread, AG-UI messages… ]}
then ONE of:
  · a run is still going on this thread → its events from now on, live, until it ends
  · the thread is paused on approvals  → RUN_FINISHED {outcome: {type: "interrupt", interrupts: [...]}}
  · nothing is going on                → RUN_FINISHED {outcome: {type: "success"}}
```

`MESSAGES_SNAPSHOT` uses AG-UI messages:
`{id, role: "user", content}`,
`{id, role: "assistant", content?, toolCalls?: [{id, type: "function", function: {name, arguments}}], custom?: [{name, value}]}`,
`{id, role: "tool", toolCallId, content, error?}`. The client rebuilds the bubbles and steps from it.
There is no event replay and no `Last-Event-ID`: the snapshot is the source of truth. Message ids
must be stable (the client uses them to join history pages).

- **A live run is part of the snapshot.** It includes what the live run has said so far; the events
  that follow continue from there.
- **What a turn delivered** (files, artifacts: the `CUSTOM` events of §7 that the app draws) goes
  in the `custom` field of that assistant message, so it is still there after a reload. AG-UI
  messages allow extra fields.
- **A snapshot may also arrive in the middle of a run**, for example when the backend rewrites text it
  already sent (a guard, a compaction). The client replaces the thread and keeps the run going: same
  `runId`, still busy, tool calls without a result still running.

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
  The backend adds the message to that run (the agent reads it at its next step) and answers with
  the **rest of the live run**, as if reconnecting: `RUN_STARTED {runId: "run_8a77"}` →
  `CUSTOM ghosty.injected {messageId: "msg_07"}` → the run's events until its `RUN_FINISHED`. The
  client stops reading the old stream and follows this one. The snapshot (§5) stores the message
  where it was injected. If the run already ended or the backend can't inject, it answers
  `409 run_active` (or starts a normal run if nothing is live), and the client reconnects (§5).
- **HTTP errors** (before the stream starts; body `{"error": "<code>", "message": "<for people>"}`):

| Status | When | Client does |
|---|---|---|
| `400` | Malformed `RunAgentInput` | Shows `message`. |
| `401` / `403` | Not signed in / not allowed | Shows `message`; the app may ask to sign in. |
| `409` `{"error":"run_active"}` | A run is already going on this thread | Reconnects (§5) instead of sending. |
| `409` `{"error":"interrupt_pending"}` | There are unanswered approvals | Reconnects (§5), which shows the cards. |
| `429` + `Retry-After` | Rate limit / no capacity | Shows `message`, then lets the user retry. |
| `503` + `Retry-After` | Server restarting (deploy) | Retries the **same** request after `Retry-After`, so keep requests idempotent by `runId`. |

- **During the stream:** errors are `RUN_ERROR {message, code?}`.

## 7. Custom events

All optional. Names starting with `ghosty.` are reserved for this list. The first three are part of
the protocol; the client handles them and doesn't keep them in the turn. The rest are content: they
go to `turn.custom[]` for the app to draw, and every event also reaches the app through `onEvent`.

| `CUSTOM` name | `value` | Meaning |
|---|---|---|
| `ghosty.title` | `{ "title": "Monitor timeouts" }` | The backend named the thread (for a sidebar). |
| `ghosty.history` | `{ "hasMoreBefore": true, "before": "<cursor>" }` | Sent right before `MESSAGES_SNAPSHOT`: there are older messages (§5). |
| `ghosty.injected` | `{ "messageId": "msg_07" }` | A steer message entered the live run (§6). |
| `ghosty.delivery` | `{ "tipo", "nombre", "fileId", "url", "mime", "size", "captura" }` | The turn delivered a file or artifact. **A URL, never base64.** Also stored in the message's `custom` (§5). |
| `ghosty.ui` | `{ "action": "…", … }` | The agent asks the app to do something on screen (move or open a card). |
| `ghosty.reply_to` | `{ "messageId": "…" }` | The answer replies to a specific earlier message. |
| `ghosty.attachments_failed` | `{ "names": ["…"] }` | Attachments of the user's message the agent couldn't read. |

## 8. Checklist for a backend

1. `POST <url>` accepts `RunAgentInput`, stores the thread by `threadId`, appends only `messages`.
2. Streams `RUN_STARTED` → `TEXT_MESSAGE_*` / `TOOL_CALL_*` → `RUN_FINISHED` (or `RUN_ERROR`), as SSE
   `data:` lines, with pings.
3. Risky actions end the run with `outcome: interrupt`, and the backend acts only on a `resume` with
   `approved: true`, once, before `expiresAt`.
4. An empty `messages` with no `resume` answers `MESSAGES_SNAPSHOT` plus the live run, the pending
   interrupt, or success.
5. A closed connection never stops a run; `forwardedProps.cancel` does. `409`/`429`/`503` as in §6.
6. Optional: `STATE_SNAPSHOT`/`STATE_DELTA` with `caps`, steer with `forwardedProps.steer`,
   `ghosty.history` for long threads, and deliveries in `custom`.

Reference: an agent written with LangGraph and served through its official AG-UI adapter
(`@ag-ui/langgraph`) is in [`examples/langgraph`](../examples/langgraph).
