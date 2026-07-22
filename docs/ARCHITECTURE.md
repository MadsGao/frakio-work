# Architecture

Frakio Work is a local-first application with four explicit boundaries.

`apps/web` contains the React/Vite user interface. It only talks to the local HTTP API and the narrow Electron preload bridge. It must not access the filesystem or process environment directly.

`apps/api` owns state, credentials, Hermes integration, runtime lifecycle, workspace file boundaries, update metadata, and telemetry sanitization. The server binds to loopback. Mutating requests require a same-site local session and a Frakio request header.

`apps/desktop` owns macOS and Windows window behavior, API process lifecycle, logs, approved filesystem dialogs, and approved GitHub Release links. The renderer is sandboxed.

`packages/contracts` owns shared transport types and platform identifiers. New cross-boundary payloads belong here before UI-specific presentation types are added.

Persistent data belongs under `~/.frakio-work`. Hermes-owned profiles and credentials remain under `~/.hermes`. The repository contains reproducible build scripts but does not contain user data, generated runtimes, or release binaries.

GitHub Actions validates the source Web UI on macOS, Windows, and Linux. Tagged releases build separate Apple Silicon, Intel Mac, and Windows x64 runtime/application artifacts on native runners.
