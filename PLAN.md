# Plan

Each milestone ends with `npm run check` passing and a manual two-browser test of what it added.

- [x] 1. Orgs, roles and the task board: GitHub and dev login, create and join orgs, admin/member/viewer roles, private tasks.
- [x] 2. Agent runner: a streaming tool-use loop with `fetch_url` and `search_approved_tasks`, every step stored as a run event.
- [x] 3. Live updates: tRPC subscriptions over SSE backed by Postgres LISTEN/NOTIFY, with per-user visibility filtering on the stream.
- [x] 4. Steering: teammates send messages while a run is in progress and the agent reads them on its next turn.
- [x] 5. Shared review: autosaved draft edits with version checks, conflict handling and approval.
- [ ] 6. Presence: show who is viewing a task and who is typing in the draft.
- [ ] 7. Concurrent editing: replace version-checked saves with a Yjs document so two people can type in the draft at once.
- [ ] 8. Durable runs: move the runner out of the web process into a job queue so a restart does not strand tasks in `running`, and allow re-running a failed task.
- [ ] 9. Deploy: Railway or Fly with managed Postgres, plus a README demo GIF and architecture diagram.
