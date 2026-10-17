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

export function splitNarration(text: string, cuts?: number[]): { steps: string[]; rest: string } {
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
        return { steps: chunks.map((t) => t.replace(/\s*\n\s*/g, " ")), rest: text.slice(from).replace(/^\s+/, "") };
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
