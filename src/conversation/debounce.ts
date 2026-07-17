import { logger } from "../lib/logger";
import { respondToConversation } from "./respond";

/**
 * Debounce en memoria: el "efecto humano".
 *
 * Cuando el paciente escribe "hola" · "buenas" · "quería preguntar algo" en tres
 * mensajes seguidos, no queremos tres respuestas. Cada mensaje nuevo cancela el timer
 * anterior y lo reinicia, así que el agente contesta UNA vez, ~10 s después del último.
 *
 * ⚠️ ESTO ASUME UNA SOLA INSTANCIA DEL SERVIDOR.
 * Los timers viven en la memoria de este proceso: con dos instancias detrás de un
 * balanceador, cada una tendría su propio Map y el paciente recibiría respuestas
 * duplicadas. Es suficiente y correcto para el plan free de Render (una sola instancia).
 * Camino de upgrade cuando haya que escalar: mover estos timers a Redis + BullMQ
 * (job con delay e id = conv-{conversationId}, se borra y recrea al llegar otro mensaje).
 */
const timers = new Map<string, NodeJS.Timeout>();

export function scheduleReply(conversationId: string, delayMs: number): void {
  const anterior = timers.get(conversationId);
  if (anterior) {
    clearTimeout(anterior);
    logger.debug({ conversationId }, "Ráfaga detectada: se reinicia el temporizador de respuesta");
  }

  const timer = setTimeout(() => {
    timers.delete(conversationId);

    // El timer no es await-eable: si respondToConversation rechazara, sería un
    // unhandledRejection que tumba el proceso. Por eso, catch explícito.
    respondToConversation(conversationId).catch((err) => {
      logger.error({ conversationId, err }, "Fallo no controlado al responder; el proceso sigue");
    });
  }, delayMs);

  // No mantengas vivo el proceso solo por este timer (apagado limpio en Render).
  timer.unref?.();

  timers.set(conversationId, timer);
}

/** Solo para tests y apagado limpio. */
export function cancelAllReplies(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

export function pendingRepliesCount(): number {
  return timers.size;
}
