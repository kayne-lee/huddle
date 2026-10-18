"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "~/trpc/react";

export function OrgForms() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const create = api.org.create.useMutation({ onSuccess: (org) => router.push(`/org/${org.id}`) });
  const join = api.org.join.useMutation({ onSuccess: (org) => router.push(`/org/${org.id}`) });

  return (
    <div className="space-y-6">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ name });
        }}
      >
        <label className="block text-sm font-medium" htmlFor="org-name">
          Create an org
        </label>
        <div className="flex gap-2">
          <input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme"
            className="flex-1 rounded border border-stone-300 bg-white px-3 py-2 text-sm"
          />
          <button type="submit" disabled={!name.trim() || create.isPending} className="btn-primary">
            Create
          </button>
        </div>
      </form>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          join.mutate({ code });
        }}
      >
        <label className="block text-sm font-medium" htmlFor="join-code">
          Join with a code
        </label>
        <div className="flex gap-2">
          <input
            id="join-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="flex-1 rounded border border-stone-300 bg-white px-3 py-2 font-mono text-sm"
          />
          <button type="submit" disabled={!code.trim() || join.isPending} className="btn-secondary">
            Join
          </button>
        </div>
        {join.error ? <p className="text-sm text-red-700">{join.error.message}</p> : null}
      </form>
    </div>
  );
}
