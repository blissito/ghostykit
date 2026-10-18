// La tarjeta de aprobación — la pieza que distingue a Ghosty Autopilot. El run de AG-UI terminó con
// `outcome: interrupt` y la tarjeta se lee como un PASE: qué quiere hacer el agente, con qué
// herramienta, cuánto le queda (la mecha se consume) y dos salidas. Al contestar cae el SELLO
// («Aprobado», «Rechazado») y luego la tarjeta se recoge en una línea bajo la respuesta.
//
// `onRespond` CONTESTA (el `resume` sale en el siguiente run). `onSettled` llega cuando el sello ya se
// vio: ahí se anota la decisión y la tarjeta sale.
import { CircleCheck, CircleSlash, Clock, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { expiryMs } from "../core/reducer";
import type { Decision, PermissionOption, PermissionRequest } from "../core/types";
import { usePiloto } from "./context";

/** Las opciones de rechazo van primero y discretas; las de aprobar, al final y en color. */
export const isRejectOption = (o: PermissionOption) => /^reject|deny|cancel/i.test(o.kind ?? o.optionId);

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Cuánto le queda (ms), al segundo, y cuánto tenía cuando apareció (para la mecha). */
function useRemaining(expiresAt?: string | number): { left: number; total: number } | null {
  const end = expiresAt === undefined ? NaN : expiryMs(expiresAt);
  const [now, setNow] = useState(() => Date.now());
  const first = useRef<number | null>(null);
  useEffect(() => {
    if (Number.isNaN(end)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [end]);
  if (Number.isNaN(end)) return null;
  if (first.current === null) first.current = Math.max(1, end - now);
  return { left: end - now, total: first.current };
}

/** Cuánto se queda el sello a la vista antes de que la tarjeta se recoja. */
const STAMP_MS = 1100;

type Stamp = Decision["status"];

export function ConfirmCard({
  request,
  onRespond,
  onSettled,
  onExpire,
}: {
  request: PermissionRequest;
  /** Contesta: `approved` viaja como `payload` del `resume`. */
  onRespond: (id: string, approved: boolean) => void;
  /** El sello ya se vio: anotar la decisión y retirar la tarjeta. */
  onSettled?: (id: string, status: Decision["status"]) => void;
  /** Venció sin contestarse. */
  onExpire?: (id: string) => void;
}) {
  const { strings: t } = usePiloto();
  const [pending, setPending] = useState<string | null>(null);
  const [stamp, setStamp] = useState<Stamp | null>(null);
  const time = useRemaining(request.expiresAt);
  const expired = time !== null && time.left <= 0;
  const urgent = time !== null && !expired && time.left < 60_000;

  // Vencida: sello «Vencida» y sale.
  useEffect(() => {
    if (!expired || stamp) return;
    setStamp("expired");
    const id = setTimeout(() => onExpire?.(request.id), STAMP_MS + 600);
    return () => clearTimeout(id);
  }, [expired, stamp, onExpire, request.id]);

  // Rechazar primero y discreto; aprobar al final y en color. Los textos son de la app (`strings`).
  const ordered: PermissionOption[] = [
    { optionId: "reject", name: t.reject, kind: "reject_once" },
    { optionId: "approve", name: t.approve, kind: "allow_once" },
  ];

  const answer = (o: PermissionOption) => {
    setPending(o.optionId);
    const approved = !isRejectOption(o);
    onRespond(request.id, approved);
    const status: Stamp = approved ? "approved" : "rejected";
    setStamp(status);
    setTimeout(() => onSettled?.(request.id, status), STAMP_MS);
  };

  const stampLabel = stamp === "approved" ? t.stampApproved : stamp === "rejected" ? t.stampRejected : stamp === "cancelled" ? t.stampCancelled : t.stampExpired;
  const locked = pending !== null || stamp !== null;

  return (
    <section className="piloto-ticket" data-state={stamp ?? "open"} data-urgent={urgent || undefined} aria-label={t.confirmTitle}>
      <div className="piloto-ticket-head">
        <span className="piloto-ticket-icon" aria-hidden>
          <ShieldAlert className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="piloto-ticket-ask">{t.confirmTitle}</p>
          <p className="piloto-ticket-title">{request.title}</p>
          {request.tool && <code className="piloto-ticket-tool">{request.tool}</code>}
        </div>
      </div>
      <div className="piloto-ticket-tear" aria-hidden />
      <div className="piloto-ticket-foot">
        {time !== null ? (
          <span className="piloto-ticket-clock" title={t.expiresIn(mmss(time.left))} aria-label={expired ? t.expiredNow : t.expiresIn(mmss(time.left))}>
            <Clock className="h-4 w-4" aria-hidden />
            {mmss(time.left)}
          </span>
        ) : (
          <span />
        )}
        <div className="piloto-ticket-actions">
          {ordered.map((o) => (
            <button
              key={o.optionId}
              type="button"
              disabled={locked || expired}
              onClick={() => answer(o)}
              className={isRejectOption(o) ? "piloto-btn piloto-btn-quiet" : "piloto-btn piloto-btn-go"}
              aria-busy={pending === o.optionId || undefined}
            >
              {o.name}
            </button>
          ))}
        </div>
      </div>
      {time !== null && (
        <div className="piloto-fuse" aria-hidden>
          <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, time.left / time.total))})` }} />
        </div>
      )}
      {stamp && (
        <span className="piloto-stamp" data-kind={stamp} role="status">
          {stampLabel}
        </span>
      )}
    </section>
  );
}

/** Lo que el usuario decidió en las tarjetas de este turno: «Aprobaste: correr la purga». */
export function DecisionLines({ decisions }: { decisions: Decision[] }) {
  const { strings: t } = usePiloto();
  if (!decisions.length) return null;
  return (
    <ul className="piloto-decisions">
      {decisions.map((d) => {
        const Icon = d.status === "approved" ? CircleCheck : d.status === "expired" ? Clock : CircleSlash;
        const label = d.status === "approved" ? t.decisionApproved : d.status === "rejected" ? t.decisionRejected : d.status === "cancelled" ? t.decisionCancelled : t.decisionExpired;
        return (
          <li key={d.id} className="piloto-decision" data-status={d.status}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0">
              <strong>{label}:</strong> {d.title}
              {d.detail && <span className="piloto-decision-detail"> ({d.detail})</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
