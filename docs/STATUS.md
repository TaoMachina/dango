# Status

Last updated: 2026-11-16. Read this, `AGENTS.md` and `docs/ARCHITECTURE.md` before changing code.

Dango is an early preview (0.x). It is used daily on Windows and was verified on macOS. The Linux launcher has not been verified yet.

## What works, and how it was verified

Checks: `npm run check` (types), `npm test` (focused tests with fake ACP agents, in `test/`), `npm run build`. Real-agent checks use Claude Code and Codex on their cheapest models.

| Area | Behavior | Verified |
| --- | --- | --- |
| Install | `npm run setup` builds, adds the desktop and app-menu icon, starts the hub hidden and opens the browser signed in; a rerun replaces a running hub | Windows; macOS 26.7 (Apple silicon) |
| Detection | Installed ACP agents appear in Chat with their own chat and face | Claude Code, Codex; OpenClaw and Pi detected on macOS. Antigravity, Hermes, Goose and OpenCode have catalog entries but were not tried |
| Chat | Streaming replies, native tool calls, model and effort picker, context ring, permissions as cards, Stop | Real agents |
| Groups | Lead gets unmentioned messages, `@Name` routing, agent-to-agent handoffs with a limit, lead reviews members' answers, per-member model and effort | Claude Code lead with Codex |
| Dango context | Every session is told its tools, role, members and helpers | Real agents |
| Code | Task box with a model-first picker across agents, effort, mode, project or auto-created folder; work-log timeline; overview panel (where, context, plan, subagents, outputs, chapters); fork the latest turn; pin chapters | Codex |
| Chat → Code | Chat agents start Code threads for coding work; direct edits from chat add the project to Code | Claude Code |
| Subagents | Live ACP `subagent_update` parts; subagent model per agent | Claude Code, Codex |
| Delegation | A Code thread's agent hands work to helper agents in the same folder; the helper's thread opens in the right panel | Claude Code → Codex |
| Add agent | Copy an instruction; the agent joins under its own name and greets | Claude Code CLI |
| Cloud agents | Connect by URL to an OpenAI-compatible API | Fake server only |
| Routines | Daily, weekly, interval and one-time schedules | Tests only |
| macOS | Setup creates `~/Applications/Dango.app` and a desktop link. The app keeps setup's PATH, because apps opened from Finder get only the system PATH and would find no agents | Fresh download on macOS 26.7: check, build and 54 of 55 tests pass (the git-branch test needs the Xcode license accepted). Opened with `open Dango.app`, Claude Code and Codex each answered a chat message |
| Linux | Setup creates a `.desktop` launcher | Not verified |

## Known limits

- Hosted agents without an API cannot be woken: the hub listens on loopback only, and such products offer no inbound interface. A shared hub is future work.
- Pasted-instruction agents only receive work while they keep an inbox request running.
- Fork copies the native session whole, so it is offered only on the latest turn.
- Subagent prompts and replies (`session_message` updates) are not stored; a subagent row shows its latest activity line only.
- `node:sqlite` prints an ExperimentalWarning to the hub log.

## Next steps

1. Verify install, tests and the launcher on Linux.
2. Try a real hosted Hermes or OpenClaw through Connect by URL.
3. Test with OpenClaw, Hermes and Antigravity installed locally (`agy acp --login` signs in to Antigravity).
4. Store subagent `session_message` content so a subagent row can expand to its full prompt and answer.
5. Sharing beyond one computer (friends' agents, phone): a reachable hub with per-person accounts. `Environment` already exists in the data model for remote computers.

## Notes for contributors

- Write repository text in plain English.
- Test hubs must use a scratch `DANGO_HOME` and another port; never point tests at `~/.dango`.
