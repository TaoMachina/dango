# Architecture

## Outcome

A person gives this repository's URL to a coding agent such as Codex. The agent installs Dango and creates a desktop icon. The person opens the icon. Dango starts in the background and opens the default browser. The Chat screen already lists every agent installed on the computer. The person can rename an agent, change its avatar, chat with it, put several agents in a group, schedule routines, and start coding work in Code.

Everything runs on the person's computer. Dango does not run models. Each agent keeps its own login, subscription, tools, memory and permission rules.

## Parts

```text
browser  ──HTTP + SSE──▶  hub (Node, 127.0.0.1)  ──ACP over stdio──▶  local agents
                              │                     (Claude Code, Codex, Antigravity, OpenClaw, Hermes, Goose, ...)
                              ├── SQLite (~/.dango/dango.db)
                              ├── routines (scheduler)
                              ├── dango MCP tools ◀── agents call them (stdio bridge)
                              ├── external agent API ◀── agents without ACP (HTTP, token)
                              └── url agents ──HTTPS──▶ hosted agents' OpenAI-compatible APIs
```

- **Hub** (`server/`): one Node process. It serves the web app, stores conversations, routes messages, runs routines, and drives agents.
- **Web app** (`web/`): React. Chat and Code share one visual system.
- **Agent host** (`server/acp/`): detects installed agents and talks to them with the [Agent Client Protocol](https://agentclientprotocol.com). One process per agent. One ACP session per agent per conversation.
- **Dango tools** (`server/mcp/`): an MCP server passed to every ACP session. Agents use it to read group membership, list projects and their threads, start Code tasks, read a Code thread's progress and result, create routines, and delegate to helpers (`dango_list_helpers`, `dango_delegate`, `dango_wait_for_helper`).
- **Dango context** (`server/acp/context.ts`): a short text that tells each agent who it is in Dango and what it can do — its tools, and in a group the members, the lead and how to hand off with `@Name`. Agents that support it receive it appended to their native system prompt; others receive it before their first prompt. In a Code thread it lists the enabled helpers with their model and effort. Membership and helper changes reach existing sessions as a one-line update.
- **Delegation** (`server/mcp/tools.ts`, `server/helpers.ts`): a Code thread's main agent can hand work to another installed coding agent, its helper. The person enables helpers and picks each one's model and effort in the thread's panel; new threads start from the last settings. `dango_delegate` starts the helper in a child Code thread in the same project, applies those choices before its first prompt, posts the task as coming from the main agent, and shows the child as a live subagent of the main agent's reply, with Open. Open shows the child thread in the right panel beside the parent; Back returns to the panel or closes it. It waits up to 50 s for the answer, below Codex's default 60 s MCP tool timeout; a longer task returns a `delegationId` for `dango_wait_for_helper`. Stop in the parent thread stops its children. Child threads have no helpers of their own and are hidden from the Code list. The agent's own native subagents are unaffected.
- **External agents**: an agent that cannot be launched over ACP joins by pasting an instruction. It reads its inbox and posts replies over HTTP with its own token.
- **URL agents** (`server/url-agent.ts`): an agent hosted elsewhere (for example Hermes or OpenClaw in the cloud) cannot call a hub on `127.0.0.1`, but the hub can call out. The person enters the agent's OpenAI-compatible API URL and key. Each run posts the Dango context and the latest 40 messages to `/v1/chat/completions` and streams the reply. The key stays in the hub database.

## Why these choices

- **Local first.** Subscriptions are used through each vendor's own CLI on the person's computer. Personal agents also run there. The hub therefore runs there too, and needs no account or server.
- **ACP.** Claude Code, Codex, Antigravity CLI, OpenClaw, Hermes, Goose, OpenCode and Pi all accept ACP directly or through a published adapter. One protocol covers detection, sessions, streaming, tool activity, model and mode choice, permission requests and cancellation.
- **One persistent chat per agent.** An agent in the sidebar is a teammate with one ongoing conversation. Groups and Code threads are separate conversations with their own sessions.
- **Bundled adapters.** Claude Code and Codex speak ACP through `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp`. Dango installs pinned versions so the first chat does not wait for a download, and runs them with Node directly (no shell), which also lets Stop and Quit end their whole process tree on Windows. Both reuse the existing `~/.claude` and `~/.codex` logins.
- **Native settings.** Model, mode, effort and similar choices are the agent's ACP session config options. Dango shows whatever the agent reports and sets them with `session/set_config_option`.
- **Native permissions.** Dango does not advertise file-system or terminal client capabilities. Agents use their own tools. A permission request from an agent appears as a card in the conversation with the agent's own options.
- **SQLite through `node:sqlite`, SSE, no build step for the server.** Node 24 runs the TypeScript server directly. The only native code is in the agents.

## Environments

An environment is the computer where an agent runs. Version 1 has one: this computer. Every agent and project records its environment. A later remote connector registers another computer (for example a personal agent's own machine) as another environment; its agents then appear with that environment's name, and Code lets the person choose the environment before choosing an agent and folder.

## Routing

| Event | Recipients |
| --- | --- |
| Message in an agent's chat | That agent |
| Group message without a mention | The group lead |
| Group message with `@Name` mentions | Each mentioned agent |
| Agent reply that mentions another member | That member, as part of the same request |
| Routine fires | Its agent, in its conversation |

Every agent turn is a **run** with an ID, a status and an optional parent run. A request and all runs it triggers form one tree. **Stop** cancels every active run in the conversation. Agent-to-agent mentions stop after the group's hop limit; the default of 3 lets a lead hand off, a member answer and the lead sum up without loops, and is a setting.

An agent in a group receives the messages it has not yet seen, each prefixed with its author, so every member shares the room context while keeping its own session.

## Security

The hub listens on `127.0.0.1` only. A random key in `~/.dango/key` is exchanged for an HttpOnly, SameSite=Strict cookie when the launcher opens the browser. Every API request needs that cookie and a loopback `Host` header, which blocks other websites and DNS-rebinding pages. External agents use per-agent bearer tokens.

## Data

`~/.dango/` holds `dango.db`, `key`, `hub.json` (port and PID) and `hub.log`. Chat and group sessions work in `~/Dango/chat`; projects created by name go in `~/Dango/projects`. Chat and group conversations show only the model and effort choices and keep each agent's native mode; Code threads show every option the agent reports. Removing the repository keeps the data.
