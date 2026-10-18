// El playground: un panel de crons de mentira a la izquierda (lo que la app ya tiene) y Piloto a la
// derecha. El panel le pasa `context` (qué pantalla y qué fila ves) y referencias con «@».
import { useEffect, useMemo, useRef, useState } from "react";
import { Piloto, definePlugin, type PilotoHandle, type TurnDoneInfo } from "ghostykit";
import { livePage, modelPicker } from "ghostykit/plugins";
import { createMockTransport, setMockModel } from "./mockTransport";
import { createAgUiTransport } from "ghostykit";

// Todo lo propio de esta app va en plugins, con nombre. Se crean UNA vez, fuera del render.
const crons = definePlugin({
  name: "crons",
  tools: {
    verbs: {
      list_crons: { one: "Revisé los crons", many: "Revisé los crons", running: "Revisando los crons…" },
      get_cron_runs: { one: "Leí el historial", many: "Leí %n historiales", running: "Leyendo el historial…" },
      run_cron: { one: "Corrí un cron", many: "Corrí %n crons", running: "Corriendo el cron…" },
    },
  },
  composer: { attachments: { transcribe: async () => "¿por qué falló el monitor?" } },
  // Un enlace `#cron-<nombre>` en la respuesta es un botón que selecciona ese cron en el panel.
  markdown: {
    components: {
      a: ({ href, children }) =>
        typeof href === "string" && href.startsWith("#cron-") ? (
          <button type="button" className="cta" onClick={() => window.dispatchEvent(new CustomEvent("demo:select", { detail: href.slice(6) }))}>
            {children} →
          </button>
        ) : (
          <a href={String(href)} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
    },
  },
});
const PLUGINS = [crons, modelPicker({ onChange: (value) => setMockModel(value) }), livePage()];

// `?parity=1`: lo mismo que /c de Ghosty, «Mis archivos» incluido.
const misArchivos = definePlugin({
  name: "misArchivos",
  styles: "ghostykit",
  composer: {
    attachments: { upload: async (f) => ({ url: URL.createObjectURL(f) }), transcribe: async () => "" },
    actions: () => (
      <button type="button" aria-label="De mis archivos" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-background-secondary hover:text-text-primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></svg>
      </button>
    ),
  },
});
const PARITY_PLUGINS = [misArchivos];

const CRONS = [
  { name: "purge-files", schedule: "cada 7 días", last: "hace 2 h", status: "ok" },
  { name: "purge-notifications", schedule: "diario 03:00", last: "hace 26 h", status: "atrasado" },
  { name: "monitor", schedule: "cada 5 min", last: "hace 4 min", status: "falló" },
];

type Skin = "ghosty" | "easybits" | "neutral";

export function App() {
  // `?backend=agui&url=http://localhost:8000/agent`: un agente AG-UI de verdad (p. ej. examples/langgraph).
  // Sin eso, el agente de mentira de `mockTransport.ts`.
  const transport = useMemo(() => {
    const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
    const url = q.get("url");
    return q.get("backend") === "agui" && url ? createAgUiTransport({ url, credentials: "omit" }) : createMockTransport();
  }, []);
  const pilot = useRef<PilotoHandle>(null);
  // `?skin=easybits&dark=1&lang=en`: para compartir una combinación (y para las capturas).
  const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  const [skin, setSkin] = useState<Skin>((["ghosty", "easybits", "neutral"].includes(q.get("skin") ?? "") ? q.get("skin") : "ghosty") as Skin);
  const [dark, setDark] = useState(q.get("dark") === "1");
  const [locale, setLocale] = useState<"es" | "en">(q.get("lang") === "en" ? "en" : "es");
  const [selected, setSelected] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [thread, setThread] = useState<string | null>(null);
  useEffect(() => {
    const pick = (e: Event) => setSelected((e as CustomEvent<string>).detail);
    window.addEventListener("demo:select", pick);
    return () => window.removeEventListener("demo:select", pick);
  }, []);

  const onTurnDone = (info: TurnDoneInfo) =>
    setLog((l) => [`onTurnDone · ${info.seconds ?? "?"} s · ${info.text.length} letras${info.interrupted ? " · pide aprobación" : ""}`, ...l].slice(0, 4));

  // `?parity=1`: sólo el chat, con lo mismo que /c de Ghosty, para compararlos lado a lado.
  if (q.get("parity") === "1") {
    return (
      <div style={{ height: "100%" }}>
        <Piloto
          transport={transport}
          agentName="Ghosty"
          skin={skin}
          theme={dark ? "dark" : "light"}
          avatar={<img src="https://formmy.app/logo.png" alt="" width={72} height={72} className="parity-ghost" />}
          welcome="¿Qué estás pensando?"
          suggestions={["Hazme una cotización en PDF", "Arma una landing para mi negocio", "Escribe un mensaje de seguimiento", "Redacta un documento"]}
          plugins={PARITY_PLUGINS}
        />
      </div>
    );
  }

  return (
    <div className={`demo ${dark ? "demo-dark" : ""}`}>
      <aside className="panel">
        <header>
          <h1>
            Ghosty Autopilot <span>ghostykit</span>
          </h1>
          <p>El piloto de tu app: tú dices a dónde, él maneja. Este panel es «tu app»; el chat de la derecha es Piloto con un transporte simulado. Pídele «¿por qué falló el monitor?».</p>
          <p><a href="https://github.com/blissito/ghostykit">github.com/blissito/ghostykit</a> · <code>npm i ghostykit</code></p>
        </header>
        <div className="controls">
          <label>
            Piel
            <select value={skin} onChange={(e) => setSkin(e.target.value as Skin)}>
              <option value="ghosty">Ghosty</option>
              <option value="easybits">EasyBits</option>
              <option value="neutral">Neutral</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> oscuro
          </label>
          <label>
            Idioma
            <select value={locale} onChange={(e) => setLocale(e.target.value as "es" | "en")}>
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
        <h2>Crons</h2>
        <ul className="crons">
          {CRONS.map((c) => (
            <li key={c.name} className={selected === c.name ? "sel" : ""} onClick={() => setSelected(c.name)}>
              <div>
                <strong>{c.name}</strong>
                <small>
                  {c.schedule} · {c.last}
                </small>
              </div>
              <span className={`st st-${c.status}`}>{c.status}</span>
              <button
                type="button"
                title="Mencionar en el chat"
                onClick={(e) => {
                  e.stopPropagation();
                  pilot.current?.addReference({ id: c.name, label: `cron ${c.name}` });
                }}
              >
                @
              </button>
              {c.status === "falló" && (
                <button
                  type="button"
                  className="ask"
                  onClick={(e) => {
                    e.stopPropagation();
                    pilot.current?.send(`¿Por qué falló el ${c.name}?`);
                  }}
                >
                  Pídeselo
                </button>
              )}
            </li>
          ))}
        </ul>
        {thread && (
          <p className="thread">
            threadId <code>{thread}</code>
          </p>
        )}
        <h2>Callbacks</h2>
        <ul className="log">{log.length ? log.map((l, i) => <li key={i}>{l}</li>) : <li>— todavía nada —</li>}</ul>
      </aside>
      <main className="chat">
        <Piloto
          ref={pilot}
          transport={transport}
          agentName="Asistente de admin"
          locale={locale}
          theme={dark ? "dark" : "light"}
          skin={skin}
          welcome={locale === "en" ? "How can I help with your crons?" : "¿En qué te ayudo con tus crons?"}
          suggestions={
            locale === "en"
              ? ["Why did the monitor fail?", "Summarize today's runs", "Explain this to me: "]
              : ["¿Por qué falló el monitor?", "Resume las corridas de hoy", "Explícame esto: "]
          }
          context={() => ({ screen: "Panel de crons", selected })}
          plugins={PLUGINS}
          onTurnDone={onTurnDone}
          threadId={new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("thread") ?? undefined}
          onSend={(input) => setThread(input.threadId)}
        />
      </main>
    </div>
  );
}
