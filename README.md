# AirClaw Web

## Environments

| Environment | Fly App | Config | URL |
|---|---|---|---|
| Dev | `airclaw-dev` | `fly.dev.toml` | `airclaw-dev.fly.dev` |
| Prod | `airclaw-prod` | `fly.toml` | `airclaw-prod.fly.dev` |

Local development uses `.env` which points at `airclaw-dev` by default.

## Common Commands

### Local Development

```bash
pnpm dev              # Start local dev server (uses airclaw-dev for machines)
pnpm docker:up        # Start local Postgres
pnpm docker:down      # Stop local Postgres
pnpm db:migrate       # Run database migrations
pnpm db:studio        # Open Drizzle Studio
```

### Deploy Backend

```bash
# Dev
fly deploy -c fly.dev.toml

# Prod
fly deploy
```

### Build & Push OpenClaw Image

```bash
# Authenticate Docker with Fly registry (one-time)
fly auth docker

# Build the image
docker build -t registry.fly.io/airclaw-dev:TAG -f docker/Dockerfile.openclaw docker/

# Push to registry
docker push registry.fly.io/airclaw-dev:TAG

# Then update OPENCLAW_IMAGE in services/machine.ts (or set via env var)
```

Replace `airclaw-dev` with `airclaw-prod` for production.

### Update Running User Machines

Per-user machines are created via the Machines API (`services/machine.ts`), NOT `fly deploy`.

To update user machines with a new image:

1. Build and push the new image (see above)
2. Update the image tag in `services/machine.ts` (`OPENCLAW_IMAGE`)
3. Destroy old user machines so they get recreated on next start:

```bash
# List machines
fly machines list -a airclaw-dev

# Destroy a specific machine
fly machines destroy <machine-id> -a airclaw-dev --force
```

### Manage Fly Secrets

```bash
# List secrets (names only)
fly secrets list -a airclaw-dev

# Set secrets
fly secrets set -a airclaw-dev \
  FLY_APP_NAME="airclaw-dev" \
  FLY_API_TOKEN="..." \
  ANTHROPIC_API_KEY="..." \
  MACHINE_SECRET="..." \
  DATABASE_URL="..." \
  AUTH_SECRET="..." \
  AUTH_URL="https://airclaw-dev.fly.dev" \
  ENCRYPTION_KEY="..."
```

Replace `airclaw-dev` with `airclaw-prod` for production.
