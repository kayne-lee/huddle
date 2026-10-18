import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import { canSeeTask } from "~/server/access";
import { db } from "~/server/db";
import { memberships, type Role, tasks } from "~/server/db/schema";

export async function requireRole(orgId: string, userId: string): Promise<Role> {
  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)),
    columns: { role: true },
  });
  // NOT_FOUND rather than FORBIDDEN so outsiders cannot probe which orgs exist.
  if (!membership) throw new TRPCError({ code: "NOT_FOUND" });
  return membership.role;
}

export async function requireVisibleTask(taskId: string, userId: string) {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) throw new TRPCError({ code: "NOT_FOUND" });
  const role = await requireRole(task.orgId, userId);
  if (!canSeeTask(role, userId, task)) throw new TRPCError({ code: "NOT_FOUND" });
  return { task, role };
}
