// Las burbujas del hilo: la del usuario (texto, imágenes, nota de voz, documentos) y la del agente
// (pensamiento, pasos, narración, respuesta al ritmo, opciones, entregas, uso y pie).
import { ArrowUpRight, Check, Coins, Copy, FileText, Gauge, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { splitNarration } from "../core/narration";
import { cleanReplyOption, extractReplyOptions, type ReplyOptions } from "../core/options";
import { systemNoteOf } from "../core/text";
import type { Delivery, Turn, Usage } from "../core/types";
import { usePiloto } from "./context";
import { Markdown } from "./Markdown";
import { AgentSteps, Narration } from "./Steps";
import { useTextAtPace } from "./TextAtPace";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Sin permiso de portapapeles no hay nada que hacer, y avisar de eso no ayuda.
    return false;
  }
}

export function UserBubble({ turn }: { turn: Turn }) {
  const { strings: t, formatUserText } = usePiloto();
  const note = systemNoteOf(turn.text);
  if (note) {
    // Turno abierto por la plataforma (tarea programada, entrega): línea de sistema, no burbuja.
    return (
      <div className="flex justify-center">
        <span className="piloto-system-note max-w-[80%] truncate rounded-full bg-background-secondary px-3 py-1 text-[11px] text-text-tertiary">⏰ {note}</span>
      </div>
    );
  }
  const visible = formatUserText(turn.text);
  const atts = turn.attachments ?? [];
  // Imágenes y notas de voz van dentro de la burbuja; los documentos, como tarjetas encima.
  const inBubble = atts.filter((a) => (a.mimeType.startsWith("image/") && (a.data || a.uri)) || (a.mimeType.startsWith("audio/") && a.uri));
  const docs = atts.filter((a) => !inBubble.includes(a));
  return (
    <div className="piloto-user group/msg flex flex-col items-end gap-1">
      {turn.steer && <span className="text-[11px] text-text-tertiary">↪ {t.steered}</span>}
      {docs.length > 0 && (
        <div className="mb-1 flex max-w-[75%] flex-wrap justify-end gap-2">
          {docs.map((a, i) => (
            <span key={i} className="piloto-attachment-card inline-flex max-w-[16rem] items-center gap-1.5 rounded-(--piloto-radius-input) border border-border-primary bg-background-primary px-2.5 py-1.5 text-xs text-text-secondary">
              <FileText className="h-3.5 w-3.5 shrink-0" />
              {a.uri ? (
                <a href={a.uri} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
                  {a.name ?? a.mimeType}
                </a>
              ) : (
                <span className="truncate">{a.name ?? a.mimeType}</span>
              )}
            </span>
          ))}
        </div>
      )}
      {(inBubble.length > 0 || visible.trim()) && (
        <div className="piloto-bubble-user max-w-[75%] whitespace-pre-wrap break-words rounded-(--piloto-radius-bubble) px-4 py-3 text-[15px] leading-[22px]">
          {inBubble.length > 0 && (
            <div className={`flex flex-wrap justify-end gap-1.5 ${visible.trim() ? "mb-2" : ""}`}>
              {inBubble.map((a, i) =>
                a.mimeType.startsWith("image/") ? (
                  <img key={i} src={a.data ? `data:${a.mimeType};base64,${a.data}` : a.uri} alt="" className="h-20 w-20 rounded-lg object-cover" />
                ) : (
                  <audio key={i} src={a.uri} controls preload="metadata" className="h-9 max-w-[16rem]" />
                ),
              )}
            </div>
          )}
          {visible}
        </div>
      )}
      {visible.trim() && <CopyUserMessage text={visible} />}
    </div>
  );
}

