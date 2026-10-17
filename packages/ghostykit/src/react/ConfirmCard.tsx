// La tarjeta de aprobación: el agente pidió permiso (evento `permission`) antes de algo riesgoso.
// Aprobar o rechazar llama a `onRespond(id, optionId)` —la app decide cómo: el transporte, o su
// propia ruta de aprobación con la sesión—. Con `expiresAt`, cuenta hacia atrás y al vencer se
// apaga. Ya contestada, la decisión queda anotada en la respuesta (`DecisionLines`).
import { CircleCheck, CircleSlash, Clock, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { expiryMs } from "../core/reducer";
import type { Decision, PermissionOption, PermissionRequest } from "../core/types";
import { usePiloto } from "./context";
import type { PermissionAnswer } from "./usePilot";

/** Las opciones de rechazo van primero y discretas; las de aprobar, al final y en color. */
const isReject = (o: PermissionOption) => /^reject|deny|cancel/i.test(o.kind ?? o.optionId);

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Cuánto le queda a la tarjeta (ms), al segundo. `null` = no vence. */
function useRemaining(expiresAt?: string | number): number | null {
  const end = expiresAt === undefined ? null : expiryMs(expiresAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (end === null || Number.isNaN(end)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [end]);
  return end === null || Number.isNaN(end) ? null : end - now;
}

export function ConfirmCard({
  request,
  onRespond,
  onExpire,
}: {
  request: PermissionRequest;
  onRespond: (id: string, optionId: string) => Promise<PermissionAnswer> | PermissionAnswer;
  /** Venció sin contestarse (la app la retira y la anota como vencida). */
  onExpire?: (id: string) => void;
}) {
  const { strings: t } = usePiloto();
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const remaining = useRemaining(request.expiresAt);
  const expired = remaining !== null && remaining <= 0;

  // Al vencer se queda un momento diciendo «venció» y luego sale (queda anotada en la respuesta).
  useEffect(() => {
    if (!expired || !onExpire) return;
    const id = setTimeout(() => onExpire(request.id), 2500);
    return () => clearTimeout(id);
  }, [expired, onExpire, request.id]);

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
    <div className="piloto-confirm piloto-fade-up rounded-(--piloto-radius-card) border-(length:--piloto-border-width) p-4" data-expired={expired || undefined} role="group" aria-label={t.confirmTitle}>
      <div className="flex items-start gap-3">
        <span className="piloto-confirm-icon grid h-9 w-9 shrink-0 place-items-center rounded-full">
          <ShieldAlert className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t.confirmTitle}</p>
          <p className="mt-0.5 text-[15px] font-medium leading-snug text-text-primary">{request.title}</p>
          {request.tool && <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary">{request.tool}</p>}
        </div>
        {remaining !== null && (
          <span className="piloto-countdown flex shrink-0 items-center gap-1 text-xs tabular-nums text-text-tertiary" aria-live="off">
            <Clock className="h-3.5 w-3.5" />
            {expired ? t.expiredNow : t.expiresIn(mmss(remaining))}
          </span>
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {ordered.map((o) => (
          <button
            key={o.optionId}
            type="button"
            disabled={pending !== null || expired}
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

/** Lo que el usuario decidió en las tarjetas de este turno: «Aprobaste · Correr la purga». */
export function DecisionLines({ decisions }: { decisions: Decision[] }) {
  const { strings: t } = usePiloto();
  if (!decisions.length) return null;
  return (
    <ul className="piloto-decisions mt-2 flex flex-col gap-1">
      {decisions.map((d) => {
        const Icon = d.status === "approved" ? CircleCheck : d.status === "rejected" ? CircleSlash : Clock;
        const label = d.status === "approved" ? t.decisionApproved : d.status === "rejected" ? t.decisionRejected : t.decisionExpired;
        return (
          <li key={d.id} className="piloto-decision piloto-fade-up flex min-w-0 items-center gap-2 text-[13px] text-text-secondary" data-status={d.status}>
            <Icon className={`h-4 w-4 shrink-0 ${d.status === "approved" ? "text-text-success" : d.status === "rejected" ? "text-text-danger" : "text-text-tertiary"}`} />
            <span className="min-w-0 truncate">
              <span className="font-medium text-text-primary">{label}</span> · {d.title}
              {d.detail && <span className="text-text-tertiary"> · {d.detail}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
