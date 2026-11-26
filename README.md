# 🐝 Hive

Hive is a free desktop coding app you use with friends. It looks like VS Code, has a team of AI models
that can build a project for you, and lets several people edit the same project live from their own
computers.

## What it does

- **AI team.** Describe what you want built. The strongest model writes a plan, smaller models each
  take a task in their own copy of the project, a lead model reviews their work, and you approve the
  merge. You can also pick one model and use it on its own.
- **Ask AI.** Ask about the open file. Suggested edits appear as a diff you accept or reject. If a
  friend changed the same lines first, **Apply to latest version** redoes the AI's change on top of
  theirs.
- **Free models only.** Run models on your own PC (through Ollama), use free online models with a
  free key, or use Claude Code or Codex if you already have them. Paid models are never shown.
- **Live collaboration.** Share a project with an invite link. Everyone sees edits, cursors and who's
  online as it happens. Everything is end-to-end encrypted, so the relay server can't read your code.
- **History.** A feed shows every change: who made it, when, and the diff. You can undo from it.
- **Planning room.** Chat with your team next to a shared plan. A planner AI keeps the plan up to
  date, and **Send to agents** turns it into work for the AI team.
- **Run.** One button runs Node, Python, static websites, Go, Rust, Java and C/C++ projects. If a
  package is missing, Hive tells you which one and how to install it. **Safe mode** stops a program
  from touching files outside the project, starting other programs or using the network.
- **The usual editor tools.** File explorer, tabs, search across files, terminal, Git panel, autosave,
  and dark and light themes.

## Install

1. Download the installer from the
   [latest release](https://github.com/KassanaGujar/hive/releases/latest):
   - Windows: `Hive-Setup-<version>.exe`
   - Mac: the `.dmg` for Apple Silicon (`arm64`) or Intel (`x64`)
   - Linux: the `.AppImage`
2. Open it. On Windows it installs in one click, with no admin password.
   - Windows may say **"Windows protected your PC"** because Hive isn't signed. Click
     **More info → Run anyway**.
   - On a Mac, right-click Hive and choose **Open** the first time.
3. The setup wizard asks your name, checks your PC and suggests a model that will run well on it.
   It installs Git and Ollama for you if they're missing. Expect a few minutes plus the model
   download (a few GB).

On Windows, Hive updates itself when a new version is released. On a Mac, it tells you when an update
is available.

## Work on a project together

Each person keeps their own copy of the project on their own computer. Hive keeps the copies in sync
through a small relay server, so you don't need to be on the same network.

1. **The host** opens the project, goes to **People** and clicks **Share & invite**.
2. **Copy link** and send it to a friend (or send the 6-letter code). Invites expire after 24 hours.
   Use **Viewer invite** for someone who should watch but not edit.
3. **The friend** clicks the link, or clicks **Join a friend's project** in Hive and pastes the code.
   They choose a folder on their computer, and the project downloads into it.
4. From then on, edits save automatically and show up on everyone's screen within about a second.
   Changes made while someone is offline sync when they reconnect.

Up to 10 people can share a project. The host can remove people from the **People** panel.

## For developers

```
apps/desktop      Electron app (main process, preload bridge, React renderer)
packages/shared   Types and the typed IPC contract
packages/models   Free-only model catalog, fit labels, ranking, OpenAI-compatible client
packages/agents   AI team orchestrator, worktrees, command policy
packages/collab   Encryption, invites, Yjs document, sync, plan and feed logic
packages/editor   Run detection, language mapping, run failure hints
services/relay    Relay server (forwards encrypted updates), with a Dockerfile
services/relay-cf The same relay as a Cloudflare Worker (the one Hive uses by default)
catalog/          catalog.json, the model list Hive fetches on launch
site/             Download page
tools/qa          End-to-end QA harness (drives real Hive instances)
```

```bash
npm install
node node_modules/electron/install.js   # if npm skipped Electron's download
npm run dev                             # Hive with hot reload
npm test                                # unit and integration tests
npm run relay                           # local collaboration relay on :4455
npm run dist                            # Windows installer in apps/desktop/release/
```

Run a second, separate instance (for example, to test collaboration on one PC):

```bash
cd apps/desktop
HIVE_USER_DATA=./tmp-profile2 npx electron .
```

**Releasing:** bump `version` in `apps/desktop/package.json`, then `git tag v<version>` and
`git push --tags`. The workflow in `.github/workflows/release.yml` builds Windows, Mac and Linux
installers and publishes them as a GitHub Release, which installed copies update from.

More: product spec in [docs/PRD.md](docs/PRD.md), build notes in [PROGRESS.md](PROGRESS.md), relay
hosting in [docs/relay-hosting.md](docs/relay-hosting.md), QA results in
[docs/qa-checklist.md](docs/qa-checklist.md).
