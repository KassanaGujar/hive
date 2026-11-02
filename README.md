# 🐝 Hive

Free desktop coding app for friends: a VS Code-style workspace where a team of free AI models builds
software together — the strongest model plans and reviews, smaller ones write code, each in its own git
worktree — plus live collaboration, a change feed and a planning room. Spec: [docs/PRD.md](docs/PRD.md).
Build status / resume notes: [PROGRESS.md](PROGRESS.md).

## Layout

```
apps/desktop      Electron app (main process, preload bridge, React renderer)
packages/shared   Types + the typed IPC contract
packages/models   Catalog filter (free-only), fit labels, ranking, OpenAI-compatible streaming client
packages/agents   Orchestrator (Architect → Workers → Lead review → merge), worktrees, command policy
packages/collab   E2E encryption, invites, Yjs doc layout, sync provider, plan doc + feed logic
packages/editor   Project detection for Run, language mapping
services/relay    Relay server (forwards encrypted updates) + Dockerfile
catalog/          catalog.json — the free model list Hive fetches on launch
site/             Download page
```

## Develop

```bash
npm install
node node_modules/electron/install.js   # if npm skipped Electron's download
npm run dev                             # Hive with hot reload
npm test                                # unit + integration tests
npm run relay                           # collaboration relay on :4455
npm run dist                            # Windows installer → apps/desktop/release/
```

Run a second, isolated instance (e.g. to test collaboration on one PC):

```bash
cd apps/desktop
HIVE_USER_DATA=./tmp-profile2 npx electron .
```

## Release

1. Set your GitHub user in `apps/desktop/electron-builder.yml` (`publish.owner`), `site/index.html`
   (`REPO`) and `packages/shared/src/index.ts` (`DEFAULT_CATALOG_URL`).
2. `git tag v0.1.0 && git push --tags` — the workflow in `.github/workflows/release.yml` builds and
   publishes installers; installed copies auto-update.
3. Host `site/` anywhere static (GitHub Pages works) and send friends the link.

Relay hosting options and my recommendation: [docs/relay-hosting.md](docs/relay-hosting.md).
