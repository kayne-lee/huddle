# Huddle

A multiplayer workspace for agent tasks. Someone on the team assigns a task, a Claude agent runs it, and everyone in the org sees the run as it streams. Anyone can steer the agent mid-run. When it finishes, the team edits the draft together and one person approves it.

Built on the T3 stack: Next.js App Router, tRPC v11, Drizzle + Postgres, NextAuth v5 and Tailwind v4.

## What it does

- **Orgs and roles.** Admins, members and viewers. Viewers can watch but not create, steer, edit or approve. A task can be private to its creator and the org's admins.
- **Live runs.** Token output, tool calls and status changes reach every viewer in real time.
- **Steering.** Messages sent while the agent works are added to its next turn, attributed to the sender.
- **Shared review.** The draft autosaves. If two people edit at once, the slower save is rejected and that person sees whose change came in.
- **Org memory.** The agent can search the org's approved tasks and reuse earlier work, limited to tasks the task's creator is allowed to see.

## How the real-time path works

```
agent loop ──► recordEvent ──► Postgres insert + NOTIFY huddle_events
                                           │
                     every server instance LISTENs
                                           │
                          in-process emitter keyed by org
                                           │
             tRPC subscription per browser (SSE), filtered by canSeeTask
```

Each event carries the task's org, creator and visibility, so a subscription can drop events the user may not see without querying the database. Token deltas are batched every 150 ms and only sent to clients watching that task.

## Running locally

Requires Node 20+ and Docker.

```sh
npm install
cp .env.example .env            # then set ANTHROPIC_API_KEY
docker run -d --name huddle-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=huddle -p 5432:5432 postgres:17
npm run db:push
npm run dev
```

In development, the sign-in page has a "Dev login" that accepts any name. Sign in as different names in two browser profiles to try it as two teammates: one creates an org, the other joins with the code shown on the board.

To sign in with GitHub, create an OAuth app with callback `http://localhost:3000/api/auth/callback/github` and set `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`.

## Checks

`npm run check` runs Biome, the TypeScript compiler, the unit tests and `scripts/slop-check.sh`, which fails on emoji, filler words, type escapes and comments that narrate code.

## Known limits

- The agent runs inside the web server process. Restarting the server strands any task that was running. Milestone 8 in [PLAN.md](PLAN.md) moves runs to a job queue.
- A subscription reads the user's role once, when it connects. A role change applies the next time the page reconnects.
- `fetch_url` blocks private and local hostnames by name only. It does not resolve DNS first.
