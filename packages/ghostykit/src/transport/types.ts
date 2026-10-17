// La interfaz del transporte y su error, aparte para que ambos transportes la compartan.
import type { SendInput, SendResult, Turn } from "../core/types";

/** Un evento con nombre y su `data` ya parseado (`null` si no traía o no era JSON). */
export type PilotListener = (name: string, data: unknown) => void;

export interface SubscribeOptions {
  /** ¿Hay un turno en vuelo? Con turno vivo, un silencio largo = conexión muerta → se reabre. */
  isBusy?: () => boolean;
}

export interface PilotTransport {
  /** Abre el stream de eventos. Devuelve con qué cerrarlo. */
  subscribe(listener: PilotListener, opts?: SubscribeOptions): () => void;
  /** Encarga un turno (o lo mete al turno en vuelo). Rechaza con `PilotHttpError` si el servidor dice que no. */
  send(input: SendInput): Promise<SendResult>;
  /** Detiene el turno en curso. */
  cancel(): Promise<void>;
  /** Cambia el modelo de la sesión (el stream confirma con `models`). */
  setModel?(value: string): Promise<void>;
  /** Contesta un pedido de permiso. `resolved: false` = ya no estaba abierto (se agotó el plazo). */
  respondPermission?(id: string, optionId: string): Promise<{ resolved: boolean }>;
  /** El hilo guardado, para pintarlo al montar (si la app no pasa `initialTurns`). */
  history?(): Promise<Turn[]>;
  /**
   * ¿Se puede mandar un mensaje con un turno en vuelo (steer)? Default `true` (Ghosty). Con
   * `false` (el servidor contesta 409) el composer no deja mandar hasta que el turno cierre.
   */
  steer?: boolean;
}

/** El servidor rechazó el encargo (sin saldo, sin cuenta, agente de otro). */
export class PilotHttpError extends Error {
  status: number;
  /** El servidor pide cuenta (`X-Needs-Login`). */
  needsLogin: boolean;
  constructor(message: string, status: number, needsLogin = false) {
    super(message);
    this.name = "PilotHttpError";
    this.status = status;
    this.needsLogin = needsLogin;
  }
}

