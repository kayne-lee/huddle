import Link from "next/link";

import { OrgForms } from "~/app/_components/org-forms";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function Home() {
  const session = await auth();
  if (!session) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Run agent tasks as a team</h1>
        <p className="text-stone-600">
          Assign a task, watch the agent work, steer it while it runs, then review and approve the draft together.
        </p>
        <Link href="/api/auth/signin" className="inline-block rounded bg-stone-900 px-4 py-2 text-sm text-white">
          Sign in
        </Link>
      </div>
    );
  }

  const orgs = await api.org.list();
  return (
    <div className="max-w-md space-y-8">
      <section className="space-y-3">
        <h1 className="text-lg font-semibold">Your orgs</h1>
        {orgs.length === 0 ? (
          <p className="text-sm text-stone-500">You are not in any org yet.</p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded border border-stone-200 bg-white">
            {orgs.map((org) => (
              <li key={org.id}>
                <Link href={`/org/${org.id}`} className="flex justify-between px-4 py-3 hover:bg-stone-50">
                  <span>{org.name}</span>
                  <span className="text-sm text-stone-500">{org.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <OrgForms />
    </div>
  );
}
