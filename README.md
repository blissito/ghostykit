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
  onTurnDone={({ text }) => refreshMyData()}
  plugins={PLUGINS}                                           // everything else: see Customize
/>;

ref.current?.addReference({ id: "12", label: "#12 Rosa" }); // "@" a row into the message
ref.current?.send("Why did this fail?");                     // ask on the user's behalf
```

Other props: `features` (`attachments`, `retry`, `copy`, `usage`, `replyOptions`, `duration`,
`steer`, `narration`: `false` keeps the text written before each tool as part of the answer instead of
checked progress lines), `references` / `onReferencesChange`, `placeholder`, `avatar`, `initialTurns`, `loadOlder`
(earlier pages of a long thread), `forwardedProps` (extra keys for every run, e.g.
`{permissions: "ask"}`), and the callbacks `onTurnStart`, `onTitle`, `onState`, `onEvent` (every raw
AG-UI event), `onSend`. The agent's shared state (`STATE_SNAPSHOT` + `STATE_DELTA`) is
`pilot.state.agentState`, and each turn's `CUSTOM` events are `turn.custom`.

Subagents (`state.subagents.tasks`) are `pilot.subagents`; `pilot.stopSubagent(id)` stops one, and
`<Subagents pilot={pilot} />` is a ready-made bar ("2 agents working", one row each, *Stop*). A
message the server can't take while a run is live (`409 run_active`) waits in `pilot.state.queued`
and is sent when that run ends. `pilot.refresh()` asks for the thread again (when your own event bus
says something changed). To read the state outside the chat, call `usePilot(transport)` yourself and
pass the result as `pilot`. Every piece is exported (`AgentBubble`, `AgentSteps`, `Composer`,
`ConfirmCard`, `Markdown`, …) if you want to build your own layout.

## Customize

There is **one** way to customize `<Piloto>`: **plugins**. A plugin is an object with a `name` and
named extension points. Everything a plugin draws is a React **component**: it is mounted as
`<View ctx={…} />`, so it can use hooks. Branding is the skin plus `--piloto-*` tokens.

```tsx
import { Piloto, definePlugin } from "ghostykit";
import { livePage, modelPicker, pilotDevtools } from "ghostykit/plugins";

const crm = definePlugin({
  name: "crm",
  requires: { events: ["crm.card"] },                       // what it handles, visible at a glance
  tools: { verbs: { find_lead: { one: "Found the lead", many: "Found %n leads", running: "Looking…" } } },
  message: { custom: { "crm.card": ({ entry, ctx }) => <LeadCard lead={entry.value} onOpen={() => ctx.send("Open it")} /> } },
  composer: { actions: ({ ctx }) => <PointButton onPick={(row) => ctx.addReference(row)} /> },
});

// Create them ONCE (module scope or useMemo): some plugins keep state.
const PLUGINS = [crm, modelPicker({ onChange: (model) => api.setModel(model) }), livePage(), pilotDevtools()];

