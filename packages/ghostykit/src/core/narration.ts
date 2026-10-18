/**
 * Narración intercalada: lo que el agente dice ANTES de cada herramienta («Reviso tus archivos.»,
 * «Armo el calendario.») es avance, no respuesta. Se pinta como lista con palomitas encima de la
 * respuesta final, como los pasos de claude.ai.
 *
 * Dos fuentes, mismo resultado:
 * - En vivo: el reductor anota en qué largo del texto arrancó cada herramienta (`cuts`).
 * - En la copia guardada: el servidor la escribe como `- ✓ …` al inicio, así la recarga la ve igual.
 */

const MARK = "✓";
const LINE = /^- ✓ (.+)$/;

/** Un tramo es «narración» si es corto y de un solo párrafo; si no, es texto normal. */
export function isNarration(chunk: string): boolean {
  const t = chunk.trim();
  return t.length > 0 && t.length <= 300 && !/\n\s*\n/.test(t) && !t.includes("```");
}

export function splitNarration(text: string, cuts?: number[], closed = false): { steps: string[]; rest: string } {
  if (cuts?.length) {
    const valid = cuts.filter((c) => c > 0 && c <= text.length);
    if (valid.length) {
      const chunks: string[] = [];
      let from = 0;
      for (const c of valid) {
        const t = text.slice(from, c).trim();
        if (t) chunks.push(t);
        from = c;
      }
      if (chunks.every(isNarration)) {
        const rest = text.slice(from).replace(/^\s+/, "");
        // Un turno CERRADO que acabó en un paso (la respuesta se escribió antes de su última
        // herramienta, p. ej. al reconstruirlo de un snapshot): lo último que dijo ES la respuesta,
        // no un avance con palomita.
        if (closed && !rest.trim()) return { steps: chunks.slice(0, -1).map((t) => t.replace(/\s*\n\s*/g, " ")), rest: chunks[chunks.length - 1] };
        return { steps: chunks.map((t) => t.replace(/\s*\n\s*/g, " ")), rest };
      }
    }
    return { steps: [], rest: text };
  }
  const lines = text.split("\n");
  const steps: string[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const m = LINE.exec(lines[i]);
    if (!m) break;
    steps.push(m[1].trim());
  }
  if (!steps.length) return { steps, rest: text };
  return { steps, rest: lines.slice(i).join("\n").replace(/^\s+/, "") };
}

/** La copia que se guarda: narración como `- ✓ …` y luego la respuesta. */
export function narrationToMarkdown(chunks: string[], answer: string): string {
  const steps = chunks.map((t) => t.trim()).filter(Boolean);
  if (!steps.length || !steps.every(isNarration)) return answer;
  const list = steps.map((p) => `- ${MARK} ${p.replace(/\s*\n\s*/g, " ")}`).join("\n");
  return answer.trim() ? `${list}\n\n${answer.trim()}` : list;
}

/** Un bloque con nombre del texto (```eb-file …```) que una app pinta como tarjeta. */
export interface TextBlock {
  lang: string;
  body: string;
  /** El bloque ya cerró (en vivo, uno a medio escribir llega sin cerrar). */
  complete: boolean;
}

/**
 * Saca del texto los bloques ```<lang>``` cuyos nombres se piden (sólo los que abren al inicio de un
 * renglón) y recorre los cortes de la narración para que sigan cayendo donde caían. Uno sin cerrar
 * (todavía se escribe) se saca hasta el final.
 */
export function extractBlocks(text: string, langs: readonly string[], cuts?: number[]): { text: string; cuts?: number[]; blocks: TextBlock[] } {
  if (!langs.length || !text.includes("```")) return { text, cuts, blocks: [] };
  const want = new Set(langs);
  const blocks: TextBlock[] = [];
  const removed: [number, number][] = [];
  const re = /(^|\n)```([\w.-]+)[^\n]*\n([\s\S]*?)(\n```[ \t]*(?=\n|$)|$)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!want.has(m[2])) continue;
    const start = m.index + m[1].length;
    const end = m.index + m[0].length;
    blocks.push({ lang: m[2], body: m[3], complete: Boolean(m[4]) });
    removed.push([start, end]);
  }
  if (!removed.length) return { text, cuts, blocks };
  let out = "";
  let from = 0;
  for (const [a, b] of removed) {
    out += text.slice(from, a);
    from = b;
  }
  out += text.slice(from);
  const shift = (c: number) => c - removed.reduce((n, [a, b]) => n + (c >= b ? b - a : c > a ? c - a : 0), 0);
  return { text: out, ...(cuts ? { cuts: cuts.map(shift) } : {}), blocks };
}
