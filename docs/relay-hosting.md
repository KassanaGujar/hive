# Where to host the relay (open question from the PRD)

The relay is tiny: it only forwards and stores **encrypted** Yjs updates (it never has the room key).
It needs a public WebSocket URL that friends on other networks can reach. Options, all free:

| Option | Cost | Always on? | Setup | Notes |
|---|---|---|---|---|
| **Your PC + Cloudflare Tunnel** | Free | Only while your PC is on | Easy: click "Host the relay on this PC" in Hive's Team panel, then run `cloudflared tunnel --url http://localhost:4455` and share the `wss://….trycloudflare.com` URL | No account needed for quick tunnels. URL changes each run unless you make a named tunnel (free Cloudflare account + a domain). |
| **Fly.io** | Free allowance (check current terms) | Yes | `fly launch` with `services/relay/Dockerfile`, add a 1 GB volume at `/data` | Closest to "always on". Free terms have changed over time; verify before relying on it. |
| **Render free web service** | Free | Sleeps after ~15 min idle; ~30–60 s cold start | Connect repo, Docker, Dockerfile path `services/relay/Dockerfile` | Free disk is ephemeral → room logs vanish on restart. Clients re-upload state when they reconnect, so it still works, but late joiners need someone online. |
| **Oracle Cloud Always Free VM** | Free | Yes | More work (VM, Docker, TLS via Caddy) | Most robust free option; sign-up needs a card for verification. |

## Recommendation (my call)

1. **Friend beta: your PC + Cloudflare quick tunnel.** Zero accounts, works today, and you're the host
   who's online when the team works anyway. Hive's offline queue covers short gaps.
2. **If friends want to work while your PC is off:** move the same Docker image to Fly.io (with a volume)
   — no code changes, just paste the new `wss://` URL into Hive's Team panel.

## Running it

```bash
# local / home PC (Node 22+)
npm run relay            # listens on :4455, data in ./relay-data

# Docker (from the repo root)
docker build -f services/relay/Dockerfile -t hive-relay .
docker run -p 4455:4455 -v hive-relay:/data hive-relay
```

Health check: `GET /health` → `{"ok":true,...}`.

Hive's default relay URL is set in Settings (`relayUrl`); the host types the public URL in the Team panel
before sharing, and it's embedded in every invite link.
