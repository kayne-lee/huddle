import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { canManageMembers } from "~/server/access";
import { requireRole } from "~/server/api/membership";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { memberships, orgs, roleEnum } from "~/server/db/schema";

export const orgRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.memberships.findMany({
      where: eq(memberships.userId, ctx.session.user.id),
      with: { org: { columns: { id: true, name: true } } },
      orderBy: asc(memberships.createdAt),
    });
    return rows.map((r) => ({ ...r.org, role: r.role }));
  }),

  get: protectedProcedure.input(z.object({ orgId: z.string() })).query(async ({ ctx, input }) => {
    const role = await requireRole(input.orgId, ctx.session.user.id);
    const org = await ctx.db.query.orgs.findFirst({ where: eq(orgs.id, input.orgId) });
    if (!org) throw new TRPCError({ code: "NOT_FOUND" });
    return {
      id: org.id,
      name: org.name,
      role,
      joinCode: canManageMembers(role) ? org.joinCode : null,
    };
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const [org] = await tx
          .insert(orgs)
          .values({ name: input.name, joinCode: randomBytes(6).toString("base64url") })
          .returning({ id: orgs.id });
        if (!org) throw new Error("insert returned no row");
        await tx.insert(memberships).values({ orgId: org.id, userId: ctx.session.user.id, role: "admin" });
        return org;
      });
    }),

  join: protectedProcedure.input(z.object({ code: z.string().trim().min(1) })).mutation(async ({ ctx, input }) => {
    const org = await ctx.db.query.orgs.findFirst({ where: eq(orgs.joinCode, input.code) });
    if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "No org with that code" });
    await ctx.db
      .insert(memberships)
      .values({ orgId: org.id, userId: ctx.session.user.id, role: "member" })
      .onConflictDoNothing();
    return { id: org.id };
  }),

  members: protectedProcedure.input(z.object({ orgId: z.string() })).query(async ({ ctx, input }) => {
    await requireRole(input.orgId, ctx.session.user.id);
    const rows = await ctx.db.query.memberships.findMany({
      where: eq(memberships.orgId, input.orgId),
      with: { user: { columns: { id: true, name: true, image: true } } },
      orderBy: asc(memberships.createdAt),
    });
    return rows.map((r) => ({ ...r.user, role: r.role }));
  }),

  setRole: protectedProcedure
    .input(z.object({ orgId: z.string(), userId: z.string(), role: z.enum(roleEnum.enumValues) }))
    .mutation(async ({ ctx, input }) => {
      const role = await requireRole(input.orgId, ctx.session.user.id);
      if (!canManageMembers(role)) throw new TRPCError({ code: "FORBIDDEN" });
      // Stops the last admin from locking everyone out.
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot change your own role" });
      }
      await ctx.db
        .update(memberships)
        .set({ role: input.role })
        .where(and(eq(memberships.orgId, input.orgId), eq(memberships.userId, input.userId)));
    }),
});
