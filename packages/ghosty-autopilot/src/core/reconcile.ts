// Reconciliar lo que pinta el chat en vivo con la copia del hilo que trae la app.
//
// El stream de una conversación sólo trae lo que ESCRIBE el agente: un mensaje del usuario mandado
// desde OTRO cliente (el teléfono) —sobre todo un steer, que entra al turno vivo— nunca llega por
// ahí. Al cerrar el turno la app vuelve a leer el hilo y esto lo junta con lo que hay en pantalla.
import type { Turn } from "./types";

const same = (a: Turn, b: Turn) => a.role === b.role && a.text.trim() === b.text.trim();

/**
 * Si la copia trae MÁS mensajes del usuario que la pantalla, faltan los de otro cliente: se repinta
 * con la copia, conservando el turno vivo (pasos, segundos, uso) de cada mensaje que coincide. Con
 * los mismos mensajes del usuario no se toca nada (las burbujas en vivo son más ricas que la copia).
 */
export function reconcileTurns(current: Turn[], fresh: Turn[]): Turn[] {
  const users = (ts: Turn[]) => ts.filter((t) => t.role === "user").length;
  if (users(fresh) <= users(current)) return current;
  let j = 0;
  return fresh.map((f) => {
    for (let k = j; k < current.length; k++) {
      if (same(current[k], f)) {
        j = k + 1;
        return { ...f, ...current[k], deliveries: current[k].deliveries ?? f.deliveries };
      }
    }
    return f;
  });
}
