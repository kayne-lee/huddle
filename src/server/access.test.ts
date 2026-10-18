import { describe, expect, it } from "vitest";

import { canContribute, canCreateTask, canSeeTask } from "./access";

const orgTask = { createdById: "alice", visibility: "org" as const };
const privateTask = { createdById: "alice", visibility: "private" as const };

describe("canSeeTask", () => {
  it("shows org tasks to every role", () => {
    for (const role of ["admin", "member", "viewer"] as const) {
      expect(canSeeTask(role, "bob", orgTask)).toBe(true);
    }
  });

  it("hides private tasks from members who did not create them", () => {
    expect(canSeeTask("member", "bob", privateTask)).toBe(false);
    expect(canSeeTask("viewer", "bob", privateTask)).toBe(false);
  });

  it("shows private tasks to their creator and to admins", () => {
    expect(canSeeTask("member", "alice", privateTask)).toBe(true);
    expect(canSeeTask("admin", "bob", privateTask)).toBe(true);
  });
});

describe("contribution", () => {
  it("blocks viewers from creating or contributing", () => {
    expect(canCreateTask("viewer")).toBe(false);
    expect(canContribute("viewer", "alice", privateTask)).toBe(false);
  });

  it("blocks contributing to a task the user cannot see", () => {
    expect(canContribute("member", "bob", privateTask)).toBe(false);
  });
});
