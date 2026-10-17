// Lo que se ve mientras el agente todavía no contesta: los puntos con la frase de espera, y el
// estado de conexión con sus tres pasos reales.
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatDuration } from "../core/text";
import type { ConnectPhase } from "../core/types";
import { usePiloto } from "./context";

/** Segundos en «despertando» tras los que se da el turno por perdido. */
const WAKING_GIVEUP_S = 45;
/** Pasado esto, la frase ya no es «estoy leyendo»: el agente lleva rato trabajando. */
const STILL_WORKING_S = 90;

/** Los tres puntos de «escribiendo». Color y animación por CSS (`.piloto-typing`). */
export function TypingDots() {
  return (
    <div className="piloto-typing" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="piloto-typing-dot" />
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
        ? // Frases propias de la app (el widget de un cliente): rotan cada 4 s.
          elsewhere || seconds >= STILL_WORKING_S
          ? t.stillWorking
          : phrases[Math.floor(seconds / 4) % phrases.length]
        : elsewhere
          ? t.stillWorking
          : t.howItGoes(seconds);
  const lost = phase === "waking" && seconds >= WAKING_GIVEUP_S;
  return (
    <div className="piloto-wait flex flex-col gap-0.5 text-sm text-text-secondary">
      {lost ? (
        <p className="text-text-primary">
          {t.cantStart}{" "}
          <button type="button" onClick={onLost} className="cursor-pointer underline underline-offset-2">
            {t.retry}
          </button>
        </p>
      ) : (
        // La frase cambia con fundido (sale y entra): de golpe se leía brusco.
        <p className="flex items-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={what} className="piloto-wait-text" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: "easeInOut" }}>
              {what}
            </motion.span>
          </AnimatePresence>
          {showDuration && <span className="piloto-wait-time">{formatDuration(seconds)}</span>}
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
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="piloto-connecting flex min-h-[40vh] flex-col items-center justify-center gap-8 text-center">
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
          {avatar ?? <span className="piloto-avatar-default" />}
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
                {done ? (
                  <span className="piloto-pop flex h-5 w-5 items-center justify-center rounded-full bg-background-success">
                    <Check className="h-3 w-3 text-text-inverse" strokeWidth={3} />
                  </span>
                ) : active ? (
                  <span className="piloto-pulse h-2.5 w-2.5 rounded-full bg-text-primary" />
                ) : failed ? (
                  <span className="h-2.5 w-2.5 rounded-full bg-text-danger" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-border-primary" />
                )}
              </span>
              <div className="leading-tight">
                <p className={`text-sm ${active || failed ? "text-text-primary" : done ? "text-text-secondary" : "text-text-tertiary"}`}>
                  {step.label}
                  {active && <span className="piloto-ellipsis inline-block w-4 text-left">…</span>}
                </p>
                {active && <p className="text-xs text-text-tertiary">{step.hint}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {error && (
        <div className="flex max-w-md flex-col items-center gap-3">
          <p className="text-sm text-text-danger">{error}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="rounded-full border border-border-primary px-4 py-1.5 text-sm text-text-primary hover:bg-background-secondary">
              {t.connectRetry}
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
