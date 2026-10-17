# Piloto UI · `ghostykit`

**The in-app copilot chat from [Ghosty Studio](https://www.ghosty.studio)** — an agent chat that lives
inside an app you already have: streaming text, agent steps, attachments, voice notes, reconnection when
the network drops, and approval cards before anything risky (*human in the loop*).

> El copiloto de tu app: el chat de Ghosty, probado en producción, como biblioteca.

```bash
npm i ghostykit motion streamdown
```

```tsx
import { Piloto, useSseTransport } from "ghostykit";
import "ghostykit/styles.css";

export function Copilot() {
  const transport = useSseTransport("/api/copilot/conversations/abc");
  return <Piloto transport={transport} />;
}
```

That's it. Everything else is optional.

## Three entry points

| Import | What | React? |
|---|---|---|
| `ghostykit/core` | `reducePilotEvent(state, name, data)` — the whole chat state as a **pure reducer**, plus types, `reconcileTurns`, narration / reply-option / step parsers | no |
| `ghostykit/transport` | `PilotTransport` interface + `createSseTransport(base)` (Ghosty: EventSource + POST) and `createPostStreamTransport(url)` (the POST returns the SSE; re-attach + history) | no |
| `ghostykit` / `ghostykit/react` | `usePilot(transport)`, `<Piloto />` and every piece (`AgentBubble`, `AgentSteps`, `Composer`, `ConfirmCard`, `Markdown`, …) | yes |
| `ghostykit/pointer` | `elementReference(picked, file)` — turn an element picked with `@ghostystudio/pointer` into a message reference | optional |

## A real copilot

```tsx
const ref = useRef<PilotoHandle>(null);

<Piloto
  ref={ref}
  transport={transport}
  agentName="Admin assistant"
  locale="en"                                  // Spanish by default
  theme="auto"                                 // light | dark | auto
  context={() => ({ screen: "crons", selected })} // travels with EVERY turn (body.context)
  suggestions={["Why did the monitor fail?"]}
  toolVerbs={{ run_cron: { one: "Ran a cron", many: "Ran %n crons", running: "Running the cron…" } }}
  upload={async (file) => ({ url: await myUpload(file) })}     // attachments
  transcribe={async (blob) => myWhisper(blob)}               // voice notes
  onTurnDone={({ text, seconds }) => revalidate()}           // app effects at turn end
  onPermission={(id, optionId) => approve(id, optionId)}     // default: transport.respondPermission
  slots={{ renderDeliveries: (turn) => <MyFiles turn={turn} />, composerExtras: <MyButton /> }}
/>

// From your app: "@" a row into the composer, or ask on behalf of the user.
ref.current?.addReference({ id: "12", label: "#12 Rosa" });
ref.current?.send("Why did this fail?");
```

### Props (all optional except `transport`)

`agentName` · `locale` (`"es"`/`"en"`) · `strings` (override any text) · `theme` · `className` / `style` ·
`welcome` · `avatar` · `placeholder` · `suggestions` · `context` · `initialTurns` · `toolVerbs` · `toolIcons`
(by step `kind` or tool name) · `formatUserText` · `markdown` (`{ transform, onLinkClick }`) · `upload` ·
`transcribe` · `voiceNoteText` · `features` (`attachments`, `retry`, `copy`, `usage`, `models`,
`replyOptions`, `duration`) · `references` / `onReferencesChange` / `onReferenceClick` · `onPermission` ·
`slots` (`renderDeliveries`, `composerExtras`, `emptyState`, `headerActions`, `aboveComposer`) ·
callbacks `onTurnStart`, `onTurnDone`, `onTitle`, `onNeedsLogin`, `onDisconnected`, `onEvent`, `onSend` ·
`pilot` (pass your own `usePilot()` result to read state outside).

## The SSE contract (`createSseTransport(base)`)

- `GET  {base}/events` — named SSE events: `started{latidoMs}`, `status{phase,otraCaja}`, `caps`, `models`,
  `chunk{text,turnId}`, `thought`, `tool{id,title,kind,status,detalle,path}`, `artifact`, `usage`, `title`,
  `permission{id,title,tool,options[]}`, `permission-resolved{id}`, `reemplazo{text}`, `warning`, `error`,
  `done{turnId, reposo?, interrumpido?, ultimo?}`, `closed`, plus the page-builder events.
- `POST {base}/messages` `{content, images, primerTurno, retomar?, context?}` → `{inyectado?, estado?, turnId?}`
- `POST {base}/cancel` · `POST {base}/model {value}` · `POST {base}/permission {id, optionId}` → `{resuelto}`

Any other backend: implement `PilotTransport` (`subscribe`, `send`, `cancel`, optional `setModel`,
`respondPermission`) and emit the same event names.

## Other backend: the POST returns the stream (`createPostStreamTransport(url)`)

For servers where the POST that starts the turn *is* the SSE (the EasyBits admin copilot, most
fetch-based chats), with a GET to re-attach to a live turn:

```tsx
const transport = useMemo(() => createPostStreamTransport("/api/v2/admin/copilot/chat"), []);

<Piloto
  transport={transport}
  context={{ page: "crons", job: selectedJob }}
  // Approvals go through the app's own route, with the session cookie:
  onPermission={async (id, optionId) => {
    const res = await fetch(`/api/v2/admin/agent-actions/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: optionId === "approve" ? "approve" : "reject" }),
    });
    if (res.status === 409 || res.status === 404) return { resolved: false }; // expired / already resolved
    if (!res.ok) throw new Error((await res.json()).error);
    const r = await res.json();
    return { resolved: true, detail: r.status === "executed" ? "ejecutada" : undefined };
  }}
/>
```

- `POST {url} {text, context?, turnId, continueTurnId?}` → SSE `started`, `chunk`, `tool{title,status}` (no id
  needed), `permission{…, expiresAt}`, `done{turnId,text}`, `error` (final), `capacity`, `interrupted{turnId,canContinue}`, `idle`.
  503 is retried with the same `turnId`; 409 `turn_busy` surfaces as an error (the composer won't send
  while a turn runs: `transport.steer === false`).
- `GET {url}?attach=1` → `started`, one `permission` per open card, `snapshot{turnId,text,tools,cortes}`, then live.
  Used on mount and whenever a stream ends without a final event.
- `GET {url}` → `{messages:[{role,text}]}`: loaded as the thread when you don't pass `initialTurns`.
- Cards with `expiresAt` show a countdown, outlive their turn, and once answered are recorded under the
  answer («Aprobaste · …»).

## Skin

`ghostykit/styles.css` is self-contained and scoped under `.piloto`: it works with Tailwind 3, Tailwind 4
or no Tailwind at all. Every color, radius, shadow and border width is a `--piloto-*` variable:

```css
.my-admin .piloto {
  --piloto-accent: #7c3aed;
  --piloto-warning: #fbbf24;
  --piloto-radius-card: 8px;
  --piloto-border-width: 2px;
  --piloto-shadow-card: 5px 5px 0 #fbbf24;
}
```

## License

MIT
