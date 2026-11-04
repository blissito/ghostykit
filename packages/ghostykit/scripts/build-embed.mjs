// `dist/embed.js`: Piloto para cualquier página con un `<script>` (IIFE, `window.GhostyKit`).
// A diferencia del build ESM, aquí React, motion y streamdown van ADENTRO, y el CSS también
// (`dist/styles.css` incrustado como texto). Corre después de `build-css.mjs`.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));

const inlineCss = {
  name: "piloto-styles",
  setup(b) {
    b.onResolve({ filter: /^piloto:styles$/ }, () => ({ path: join(pkg, "dist/styles.css"), namespace: "piloto-css" }));
    b.onLoad({ filter: /.*/, namespace: "piloto-css" }, (args) => ({ contents: readFileSync(args.path, "utf8"), loader: "text" }));
  },
};

const result = await build({
  entryPoints: [join(pkg, "src/embed.tsx")],
  outfile: join(pkg, "dist/embed.js"),
  bundle: true,
  format: "iife",
  globalName: "GhostyKit",
  target: "es2020",
  platform: "browser",
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"', __GHOSTYKIT_VERSION__: JSON.stringify(version) },
  banner: { js: `/* ghostykit ${version} — embed · MIT · https://github.com/blissito/ghostykit */` },
  plugins: [inlineCss],
  metafile: true,
  logLevel: "info",
});
import { writeFileSync } from "node:fs";
if (process.env.EMBED_META) writeFileSync(process.env.EMBED_META, JSON.stringify(result.metafile));
