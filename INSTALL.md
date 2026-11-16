# Install Dango

**This file is written for an AI agent** (Codex, Claude Code, Antigravity or similar) that a person asked to install Dango. Follow it from top to bottom on the person's computer. Run each command and check its result before the next step. Do not ask the person to type anything unless a step says so.

Dango is a local web app. It finds the agents installed on this computer and lets the person chat with them in one page, alone or in groups. It needs no account and no API key.

## 1. Check the tools

```sh
node --version
git --version
```

- Node.js must be **24 or later**. If it is missing or older, install the current LTS: `winget install OpenJS.NodeJS.LTS` (Windows), `brew install node` (macOS), or the distribution's package (Linux). Then open a new shell so `node` is on PATH.
- If `git` is missing: `winget install Git.Git` (Windows), `xcode-select --install` (macOS), or the distribution's package (Linux).
- On macOS, if `git` says the Xcode license is not agreed, ask the person to run `sudo xcodebuild -license accept` in Terminal. It needs their password, so they must type it themselves.

## 2. Get the code

Clone into the person's home folder unless they named another place. Do not move the folder afterwards: the desktop icon points to it.

```sh
cd ~
git clone https://github.com/TaoMachina/dango.git
cd dango
```

If the folder already exists, run `git pull` inside it instead.

## 3. Install and set up

```sh
npm install
npm run setup
```

`npm run setup` builds the web app, adds a **Dango** icon to the desktop and the app menu (Start menu on Windows, `~/Applications` on macOS, the applications menu on Linux), starts Dango in the background and opens it in the default browser.

## 4. Check it worked

Open http://127.0.0.1:7420/api/health. It must answer `{"ok":true}`. If it does not, read `~/.dango/hub.log` and fix the reported problem, then run `npm run setup` again.

## 5. Tell the person

Say this, in the person's language:

> Dango is installed. Double-click the **Dango** icon on your desktop. Your agents are already listed in Chat — click one to start talking. You can rename them and change their faces.

If an agent shows **Needs sign-in**, tell the person to sign in once with that agent's own command, for example `claude`, `codex` or `agy acp --login`.

## Later

- Update: in the same folder run `git pull`, `npm install` and `npm run setup`.
- An agent installed later does not appear: run `npm run setup` again so the icon knows where it is.
- Data lives in `~/.dango`. Removing the code folder keeps it.
- Port 7420 is the default. Set `DANGO_PORT` before `npm run setup` if another program uses it.
