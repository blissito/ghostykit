/**
 * Cuando la ÚLTIMA respuesta, ya terminada, cierra con una oferta («Si quieres, puedo:»,
 * «¿Quieres que…?», «Dos caminos, tú eliges:») seguida de una lista corta, esa lista se pinta como
 * BOTONES: un clic manda la opción como mensaje del usuario, por el camino normal.
 */
export type ReplyOptions = { before: string; items: string[]; numbered: boolean };

const BULLET = /^\s*(?:[-*•+]|(\d{1,2})[.)])\s+(.+?)\s*$/;
const INVITES = /(puedo|quieres|elige|eliges|prefieres|opciones|caminos|can i|would you|want me|choose|prefer|options)/i;

/** ¿El texto termina en una oferta con 2–5 opciones cortas? Si sí, la separa. */
export function extractReplyOptions(text: string): ReplyOptions | null {
  const lines = text.replace(/\s+$/, "").split("\n");
  const items: string[] = [];
  let numbered = false;
  let i = lines.length - 1;
  for (; i >= 0; i--) {
    const m = BULLET.exec(lines[i]);
    if (!m) break;
    if (m[1]) numbered = true;
    items.unshift(m[2]);
  }
  if (items.length < 2 || items.length > 5) return null;
  if (items.some((t) => t.length > 140 || /```|`|https?:\/\/|\]\(/.test(t))) return null;
  // El párrafo de antes (saltando líneas en blanco): termina en «:» o invita a elegir.
  let j = i;
  while (j >= 0 && !lines[j].trim()) j--;
  if (j < 0) return null;
  const invitation = lines[j].trim();
  if (!invitation.endsWith(":") && !INVITES.test(invitation)) return null;
  return { before: lines.slice(0, i + 1).join("\n").trimEnd(), items, numbered };
}

/** La opción como la mandaría una persona: sin «o »/«y », sin negritas ni puntuación final. */
export function cleanReplyOption(t: string): string {
  let s = t.replace(/\*\*|__/g, "").trim();
  s = s.replace(/^(?:o|y|u|or|and)\s+/i, "").replace(/[\s,.;]+$/, "").trim();
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}
