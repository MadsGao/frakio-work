# Frakio Work

[中文](README.md)

Frakio Work is an open-source multi-agent workspace for [Hermes Agent](https://github.com/NousResearch/hermes-agent). It brings conversations, agents, models, MCP servers, channels, jobs, knowledge vaults, and runtime management into one local interface.

> v0.1.0 is a public beta. The macOS builds are not yet Apple-signed or notarized. On first launch, right-click the app in Finder and choose **Open**.

![Frakio Work workspace](docs/assets/frakio-work.png)

## Run Frakio Work

macOS users can download Apple Silicon or Intel DMGs from [GitHub Releases](https://github.com/MadsGao/frakio-work/releases). The Settings page checks that release feed and opens the matching download when a newer version is available.

The source Web UI runs on macOS, Windows, and Linux. It requires Node.js 24, npm, and Git. Hermes features also require a working local Hermes Agent installation and its platform dependencies.

```bash
git clone https://github.com/MadsGao/frakio-work.git
cd frakio-work
npm ci
npm run dev
```

The Web UI runs at `http://127.0.0.1:5173`; the local API runs at `http://127.0.0.1:8787`. User state, credentials, logs, runtimes, and backups live under `~/.frakio-work` and never belong in the source repository.

## Development

```bash
npm run check:syntax
npm run typecheck
npm test
npm run test:smoke
npm run build
```

The repository is organized into four workspaces: `apps/web`, `apps/api`, `apps/desktop`, and `packages/contracts`. See [Architecture](docs/ARCHITECTURE.md) for boundaries and data flow.

## Privacy and upstream relationship

Anonymous telemetry is off by default. It is enabled only after explicit first-run consent. Allowed events exclude conversations, file contents, project names, local paths, secrets, and account data.

Frakio Work is an independent third-party project and is not an official Nous Research product. Hermes Agent is used under the MIT License. Release packages retain upstream and third-party license files.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contributions and [SECURITY.md](SECURITY.md) for security reports.
