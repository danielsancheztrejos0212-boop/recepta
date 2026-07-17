/**
 * Candado en memoria por clave: encola las tareas de una misma clave para que
 * corran una detrás de otra en vez de pisarse.
 *
 * POR QUÉ EXISTE (bug real, visto en un E2E contra el webhook):
 * el webhook responde 200 de inmediato y procesa en `setImmediate`, así que los
 * mensajes de una ráfaga se procesan EN PARALELO. Los tres hacían
 * `findFirst({ status: "abierta" })`, los tres no encontraban nada y los tres creaban
 * una conversación. Resultado: la ráfaga partida en varias conversaciones, el agente
 * con contexto incompleto y varias respuestas al paciente.
 *
 * ⚠️ ASUME UNA SOLA INSTANCIA, igual que `conversation/debounce.ts` (plan free de
 * Render). Si algún día hay varias instancias, esto se cambia por un lock distribuido
 * (Redis) o un índice único parcial en Postgres:
 *   CREATE UNIQUE INDEX ... ON "Conversation"("businessId","customerId") WHERE status='abierta';
 */
const colas = new Map<string, Promise<unknown>>();

export function conCandado<T>(clave: string, tarea: () => Promise<T>): Promise<T> {
  const anterior = colas.get(clave) ?? Promise.resolve();

  // `then(tarea, tarea)`: si la tarea anterior falló, la siguiente igual debe correr.
  const actual = anterior.then(tarea, tarea);

  // El marcador nunca rechaza: si lo hiciera, encadenaríamos un rechazo no manejado.
  const marcador = actual.then(
    () => undefined,
    () => undefined,
  );
  colas.set(clave, marcador);

  // Limpieza: si al terminar nadie más encoló, sacamos la clave para no crecer sin fin.
  void marcador.finally(() => {
    if (colas.get(clave) === marcador) colas.delete(clave);
  });

  return actual;
}

/** Solo para tests. */
export function candadosActivos(): number {
  return colas.size;
}
