// Cuándo se enseña «conectando» (ConnectingState). Puro, para poder fijarlo con pruebas.
//
// Una conexión rápida no enseña nada (antes salía el círculo a los 800 ms y se iba a mitad de su
// animación: un parpadeo). Si de verdad tarda, sale y se queda un mínimo antes de irse con su fundido.

/** Sin conexión por este rato, se enseña. */
export const CONNECTING_DELAY_MS = 1200;
/** Una vez a la vista, se queda al menos esto. */
export const CONNECTING_MIN_MS = 700;

export interface ConnectingGate {
  /** Desde cuándo está a la vista (null = oculto). */
  shownAt: number | null;
  /** Desde cuándo falta la conexión (null = conectado). */
  waitingSince: number | null;
}

export const initialGate = (now: number, connected: boolean): ConnectingGate => ({ shownAt: null, waitingSince: connected ? null : now });

/** El estado a `now`, y cuándo volver a mirar (null = no hace falta). */
export function stepGate(g: ConnectingGate, connected: boolean, now: number, delay = CONNECTING_DELAY_MS, min = CONNECTING_MIN_MS): { gate: ConnectingGate; visible: boolean; recheckAt: number | null } {
  const waitingSince = connected ? null : (g.waitingSince ?? now);
  let shownAt = g.shownAt;
  if (shownAt === null && waitingSince !== null && now - waitingSince >= delay) shownAt = now;
  if (shownAt !== null && connected && now - shownAt >= min) shownAt = null;
  const gate = { shownAt, waitingSince };
  let recheckAt: number | null = null;
  if (shownAt === null && waitingSince !== null) recheckAt = waitingSince + delay;
  else if (shownAt !== null && connected) recheckAt = shownAt + min;
  return { gate, visible: shownAt !== null, recheckAt };
}