/** Copiar lo que TÚ escribiste: un ícono bajo tu burbuja, al pasar el mouse (fijo en táctil). */
export function CopyUserMessage({ text }: { text: string }) {
  const { strings: t } = usePiloto();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
      aria-label={copied ? t.copied : t.copyMessage}
      title={copied ? t.copied : t.copy}
      className={`piloto-copy-user grid h-7 w-7 place-items-center rounded-md text-text-tertiary transition-opacity hover:bg-background-secondary hover:text-text-primary focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${
        copied ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"
      }`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** La prosa de la respuesta, al ritmo de claude.ai mientras el turno vive. */
function AnswerText({ text, live, whole = false }: { text: string; live: boolean; whole?: boolean }) {
  const { visible, animate } = useTextAtPace(text, live, whole);
  if (!visible) return null;
  return <Markdown animate={animate}>{visible}</Markdown>;
}

/** Las opciones finales de la última respuesta como botones: un clic las manda como tu mensaje. */
export function ReplyOptionButtons({ options, onPick }: { options: ReplyOptions; onPick: (text: string) => void }) {
  const { strings: t } = usePiloto();
  return (
    <ul className="piloto-options mt-3 flex flex-col gap-2" aria-label={t.replyOptions}>
      {options.items.map((item, i) => {
        const clean = cleanReplyOption(item);
        return (
          <li key={i} className="piloto-chunk-in">
            <button
              type="button"
              onClick={() => onPick(clean)}
              className="piloto-option group flex w-full cursor-pointer items-center gap-3 rounded-(--piloto-radius-input) border border-border-primary bg-background-primary px-4 py-2.5 text-left text-sm text-text-primary transition-colors hover:border-brand-300 hover:bg-background-secondary"
            >
              {options.numbered && <span className="shrink-0 tabular-nums text-text-tertiary">{i + 1}.</span>}
              <span className="min-w-0 flex-1">{clean}</span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-text-tertiary transition-colors group-hover:text-text-primary" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Tokens del turno, qué tanto del contexto se llevó y cuánto costó. */
export function UsageStats({ used, size, cost }: Usage) {
  const { strings: t } = usePiloto();
  if (!used && !cost) return null;
  const pct = size > 0 ? Math.min(100, Math.round((used / size) * 100)) : 0;
  return (
    <div className="piloto-usage mt-2 flex items-center gap-4 text-[11px] text-text-tertiary">
      <span className="flex items-center gap-1">
        <Gauge className="h-3 w-3" />
        {used.toLocaleString(t.numberLocale)}
        {size > 0 && ` / ${size.toLocaleString(t.numberLocale)} (${pct}%)`}
      </span>
      {cost > 0 && (
        <span className="flex items-center gap-1">
          <Coins className="h-3 w-3" />
          {cost.toLocaleString(t.numberLocale, { style: "currency", currency: "USD", maximumFractionDigits: 4 })}
        </span>
      )}
    </div>
  );
}

/** El pie de una respuesta terminada: cuánto tardó, copiar y reintentar. */
export function TurnFooter({ text, seconds, onRetry, showCopy = true }: { text: string; seconds?: number; onRetry?: () => void; showCopy?: boolean }) {
  const { strings: t } = usePiloto();
  const [copied, setCopied] = useState(false);
  return (
    <div className="piloto-footer mt-2 flex items-center gap-3 text-xs text-text-tertiary">
      {seconds ? <span>{t.worked(seconds)}</span> : null}
      {showCopy && (
        <button
          type="button"
          onClick={async () => {
            if (await copyText(text)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
          className="flex items-center gap-1 transition-colors hover:text-text-primary"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-text-success" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t.copied : t.copy}
        </button>
      )}
      {onRetry && (
        <button type="button" onClick={onRetry} className="flex items-center gap-1 transition-colors hover:text-text-primary">
          <RotateCcw className="h-3.5 w-3.5" />
          {t.retry}
        </button>
      )}
    </div>
  );
}

/** Las entregas por defecto: una ficha por archivo (las apps pintan las suyas con `renderDeliveries`). */
export function DeliveryChips({ deliveries }: { deliveries: Delivery[] }) {
  const shown = deliveries.filter((d) => !d.capture);
  if (!shown.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {shown.map((d, i) => (
        <span key={i} className="piloto-delivery inline-flex max-w-[16rem] items-center gap-1.5 rounded-(--piloto-radius-input) border border-border-primary px-2 py-1 text-xs text-text-secondary">
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{d.name}</span>
        </span>
      ))}
    </div>
  );
}

export interface AgentBubbleProps {
  turn: Turn;
  /** El turno sigue escribiéndose. */
  live: boolean;
  onRetry?: () => void;
  /** Sólo la ÚLTIMA respuesta, ya terminada: sus opciones finales salen como botones. */
  onOption?: (text: string) => void;
  showUsage?: boolean;
  showCopy?: boolean;
  /** Las entregas (y lo que la app quiera bajo la respuesta). Sin esto, fichas simples. */
  renderDeliveries?: (turn: Turn, live: boolean) => ReactNode;
}

export function AgentBubble({ turn, live, onRetry, onOption, showUsage = true, showCopy = true, renderDeliveries }: AgentBubbleProps) {
  const { strings: t } = usePiloto();
  const narrated = splitNarration(turn.text ?? "", turn.cuts);
  const visible = narrated.rest;
  const options = onOption && !live && visible ? extractReplyOptions(visible) : null;
  return (
    <div className="piloto-agent min-w-0 max-w-[92%]">
      {turn.thought && (
        <details className="piloto-thought mb-3 text-xs text-text-secondary">
          <summary className="cursor-pointer select-none">{t.thinking}</summary>
          <p className="mt-2 whitespace-pre-wrap border-l-2 border-border-secondary pl-3">{turn.thought}</p>
        </details>
      )}
      {turn.tools && turn.tools.length > 0 && <AgentSteps tools={turn.tools} live={live} />}
      {narrated.steps.length > 0 && <Narration steps={narrated.steps} />}
      {options ? (
        <>
          {options.before && <AnswerText text={options.before} live={live} />}
          <ReplyOptionButtons options={options} onPick={onOption!} />
        </>
      ) : (
        // Cada tramo nuevo tras una herramienta monta su propio ritmo (empieza de cero). Lo que llegó
        // entero fuera de un turno se escribe al mismo ritmo; al recargar ya sale completo.
        visible && <AnswerText key={`r${narrated.steps.length}`} text={visible} live={live || !!turn.arrived} whole={!!turn.arrived} />
      )}
      {renderDeliveries ? renderDeliveries(turn, live) : turn.deliveries?.length ? <DeliveryChips deliveries={turn.deliveries} /> : null}
      {showUsage && turn.usage && <UsageStats {...turn.usage} />}
      {turn.text && !live && <TurnFooter text={turn.text} seconds={turn.seconds} onRetry={onRetry} showCopy={showCopy} />}
    </div>
  );
}
