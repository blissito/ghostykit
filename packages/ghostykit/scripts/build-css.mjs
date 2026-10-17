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
function scopeSelector(sel) {
  return sel
    .split(",")
    .map((s) => s.trim())
    .map((s) => {
      if (!s) return s;
      if (s === ":root" || s === ":host" || s === "html") return SCOPE;
      if (s.startsWith(SCOPE)) return s;
      return `${SCOPE} ${s}`;
    })
    .filter((s, i, all) => all.indexOf(s) === i)
    .join(", ");
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
      rule.selector = scopeSelector(rule.selector);
    });
  },
};

const tw = readFileSync(tmp, "utf8");
const scoped = (await postcss([scope]).process(tw, { from: tmp })).css;
const base = readFileSync(join(pkg, "src/styles/base.css"), "utf8");
const banner = "/* ghostykit — Piloto UI · MIT · https://github.com/blissito/ghostykit */\n";
writeFileSync(join(pkg, "dist/styles.css"), `${banner}${base}\n/* ── Utilidades (Tailwind ${"v4"}, encerradas en .piloto) ── */\n${scoped}`);
rmSync(dirname(tmp), { recursive: true, force: true });
console.log(`dist/styles.css  ${(Buffer.byteLength(base + scoped) / 1024).toFixed(1)}kb`);
