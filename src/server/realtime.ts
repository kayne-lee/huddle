import { EventEmitter, on } from "node:events";
import postgres from "postgres";

import { env } from "~/env";
import type { Visibility } from "~/server/db/schema";

// Every event carries enough of the task to run the visibility check without a query.
type TaskScope = {
  orgId: string;
  taskId: string;
  createdById: string;
  visibility: Visibility;
};

export type HuddleEvent =
  | (TaskScope & { kind: "task" })
  | (TaskScope & { kind: "run"; eventId: number })
  | (TaskScope & { kind: "delta"; text: string });

const CHANNEL = "huddle_events";
// Postgres caps NOTIFY payloads at 8000 bytes.
const MAX_DELTA_CHARS = 2000;

const globalForBus = globalThis as unknown as {
  bus: { sql: postgres.Sql; emitter: EventEmitter; listening: Promise<unknown> } | undefined;
};

function bus() {
  if (!globalForBus.bus) {
    const sql = postgres(env.DATABASE_URL, { max: 1 });
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    // NOTIFY rather than an in-process emit so events reach every server instance.
    const listening = sql.listen(CHANNEL, (payload) => {
      const event = JSON.parse(payload) as HuddleEvent;
      emitter.emit(event.orgId, event);
    });
    globalForBus.bus = { sql, emitter, listening };
  }
  return globalForBus.bus;
}

export async function publish(event: HuddleEvent): Promise<void> {
  const { sql } = bus();
  if (event.kind === "delta" && event.text.length > MAX_DELTA_CHARS) {
    for (let i = 0; i < event.text.length; i += MAX_DELTA_CHARS) {
      await sql.notify(CHANNEL, JSON.stringify({ ...event, text: event.text.slice(i, i + MAX_DELTA_CHARS) }));
    }
    return;
  }
  await sql.notify(CHANNEL, JSON.stringify(event));
}

export async function* subscribe(orgId: string, signal: AbortSignal | undefined): AsyncGenerator<HuddleEvent> {
  const { emitter, listening } = bus();
  await listening;
  try {
    for await (const [event] of on(emitter, orgId, { signal })) {
      yield event as HuddleEvent;
    }
  } catch (err) {
    if (!signal?.aborted) throw err;
  }
}
