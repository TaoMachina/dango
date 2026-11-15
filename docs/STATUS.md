# Status and handoff

Last updated: 2026-11-16, end of the first build session. Read this, `AGENTS.md` and `docs/ARCHITECTURE.md` before continuing.

## Where things stand

Agentry is a working local app. It was rebuilt from scratch on 2026-11-15; the earlier implementation (then called "Rea") is archived outside the repository at `D:\rea-legacy-2026-11-15.zip`. All work is committed on `main` in this local repository. **Nothing is pushed**: the GitHub owner is not decided, and `README.md` / `INSTALL.md` still say `<owner>`.

The person's own install is live on their Windows computer: desktop and Start menu icon **Agentry**, hub on `http://127.0.0.1:7420`, data in `~/.agentry`. After code changes, run `npm run setup` (it rebuilds, stops the running hub and starts the new one) or restart the hub by hand.

## What works, and how it was verified

Checks: `npm run check` (types), `npm test` (55 focused tests, fake ACP agents, files in `test/`), `npm run build`. Real-agent checks used Claude Code (cheapest: Haiku) and Codex (cheapest: 6 Luna) installed on the person's computer.

| Area | Behavior | Verified |
| --- | --- | --- |
| Install | `npm run setup` builds, adds the desktop/Start menu icon, starts the hub hidden, opens the browser signed in; a rerun replaces a running hub | Real, Windows |
| Detection | Installed ACP agents appear in Chat with their own chat and face; Antigravity (`agy acp`) replaced Gemini CLI | Real (Claude Code, Codex); Antigravity, OpenClaw, Hermes, Goose, OpenCode, Pi not installed here |
| Chat | Streaming replies, native tool calls, model + effort picker (latest model per family), context ring, permissions as cards, Stop | Real |
| Groups | Lead gets unmentioned messages, `@Name` routing, agent-to-agent handoffs with a limit, lead reviews members' answers, per-member model/effort, recipient hint | Real (Claude lead + Codex) |
| Agentry context | Every session is told its tools, role, members and helpers (appended to the native system prompt where supported) | Real |
| Code | Task box with model-first picker across agents, effort, mode, project or auto-created folder; work-log timeline; overview panel (where, context, plan, subagents, outputs, chapters); fork latest turn; pin chapters | Real (Codex 6 Luna) |
| Chat → Code | Chat agents start Code threads for coding work (`agentry_start_code_task`); direct edits from chat add the project to Code and are reported | Real (Claude) |
| Subagents | Live ACP `subagent_update` parts; subagent model per agent (Claude: `CLAUDE_CODE_SUBAGENT_MODEL`, Codex: `agents.default_subagent_model` via `CODEX_CONFIG`) | Real (both) |
| Delegation | A Code thread's agent hands work to other agents (helpers) in the same folder: `agentry_delegate` / `agentry_wait_for_helper`, 50 s wait budget under Codex's 60 s MCP tool timeout | Real (Claude → Codex) |
| Add agent | Copy an instruction (plain HTTP) → the agent joins under its own name and greets | Real (Claude Code CLI pasted it) |
| Cloud agents | Connect by URL to an OpenAI-compatible API (Hermes, OpenClaw) | Fake server only; no real hosted agent tried |
| Routines | Daily / weekly / interval / once schedules | Tests only |
| macOS / Linux | Setup creates `~/Applications/Agentry.app` / `.desktop` launchers | **Not verified.** Two attempts to run the checks on the person's Mac mini stopped at the `mac-mini` bridge's `mac_prepare_workspace`, which gave no response for 30 minutes — the second time with only the 114 tracked source files included, so the bridge sync itself is the suspect |

## Known limits (not bugs)

- **Hosted agents without an API** (for example Instinct) cannot be woken: the hub is loopback-only and such products offer no public inbound interface. A shared/public hub is future work.
- **Pasted-instruction agents** only receive work while they keep an inbox request running.
- **Fork** copies the native session whole, so it is offered only on the latest turn.
- **Subagent prompts and replies** (`session_message` updates) are not stored; the subagent part shows the latest activity line only.
- A helper's permission request appears in the child thread; the parent shows "Needs input" with Open.
- `node:sqlite` prints an ExperimentalWarning to the hub log.

## Next steps, in order

1. Decide the GitHub owner, replace `<owner>` in `README.md` and `INSTALL.md`, push, and test the real "give the repo URL to Codex" install on a clean machine or user account.
2. Verify install, `npm test` and the launcher on macOS and Linux (the Mac mini bridge sync needs fixing first, or copy the repo there by git).
3. Try a real hosted Hermes or OpenClaw through Connect by URL (session header behavior is from their docs, not observed).
4. Test with OpenClaw / Hermes / Antigravity installed locally (catalog entries exist; `agy acp --login` for Antigravity sign-in).
5. Consider storing subagent `session_message` content so a subagent row can expand to its full prompt and answer.
6. Sharing beyond this computer (friends' agents, phone): a reachable hub with per-person accounts; design not started. `Environment` already exists in the data model for remote computers.

## Working notes for the next agent

- Talk to the person in Chinese; write everything in the repository in English.
- The person decides product experience; technical choices are yours, explained from first principles. They gave Claude the orchestrator role; subagents are fine, and reviews or docs can go to cheaper models.
- Visual references: Grok Bot (Chat) and T3 Code (Code). A T3 Code source copy for reference lives in `.local/design-references/t3code-current` (ignored by git; its own AGENTS.md is for T3 contributors, not for us).
- Machine specifics: Git is at `H:\git hub\Git` (the hub derives `CLAUDE_CODE_GIT_BASH_PATH` from `git` on PATH); the person's old Rea data and the legacy `~/.rea/connections` folder were left in place.
- Test hubs must use a scratch `AGENTRY_HOME` and another port; never point tests at `~/.agentry`.
