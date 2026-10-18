# Ghosty Autopilot · `ghostykit`

**An autopilot for your React app, not a copilot or kit.** You don't drive: you say where you're going and
the agent flies the app for you, stopping only to ask before anything risky. Ghosty Autopilot is the agent chat from
[Ghosty Studio](https://www.ghosty.studio) (`/c`), packaged as a library: same components, same
markup, same look ([side by side](https://raw.githubusercontent.com/blissito/ghostykit/main/docs/screenshots/parity/desktop-done-gs-vs-ghostykit.png)). You drop it into an app you already
have. It sees what the user has on screen, streams what the agent says and does, and **stops to ask
before anything risky** (human in the loop).

It speaks **[AG-UI](https://docs.ag-ui.com)**, the open agent ↔ app protocol, so it works with
**LangGraph**, Mastra, CrewAI, Pydantic AI, Google ADK, or your own backend. No adapter of ours in
between.

> El piloto de tu app, no el copiloto: tú no manejas, vas de pasajero y le dices a dónde ir. Es el chat de Ghosty, probado en producción, como biblioteca. Español por default, inglés incluido.

**[Open the playground →](https://blissito.github.io/ghostykit/)** (a fake backend, a real chat)

![The permission pass: the agent asks before running a cron](https://raw.githubusercontent.com/blissito/ghostykit/main/docs/screenshots/ghosty-light-desktop-2-permission.png)

## What you get

- **Live answers**: markdown streamed at a readable pace (Streamdown), with code blocks and tables. External links ask for confirmation before opening.
- **Agent steps**: every tool call as a line ("Read 2 files", "Searched the web"). Steps fold into a card when the turn ends, and you can show your own labels and icons.
- **The permission pass**: risky actions arrive as a card with a countdown, *Approve* and *Reject*. A stamp lands when you answer, and the decision stays recorded under the reply.
- **Context and references**: what the user is looking at travels with every turn. Rows from your app can be "@-mentioned" into the message.
- **Resilience**: the thread lives on your server. A dropped connection or a reload asks for it again
  and repaints from `MESSAGES_SNAPSHOT`, pending approvals included; a deploy (`503`) is retried with
  the same run.
- **The composer**: attachments (you provide `upload`), voice notes (you provide `transcribe`), stop and reply-option buttons.
- **Solid core**: the whole chat state is a pure reducer over AG-UI events, `reduceAgUiEvent(state, event)`, tested by replaying streams recorded from a real LangGraph agent.

> **En español:** Ghosty Autopilot le pone piloto a tu app con un solo componente: la persona dice qué quiere y el agente lo hace por ella. Tus usuarios ven la respuesta escribirse en vivo y cada paso del agente («Leí 2 archivos»), y aprueban o rechazan cualquier acción riesgosa con una tarjeta antes de que ocurra. El agente sabe qué pantalla y qué registro está viendo la persona. Habla AG-UI, el protocolo abierto entre agentes y apps, así que funciona con LangGraph, Mastra, CrewAI o tu propio backend. El chat se recupera solo de cortes de red y de deploys, y trae adjuntos, notas de voz y botón para detener. Por dentro, todo el estado es una función pura probada con sesiones reales, así que se puede actualizar sin miedo.

## 30-second quickstart

```bash
npm i ghostykit motion streamdown
```

```tsx
import { Piloto, createAgUiTransport } from "ghostykit";
import "ghostykit/styles.css";

const transport = createAgUiTransport({ url: "/api/agent" }); // any AG-UI endpoint

export function Pilot() {
  return <Piloto transport={transport} />;
}
```

`<Piloto transport={…} />` works with nothing else. Give its container a height: Piloto fills it.
The product is **Ghosty Autopilot**; the component is `<Piloto>`.

## Works with LangGraph (and any AG-UI agent)

Serve your LangGraph graph with its official AG-UI adapter and point Piloto at it:

```ts
// server: one POST endpoint (full file in examples/langgraph/src/server.ts)
import { LangGraphAgent } from "@ag-ui/langgraph";
import { EventEncoder } from "@ag-ui/encoder";

const agent = new LangGraphAgent({ graphId: "crons", deploymentUrl: "http://localhost:2024", emitInterruptOutcome: true });
// POST /agent → agent.run(runAgentInput).subscribe(e => res.write(new EventEncoder().encode(e)))
```

```tsx
<Piloto transport={createAgUiTransport({ url: "http://localhost:8000/agent" })} />
```

`interrupt()` in your graph becomes the approval card; *Approve*/*Reject* resume it
(`Command(resume={approved})` on the graph side). A runnable example with a tool and an approval is in
[`examples/langgraph`](examples/langgraph); the playground can point at it with
`?backend=agui&url=http://localhost:8000/agent`.

## The contract

One `POST <url>` with an AG-UI `RunAgentInput`, answered by a stream of standard AG-UI events. That's
all a backend serves. **[docs/protocol.md](docs/protocol.md)** is the exact spec: request, events,
approvals (`RUN_FINISHED.outcome: interrupt` + `resume`), reopening a thread (`MESSAGES_SNAPSHOT`),
stopping and errors.

## Make it yours

```tsx
const ref = useRef<PilotoHandle>(null);

<Piloto
  ref={ref}
  transport={transport}
  skin="easybits"            // "ghosty" (default) | "easybits" | "neutral" | your own
  theme="auto"               // "light" | "dark" | "auto"
  locale="en"                // Spanish by default
  agentName="Admin assistant"
  welcome="How can I help with your crons?"
  suggestions={["Why did the monitor fail?"]}
  draft={{ text: "Why did the monitor fail?", key: row.id }} // prefilled + focused, not sent
  threadId={conversationId}                                   // reopen a stored thread
  context={() => ({ screen: "crons", selected })}            // AG-UI `context`, every run
  toolVerbs={{ run_cron: { one: "Ran a cron", many: "Ran %n crons", running: "Running the cron…" } }}
  upload={async (file) => ({ url: await myUpload(file) })}
  transcribe={async (audio) => myWhisper(audio)}
  onTurnDone={({ text }) => refreshMyData()}
  slots={{ renderDeliveries: (turn) => <MyFiles turn={turn} />, composerExtras: <MyButton /> }}
/>;

ref.current?.addReference({ id: "12", label: "#12 Rosa" }); // "@" a row into the message
ref.current?.send("Why did this fail?");                     // ask on the user's behalf
```

Other options: `strings`, `toolIcons`, `formatUserText`, `markdown`, `features`
(`attachments`, `retry`, `copy`, `usage`, `replyOptions`, `duration`), `references` /
`onReferencesChange`, `voiceNoteText`, `placeholder`, `avatar`, `initialTurns`, and the callbacks
`onTurnStart`, `onTitle`, `onEvent` (every raw AG-UI event: STATE_*, CUSTOM…), `onSend`. To read the state
outside the chat, call `usePilot(transport)` yourself and pass the result as `pilot`. Every piece is
exported (`AgentBubble`, `AgentSteps`, `Composer`, `ConfirmCard`, `Markdown`, …) if you want to build
your own layout.

### Skins and theming

`ghostykit/styles.css` is self-contained and scoped under `.piloto`. It works the same with
**Tailwind 3, Tailwind 4 or no Tailwind**, and it shields its fields from the host's CSS (verified
in a Tailwind 3 app **with `@tailwindcss/forms`**: Piloto's textarea gets no border or focus ring, and
the app's own utilities compute identically with and without Piloto's CSS). Sizes don't depend on
the host's `html` font size either: `1rem` inside Piloto is `--piloto-rem` (18 px in the Ghosty skin,
like ghosty.studio; 16 px in the others). Every color, radius, border width and shadow is a variable:

```css
.my-app .piloto {
  --piloto-accent: #0f766e;
  --piloto-warning: #fde68a;      /* the permission pass */
  --piloto-radius-card: 6px;
  --piloto-border-width: 3px;
  --piloto-shadow-hero: 6px 6px 0 #0f766e;
  --piloto-rem: 16px;
  --piloto-font: "Your Sans", sans-serif;
}
```

| Ghosty | EasyBits | Neutral |
|---|---|---|
| ![Ghosty skin](https://raw.githubusercontent.com/blissito/ghostykit/main/docs/screenshots/ghosty-light-mobile-2-permission.png) | ![EasyBits skin, dark](https://raw.githubusercontent.com/blissito/ghostykit/main/docs/screenshots/easybits-dark-mobile-2-permission.png) | ![Neutral skin](https://raw.githubusercontent.com/blissito/ghostykit/main/docs/screenshots/neutral-light-mobile-2-permission.png) |

## Accessibility

- Keyboard-first: Enter sends, Shift+Enter adds a new line, Backspace on an empty box removes the last reference. Menus close with Escape, and focus rings are visible (`--piloto-focus`).
- The permission pass is a labelled region; the stamp is announced as status, and errors as alerts.
- `prefers-reduced-motion` turns off every animation, including the text-at-pace effect, the stamp and the "thinking" lamps.
- Dark mode is real, not inverted: hard shadows switch to a color so they stay visible on dark backgrounds.

## The repo

- `packages/ghostykit`: the package (`core`, `transport`, `react`, `pointer`, `styles.css`, `fonts.css`)
- `apps/demo`: the playground (Vite, simulated transport, skin switcher)

```bash
npm install
npm test        # reducer, both transports, parsers, SSR
npm run build   # dist/ (JS + .d.ts + styles.css)
npm run demo    # http://localhost:5173
```

## License

MIT © Héctor BlisS (FixterGeek)
