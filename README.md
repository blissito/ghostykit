# Ghosty Autopilot · `ghosty-autopilot`

**An autopilot for your React app, not a copilot or kit.** You don't drive: you say where you're going and
the agent flies the app for you, stopping only to ask before anything risky. Ghosty Autopilot is the agent chat from
[Ghosty Studio](https://www.ghosty.studio) (`/c`), packaged as a library: same components, same
markup, same look ([side by side](https://raw.githubusercontent.com/blissito/ghosty-autopilot/main/docs/screenshots/parity/desktop-done-gs-vs-ghosty-autopilot.png)). You drop it into an app you already
have. It sees what the user has on screen, streams what the agent says and does, and **stops to ask
before anything risky** (human in the loop).

> El piloto de tu app, no el copiloto: tú no manejas, vas de pasajero y le dices a dónde ir. Es el chat de Ghosty, probado en producción, como biblioteca. Español por default, inglés incluido.

**[Open the playground →](https://blissito.github.io/ghosty-autopilot/)** (a fake backend, a real chat)

![The permission pass: the agent asks before running a cron](https://raw.githubusercontent.com/blissito/ghosty-autopilot/main/docs/screenshots/ghosty-light-desktop-2-permission.png)

## What you get

- **Live answers**: markdown streamed at a readable pace (Streamdown), with code blocks and tables. External links ask for confirmation before opening.
- **Agent steps**: every tool call as a line ("Read 2 files", "Searched the web"). Steps fold into a card when the turn ends, and you can show your own labels and icons.
- **The permission pass**: risky actions arrive as a card with a countdown, *Approve* and *Reject*. A stamp lands when you answer, and the decision stays recorded under the reply.
- **Context and references**: what the user is looking at travels with every turn. Rows from your app can be "@-mentioned" into the message.
- **Resilience**: reconnects after a dropped network or a deploy, re-attaches to a running turn, retries while the server drains, and offers *Resume* when a turn is cut short.
- **The composer**: attachments (you provide `upload`), voice notes (you provide `transcribe`), stop, model picker and reply-option buttons.
- **Solid core**: the whole chat state is a pure reducer, `reducePilotEvent(state, name, data)`, tested by replaying real SSE sessions.

> **En español:** Ghosty Autopilot le pone piloto a tu app con un solo componente: la persona dice qué quiere y el agente lo hace por ella. Tus usuarios ven la respuesta escribirse en vivo y cada paso del agente («Leí 2 archivos»), y aprueban o rechazan cualquier acción riesgosa con una tarjeta antes de que ocurra. El agente sabe qué pantalla y qué registro está viendo la persona. El chat se recupera solo de cortes de red y de deploys sin perder el turno, y trae adjuntos, notas de voz y botón para detener. Por dentro, todo el estado es una función pura probada con sesiones reales, así que se puede actualizar sin miedo.

## 30-second quickstart

```bash
npm i ghosty-autopilot motion streamdown
```

```tsx
import { Piloto, useSseTransport } from "ghosty-autopilot";
import "ghosty-autopilot/styles.css";
import "ghosty-autopilot/fonts.css"; // optional: the house typefaces

export function Pilot() {
  const transport = useSseTransport("/api/pilot/conversations/123");
  return <Piloto transport={transport} />;
}
```

`<Piloto transport={…} />` works with nothing else. Give its container a height: Piloto fills it.

> **Names.** The product is **Ghosty Autopilot**; the component is still `<Piloto>`, and the rest of the
> API keeps its names (`usePilot`, `PilotTransport`, the `.piloto` class and the `--piloto-*` variables),
> so nothing breaks when you upgrade.

## Transports

A transport is how Piloto talks to your agent. It is a small interface: `subscribe`, `send`, `cancel`,
plus optional `setModel`, `respondPermission` and `history`. Two are included.

### 1. Split stream: `createSseTransport(base)` (Ghosty's contract)

The event stream stays open (`EventSource`) and messages go by POST.

| | |
|---|---|
| `GET  {base}/events` | Named SSE events: `started`, `status`, `chunk`, `thought`, `tool`, `permission`, `permission-resolved`, `usage`, `models`, `title`, `done{reposo?,interrumpido?,ultimo?}`, `error`… |
| `POST {base}/messages` | `{content, images, primerTurno, retomar?, context?}` → `{inyectado?, estado?, turnId?}` |
| `POST {base}/cancel` · `/model` · `/permission` | stop, switch model, answer a card |

Messages sent during a running turn are injected into it (steer). A silent connection during a turn is
reopened, and the server says whether the turn continued, finished or was cut short.

### 2. POST returns the stream: `createPostStreamTransport({ url })` (EasyBits' contract)

The POST that starts a turn *is* the SSE. A GET re-attaches to a running turn.

| | |
|---|---|
| `POST {url}` | `{text, context?, turnId, continueTurnId?}` → SSE `started`, `chunk`, `tool{title,status}`, `permission{…, expiresAt}`, `done{turnId,text}`, `error`, `capacity`, `interrupted{turnId,canContinue}`, `idle` |
| `GET {url}?attach=1` | `started`, one `permission` per open card, `snapshot{turnId,text,tools}`, then live |
| `GET {url}` | `{messages:[{role,text}]}`, loaded as the thread |

A 503 (deploy draining) is retried with the same `turnId`. A 409 `turn_busy` re-attaches to the turn
that is already running. Approvals usually go through your own route:

```tsx
<Piloto
  transport={useMemo(() => createPostStreamTransport({ url: "/api/v2/admin/copilot/chat" }), [])}
  context={{ page: "crons", job: selectedJob }}
  onPermission={async (id, optionId) => {
    const res = await fetch(`/api/v2/admin/agent-actions/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: optionId === "approve" ? "approve" : "reject" }),
    });
    if (res.status === 409 || res.status === 404) return { resolved: false }; // expired or already answered
    if (!res.ok) throw new Error("approval failed");
    return { resolved: true, detail: (await res.json()).status };
  }}
