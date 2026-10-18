// Chips. PORTADOS de Ghosty Studio: las sugerencias (`Chips` de `EmptyState.tsx`), las referencias del
// tablero (los chips `refs` de `ChatInput.tsx`) y el elemento señalado (`chipSenalado` de `ChatView`).
import { Crosshair, X } from "lucide-react";
import type { Reference } from "../core/types";
import { usePiloto } from "./context";

/**
 * Las referencias del mensaje: chips atómicos con ×. Una con `prompt` (un elemento señalado) se pinta
 * con la mira, como en Ghosty; las demás (tarjetas del tablero), con su etiqueta. Clic = `onActivate`.
 */
export function ReferenceChips({ references, onRemove, onActivate }: { references: Reference[]; onRemove: (id: string) => void; onActivate?: (ref: Reference) => void }) {
  const { strings: t } = usePiloto();
  if (!references.length) return null;
  const pointed = references.filter((r) => r.prompt);
  const plain = references.filter((r) => !r.prompt);
  return (
    <>
      {pointed.map((r) => (
        <div key={r.id} className="mb-2 flex">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-brand-500/40 bg-brand-500/10 py-1 pl-2.5 pr-1 text-xs text-text-primary">
            <Crosshair size={13} className="shrink-0 text-brand-500" />
            <span className="shrink-0 font-semibold">{r.label}</span>
            {r.hint && <span className="truncate text-text-secondary">«{r.hint}»</span>}
            <button
              type="button"
              onClick={() => onRemove(r.id)}
              aria-label={t.removeReference}
              className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full text-text-tertiary hover:bg-background-secondary hover:text-text-primary"
            >
              <X size={12} />
            </button>
          </span>
        </div>
      ))}
      {plain.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {plain.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 rounded-full border border-border-primary bg-background-secondary py-0.5 pl-2 pr-1 text-xs text-text-primary">
              <button type="button" onClick={() => onActivate?.(r)} className="underline-offset-2 hover:underline">
                {r.label}
              </button>
              <button
                type="button"
                onClick={() => onRemove(r.id)}
                aria-label={t.removeReference}
                className="flex h-4 w-4 items-center justify-center rounded-full text-text-tertiary hover:bg-background-tertiary hover:text-text-primary"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** Sugerencias para arrancar. Una que termina en «: » se escribe en la caja en vez de mandarse. */
export function Suggestions({ items, onPick, onPrefill, disabled }: { items: string[]; onPick: (text: string) => void; onPrefill?: (text: string) => void; disabled?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2">
      {items.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => (onPrefill && /:\s*$/.test(c) ? onPrefill(c) : onPick(c))}
          disabled={disabled}
          className="gc-chip rounded-full bg-irongray/10 px-3.5 py-1.5 text-xs font-medium text-metal transition-colors hover:bg-irongray/20 hover:text-dark disabled:opacity-40"
        >
          {c}
        </button>
      ))}
    </div>
  );
}
