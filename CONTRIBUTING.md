# Contributing

Thanks for helping. Agentry is an early preview, so issues that describe a real problem with your agents are as useful as code.

## Before you start

Read [AGENTS.md](AGENTS.md) (the working rules), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/STATUS.md](docs/STATUS.md). For a larger change, open an issue first so we can agree on the approach.

## Develop

Node.js 24 or later.

```sh
npm install
npm run dev       # hub with reload on http://127.0.0.1:7420
npm run dev:web   # web app with hot reload, proxied to the hub
```

Open the dev web app with `?fixture=1` to see sample data without any agent installed.

## Before a pull request

```sh
npm run check
npm test
npm run build
```

If your change touches how Agentry talks to agents, try it with a real agent and say in the pull request which agent and model you used and what you saw.

Write code comments, docs and commit messages in short, plain English.

By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE).
