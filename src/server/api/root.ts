import { orgRouter } from "~/server/api/routers/org";
import { taskRouter } from "~/server/api/routers/task";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  org: orgRouter,
  task: taskRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
