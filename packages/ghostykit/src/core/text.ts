// Lo que se ENSEÑA de un mensaje, sin la fontanería que el cliente le pega al prompt.
import type { Reference } from "./types";

/** El envoltorio de una nota de voz (formato de Ghosty): se queda lo dicho. */
const VOICE_NOTE = /\[Nota de voz transcrita[^\]]*\]\s*«([^»]*)»/;

/** El texto del usuario como se pinta en su burbuja. Las apps afinan con `formatUserText`. */
export function cleanUserText(raw: string): string {
  let t = raw;
  const voice = t.match(VOICE_NOTE);
  if (voice) t = t.replace(voice[0], voice[1]);
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Un turno que abrió la PLATAFORMA y no la persona (una tarea programada, una entrega): empieza
 * con «⏰ ». Se pinta como línea de sistema con sólo la causa, sin las instrucciones al modelo.
 */
export function systemNoteOf(text: string): string | null {
  if (!text.startsWith("⏰ ")) return null;
  const cause = text.match(/^⏰ [^(\n]*\(([^)]+)\)/)?.[1] ?? text.split("\n")[0].replace(/^⏰ /, "").replace(/[.:].*$/, "").slice(0, 60);
  return cause.toLowerCase();
}

/**
 * Las referencias se mandan DENTRO del texto (es lo que el agente lee): primero los renglones con
 * `prompt` (p. ej. un elemento señalado), luego las etiquetas juntas `[#12 Rosa, #7 Javier] `.
 */
export function applyReferences(text: string, refs: Reference[]): string {
  if (!refs.length) return text;
  const lines = refs.filter((r) => r.prompt).map((r) => r.prompt!);
  const labels = refs.filter((r) => !r.prompt).map((r) => r.label);
  let out = text;
  if (labels.length) out = `[${labels.join(", ")}] ${out}`.trim();
  if (lines.length) out = `${lines.join("\n")}\n${out}`;
  return out;
}

/** «45 s», «3 min», «1 h 05 min». */
export function formatDuration(s: number): string {
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}
