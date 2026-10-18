"use client";

import { TRPCClientError } from "@trpc/client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { StatusBadge } from "~/app/_components/status-badge";
import { api, type RouterOutputs } from "~/trpc/react";

type Task = RouterOutputs["task"]["get"];
type RunEvent = Task["events"][number];

const AUTOSAVE_MS = 800;

export function TaskView({ orgId, taskId }: { orgId: string; taskId: string }) {
  const utils = api.useUtils();
  const task = api.task.get.useQuery({ taskId });
  const [live, setLive] = useState("");

  api.task.events.useSubscription(
    { orgId, taskId },
    {
      onData: (event) => {
        if (event.taskId !== taskId) return;
        if (event.kind === "delta") {
          setLive((prev) => prev + event.text);
          return;
        }
        // Deltas for a turn are always published before that turn's persisted events,
        // so the stored copy replaces the streamed one.
        if (event.kind === "run") setLive("");
        void utils.task.get.invalidate({ taskId });
      },
    },
  );

  if (!task.data) return <p className="text-sm text-stone-500">Loading...</p>;
  const t = task.data;
  const active = t.status === "queued" || t.status === "running";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href={`/org/${orgId}`} className="text-sm text-stone-500 hover:text-stone-900">
          Back to board
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
          <StatusBadge status={t.status} />
          {t.visibility === "private" ? <span className="text-xs text-stone-500">private</span> : null}
        </div>
        <p className="text-sm text-stone-500">Assigned by {t.createdByName}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">Run</h2>
          <div className="rounded border border-stone-200 bg-white p-3 text-sm whitespace-pre-wrap">{t.prompt}</div>
          <ol className="space-y-2">
            {t.events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
            {live ? (
              <li className="rounded border border-sky-200 bg-white p-3 text-sm whitespace-pre-wrap">{live}</li>
            ) : null}
          </ol>
          {active && t.canContribute ? <SteerForm taskId={taskId} /> : null}
        </section>

        {t.status === "review" || t.status === "approved" ? <DraftEditor key={t.id} task={t} /> : null}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: RunEvent }) {
  const p = event.payload;
  switch (event.type) {
    case "status":
      return <li className="text-xs text-stone-500">Status: {String(p.status)}</li>;
    case "text":
      return (
        <li className="rounded border border-stone-200 bg-white p-3 text-sm whitespace-pre-wrap">{String(p.text)}</li>
      );
    case "tool_call":
      return (
        <li className="font-mono text-xs text-stone-600">
          {String(p.name)}({JSON.stringify(p.input)})
        </li>
      );
    case "tool_result":
      return (
        <li>
          <details className="text-xs">
            <summary className={p.isError ? "text-red-700" : "text-stone-500"}>
              {String(p.name)} {p.isError ? "failed" : "returned"}
            </summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-stone-100 p-2 whitespace-pre-wrap">
              {String(p.content)}
            </pre>
          </details>
        </li>
      );
    case "steer":
      return (
        <li className="ml-8 rounded bg-stone-900 p-2 text-sm text-white">
          <span className="text-stone-400">{event.userName}: </span>
          {String(p.text)}
        </li>
      );
    case "error":
      return <li className="rounded bg-red-50 p-2 text-sm text-red-800">{String(p.message)}</li>;
  }
}

function SteerForm({ taskId }: { taskId: string }) {
  const [text, setText] = useState("");
  const steer = api.task.steer.useMutation({ onSuccess: () => setText("") });
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        steer.mutate({ taskId, text });
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Steer the agent, e.g. keep it under 200 words"
        aria-label="Steering message"
        className="flex-1 rounded border border-stone-300 bg-white px-3 py-2 text-sm"
      />
      <button type="submit" disabled={!text.trim() || steer.isPending} className="btn-primary">
        Send
      </button>
    </form>
  );
}

function DraftEditor({ task }: { task: Task }) {
  const utils = api.useUtils();
  const [draft, setDraft] = useState(task.draft);
  const [baseVersion, setBaseVersion] = useState(task.draftVersion);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Refs so the autosave timer reads current values, not the ones from the keystroke that set it.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baseRef = useRef(baseVersion);
  baseRef.current = baseVersion;
  const readOnly = !task.canContribute || task.status !== "review";

  const save = api.task.saveDraft.useMutation({
    onSuccess: (res, vars) => {
      setBaseVersion(res.draftVersion);
      // Typing may have continued while the save was in flight.
      setDirty((d) => d && vars.draft !== draftRef.current);
    },
    onError: (err) => {
      if (err instanceof TRPCClientError && err.data?.code === "CONFLICT") setConflict(true);
    },
  });
  const approve = api.task.approve.useMutation({
    onSuccess: () => utils.task.get.invalidate({ taskId: task.id }),
  });

  // Someone else saved: take their version unless we have unsaved edits.
  useEffect(() => {
    if (task.draftVersion === baseVersion) return;
    // Our own save can come back through the subscription before the mutation resolves.
    if (task.draft === draftRef.current) {
      setBaseVersion(task.draftVersion);
      return;
    }
    if (dirty) {
      setConflict(true);
      return;
    }
    setDraft(task.draft);
    setBaseVersion(task.draftVersion);
  }, [task.draft, task.draftVersion, baseVersion, dirty]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = (value: string) => {
    setDraft(value);
    setDirty(true);
    clearTimeout(timer.current);
    if (conflict) return;
    timer.current = setTimeout(() => {
      save.mutate({ taskId: task.id, draft: draftRef.current, baseVersion: baseRef.current });
    }, AUTOSAVE_MS);
  };

  const takeTheirs = () => {
    setDraft(task.draft);
    setBaseVersion(task.draftVersion);
    setDirty(false);
    setConflict(false);
  };

  const editedBy = task.draftEditedByName ? `Last edited by ${task.draftEditedByName}` : "Written by the agent";
  const saveState = save.isPending ? "Saving..." : dirty ? "Unsaved" : "Saved";

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">Draft</h2>
        <span className="text-xs text-stone-500">
          {editedBy}
          {readOnly ? "" : ` · ${saveState}`}
        </span>
      </div>
      {conflict ? (
        <div className="flex items-center justify-between rounded bg-amber-50 p-2 text-sm text-amber-900">
          <span>{task.draftEditedByName ?? "Someone"} changed the draft while you were editing.</span>
          <button type="button" onClick={takeTheirs} className="btn-secondary">
            Load their version
          </button>
        </div>
      ) : null}
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        aria-label="Draft"
        rows={20}
        className="w-full rounded border border-stone-300 bg-white p-3 text-sm read-only:bg-stone-50"
      />
      {task.status === "review" && task.canContribute ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={dirty || conflict || approve.isPending}
            onClick={() => approve.mutate({ taskId: task.id, baseVersion })}
            className="btn-primary"
          >
            Approve
          </button>
          {approve.error ? <span className="text-sm text-red-700">{approve.error.message}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
