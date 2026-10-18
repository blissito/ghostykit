// Lo que se ve mientras el agente todavía no contesta. PORTADO de Ghosty Studio (`WaitLabel` y los
// puntitos `gc-typing` de `ChatView.tsx`, y `ConnectingState.tsx`) con el mismo markup; los textos
// salen de `strings` y la cara del agente, de `avatar`.
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { formatDuration } from "../core/text";
import type { ConnectPhase } from "../core/types";
import { usePiloto } from "./context";

/** Segundos en «despertando» tras los que se da el turno por perdido. */
const WAKING_GIVEUP_S = 45;
/** Pasado esto, la frase propia ya no es honesta: el agente lleva rato trabajando. */
const STILL_WORKING_S = 90;

/** Los tres puntitos de «escribiendo» (color y animación en CSS: `gc-typing`). */
export function TypingDots() {
  return (
    <div className="gc-typing flex gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="gc-typing-dot h-2 w-2 animate-bounce rounded-full" style={{ "--i": i } as CSSProperties} />
      ))}
    </div>
  );
}

export function WaitLabel({
  phase,
  since,
  elsewhere,
  onLost,
  showDuration = true,
}: {
  phase: ConnectPhase;
  /** Desde que se MANDÓ el mensaje (no desde que se montó la etiqueta). */
  since?: number | null;
  elsewhere?: boolean;
  onLost?: () => void;
  showDuration?: boolean;
}) {
  const { strings: t } = usePiloto();
  const [mounted] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - (since || mounted)) / 1000));
  const phrases = t.thinkingPhrases;
  const what =
    phase !== "session"
      ? t.waitPhase[phase]
      : phrases?.length
        ? elsewhere || seconds >= STILL_WORKING_S
          ? t.stillWorking
          : phrases[Math.floor(seconds / 4) % phrases.length]
        : elsewhere
          ? t.stillWorking
          : t.howItGoes(seconds);
  const lost = phase === "waking" && seconds >= WAKING_GIVEUP_S;
  return (
    <div className="flex flex-col gap-0.5 text-sm text-text-secondary">
      {lost ? (
        <p className="text-text-primary">
          {t.cantStart}{" "}
          <button type="button" onClick={onLost} className="cursor-pointer underline underline-offset-2">
            {t.retry}
          </button>
        </p>
      ) : (
        // La frase cambia con fundido (sale y entra), como en claude.ai.
        <p className="flex items-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              className="gc-wait-text"
              key={what}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              {what}
            </motion.span>
          </AnimatePresence>
          {showDuration && <span className="tabular-nums text-text-tertiary">&nbsp;· {formatDuration(seconds)}</span>}
        </p>
      )}
    </div>
  );
}

const PHASES: ConnectPhase[] = ["waking", "connecting", "session"];

/** Lo que ocupa el hilo mientras se conecta: tres pasos reales en vez de un «Conectando…» mudo. */
export function ConnectingState({ phase, error, avatar, onRetry }: { phase: ConnectPhase; error: string | null; avatar?: ReactNode; onRetry?: () => void }) {
  const { strings: t } = usePiloto();
  const current = PHASES.indexOf(phase);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      className="flex min-h-[50vh] flex-col items-center justify-center gap-8 text-center"
    >
      <div className="relative flex h-20 w-20 items-center justify-center">
        {!error &&
          [0, 1].map((i) => (
            <motion.span
              key={i}
              className="absolute inset-0 rounded-full border border-border-primary"
              initial={{ scale: 0.6, opacity: 0.8 }}
              animate={{ scale: 1.6, opacity: 0 }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut", delay: i * 1.1 }}
            />
          ))}
        <motion.div
          className="grid h-12 w-12 place-items-center"
          animate={error ? { scale: 1, filter: "grayscale(1)" } : { scale: [1, 1.06, 1] }}
          transition={error ? { duration: 0.3 } : { duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        >
          {avatar ?? <span className="h-12 w-12 rounded-full bg-brand-500" />}
        </motion.div>
      </div>
      <ol className="flex flex-col gap-3 text-left">
        {t.connectSteps.map((step, i) => {
          const done = !error && i < current;
          const active = !error && i === current;
          const failed = !!error && i === current;
          return (
            <li key={i} className="flex items-center gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <AnimatePresence mode="wait" initial={false}>
                  {done ? (
                    <motion.span key="done" initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex h-5 w-5 items-center justify-center rounded-full bg-background-success">
                      <Check className="h-3 w-3 text-text-success" strokeWidth={3} />
                    </motion.span>
                  ) : active ? (
                    <motion.span
                      key="active"
                      className="h-2.5 w-2.5 rounded-full bg-text-primary"
                      animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                    />
                  ) : failed ? (
                    <span key="failed" className="h-2.5 w-2.5 rounded-full bg-text-danger" />
                  ) : (
                    <span key="idle" className="h-2 w-2 rounded-full bg-border-primary" />
                  )}
                </AnimatePresence>
              </span>
              <div className="leading-tight">
                <p className={`text-sm ${active || failed ? "text-text-primary" : done ? "text-text-secondary" : "text-text-tertiary"}`}>
                  {step.label}
                  {active && (
                    <motion.span
                      className="inline-block w-4 text-left"
                      animate={{ opacity: [0, 1, 1, 0] }}
                      transition={{ duration: 1.4, repeat: Infinity, times: [0, 0.2, 0.8, 1] }}
                    >
                      …
                    </motion.span>
                  )}
                </p>
                {active && <p className="text-xs text-text-tertiary">{step.hint}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {error && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex max-w-md flex-col items-center gap-3">
          <p className="text-sm text-text-danger">{error}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="rounded-full border border-border-primary px-4 py-1.5 text-sm text-text-primary hover:bg-background-secondary">
              {t.connectRetry}
            </button>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