/>
```

### 3. Your own

Implement `PilotTransport` and emit the same event names (see `ghosty-autopilot/core` types). If you only need
the state, use the reducer directly: `ghosty-autopilot/core` has no React dependency.

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
  context={() => ({ screen: "crons", selected })}            // sent with EVERY turn
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
(`attachments`, `retry`, `copy`, `usage`, `models`, `replyOptions`, `duration`), `references` /
`onReferencesChange`, `voiceNoteText`, `placeholder`, `avatar`, `initialTurns`, and the callbacks
`onTurnStart`, `onTitle`, `onNeedsLogin`, `onDisconnected`, `onEvent`, `onSend`. To read the state
outside the chat, call `usePilot(transport)` yourself and pass the result as `pilot`. Every piece is
exported (`AgentBubble`, `AgentSteps`, `Composer`, `ConfirmCard`, `Markdown`, …) if you want to build
your own layout.

### Skins and theming

`ghosty-autopilot/styles.css` is self-contained and scoped under `.piloto`. It works the same with
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
| ![Ghosty skin](https://raw.githubusercontent.com/blissito/ghosty-autopilot/main/docs/screenshots/ghosty-light-mobile-2-permission.png) | ![EasyBits skin, dark](https://raw.githubusercontent.com/blissito/ghosty-autopilot/main/docs/screenshots/easybits-dark-mobile-2-permission.png) | ![Neutral skin](https://raw.githubusercontent.com/blissito/ghosty-autopilot/main/docs/screenshots/neutral-light-mobile-2-permission.png) |

## Accessibility

- Keyboard-first: Enter sends, Shift+Enter adds a new line, Backspace on an empty box removes the last reference. Menus close with Escape, and focus rings are visible (`--piloto-focus`).
- The permission pass is a labelled region; the stamp is announced as status, and errors as alerts.
- `prefers-reduced-motion` turns off every animation, including the text-at-pace effect, the stamp and the "thinking" lamps.
- Dark mode is real, not inverted: hard shadows switch to a color so they stay visible on dark backgrounds.

## The repo

- `packages/ghosty-autopilot`: the package (`core`, `transport`, `react`, `pointer`, `styles.css`, `fonts.css`)
- `apps/demo`: the playground (Vite, simulated transport, skin switcher)

```bash
npm install
npm test        # reducer, both transports, parsers, SSR
npm run build   # dist/ (JS + .d.ts + styles.css)
npm run demo    # http://localhost:5173
```

## Migrating from `ghostykit`

`ghostykit` was this package's earlier name (0.1–0.3). Same code, same API: install
`ghosty-autopilot` and change the import path.

```diff
- npm i ghostykit
+ npm i ghosty-autopilot

- import { Piloto } from "ghostykit";
- import "ghostykit/styles.css";
+ import { Piloto } from "ghosty-autopilot";
+ import "ghosty-autopilot/styles.css";
```

## License

MIT © Héctor BlisS (FixterGeek)
