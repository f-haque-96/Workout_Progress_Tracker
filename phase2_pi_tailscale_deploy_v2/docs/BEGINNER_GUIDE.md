# Phase 2 (Pi + Tailscale only) — Beginner Guide

## If you saw: “npm ci … can only install with a package-lock.json”
That happens because your Pi is building the API container, but there is no lockfile.
This v2 bundle fixes it by using `npm install --omit=dev`.

### Run these on the Pi:
```bash
cd ~/phase2_pi_tailscale_deploy_v2
cp .env.sample .env
nano .env
```
Paste your Hevy API key after `HEVY_API_KEY=`.
Set `HEALTH_INGEST_TOKEN` to a random string.

Then:
```bash
docker compose up -d --build
```

Dashboard URL (from any Tailscale device):
`http://<pi-tailscale-ip>:8080`
