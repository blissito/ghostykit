// `dist/styles.css`: la piel (`src/styles/base.css`) + las utilidades de Tailwind que usan Piloto y
// Streamdown, ENCERRADAS bajo `.piloto`.
//
// Por qué así y no «usa Tailwind en tu app»: las apps que adoptan Piloto están en Tailwind 3, 4 o
// ninguno. Unas utilidades globales (`.flex`, `:root { --spacing }`) pisarían o se dejarían pisar
// por las del consumidor. Encerradas (`.piloto .flex`) y SIN `@layer` (una regla con capa pierde
// contra cualquier CSS sin capa del consumidor) se comportan igual en las tres.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(pkg, ".cache", "tw.css");
mkdirSync(dirname(tmp), { recursive: true });

execFileSync(process.execPath, [join(pkg, "../../node_modules/@tailwindcss/cli/dist/index.mjs"), "-i", join(pkg, "src/styles/tailwind.css"), "-o", tmp], {
  cwd: pkg,
  stdio: ["ignore", "ignore", "inherit"],
});

const SCOPE = ".piloto";

/** `:root, :host` → `.piloto`; todo lo demás → `.piloto <selector>` (salvo lo que ya empieza con `.piloto`). */
function scopeOne(sel) {
  const s = sel.trim();
  if (s === ":root" || s === ":host" || s === "html") return SCOPE;
  if (s.startsWith(SCOPE)) return s;
  return `${SCOPE} ${s}`;
}

const scope = {
  postcssPlugin: "piloto-scope",
  Once(root) {
    // Fuera las capas: se conserva el contenido en su lugar.
    root.walkAtRules("layer", (at) => {
      if (at.nodes) at.replaceWith(at.nodes);
      else at.remove();
    });
    root.walkRules((rule) => {
      // Los pasos de un @keyframes (`from`, `50%`) no son selectores.
      if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
      // `rule.selectors` parte bien las comas escapadas (`.max-h-\\[min\\(70vh\\,40rem\\)\\]`).
      rule.selectors = [...new Set(rule.selectors.map(scopeOne))];
    });
  },
};

/**
 * `rem` → `var(--piloto-rem)`. Ghosty Studio corre con `html { font-size: 18px }`, así que sus
 * medidas en rem valen 18 px; la app anfitriona tiene la suya (16 px casi siempre). Con esto Piloto
 * mide lo mismo en cualquier app, y cada piel elige su unidad (ghosty 18 px, easybits 16 px).
 */
const remToVar = async (css) =>
  (
    await postcss([
      {
        postcssPlugin: "piloto-rem",
        // Sólo en VALORES: un `@media (width >= 40rem)` no admite `var()` y se queda en rem.
        Declaration(decl) {
          if (/rem\b/.test(decl.value)) decl.value = decl.value.replace(/(-?\d*\.?\d+)rem\b/g, (_m, n) => `calc(${n} * var(--piloto-rem))`);
        },
      },
    ]).process(css, { from: undefined })
  ).css;

const tw = readFileSync(tmp, "utf8");
const scoped = await remToVar((await postcss([scope]).process(tw, { from: tmp })).css);
const base = await remToVar(readFileSync(join(pkg, "src/styles/base.css"), "utf8"));
const banner = "/* ghostykit — Piloto UI · MIT · https://github.com/blissito/ghostykit */\n";
// La piel va DESPUÉS: a igual especificidad, sus piezas con nombre ganan a las utilidades.
writeFileSync(join(pkg, "dist/styles.css"), `${banner}/* ── Utilidades (Tailwind v4, encerradas en .piloto) ── */\n${scoped}\n/* ── La piel ── */\n${base}`);
writeFileSync(join(pkg, "dist/fonts.css"), readFileSync(join(pkg, "src/styles/fonts.css"), "utf8"));
rmSync(dirname(tmp), { recursive: true, force: true });
console.log(`dist/styles.css  ${(Buffer.byteLength(base + scoped) / 1024).toFixed(1)}kb`);
