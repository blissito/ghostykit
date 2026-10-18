/**
 * El texto del agente entrando como en claude.ai, con los números MEDIDOS en su página:
 *
 * - Lo que llega se guarda y se suelta en TRAMOS de ~16–21 letras cortados en límite de palabra,
 *   uno cada ~130 ms, parejo aunque la red llegue a ráfagas. Si el atraso pasa de ~300 letras, el
 *   intervalo se acorta en proporción.
 * - Cada tramo es un `<span>` con opacidad 0 → 1 LINEAL de 400 ms. Los tramos se solapan (la ola).
 *   Lo ya visible nunca se re-anima.
 * - Al cerrar el turno, el resto entra como UN tramo. Lo que ya estaba al abrir el hilo se pinta de
 *   una, sin animación.
 *
 * Sólo se re-renderiza al soltar un tramo (~8 veces por segundo) y Streamdown memoiza por bloque:
 * sólo se vuelve a parsear el ÚLTIMO. Un plugin rehype por bloque cuenta las letras pintadas; las
 * nuevas desde el render anterior son el tramo nuevo.
 */
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Block, type BlockProps } from "streamdown";

/** 400 ms lineal, como claude.ai. */
export const CHUNK_MS = 400;
const LETTERS_PER_CHUNK = 20;
const INTERVAL = 130;
/** Sin texto nuevo por este rato, lo que falte se suelta completo. */
const QUIET_MS = 600;

/** Fin del siguiente tramo desde `from`: ~20 letras cortadas en el primer límite de palabra. */
function chunkEnd(c: string, from: number, complete: boolean): number | null {
  if (from >= c.length) return null;
  let i = from;
  let lastBoundary: number | null = null;
  const blank = (ch: string) => ch === " " || ch === "\n" || ch === "\t" || ch === "\r";
  while (i < c.length) {
    while (i < c.length && blank(c[i])) i++;
    while (i < c.length && !blank(c[i])) i++;
    if (i >= c.length) break;
    // Los blancos que siguen, sin pasar de un salto de línea (abre bloque).
    while (i < c.length && blank(c[i]) && c[i] !== "\n") i++;
    lastBoundary = i;
    if (i - from >= LETTERS_PER_CHUNK) return i;
  }
  return complete ? lastBoundary : c.length;
}

/**
 * Cuánto del texto se enseña ya. Sólo anima si el turno estaba VIVO al montar.
 * `whole`: llegó completo de una vez (el remate de los subagentes): se escribe tramo a tramo hasta
 * el final, sin la regla de «quieto 600 ms = suelta el resto».
 */
export function useTextAtPace(text: string, live: boolean, whole = false): { visible: string; animate: boolean } {
  const animate = useRef<boolean | null>(null);
  if (animate.current === null) {
    const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    animate.current = live && !still;
  }
  const [released, setReleased] = useState(animate.current ? 0 : text.length);
  const textRef = useRef(text);
  textRef.current = text;
  const liveRef = useRef(live);
  liveRef.current = live;
  const releasedRef = useRef(released);
  releasedRef.current = released;

  useEffect(() => {
    if (!animate.current) return;
    let last = 0;
    // Si el texto se queda quieto (el agente se puso a usar herramientas), la última palabra se
    // suelta aunque no la siga un espacio.
    let len = textRef.current.length;
    let changed = performance.now();
    const id = window.setInterval(() => {
      const t = textRef.current;
      if (t.length !== len) {
        len = t.length;
        changed = performance.now();
      }
      const s = Math.min(releasedRef.current, t.length);
      if (!liveRef.current) {
        if (s < t.length) setReleased(t.length);
        return;
      }
      const lag = t.length - s;
      const every = lag > 300 ? Math.max(30, (INTERVAL * 300) / lag) : INTERVAL;
      const now = performance.now();
      if (now - last < every) return;
      if (whole && s >= t.length) return;
      const quiet = !whole && now - changed > QUIET_MS;
      const end = quiet && s < t.length ? t.length : (chunkEnd(t, s, true) ?? (whole ? t.length : null));
      if (end != null && end > s) {
        last = now;
        setReleased(end);
      }
    }, 16);
    return () => clearInterval(id);
  }, []);

  if (!animate.current) return { visible: text, animate: false };
  // Si el texto se ACORTÓ, lo soltado se recorta.
  return { visible: text.slice(0, Math.min(released, text.length)), animate: true };
}

