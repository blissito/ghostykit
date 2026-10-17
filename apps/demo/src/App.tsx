// El playground: un panel de crons de mentira a la izquierda (lo que la app ya tiene) y Piloto a la
// derecha. El panel le pasa `context` (qué pantalla y qué fila ves) y referencias con «@».
import { useMemo, useRef, useState } from "react";
import { Piloto, type PilotoHandle, type TurnDoneInfo } from "ghostykit";
import { createMockTransport } from "./mockTransport";

const CRONS = [
  { name: "purge-files", schedule: "cada 7 días", last: "hace 2 h", status: "ok" },
  { name: "purge-notifications", schedule: "diario 03:00", last: "hace 26 h", status: "atrasado" },
  { name: "monitor", schedule: "cada 5 min", last: "hace 4 min", status: "falló" },
];

type Skin = "ghosty" | "easybits" | "neutral";

export function App() {
  const transport = useMemo(() => createMockTransport(), []);
  const pilot = useRef<PilotoHandle>(null);
  // `?skin=easybits&dark=1&lang=en`: para compartir una combinación (y para las capturas).
  const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  const [skin, setSkin] = useState<Skin>((["ghosty", "easybits", "neutral"].includes(q.get("skin") ?? "") ? q.get("skin") : "ghosty") as Skin);
  const [dark, setDark] = useState(q.get("dark") === "1");
  const [locale, setLocale] = useState<"es" | "en">(q.get("lang") === "en" ? "en" : "es");
  const [selected, setSelected] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const onTurnDone = (info: TurnDoneInfo) =>
    setLog((l) => [`onTurnDone · ${info.seconds ?? "?"} s · ${info.text.length} letras${info.interrupted ? " · interrumpido" : ""}`, ...l].slice(0, 4));

  return (
    <div className={`demo ${dark ? "demo-dark" : ""}`}>
      <aside className="panel">
        <header>
          <h1>
            Piloto UI <span>ghostykit</span>
          </h1>
          <p>El copiloto de tu app. Este panel es «tu app»; el chat de la derecha es Piloto con un transporte simulado. Pídele «¿por qué falló el monitor?».</p>
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
