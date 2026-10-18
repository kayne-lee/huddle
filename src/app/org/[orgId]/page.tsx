import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { Board } from "~/app/_components/board";
import { api } from "~/trpc/server";

export default async function OrgPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const org = await api.org.get({ orgId }).catch((err: unknown) => {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") notFound();
    throw err;
  });
  return <Board org={org} />;
}
