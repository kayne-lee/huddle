import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { canContribute, canCreateTask, canSeeTask } from "~/server/access";
import { runTask } from "~/server/agent/runner";
import { requireRole, requireVisibleTask } from "~/server/api/membership";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runEvents, tasks, visibilityEnum } from "~/server/db/schema";
import { publishTaskChanged, recordEvent } from "~/server/events";
import { subscribe } from "~/server/realtime";

export const taskRouter = createTRPCRouter({
  list: protectedProcedure.input(z.object({ orgId: z.string() })).query(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const role = await requireRole(input.orgId, userId);
    const rows = await ctx.db.query.tasks.findMany({
      where: eq(tasks.orgId, input.orgId),
      columns: {
        id: true,
        title: true,
        status: true,
        visibility: true,
        createdById: true,
        updatedAt: true,
      },
      with: { createdBy: { columns: { name: true } } },
      orderBy: desc(tasks.createdAt),
    });
    return rows.filter((t) => canSeeTask(role, userId, t));
  }),

  get: protectedProcedure.input(z.object({ taskId: z.string() })).query(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const { task, role } = await requireVisibleTask(input.taskId, userId);
    const events = await ctx.db.query.runEvents.findMany({
      where: eq(runEvents.taskId, task.id),
      with: { user: { columns: { name: true } } },
      orderBy: asc(runEvents.id),
    });
    const people = await ctx.db.query.users.findMany({
      where: (u, { inArray }) => inArray(u.id, [task.createdById, task.draftEditedById ?? task.createdById]),
      columns: { id: true, name: true },
    });
    const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
    return {
      ...task,
      createdByName: nameOf(task.createdById),
      draftEditedByName: nameOf(task.draftEditedById),
      canContribute: canContribute(role, userId, task),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        userName: e.user?.name ?? null,
        createdAt: e.createdAt,
      })),
    };
  }),

  create: protectedProcedure
    .input(
      z.object({
        orgId: z.string(),
        title: z.string().trim().min(1).max(200),
        prompt: z.string().trim().min(1).max(20_000),
        visibility: z.enum(visibilityEnum.enumValues),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const role = await requireRole(input.orgId, userId);
      if (!canCreateTask(role)) throw new TRPCError({ code: "FORBIDDEN" });
      const [task] = await ctx.db
        .insert(tasks)
        .values({ ...input, createdById: userId })
        .returning();
      if (!task) throw new Error("insert returned no row");
      await publishTaskChanged(task);
      // Runs in this server process; a restart mid-run leaves the task in "running".
      void runTask(task.id);
      return { id: task.id };
    }),

  steer: protectedProcedure
    .input(z.object({ taskId: z.string(), text: z.string().trim().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { task, role } = await requireVisibleTask(input.taskId, userId);
      if (!canContribute(role, userId, task)) throw new TRPCError({ code: "FORBIDDEN" });
      if (task.status !== "queued" && task.status !== "running") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The agent is no longer running" });
      }
      await recordEvent(task, "steer", { text: input.text }, userId);
    }),

  saveDraft: protectedProcedure
    .input(z.object({ taskId: z.string(), draft: z.string().max(100_000), baseVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { task, role } = await requireVisibleTask(input.taskId, userId);
      if (!canContribute(role, userId, task)) throw new TRPCError({ code: "FORBIDDEN" });
      if (task.status !== "review")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only drafts in review can be edited" });

      // Compare-and-swap on the version: a stale editor gets CONFLICT instead of overwriting.
      const [updated] = await ctx.db
        .update(tasks)
        .set({ draft: input.draft, draftVersion: sql`${tasks.draftVersion} + 1`, draftEditedById: userId })
        .where(and(eq(tasks.id, task.id), eq(tasks.draftVersion, input.baseVersion)))
        .returning({ draftVersion: tasks.draftVersion });
      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Someone else edited this draft. Reload to see their changes.",
        });
      }
      await publishTaskChanged(task);
      return updated;
    }),

  approve: protectedProcedure
    .input(z.object({ taskId: z.string(), baseVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { task, role } = await requireVisibleTask(input.taskId, userId);
      if (!canContribute(role, userId, task)) throw new TRPCError({ code: "FORBIDDEN" });

      const [updated] = await ctx.db
        .update(tasks)
        .set({ status: "approved", approvedById: userId })
        .where(and(eq(tasks.id, task.id), eq(tasks.status, "review"), eq(tasks.draftVersion, input.baseVersion)))
        .returning({ id: tasks.id });
      if (!updated) {
        throw new TRPCError({ code: "CONFLICT", message: "The draft changed or was already approved." });
      }
      await recordEvent(task, "status", { status: "approved" }, userId);
      await publishTaskChanged(task);
    }),

  // Streams org events the caller is allowed to see. Text deltas only flow for the task being watched.
  events: protectedProcedure
    .input(z.object({ orgId: z.string(), taskId: z.string().optional() }))
    .subscription(async function* ({ ctx, input, signal }) {
      const userId = ctx.session.user.id;
      const role = await requireRole(input.orgId, userId);
      for await (const event of subscribe(input.orgId, signal)) {
        if (!canSeeTask(role, userId, event)) continue;
        if (event.kind === "delta" && event.taskId !== input.taskId) continue;
        yield event;
      }
    }),
});
