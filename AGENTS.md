# Working rules

Read `docs/ARCHITECTURE.md` before changing code. `shared/types.ts` is the contract between the hub and the web app; change it first and update both sides together.

## Product

- Agentry is local first. It runs on the person's computer, drives the agents installed there, and never runs a model itself.
- Preserve each agent's native behavior: its own login, tools, models, modes, permission prompts and memory. Show what the agent reports; do not invent capabilities.
- The interface is a calm chat layout: a list, one conversation, an optional side panel. Chat and Code share one visual system. Add a control only when the current task needs it.
- The first run must need no forms: open the icon, see the installed agents, start talking.

## Code

- TypeScript everywhere. The server runs directly on Node 24 (type stripping), so use only erasable syntax and `.ts` import paths.
- Plain, small modules. No speculative options, silent fallbacks, broad try/catch or retry loops. Validate input where it enters the hub and let internal faults surface.
- Behavior-affecting numbers (limits, intervals, ports) need a stated reason in a comment.
- Keep user data, credentials and private conversations out of the repository.

## Checks

- `npm run check` (types), `npm test` (focused behavior tests), `npm run build`.
- Test the behavior you changed with a real agent when it touches the agent host. Record what you observed in the pull request.
- Write repository text in short, plain English.
