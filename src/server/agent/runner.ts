import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { memberships, runEvents, type TaskStatus, tasks } from "~/server/db/schema";
import { publishDelta, publishTaskChanged, recordEvent, type TaskScopeRow } from "~/server/events";
import { runTool, type ToolContext, toolDefinitions } from "./tools";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;

const MODEL = "claude-opus-5-5";
const MAX_TURNS = 12;
const DELTA_FLUSH_MS = 150;

const SYSTEM_PROMPT = `You are the shared agent for a team workspace called Huddle. A teammate assigned you a task. Your final message is a draft that the team will review, edit and approve, so make it the finished deliverable itself: no preamble, no sign-off, no description of what you did.

Teammates may add steering messages while you work. They arrive as user messages starting with "[steer from NAME]". Follow the most recent steering when it conflicts with the original task.

Use tools only when the task needs outside information. If a tool fails, say what you could not access in the draft instead of guessing.`;

let client: Anthropic | undefined;

export async function runTask(taskId: string): Promise<void> {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) return;
  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.orgId, task.orgId), eq(memberships.userId, task.createdById)),
  });
  if (!membership) return;

  const toolCtx: ToolContext = { orgId: task.orgId, userId: task.createdById, role: membership.role };

  try {
    await setStatus(task, "running");
    const draft = await agentLoop(task, toolCtx);
    await db
      .update(tasks)
      .set({ status: "review", draft, draftVersion: sql`${tasks.draftVersion} + 1`, draftEditedById: null })
      .where(eq(tasks.id, task.id));
    await recordEvent(task, "status", { status: "review" });
    await publishTaskChanged(task);
  } catch (err) {
    await recordEvent(task, "error", { message: describeError(err) });
    await setStatus(task, "failed");
  }
}

async function agentLoop(task: TaskScopeRow & { prompt: string }, toolCtx: ToolContext): Promise<string> {
  const messages: MessageParam[] = [{ role: "user", content: task.prompt }];
  let finalText = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const last = messages.at(-1);
    if (last?.role === "user") {
      last.content = [...asBlocks(last.content), ...(await takeSteering(task.id))];
    }

    const message = await streamTurn(task, messages);
    messages.push({ role: "assistant", content: message.content });

    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text) {
      finalText = text;
      await recordEvent(task, "text", { text });
    }

    if (message.stop_reason === "refusal") throw new Error("The model declined this task.");
    if (message.stop_reason === "max_tokens") throw new Error("The response hit the output token limit.");

    const toolUses = message.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      // Steering that arrived while the model was finishing still deserves a turn.
      const steering = await takeSteering(task.id);
      if (steering.length === 0) return finalText;
      messages.push({ role: "user", content: steering });
      continue;
    }

    const results = await Promise.all(
      toolUses.map(async (call) => {
        await recordEvent(task, "tool_call", { id: call.id, name: call.name, input: call.input });
        const result = await runTool(call.name, call.input, toolCtx);
        await recordEvent(task, "tool_result", { id: call.id, name: call.name, ...result });
        return {
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: result.content,
          is_error: result.isError,
        };
      }),
    );
    messages.push({ role: "user", content: results });
  }

  throw new Error(`Stopped after ${MAX_TURNS} turns without finishing.`);
}

async function streamTurn(task: TaskScopeRow, messages: MessageParam[]) {
  // Created on first use so a missing API key fails one task, not the whole server.
  client ??= new Anthropic();
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64_000,
    system: SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    tools: toolDefinitions,
    messages,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  // Batch token deltas so a long answer is a few dozen NOTIFYs, not thousands.
  let pending = "";
  let flushing = Promise.resolve();
  const flush = () => {
    if (!pending) return;
    const text = pending;
    pending = "";
    flushing = flushing.then(() => publishDelta(task, text));
  };
  const timer = setInterval(flush, DELTA_FLUSH_MS);
  stream.on("text", (delta) => {
    pending += delta;
  });

  try {
    return await stream.finalMessage();
  } finally {
    clearInterval(timer);
    flush();
    await flushing;
  }
}

async function takeSteering(taskId: string): Promise<ContentBlockParam[]> {
  const rows = await db.query.runEvents.findMany({
    where: and(eq(runEvents.taskId, taskId), eq(runEvents.type, "steer"), eq(runEvents.consumed, false)),
    with: { user: { columns: { name: true } } },
    orderBy: asc(runEvents.id),
  });
  if (rows.length === 0) return [];
  await db
    .update(runEvents)
    .set({ consumed: true })
    .where(
      inArray(
        runEvents.id,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) => ({
    type: "text" as const,
    text: `[steer from ${r.user?.name ?? "a teammate"}] ${String(r.payload.text)}`,
  }));
}

function asBlocks(content: MessageParam["content"]): ContentBlockParam[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

async function setStatus(task: TaskScopeRow, status: TaskStatus) {
  await db.update(tasks).set({ status }).where(eq(tasks.id, task.id));
  await recordEvent(task, "status", { status });
  await publishTaskChanged(task);
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError)
    return "Anthropic API key is missing or invalid. Set ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Try again shortly.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ""}: ${err.message}`;
  if (!process.env.ANTHROPIC_API_KEY)
    return "No Anthropic credentials. Set ANTHROPIC_API_KEY in .env and restart the server.";
  if (err instanceof Error) return err.message;
  return String(err);
}
