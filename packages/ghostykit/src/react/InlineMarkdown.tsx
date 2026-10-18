// Markdown EN LÍNEA para textos cortos (la narración entre pasos): `código`, **negritas**, *itálicas*
// y [enlaces](https://…). Sin bloques: un renglón de narración nunca trae listas ni tablas, y montar
// Streamdown por cada uno sería caro. Lo que no reconoce se queda como texto.
import { Fragment, type ReactNode } from "react";

const TOKEN = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const t = m[0];
    if (m[1]) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k++}>{renderInline(t.slice(2, -2))}</strong>);
    else if (m[3]) out.push(<em key={k++}>{renderInline(t.slice(1, -1))}</em>);
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t) ?? [];
      out.push(
        <a key={k++} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>,
      );
    }
    last = at + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function InlineMarkdown({ children }: { children: string }) {
  return <Fragment>{renderInline(children)}</Fragment>;
}
