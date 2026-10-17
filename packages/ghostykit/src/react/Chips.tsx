// Chips: las referencias que viajan con el mensaje (una tarjeta, un elemento señalado) y las
// sugerencias para arrancar.
import { AtSign, X } from "lucide-react";
import type { Reference } from "../core/types";
import { usePiloto } from "./context";

/** Las referencias del mensaje: chips atómicos con ×. Clic en el chip = `onActivate` (resaltar en la app). */
export function ReferenceChips({
  references,
  onRemove,
  onActivate,
}: {
  references: Reference[];
  onRemove: (id: string) => void;
  onActivate?: (ref: Reference) => void;
}) {
  const { strings: t } = usePiloto();
  if (!references.length) return null;
  return (
    <div className="piloto-references flex flex-wrap gap-1.5">
      {references.map((r) => (
        <span key={r.id} className="piloto-reference inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1 text-xs text-text-primary">
          <AtSign className="h-3 w-3 shrink-0 text-brand-600" />
          <button type="button" onClick={() => onActivate?.(r)} className="shrink-0 font-semibold underline-offset-2 hover:underline">
            {r.label}
          </button>
          {r.hint && <span className="truncate text-text-secondary">«{r.hint}»</span>}
          <button
            type="button"
            onClick={() => onRemove(r.id)}
            aria-label={t.removeReference}
            className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full text-text-tertiary hover:bg-background-secondary hover:text-text-primary"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Sugerencias para arrancar. Una que termina en «: » se escribe en la caja en vez de mandarse. */
export function Suggestions({ items, onPick, onPrefill }: { items: string[]; onPick: (text: string) => void; onPrefill?: (text: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="piloto-suggestions mt-3 flex flex-wrap justify-center gap-2">
      {items.map((s, i) => (
        <button
          key={i}
          type="button"
          onClick={() => (onPrefill && /:\s*$/.test(s) ? onPrefill(s) : onPick(s))}
          className="piloto-suggestion rounded-full border border-border-primary bg-background-primary px-3.5 py-1.5 text-sm text-text-secondary transition-colors hover:border-brand-300 hover:text-text-primary"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
