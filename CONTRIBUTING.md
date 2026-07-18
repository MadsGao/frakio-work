# Contributing

Use Node.js 24 and install dependencies with `npm ci`. Keep changes inside the owning workspace and put shared wire contracts in `packages/contracts`.

Before opening a pull request, run `npm run check:syntax`, `npm run typecheck`, `npm test`, `npm run test:smoke`, and `npm run build`.

Do not commit local state, credentials, Hermes profiles, generated runtimes, logs, screenshots, or release binaries. New destructive API operations require explicit confirmation, path-boundary tests, and a recoverable backup strategy.
