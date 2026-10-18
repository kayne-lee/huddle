import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";

import { canSeeTask } from "~/server/access";
import { db } from "~/server/db";
import { type Role, tasks } from "~/server/db/schema";

const MAX_FETCH_CHARS = 50_000;

export const toolDefinitions: Anthropic.Beta.Messages.BetaTool[] = [
  {
    name: "fetch_url",
    description:
      "Fetch a public http(s) URL and return its body as text. Use it to read a doc, issue or page the task refers to. HTML is returned raw.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute http or https URL" } },
      required: ["url"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "search_approved_tasks",
    description:
      "Search this org's approved tasks by keyword in the title or output. Returns up to 5 matches with their full approved output. Use it to reuse earlier work instead of starting from scratch.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Keyword or phrase" } },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
];

const FetchUrlInput = z.object({ url: z.string().url() });
const SearchInput = z.object({ query: z.string().min(1) });

// The agent acts with the permissions of the person who created the task.
export type ToolContext = { orgId: string; userId: string; role: Role };

export async function runTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<{ content: string; isError: boolean }> {
  try {
    switch (name) {
      case "fetch_url":
        return { content: await fetchUrl(FetchUrlInput.parse(input).url), isError: false };
      case "search_approved_tasks":
        return { content: await searchApprovedTasks(SearchInput.parse(input).query, ctx), isError: false };
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}

// Lexical check only; it stops the obvious cases, not DNS rebinding.
function isPrivateHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(hostname) ||
    hostname.startsWith("[")
  );
}

async function fetchUrl(raw: string): Promise<string> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https URLs are allowed");
  if (isPrivateHost(url.hostname)) throw new Error("Private and local addresses are not allowed");

  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url.href}`);
  const body = await res.text();
  return body.length > MAX_FETCH_CHARS
    ? `${body.slice(0, MAX_FETCH_CHARS)}\n\n[truncated: ${body.length - MAX_FETCH_CHARS} more characters]`
    : body;
}

async function searchApprovedTasks(query: string, ctx: ToolContext): Promise<string> {
  const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
  const rows = await db
    .select({
      title: tasks.title,
      draft: tasks.draft,
      createdById: tasks.createdById,
      visibility: tasks.visibility,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.orgId, ctx.orgId),
        eq(tasks.status, "approved"),
        or(ilike(tasks.title, pattern), ilike(tasks.draft, pattern)),
      ),
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(20);

  const visible = rows.filter((t) => canSeeTask(ctx.role, ctx.userId, t)).slice(0, 5);
  if (visible.length === 0) return "No approved tasks match.";
  return visible.map((t) => `## ${t.title}\n\n${t.draft}`).join("\n\n---\n\n");
}
