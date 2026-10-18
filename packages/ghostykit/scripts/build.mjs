// El JS de ghostykit: ESM, un archivo por entrada y lo compartido en chunks. React, motion,
// streamdown y el señalador quedan afuera (peers); los íconos de lucide se empaquetan (sólo los usados).
import { build } from "esbuild";

await build({
  entryPoints: {
    "core/index": "src/core/index.ts",
    "transport/index": "src/transport/index.ts",
    "react/index": "src/react/index.ts",
    "pointer/index": "src/pointer/index.ts",
    "plugins/index": "src/plugins/index.tsx",
  },
  outdir: "dist",
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2020",
  platform: "neutral",
  jsx: "automatic",
  sourcemap: false,
  legalComments: "none",
  chunkNames: "chunks/[name]-[hash]",
  external: ["react", "react-dom", "react/jsx-runtime", "motion", "motion/*", "streamdown", "@ghostystudio/pointer", "@ghostystudio/pointer/*"],
  mainFields: ["module", "main"],
  logLevel: "info",
});
