// La tarjeta de aprobación: el agente pidió permiso (evento `permission`) y el turno está DETENIDO
// hasta que alguien conteste. Aprobar o rechazar llama a `onRespond(id, optionId)`; el stream la
// retira con `permission-resolved` (que además cubre que conteste otra pantalla).
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import type { PermissionOption, PermissionRequest } from "../core/types";
import { usePiloto } from "./context";

/** Las opciones de rechazo van a la izquierda y discretas; las de aprobar, al final y en color. */
const isReject = (o: PermissionOption) => /^reject|deny|cancel/i.test(o.kind ?? o.optionId);

export function ConfirmCard({
  request,
  onRespond,
}: {
  request: PermissionRequest;
  onRespond: (id: string, optionId: string) => Promise<{ resolved: boolean } | void> | void;
}) {
  const { strings: t } = usePiloto();
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Sin opciones del agente (no debería pasar), se ofrecen las dos de siempre.
  const options: PermissionOption[] = request.options.length
    ? request.options
    : [
        { optionId: "reject", name: t.reject, kind: "reject_once" },
        { optionId: "allow", name: t.approve, kind: "allow_once" },
      ];
  const ordered = [...options.filter(isReject), ...options.filter((o) => !isReject(o))];

  const answer = async (o: PermissionOption) => {
    setPending(o.optionId);
    setProblem(null);
    try {
      const r = await onRespond(request.id, o.optionId);
      if (r && r.resolved === false) setProblem(t.confirmExpired);
    } catch {
      setProblem(t.confirmFailed);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="piloto-confirm piloto-fade-up rounded-(--piloto-radius-card) border-(length:--piloto-border-width) p-4" role="group" aria-label={t.confirmTitle}>
      <div className="flex items-start gap-3">
        <span className="piloto-confirm-icon grid h-9 w-9 shrink-0 place-items-center rounded-full">
          <ShieldAlert className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t.confirmTitle}</p>
          <p className="mt-0.5 text-[15px] font-medium leading-snug text-text-primary">{request.title}</p>
          {request.tool && <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary">{request.tool}</p>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {ordered.map((o) => (
          <button
            key={o.optionId}
            type="button"
            disabled={pending !== null}
            onClick={() => void answer(o)}
            className={`${isReject(o) ? "piloto-secondary" : "piloto-primary"} rounded-(--piloto-radius-button) px-4 py-2 text-sm font-medium transition disabled:opacity-50`}
          >
            {pending === o.optionId ? "…" : o.name}
          </button>
        ))}
      </div>
      {problem && <p className="mt-2 text-xs text-text-danger">{problem}</p>}
    </div>
  );
}
