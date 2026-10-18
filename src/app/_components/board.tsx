"use client";

import Link from "next/link";
import { useState } from "react";

import { StatusBadge } from "~/app/_components/status-badge";
import type { TaskStatus, Visibility } from "~/server/db/schema";
import { api, type RouterOutputs } from "~/trpc/react";

type Org = RouterOutputs["org"]["get"];

const columns: { title: string; statuses: TaskStatus[] }[] = [
  { title: "In progress", statuses: ["queued", "running"] },
  { title: "Needs review", statuses: ["review"] },
  { title: "Approved", statuses: ["approved"] },
  { title: "Failed", statuses: ["failed"] },
];

export function Board({ org }: { org: Org }) {
  const utils = api.useUtils();
  const tasks = api.task.list.useQuery({ orgId: org.id });

  api.task.events.useSubscription(
    { orgId: org.id },
    {
      onData: (event) => {
        if (event.kind === "task") void utils.task.list.invalidate({ orgId: org.id });
      },
    },
  );

  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">{org.name}</h1>
        <span className="text-sm text-stone-500">You are {org.role === "admin" ? "an admin" : `a ${org.role}`}</span>
      </div>

      {org.role !== "viewer" ? <NewTaskForm orgId={org.id} /> : null}

      <div className="grid gap-4 md:grid-cols-4">
        {columns.map((col) => {
          const items = tasks.data?.filter((t) => col.statuses.includes(t.status)) ?? [];
          return (
            <section key={col.title} className="space-y-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">
                {col.title} <span className="text-stone-400">{items.length}</span>
              </h2>
              <ul className="space-y-2">
                {items.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/org/${org.id}/task/${t.id}`}
                      className="block space-y-1 rounded border border-stone-200 bg-white p-3 hover:border-stone-400"
                    >
                      <div className="text-sm font-medium">{t.title}</div>
                      <div className="flex items-center gap-2 text-xs text-stone-500">
                        <StatusBadge status={t.status} />
                        {t.visibility === "private" ? <span>private</span> : null}
                        <span className="ml-auto">{t.createdBy.name}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <Members org={org} />
    </div>
  );
}

function NewTaskForm({ orgId }: { orgId: string }) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("org");
  const create = api.task.create.useMutation({
    onSuccess: () => {
      setTitle("");
      setPrompt("");
    },
  });

  return (
    <form
      className="space-y-2 rounded border border-stone-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ orgId, title, prompt, visibility });
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title, e.g. Summarize the onboarding doc"
        aria-label="Task title"
        className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
      />
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="What should the agent do? Paste links or context here."
        aria-label="Task instructions"
        rows={3}
        className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
      />
      <div className="flex items-center gap-3">
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as Visibility)}
          aria-label="Visibility"
          className="rounded border border-stone-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="org">Visible to the org</option>
          <option value="private">Private to me and admins</option>
        </select>
        <button
          type="submit"
          disabled={!title.trim() || !prompt.trim() || create.isPending}
          className="btn-primary ml-auto"
        >
          Assign to agent
        </button>
      </div>
      {create.error ? <p className="text-sm text-red-700">{create.error.message}</p> : null}
    </form>
  );
}

function Members({ org }: { org: Org }) {
  const utils = api.useUtils();
  const members = api.org.members.useQuery({ orgId: org.id });
  const setRole = api.org.setRole.useMutation({
    onSuccess: () => utils.org.members.invalidate({ orgId: org.id }),
  });
  const isAdmin = org.role === "admin";

  return (
    <section className="max-w-md space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">Members</h2>
      {org.joinCode ? (
        <p className="text-sm text-stone-600">
          Join code: <code className="rounded bg-stone-100 px-1.5 py-0.5">{org.joinCode}</code>
        </p>
      ) : null}
      <ul className="divide-y divide-stone-200 rounded border border-stone-200 bg-white text-sm">
        {members.data?.map((m) => (
          <li key={m.id} className="flex items-center justify-between px-3 py-2">
            <span>{m.name}</span>
            {isAdmin ? (
              <select
                value={m.role}
                onChange={(e) => setRole.mutate({ orgId: org.id, userId: m.id, role: e.target.value as typeof m.role })}
                aria-label={`Role for ${m.name ?? "member"}`}
                className="rounded border border-stone-300 bg-white px-2 py-1 text-xs"
              >
                <option value="admin">admin</option>
                <option value="member">member</option>
                <option value="viewer">viewer</option>
              </select>
            ) : (
              <span className="text-stone-500">{m.role}</span>
            )}
          </li>
        ))}
      </ul>
      {setRole.error ? <p className="text-sm text-red-700">{setRole.error.message}</p> : null}
    </section>
  );
}
