import type { Role, Visibility } from "~/server/db/schema";

type TaskRef = { createdById: string; visibility: Visibility };

// Private tasks are visible to their creator and to org admins only.
export function canSeeTask(role: Role, userId: string, task: TaskRef): boolean {
  return task.visibility === "org" || task.createdById === userId || role === "admin";
}

export function canCreateTask(role: Role): boolean {
  return role !== "viewer";
}

// Steering, draft edits and approval all count as contributing to a task.
export function canContribute(role: Role, userId: string, task: TaskRef): boolean {
  return role !== "viewer" && canSeeTask(role, userId, task);
}

export function canManageMembers(role: Role): boolean {
  return role === "admin";
}
