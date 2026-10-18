# LangGraph agent → AG-UI → Ghosty Autopilot

A LangGraph agent with one tool (`list_crons`) and one action that needs approval (`run_cron`,
paused with `interrupt()`), served over AG-UI by LangGraph's official adapter (`@ag-ui/langgraph`).
The model is scripted and streams like a real one, so it runs without an API key; swap it for
`ChatOpenAI`/`ChatAnthropic` in `src/agent.ts` and you have a real agent.

```bash
npm install
npm run dev     # LangGraph dev server on :2024 (graph "crons")
npm run agui    # AG-UI endpoint on :8000 → POST http://localhost:8000/agent
```

Then open the playground pointed at it:
`http://localhost:5173/?backend=agui&url=http://localhost:8000/agent` (`npm run demo` at the repo root).

`src/server.ts` is the whole backend side of [docs/protocol.md](../../docs/protocol.md): the adapter does
§3–§4 (events, interrupt/resume), and the file adds §5 (a request with no new message answers
`MESSAGES_SNAPSHOT`, then the live run or the pending approval) and §6 (a run survives its client
going away; `forwardedProps.cancel` stops it; `409` if one is already running).
