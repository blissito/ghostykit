// El playground: un panel de crons de mentira a la izquierda (lo que la app ya tiene) y Piloto a la
// derecha. El panel le pasa `context` (qué pantalla y qué fila ves) y referencias con «@».
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Piloto, type PilotoHandle, type TurnDoneInfo } from "ghostykit";
import { createMockTransport } from "./mockTransport";

const CRONS = [
  { name: "purge-files", schedule: "cada 7 días", last: "hace 2 h", status: "ok" },
  { name: "purge-notifications", schedule: "diario 03:00", last: "hace 26 h", status: "atrasado" },
  { name: "monitor", schedule: "cada 5 min", last: "hace 4 min", status: "falló" },
];

type Skin = "ghosty" | "easybits";
const SKINS: Record<Skin, CSSProperties> = {
  ghosty: {},
  // EasyBits: morado y ámbar sobre casi negro, bordes gruesos y sombra dura.
  easybits: {
    "--piloto-bg": "#0b0b0f",
    "--piloto-surface": "#15151c",
    "--piloto-surface-2": "#22222c",
    "--piloto-text": "#f4f4f6",
    "--piloto-text-2": "#c4c4cc",
    "--piloto-text-3": "#8a8a96",
    "--piloto-border": "#2e2e3a",
    "--piloto-border-2": "#23232d",
    "--piloto-inverse": "#f4f4f6",
    "--piloto-text-inverse": "#0b0b0f",
    "--piloto-accent": "#7c3aed",
    "--piloto-accent-strong": "#7c3aed",
    "--piloto-accent-soft": "#a78bfa",
    "--piloto-warning": "#fbbf24",
    "--piloto-user-bubble": "#7c3aed",
    "--piloto-user-text": "#ffffff",
    "--piloto-radius-bubble": "6px",
    "--piloto-radius-card": "8px",
    "--piloto-radius-input": "10px",
    "--piloto-radius-button": "6px",
    "--piloto-border-width": "2px",
    "--piloto-shadow-card": "5px 5px 0 #fbbf24",
    "--piloto-shadow-input": "5px 5px 0 #7c3aed",
  } as CSSProperties,
};

export function App() {
  const transport = useMemo(() => createMockTransport(), []);
  const pilot = useRef<PilotoHandle>(null);
  const [skin, setSkin] = useState<Skin>("ghosty");
  const [dark, setDark] = useState(false);
  const [locale, setLocale] = useState<"es" | "en">("es");
  const [selected, setSelected] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const onTurnDone = (info: TurnDoneInfo) =>
    setLog((l) => [`onTurnDone · ${info.seconds ?? "?"} s · ${info.text.length} letras${info.interrupted ? " · interrumpido" : ""}`, ...l].slice(0, 4));

  return (
    <div className={`demo ${skin === "easybits" || dark ? "demo-dark" : ""}`}>
      <aside className="panel">
        <header>
          <h1>
            Piloto UI <span>ghostykit</span>
          </h1>
          <p>El copiloto de tu app. Este panel es «tu app»; el chat de la derecha es Piloto con un transporte simulado.</p>
        </header>
        <div className="controls">
          <label>
            Piel
            <select value={skin} onChange={(e) => setSkin(e.target.value as Skin)}>
              <option value="ghosty">Ghosty</option>
              <option value="easybits">EasyBits</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} disabled={skin === "easybits"} /> oscuro
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
        <h2>Callbacks</h2>
        <ul className="log">{log.length ? log.map((l, i) => <li key={i}>{l}</li>) : <li>— todavía nada —</li>}</ul>
      </aside>
      <main className="chat">
        <Piloto
          ref={pilot}
          transport={transport}
          agentName="Asistente de admin"
          locale={locale}
          theme={skin === "easybits" || dark ? "dark" : "light"}
          style={SKINS[skin]}
          welcome={locale === "en" ? "How can I help with your crons?" : "¿En qué te ayudo con tus crons?"}
          suggestions={
            locale === "en"
              ? ["Why did the monitor fail?", "Summarize today's runs", "Explain this to me: "]
              : ["¿Por qué falló el monitor?", "Resume las corridas de hoy", "Explícame esto: "]
          }
          context={() => ({ screen: "Panel de crons", selected })}
          toolVerbs={{
            list_crons: { one: "Revisé los crons", many: "Revisé los crons", running: "Revisando los crons…" },
            get_cron_runs: { one: "Leí el historial", many: "Leí %n historiales", running: "Leyendo el historial…" },
            run_cron: { one: "Corrí un cron", many: "Corrí %n crons", running: "Corriendo el cron…" },
          }}
          onTurnDone={onTurnDone}
          transcribe={async () => "¿por qué falló el monitor?"}
        />
      </main>
    </div>
  );
}
