# Stress test results — 2026-11-10

Run them yourself: `npm run stress` (local relay) or
`RELAY_URL=wss://hive-relay.kassanagujar.workers.dev npm run stress` (the live relay). Results are
appended to `stress-report.txt`.

## Collaboration (live Cloudflare relay)
| Scenario | Result | Target |
|---|---|---|
| 10 people typing in one file at once (1,000 keystrokes, ~490/s) | identical on all 10, 161 ms after typing stopped | converge |
| Edit latency to all 5 other people while the room is busy | p50 57 ms · p95 65 ms · max 68 ms | < 2,000 ms |
| 11th person joins | rejected: "This project is full (10 people max)." | max 10 |
| 5 people dropping offline mid-edit and reconnecting | converged, 380/380 edits kept | no lost edits |
| New member joins a 300-file / 5.9 MB project | everything synced in 1.6 s | — |
| Late joiner after the relay compacted its log | all 300 files present | — |

Local relay (same tests): converge 7 ms, latency p95 34 ms, 6 MB join 0.45 s.

## App (Windows, 2,001-file project)
| Scenario | Result |
|---|---|
| Open project / build file tree (2,222 nodes) | 253 ms / 119 ms |
| Search across all files | 0.4 s (was 2 s; first-ever search ~28 s while Windows Defender scans new files) |
| Join-time hash check of all files | 0.43 s (was 1.2 s) |
| Changes panel with 1,000 stored events (shows latest 300) | 90 ms |
| 25 editor tabs open | smooth, 145 fps, 73 MB renderer heap |

## Agents
| Scenario | Result |
|---|---|
| 8 parallel tasks across 4 workers finishing together (real git worktrees) | **failed first: 6/8 tasks hit git lock collisions** → fixed by serialising git writes → 8/8 merged, 3 runs in a row |

## Installer
- `Hive-Setup-0.1.0.exe` (126 MB): silent install 17–26 s, no admin prompt, desktop + Start Menu
  shortcuts, `hive://` invite links registered, installs to `%LOCALAPPDATA%\Programs\hive`.
- Installed app starts in the setup wizard and defaults to the Cloudflare relay.
