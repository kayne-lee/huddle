import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { TaskView } from "~/app/_components/task-view";
import { api } from "~/trpc/server";

export default async function TaskPage({ params }: { params: Promise<{ orgId: string; taskId: string }> }) {
  const { orgId, taskId } = await params;
  const task = await api.task.get({ taskId }).catch((err: unknown) => {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") notFound();
    throw err;
  });
  if (task.orgId !== orgId) notFound();
  return <TaskView orgId={orgId} taskId={taskId} />;
}
