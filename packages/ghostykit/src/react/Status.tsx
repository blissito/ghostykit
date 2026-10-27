// Lo que se ve mientras el agente todavía no contesta. PORTADO de Ghosty Studio (`WaitLabel` y los
// puntitos `gc-typing` de `ChatView.tsx`) con el mismo markup; los textos salen de `strings`.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type CSSProperties } from "react";
import { formatDuration } from "../core/text";
import { usePiloto } from "./context";

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
  since,
  showDuration = true,
  step,
  text,
}: {
  /** Frase fija que gana a las del turno (p. ej. «2 ayudantes trabajando» con el run ya cerrado). */
  text?: string | null;
  /** El paso con nombre en curso (`STEP_STARTED`): si `strings.steps` lo nombra, esa es la frase. */
  step?: string | null;
  /** Desde que se MANDÓ el mensaje (no desde que se montó la etiqueta). */
  since?: number | null;
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
  const stepText = step ? t.steps?.[step] : undefined;
  const what = text ? text : stepText ? stepText : phrases?.length ? (seconds >= STILL_WORKING_S ? t.stillWorking : phrases[Math.floor(seconds / 4) % phrases.length]) : t.howItGoes(seconds);
  return (
    <div className="flex flex-col gap-0.5 text-sm text-text-secondary">
      {/* La frase cambia con fundido (sale y entra), como en claude.ai. */}
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
    </div>
  );
}
