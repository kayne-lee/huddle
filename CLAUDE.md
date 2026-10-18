# Huddle

A multiplayer workspace for agent tasks. A teammate assigns a task, a Claude agent runs it, everyone in the org watches the run stream live, anyone can steer it mid-run, and the team edits and approves the draft together.

T3 stack: Next.js App Router, tRPC v11, Drizzle + Postgres, NextAuth v5, Tailwind v4. Biome for lint and format, Vitest for tests.

## Commands

- `npm run dev`: dev server on :3000
- `npm run check`: Biome, `tsc`, Vitest, then `scripts/slop-check.sh`. Must pass before a turn ends; the Stop hook enforces it.
- `npm run format`: apply Biome fixes
- `npm run db:push`: sync `src/server/db/schema.ts` to the database
- Local Postgres: `docker start huddle-postgres` (see README for first-time setup)

## Where things live

- `src/server/access.ts`: every permission rule. Pure functions, unit tested. Add rules here, never inline.
- `src/server/api/membership.ts`: `requireRole` and `requireVisibleTask`. Every procedure that touches an org or task goes through one of them.
- `src/server/realtime.ts`: Postgres LISTEN/NOTIFY fan-out. Events carry the task's visibility so subscriptions filter without a query.
- `src/server/events.ts`: `recordEvent` (persist + publish) and `publishTaskChanged`. Anything that changes a task must publish.
- `src/server/agent/`: the agent loop (`runner.ts`) and its tools (`tools.ts`). Uses `client.beta.messages.stream` with `claude-opus-5-5`.
- `src/server/api/routers/`: `org` and `task` routers. `task.events` is the one subscription.
- `src/app/_components/`: client components. `task-view.tsx` holds the live run, steering and draft editor.

## Invariants

- A user who cannot see a task gets `NOT_FOUND`, never `FORBIDDEN`, so private tasks do not leak their existence. This includes the subscription: filter with `canSeeTask` before yielding.
- Draft writes and approvals are compare-and-swap on `draftVersion`. Do not add a write path that skips the version check.
- The agent acts with the permissions of the task's creator (`ToolContext`).
- Message history sent to the model is append-only. Steering is added to the next user turn, never by editing earlier turns.

## Writing rules

These apply to code, comments, UI text, docs, commits and PR descriptions.

Code
- Write the smallest change that does the job. No helpers with one caller, no options nobody passes, no config for needs that do not exist yet.
- Do not guard against states the types or schema rule out. No try/catch that only logs and continues.
- No `any`, `@ts-ignore`, or non-null `!`. Fix the type.
- Match the surrounding code's naming and style rather than introducing a new pattern.

Comments
- Default to none. Write one only when the reason for the code is not obvious from the code: a constraint, a race, a workaround, a non-obvious invariant.
- Never narrate ("Create the user", "Loop over tasks"), never describe the edit ("now uses X", "updated to"), never leave JSDoc that repeats the signature.

UI text
- Plain, specific and short. Say what happened or what to do. No "Oops", "Successfully", exclamation marks or emoji.

Docs
- Lead with what the thing does and how to run it. Cut adjectives that do not carry information. Do not restate a heading in the sentence under it or summarize what the reader just read.

Commits and PRs
- Imperative subject under 72 characters that says what changed for the user or the system. The body explains why when the subject cannot.
- No AI attribution: no `Co-Authored-By` trailer for Claude and no "Generated with Claude Code" footer.

## Before committing

Run `npm run check`, then use the `slop-reviewer` subagent on the diff and fix what it reports.

## Plan

Milestones are in `PLAN.md`. Work on one at a time, and update its checkbox when it is done.