<Piloto transport={transport} skin="ghosty" plugins={PLUGINS} />;
```

| Point | What it does | Example |
|---|---|---|
| `name` | Unique. Marks everything it draws with `data-plugin="<name>"`. | `"crm"` |
| `styles` | Whose styles its views use. `"host"` (default): your app's; ghostykit's utilities stay out (`data-piloto-isolate`), so they never override your classes. `"ghostykit"`: for views built from ghostykit components (`<Subagents>`, `ModelPicker`). | `"ghostykit"` |
| `requires` | `{events, state}` it handles. Derived from `events`/`state`/`message.custom` if missing; in development a mismatch is a warning. | `{ events: ["ghosty.page"] }` |
| `strings` | Texts over the locale's. | `{ stop: "Para" }` |
| `markdown.transform` | Rewrites the answer's markdown, with the turn at hand (chained). | `(md, turn) => md.replace(/#(\d+)/g, "[#$1](#folio-$1)")` |
| `markdown.onLinkClick` | A click on a link; `true` if handled (asked in order). | open in-app |
| `markdown.components` | How a markdown element is drawn, by tag (gets its props and `ctx`): e.g. a link that is a CTA as a button. | `{ a: ({ href, children, ctx }) => … }` |
| `markdown.blocks` | Fenced blocks by name (```` ```eb-file ````) taken out of the text and drawn as cards under the answer; one still being written comes with `complete: false`. | `{ "eb-file": FileCard }` |
| `vars`, `className` | Branding on the root: `--piloto-*` tokens and classes. | `{ "--piloto-radius-bubble": "6px" }` |
| `tools.verbs` | How each tool is named in the steps. | `{ run_cron: { one, many, running } }` |
| `tools.icons` | Icon by tool name or `kind`. | `{ run_cron: Clock }` |
| `tools.render` | A tool's own view, under the steps, by tool name or `kind`. | `{ create_image: ImagePreview }` |
| `events` | Handlers by AG-UI type, by `CUSTOM` name, or `*`. | `{ "ghosty.ui": (e, ctx) => board.open(e.value) }` |
| `state` | Called when that key of `agentState` changes. | `{ model: (v, ctx) => … }` |
| `message.custom` | Draws a `turn.custom` entry by its name (deliveries, CRM cards). | `{ "ghosty.delivery": DeliveryCard }` |
| `message.assistantBefore` | Before each answer's text, under its steps. | live page progress, "Creating image…" |
| `message.user` / `message.assistant` | Extras under each user message / answer. | `({ turn, live }) => …` |
| `message.formatUserText` | How the user's text is shown (chained). | strip app plumbing |
| `message.beforeSend` | Rewrites the text that goes out (chained). | prepend what was pointed at |
| `message.avatar` | The agent's avatar next to each answer. | `() => <img src={logo} />` |
| `composer.actions` | Buttons in the composer bar, between the image button and the clip. | "My files", "Point" |
| `composer.actionsEnd` | Buttons after the clip. | model picker |
| `composer.above` | Above the message box. | `<Subagents pilot={ctx.pilot} />` |
| `composer.below` | Under the message box. | suggestion chips |
| `composer.attachments` | `upload`, `transcribe`, `voiceNoteText`, and the limits `accept`, `maxFiles`, `maxBytes`. A voice note keeps its audio attached when there is `upload`. | `{ upload, accept: "image/*", maxFiles: 4, maxBytes: 4_000_000 }` |
| `composer.replace` | `{ when(ctx), view }`: drawn instead of the message box while `when` is true. | trial over (403 + `x-needs-login`) → "Create your account" |
| `header` | Top right, over the thread. | share button |
| `sidePanel` | Next to the chat. | live page, subagents |
| `aboveThread` | Above the messages. | a banner |
| `empty` | The empty thread (instead of the greeting). | onboarding |
| `waiting` | While the agent hasn't answered (instead of the waiting phrase). Gets `step`, `since`. | "Creating your image…" |
| `wrap` | A provider around the whole chat (`{ctx, children}`); the first plugin is outermost. | artifacts panel |
| `onHttpError` | The server refused a message before answering (`{status, code, message, headers}`; also in `pilot.state.httpError` until the next send). | 429 → upgrade banner |
| `onTurnStart` / `onTurnDone` | This client started / finished a turn. | open the last delivery |

Every view gets `ctx`: `{pilot, agentState, strings, send, addReference, addAttachments, setDraft, focus, plugins}`.
`addAttachments` takes `File`s (they go through `upload`) or ready `Attachment`s (e.g. from "My files"),
and they can be sent without text. The `ref` of `<Piloto>` is the same handle (without `plugins`,
`strings`, `agentState`), so the app never needs a separate `usePilot`: `ref.current.addReference(…)`,
`ref.current.pilot.reconnect()` (when your own event bus says the thread changed),
`ref.current.pilot.stop()`. `initialPrompt` sends a message as soon as the thread is open (a question
in the URL).

**Order and precedence**, in the order of the `plugins` list:

- **Maps** (`strings`, `tools.verbs`, `tools.icons`, `vars`) are merged, and later plugins win. `markdown.transform`, `formatUserText` and `beforeSend` are chained.
- **`events` and `state`** call every handler, in order.
- **Keyed or single views** (`tools.render`, `message.custom`, `markdown.blocks`, `markdown.components`, `message.avatar`, `empty`, `waiting`, `composer.attachments`, `composer.replace`): the first plugin that declares one wins. A clash is a development warning.
- **Lists** (`header`, `sidePanel`, `aboveThread`, `composer.actions`/`actionsEnd`/`above`/`below`, `message.user`/`assistant`/`assistantBefore`, `wrap`, `onTurnStart`/`onTurnDone`) all apply, in order.

In development, ghostykit also warns once about a `CUSTOM` event that nothing handles.

**Ready-made plugins** (`ghostykit/plugins`), usable as they are and as templates:

| Plugin | What it does |
|---|---|
| `modelPicker({ onChange, stateKey? })` | The model picker in the composer bar, from `agentState.model = {current, options}`. Switching is your API (`onChange`). |
| `livePage({ width? })` | A side panel that follows `CUSTOM ghosty.page` (plan, sections, ready, error) with the link at the end. |
| `pilotDevtools({ events? })` | Prints the mounted plugins, their points and what they handle; with `events: true`, every event and who handles it. |

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
