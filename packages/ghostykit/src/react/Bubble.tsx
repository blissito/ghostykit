// Las burbujas del hilo. PORTADAS de Ghosty Studio (`Bubble` de `ChatView.tsx`, `TurnFooter.tsx`,
// `OpcionesDeRespuesta.tsx`, `MessageUsageStats.tsx`) con el MISMO markup y clases. Lo propio de cada
// app bajo la respuesta llega por `renderDeliveries` (en <Piloto>, de los plugins).
import { ArrowUpRight, Check, Coins, Copy, Gauge, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { extractBlocks, splitNarration, type TextBlock } from "../core/narration";
import { cleanReplyOption, extractReplyOptions, type ReplyOptions } from "../core/options";
import { systemNoteOf } from "../core/text";
import type { Turn, Usage } from "../core/types";
import { DecisionLines } from "./ConfirmCard";
import { TurnContext, usePiloto } from "./context";
import { Markdown } from "./Markdown";
import { AgentSteps, Narration } from "./Steps";
import { useTextAtPace } from "./TextAtPace";

/** La prosa de la respuesta, al ritmo de claude.ai mientras el turno vive. */
function AnswerText({ text, live, whole = false }: { text: string; live: boolean; whole?: boolean }) {
  const { visible, animate } = useTextAtPace(text, live, whole);
  if (!visible) return null;
  return (
    <div className="gs-prosa">
      <Markdown animate={animate}>{visible}</Markdown>
    </div>
  );
}

export function UserBubble({ turn }: { turn: Turn }) {
  const { strings: t, formatUserText } = usePiloto();
  const note = systemNoteOf(turn.text);
  if (note) {
    // Turno abierto por la plataforma (tarea programada, entrega): línea de sistema, no burbuja.
    return (
      <div className="flex justify-center">
        <span className="max-w-[80%] truncate rounded-full bg-background-secondary px-3 py-1 text-[11px] text-text-tertiary">⏰ {note}</span>
      </div>
    );
  }
  const visible = formatUserText(turn.text);
  const atts = turn.attachments ?? [];
  // Imágenes y notas de voz van dentro de la burbuja; los documentos, como tarjetas encima.
  const inBubble = atts.filter((a) => (a.mimeType.startsWith("image/") && (a.data || a.url)) || (a.mimeType.startsWith("audio/") && a.url));
  const docs = atts.filter((a) => !inBubble.includes(a));
  return (
    <div className="group/msg flex flex-col items-end gap-1">
      {docs.length > 0 && (
        <div className="mb-1 flex max-w-[75%] flex-wrap justify-end gap-2">
          {docs.map((a, i) => (
            <a
              key={i}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-border-primary px-2 py-1 text-xs text-text-tertiary"
            >
              <span aria-hidden>📄</span>
              <span className="truncate">{a.name ?? a.mimeType}</span>
            </a>
          ))}
        </div>
      )}
      {(inBubble.length > 0 || visible.trim()) && (
        <div className="gc-msg-user max-w-[75%] whitespace-pre-wrap break-words rounded-(--piloto-radius-bubble) bg-(--piloto-user-bubble) px-4 py-3 font-sans text-base leading-[22px] text-(--piloto-user-text)">
          {inBubble.length > 0 && (
            <div className={`flex flex-wrap justify-end gap-1.5 ${visible.trim() ? "mb-2" : ""}`}>
              {inBubble.map((a, i) =>
                a.mimeType.startsWith("image/") ? (
                  <img key={i} src={a.data ? `data:${a.mimeType};base64,${a.data}` : a.url} alt="" className="h-20 w-20 rounded-lg object-cover" />
                ) : (
                  <audio key={i} src={a.url} controls preload="metadata" className="h-9 max-w-[16rem]" />
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
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* sin portapapeles: el texto sigue seleccionable */
        }
      }}
      aria-label={copied ? t.copied : t.copyMessage}
      title={copied ? t.copied : t.copy}
      className={`grid h-7 w-7 place-items-center rounded-md text-text-tertiary transition-opacity hover:bg-black/5 hover:text-text-primary focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${
        copied ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"
      }`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Las opciones finales de la última respuesta como botones: un clic las manda como tu mensaje. */
export function ReplyOptionButtons({ options, onPick }: { options: ReplyOptions; onPick: (text: string) => void }) {
  const { strings: t } = usePiloto();
  return (
    <ul className="mt-3 flex flex-col gap-2" aria-label={t.replyOptions}>
      {options.items.map((item, i) => {
        const clean = cleanReplyOption(item);
        return (
          <li key={i} style={{ animation: "gs-tramo 400ms linear both" }}>
            <button
              type="button"
              onClick={() => onPick(clean)}
              className="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border-primary bg-background-primary px-4 py-2.5 text-left font-sans text-sm text-text-primary transition-colors hover:border-brand-300 hover:bg-background-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
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
    <div className="mt-2 flex items-center gap-4 text-[11px] text-text-tertiary">
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
export function TurnFooter({ text, seconds, onRetry, showCopy = true, showDuration = true }: { text: string; seconds?: number; onRetry?: () => void; showCopy?: boolean; showDuration?: boolean }) {
  const { strings: t } = usePiloto();
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-3 text-xs text-text-tertiary">
      {seconds && showDuration ? <span>{t.worked(seconds)}</span> : null}
      {showCopy && (
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* sin permiso de portapapeles */
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

export interface AgentBubbleProps {
  turn: Turn;
  /** El turno sigue escribiéndose. */
  live: boolean;
  onRetry?: () => void;
  /** Sólo la ÚLTIMA respuesta, ya terminada: sus opciones finales salen como botones. */
  onOption?: (text: string) => void;
  showUsage?: boolean;
  showCopy?: boolean;
  showDuration?: boolean;
  /** Lo que la app quiera pintar bajo la respuesta (archivos, tarjetas propias). */
  renderDeliveries?: (turn: Turn, live: boolean) => ReactNode;
  /** Vistas propias de las herramientas, justo bajo los pasos. */
  renderTools?: (turn: Turn, live: boolean) => ReactNode;
  /** Antes del texto de la respuesta, bajo sus pasos. */
  renderBefore?: (turn: Turn, live: boolean) => ReactNode;
  /** `false`: el texto antes de cada herramienta NO se vuelve paso con palomita (todo es respuesta). */
  narration?: boolean;
  /** El avatar del agente a la izquierda de la respuesta. */
  avatar?: ReactNode;
  /** Bloques con nombre (```eb-file```) que salen del texto y se pintan como tarjetas bajo la respuesta. */
  blocks?: { langs: string[]; render: (blocks: TextBlock[], turn: Turn, live: boolean) => ReactNode };
}

export function AgentBubble(props: AgentBubbleProps) {
  const { turn, avatar } = props;
  const body = <AgentBody {...props} showUsage={props.showUsage ?? true} showCopy={props.showCopy ?? true} showDuration={props.showDuration ?? true} />;
  return (
    <TurnContext.Provider value={turn}>
    {avatar ? (
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{avatar}</div>
        {body}
      </div>
    ) : (
      body
    )}
    </TurnContext.Provider>
  );
}

function AgentBody({ turn, live, onRetry, onOption, showUsage, showCopy, showDuration, renderDeliveries, renderTools, renderBefore, blocks, narration = true }: AgentBubbleProps) {
  const { strings: t } = usePiloto();
  const extracted = blocks ? extractBlocks(turn.text ?? "", blocks.langs, turn.cuts) : { text: turn.text ?? "", cuts: turn.cuts, blocks: [] };
  // Cerrado y sin pasos esperando aprobación: si acabó en un paso, lo último que dijo es la respuesta.
  const closed = !live && !turn.tools?.some((x) => x.status === "pending");
  const narrated = narration ? splitNarration(extracted.text, extracted.cuts, closed) : { steps: [] as string[], rest: extracted.text };
  const visible = narrated.rest;
  // «Si quieres, puedo: …» al final de la última respuesta → botones.
  const options = onOption && !live && visible ? extractReplyOptions(visible) : null;
  return (
    <div className="gc-msg-agent min-w-0 max-w-[90%]">
      {turn.thought && (
        <details className="mb-3 text-xs text-text-secondary">
          <summary className="cursor-pointer select-none">{t.thinking}</summary>
          <p className="mt-2 whitespace-pre-wrap border-l-2 border-border-secondary pl-3">{turn.thought}</p>
        </details>
      )}
      {turn.tools && turn.tools.length > 0 && <AgentSteps tools={turn.tools} live={live} />}
      {turn.tools && turn.tools.length > 0 && renderTools?.(turn, live)}
      {renderBefore?.(turn, live)}
      {narrated.steps.length > 0 && <Narration steps={narrated.steps} />}
      {options ? (
        <>
          {options.before && <AnswerText text={options.before} live={live} />}
          <ReplyOptionButtons options={options} onPick={onOption!} />
        </>
      ) : (
        // Cada tramo nuevo tras una herramienta monta su propio ritmo (empieza de cero).
        visible && <AnswerText key={`r${narrated.steps.length}`} text={visible} live={live} />
      )}
      {extracted.blocks.length > 0 && blocks!.render(extracted.blocks, turn, live)}
      {renderDeliveries?.(turn, live)}
      {turn.decisions?.length ? <DecisionLines decisions={turn.decisions} /> : null}
      {showUsage && turn.usage && <UsageStats {...turn.usage} />}
      {turn.text && !live && <TurnFooter text={turn.text} seconds={turn.seconds} onRetry={onRetry} showCopy={showCopy} showDuration={showDuration} />}
    </div>
  );
}
