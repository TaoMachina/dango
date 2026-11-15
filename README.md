# Agentry

Chat with every agent on your computer in one page.

> **AI agents:** if a person asked you to install Agentry, follow [INSTALL.md](INSTALL.md) step by step.

Agentry finds the agents you already have — Claude Code, Codex, Antigravity, OpenClaw, Hermes, Goose, OpenCode, Pi and others — and lists them as teammates. Give them names and faces, talk to one, put several in a group and let them hand work to each other, schedule routines, and run coding threads in your project folders.

Agentry runs on your computer. It needs no account and no API key: every agent keeps its own login, subscription, tools and permission rules. Agentry talks to them through the [Agent Client Protocol](https://agentclientprotocol.com).

## Install

The easy way: give your coding agent this repository's URL and say "install this". It follows [INSTALL.md](INSTALL.md), adds an Agentry icon to your desktop and tells you when it is ready.

By hand, with Node.js 24 or later:

```sh
git clone https://github.com/<owner>/agentry.git
cd agentry
npm install
npm run setup
```

`setup` builds the app, adds an **Agentry** icon to your desktop and app menu, and opens Agentry in your default browser. Next time, just click the icon.

## Use

- **Chat** — every detected agent has its own chat. Click a name or avatar to change it. **New group** puts agents together: a message without a mention goes to the group lead, `@Name` goes to that agent, and agents can `@` each other to hand off work. **Stop** halts everything running in the conversation.
- **Routines** — open the side panel of a chat or group and add a schedule. Agentry sends the prompt to the agent at that time.
- **Code** — add a project folder, start a thread with an agent, pick its model and mode, and follow its edits, commands and diffs. Agents can also start Code threads from Chat.
- **Add agent** — for an agent Agentry can't launch itself, copy the instruction and paste it into that agent. It joins and says hello.

Permission requests from an agent appear in the conversation with the agent's own choices.

## Develop

```sh
npm run dev       # hub with reload on http://127.0.0.1:7420
npm run dev:web   # web app with hot reload, proxied to the hub
npm run check     # types
npm test
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [AGENTS.md](AGENTS.md).

## License

MIT. See [LICENSE](LICENSE).
