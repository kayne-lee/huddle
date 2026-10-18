import type { TaskStatus } from "~/server/db/schema";

const styles: Record<TaskStatus, string> = {
  queued: "bg-stone-100 text-stone-600",
  running: "bg-sky-100 text-sky-800",
  review: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${styles[status]}`}>{status}</span>;
}
