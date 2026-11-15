# Install Rea (instructions for an agent)

You are installing Rea for the person you work for. Rea is a local web app: it runs on this computer and shows every agent installed here (Claude Code, Codex, Gemini CLI, OpenClaw, Hermes, Goose, OpenCode and others) in one chat page.

Do these steps on the person's computer, in order. Run each command and check it succeeded before the next one.

1. Check Node.js. Run `node --version`. Rea needs version 24 or later. If Node is missing or older, install the current LTS from https://nodejs.org (or with the system package manager: `winget install OpenJS.NodeJS.LTS`, `brew install node`, or the distribution's package) and open a new shell.
2. Get the code. Choose a folder the person keeps programs in (for example their home folder) and run:
   ```sh
   git clone https://github.com/<owner>/rea.git
   cd rea
   ```
   If `git` is missing, download the repository ZIP from GitHub and extract it instead.
3. Install dependencies:
   ```sh
   npm install
   ```
4. Build Rea, add the desktop icon, and open it:
   ```sh
   npm run setup
   ```
   This adds a **Rea** icon to the desktop and the app menu, starts Rea in the background, and opens it in the default browser.
5. Tell the person: "Rea is installed. Open the Rea icon on your desktop. Your agents are already listed in Chat."

Rea needs no API key and no account. Each agent keeps its own login. If an agent shows **Needs sign-in** in Rea, the person signs in once with that agent's own command (for example `claude`, `codex` or `gemini`).

To update later, run `git pull`, `npm install` and `npm run setup` in the same folder. Conversations are kept in `~/.rea`.
