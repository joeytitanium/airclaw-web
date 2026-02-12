# AirClaw Web

## Fly.io Deployment

The `airclaw-(dev/prod)` Fly app uses per-user machines created via the Machines API (in `services/machine.ts`), NOT standard `fly deploy` machines.

**Never run `fly deploy` to update running machines.** It creates unwanted "app" process group machines that lack required env vars and will crash. Instead:

1. Build and push the image only: `cd docker && fly deploy --build-only -c fly.openclaw.toml` (or use `docker build` + `docker push` to the Fly registry)
2. Update the image tag in `services/machine.ts` (`OPENCLAW_IMAGE`)
3. Destroy old user machines so they get recreated with the new image on next start

Env vars (`ANTHROPIC_API_KEY`, `MACHINE_SECRET`, `USER_ID`, `BACKEND_URL`) are injected at machine creation time from the server's environment, not via Fly secrets.
