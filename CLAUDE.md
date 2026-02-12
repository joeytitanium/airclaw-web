# AirClaw Web

## Environments

| Environment | Fly App | Config | URL |
|---|---|---|---|
| Dev | `airclaw-dev` | `fly.dev.toml` | `airclaw-dev.fly.dev` |
| Prod | `airclaw-prod` | `fly.toml` | `airclaw-prod.fly.dev` |

Local development uses `.env` which points at `airclaw-dev` by default.

## Common Commands

```bash
# Local development
pnpm dev              # Start local dev server (uses airclaw-dev for machines)
pnpm docker:up        # Start local Postgres
pnpm docker:down      # Stop local Postgres
pnpm db:migrate       # Run database migrations
pnpm db:studio        # Open Drizzle Studio

# Deploy backend (the Next.js app itself, NOT the OpenClaw user machines)
fly deploy -c fly.dev.toml   # Dev
fly deploy                   # Prod

# Manage Fly secrets
fly secrets list -a airclaw-dev
fly secrets set -a airclaw-dev \
  FLY_APP_NAME="airclaw-dev" \
  FLY_API_TOKEN="..." \
  ANTHROPIC_API_KEY="..." \
  MACHINE_SECRET="..." \
  DATABASE_URL="..." \
  AUTH_SECRET="..." \
  AUTH_URL="https://airclaw-dev.fly.dev" \
  ENCRYPTION_KEY="..."
# Replace airclaw-dev with airclaw-prod for production.
```

## Fly.io Deployment

### How it works

Each user gets their own Fly machine running an OpenClaw container. These are created on-demand via the Fly Machines API (in `services/machine.ts`), NOT via `fly deploy`.

When a user clicks "Start" in the chat UI:
1. The server calls the Fly Machines API to create (or start) a machine for that user
2. The machine runs the OpenClaw Docker image, which starts a gateway server on port 8080
3. The gateway takes ~40 seconds to boot — the server retries 502s automatically during this window
4. Once ready, chat messages are sent as HTTP POSTs to the machine via `https://airclaw-dev.fly.dev/v1/chat/completions` with a `fly-force-instance-id` header to target the specific machine

Env vars (`ANTHROPIC_API_KEY`, `MACHINE_SECRET`, `USER_ID`, `BACKEND_URL`) are injected at machine creation time from the server's environment, not via Fly secrets.

### The `machines` database table

The `machines` table in Postgres (`db/schema.ts`) tracks the mapping between our users and their Fly machines. It has one row per user (userId is unique) and stores:

- `machineId` — the Fly Machine ID (e.g. `287e124a4e1998`). Null when no Fly machine exists yet.
- `status` — one of: `stopped`, `starting`, `running`, `stopping`, `error`. Synced with Fly's actual machine state on each request via `getOrCreateMachine()`.

This table is the source of truth for "does this user have a machine?" The code in `services/machine.ts` keeps it in sync with Fly's API: when a machine is created, the Fly ID is saved; when it's destroyed, the ID is cleared to null so a new one gets created next time. If the status gets stuck (e.g. "starting" but no Fly machine exists), `getOrCreateMachine()` auto-resets it to "stopped".

### Key files

- `services/machine.ts` — machine lifecycle (create, start, stop, destroy). Contains `OPENCLAW_IMAGE` constant with the current image tag.
- `services/message.ts` — sends chat messages to machines. Has retry logic for 502s during gateway boot.
- `lib/fly.ts` — low-level Fly Machines API client.
- `docker/Dockerfile.openclaw` — the OpenClaw container image. Must keep `--platform=linux/amd64` (we develop on Apple Silicon but Fly runs AMD64).
- `docker/fly.openclaw.toml` — minimal Fly config used only for building/pushing the image.
- `docker/start.sh` — startup script that runs inside the container.

### Updating the OpenClaw image

**Never run `fly deploy` to update running machines.** It creates unwanted "app" process group machines that lack required env vars and will crash.

To push a new image:

```bash
# 1. Authenticate Docker with the Fly registry (one-time / when token expires)
fly auth docker

# 2. Build the image locally (from repo root)
docker build --platform=linux/amd64 -t registry.fly.io/airclaw-dev:v5 -f docker/Dockerfile.openclaw docker/

# 3. Push to the Fly registry
docker push registry.fly.io/airclaw-dev:v5

# 4. Update the tag in services/machine.ts (OPENCLAW_IMAGE constant)

# 5. Destroy old user machines so they get recreated with the new image
fly machines list -a airclaw-dev
fly machines destroy <machine-id> -a airclaw-dev --force
```

Pick any tag name you like (v5, v6, etc). The tag in `services/machine.ts` is what matters — that's what new machines pull.

> **Note:** `fly deploy --build-only -c fly.openclaw.toml` can also build images but may not always push them to the registry reliably. The `docker build` + `docker push` workflow above is more predictable.

### Troubleshooting

- **MANIFEST_UNKNOWN error** — the image tag in `services/machine.ts` doesn't exist in the registry. Verify with `docker pull registry.fly.io/airclaw-dev:<tag>`. Rebuild and push if needed.
- **Machine stuck in "created" state** — happens when the image pull fails. Destroy it: `fly machines destroy <id> -a airclaw-dev --force`
- **502 on first message** — normal during gateway boot (~40s). The retry logic in `services/message.ts` handles this. If it still fails after retries, check `fly logs -a airclaw-dev` for startup errors.
- **"instance refused connection on 0.0.0.0:8080"** — the gateway hasn't started listening yet. Usually resolves on its own within ~40s. If persistent, SSH in and check: `fly ssh console -a airclaw-dev -s`
