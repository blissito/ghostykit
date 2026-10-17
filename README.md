# Piloto UI · `ghostykit`

**Piloto UI** es el copiloto para tu app: un chat de agente que vive dentro de una app que ya
existe, ve lo que el usuario tiene en pantalla, ejecuta las acciones de esa app y pide permiso antes
de lo riesgoso (*in-app copilot*, *human-in-the-loop*).

Nace del chat de [Ghosty Studio](https://www.ghosty.studio), probado en producción: texto en vivo,
pasos del agente, adjuntos, voz, reconexión cuando se corta la red y tarjetas de aprobación.

> 🚧 0.1.0, sin publicar todavía. Primer uso: el panel de crons de [EasyBits](https://www.easybits.cloud).

```tsx
import { Piloto, useSseTransport } from "ghostykit";
import "ghostykit/styles.css";

<Piloto transport={useSseTransport("/api/chat/123")} />
```

La API completa está en [`packages/ghostykit/README.md`](packages/ghostykit/README.md).

## El repo

- `packages/ghostykit` — el paquete: `core` (reductor puro), `transport` (SSE), `react` (componentes) y `styles.css`.
- `apps/demo` — el playground (Vite) con un transporte simulado: pasos, permiso, opciones, pieles.

```bash
npm install
npm test           # reductor, transporte, parsers y SSR
npm run build      # dist/ del paquete (JS + .d.ts + styles.css)
npm run demo       # playground en http://localhost:5173
```

## Principios

- **Sólida** — el estado del chat es un reductor puro con pruebas que reproducen sesiones reales.
- **Simple** — `<Piloto transport={…} />` y listo; todo lo demás es opcional.
- **Artística** — una identidad propia que cada app viste con sus variables `--piloto-*`.

## Licencia

MIT
