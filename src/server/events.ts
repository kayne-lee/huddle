import { db } from "~/server/db";
import { type RunEventType, runEvents, type Visibility } from "~/server/db/schema";
import { publish } from "~/server/realtime";

export type TaskScopeRow = {
  id: string;
  orgId: string;
  createdById: string;
  visibility: Visibility;
};

function scope(task: TaskScopeRow) {
  return {
    orgId: task.orgId,
    taskId: task.id,
    createdById: task.createdById,
    visibility: task.visibility,
  };
}

export async function recordEvent(
  task: TaskScopeRow,
  type: RunEventType,
  payload: Record<string, unknown>,
  userId: string | null = null,
): Promise<number> {
  const [row] = await db
    .insert(runEvents)
    .values({ taskId: task.id, type, payload, userId })
    .returning({ id: runEvents.id });
  if (!row) throw new Error("insert returned no row");
  await publish({ ...scope(task), kind: "run", eventId: row.id });
  return row.id;
}

export async function publishTaskChanged(task: TaskScopeRow): Promise<void> {
  await publish({ ...scope(task), kind: "task" });
}

export async function publishDelta(task: TaskScopeRow, text: string): Promise<void> {
  await publish({ ...scope(task), kind: "delta", text });
}