// ── El plugin por bloque ─────────────────────────────────────────────────────────

type Chunk = { start: number; t: number };
type Registry = Map<string, { chunks: Chunk[]; total: number }>;

export const ChunksContext = createContext<{ registry: Registry; part: number } | null>(null);

/** Un registro por respuesta: vive lo que viva la burbuja. */
export function useChunkRegistry(): Registry {
  return useMemo(() => new Map(), []);
}

type Node = { type: string; tagName?: string; value?: string; children?: Node[]; properties?: Record<string, unknown> };
const UNTOUCHED = new Set(["pre", "code", "svg", "math", "script", "style"]);
const STYLE = `gs-tramo ${CHUNK_MS}ms linear both`;

/** Rehype: parte los textos del bloque en spans, uno por tramo. */
function chunksPlugin(state: { chunks: Chunk[]; total: number }) {
  return () => (tree: Node) => {
    let total = 0;
    const count = (n: Node) => {
      if (n.type === "text") total += n.value?.length ?? 0;
      else if (n.type === "element" && UNTOUCHED.has(n.tagName ?? "")) return;
      n.children?.forEach(count);
    };
    count(tree);
    const now = performance.now();
    // Se encogió (el markdown incompleto se re-cerró distinto): se recortan los tramos.
    if (total < state.total) state.chunks = state.chunks.filter((x) => x.start < total);
    if (total > state.total) state.chunks.push({ start: state.total, t: now });
    state.total = total;
    const chunks = state.chunks;
    if (!chunks.length) return;

    let pos = 0;
    const split = (n: Node) => {
      if (!n.children) return;
      if (n.type === "element" && UNTOUCHED.has(n.tagName ?? "")) return;
      const fresh: Node[] = [];
      for (const h of n.children) {
        if (h.type !== "text" || !h.value) {
          split(h);
          fresh.push(h);
          continue;
        }
        const start = pos;
        const end = pos + h.value.length;
        pos = end;
        let k = 0;
        while (k < chunks.length - 1 && chunks[k + 1].start <= start) k++;
        let a = start;
        while (a < end) {
          const b = Math.min(end, k + 1 < chunks.length ? chunks[k + 1].start : end);
          const young = now - chunks[k].t < CHUNK_MS;
          fresh.push({
            type: "element",
            tagName: "span",
            // Viejo (o recreado tras 400 ms) = sin animación: nunca vuelve a aparecer.
            properties: young ? { style: `animation:${STYLE}` } : {},
            children: [{ type: "text", value: h.value.slice(a - start, b - start) }],
          });
          a = b;
          k++;
        }
      }
      n.children = fresh;
    };
    split(tree);
  };
}

/** El bloque de Streamdown con sus tramos. Sólo cambia de plugin cuando cambia su texto. */
export const ChunkedBlock = memo(function ChunkedBlock(props: BlockProps) {
  const ctx = useContext(ChunksContext);
  const key = `${ctx?.part ?? 0}-${props.index}`;
  const plugins = useMemo(() => {
    if (!ctx) return props.rehypePlugins;
    let state = ctx.registry.get(key);
    if (!state) {
      state = { chunks: [], total: 0 };
      ctx.registry.set(key, state);
    }
    return [...(props.rehypePlugins ?? []), chunksPlugin(state)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.content, props.rehypePlugins, key]);
  return <Block {...props} rehypePlugins={plugins as BlockProps["rehypePlugins"]} />;
});
