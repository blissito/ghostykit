# Piloto UI · `ghostykit`

**Piloto UI** es el copiloto para tu app: un chat de agente que vive dentro de una app que ya
existe, ve lo que el usuario tiene en pantalla, ejecuta las acciones de esa app y pide permiso antes
de lo riesgoso (*in-app copilot*, *human-in-the-loop*).

Nace del chat de [Ghosty Studio](https://www.ghosty.studio), probado en producción: texto en vivo,
pasos del agente, adjuntos, voz, reconexión cuando se corta la red y tarjetas de aprobación.

> 🚧 En construcción. Primer uso: el panel de crons de [EasyBits](https://www.easybits.cloud).

## Principios

- **Sólida** — el estado del chat es un reductor puro con pruebas que reproducen sesiones reales.
- **Simple** — `<Piloto transport={…} />` y listo; todo lo demás es opcional.
- **Artística** — una identidad propia que cada app viste con sus variables `--piloto-*`.

## Licencia

MIT
