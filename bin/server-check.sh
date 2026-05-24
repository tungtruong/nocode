#!/bin/bash
# Run on your VPS to surface anything that might conflict with the JustVibe
# deploy. No changes made — read-only inspection. Run as the same user that
# GitHub Actions will SSH in as.
#
# One-liner:
#   curl -fsSL https://raw.githubusercontent.com/tungtruong/nocode/master/bin/server-check.sh | bash

set -uo pipefail

ok()   { echo "✅ $1"; }
warn() { echo "⚠️  $1"; }
err()  { echo "❌ $1"; }
sec()  { echo; echo "── $1 ──"; }

DEPLOY_DIR="${DEPLOY_DIR:-/opt/justvibe}"
HOST_PORT="${HOST_PORT:-3000}"

sec "Host"
echo "  user: $(whoami)"
echo "  pwd:  $(pwd)"
echo "  uname: $(uname -a)"

sec "Docker"
if command -v docker >/dev/null; then
  ok "docker installed: $(docker --version)"
  if docker info >/dev/null 2>&1; then
    ok "docker daemon reachable from this user"
  else
    err "docker daemon NOT reachable — either daemon is down OR your user is not in the 'docker' group"
    echo "    fix: sudo usermod -aG docker $(whoami) && logout/in"
  fi
else
  err "docker not installed — run: curl -fsSL https://get.docker.com | sh"
fi

if docker compose version >/dev/null 2>&1; then
  ok "docker compose plugin: $(docker compose version)"
else
  err "docker compose plugin missing — run: sudo apt install -y docker-compose-plugin"
fi

sec "Port $HOST_PORT (target for the container's published port)"
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${HOST_PORT}\$"; then
  warn "port $HOST_PORT is occupied. Detail:"
  ss -ltnp 2>/dev/null | awk -v p="${HOST_PORT}" '$4 ~ "[:.]"p"$" {print "    "$0}'
  echo "    fix: edit .env on the server: HOST_PORT=3100 (or any free port), then docker compose up -d"
else
  ok "port $HOST_PORT is free"
fi

sec "Deploy directory ($DEPLOY_DIR)"
if [ -d "$DEPLOY_DIR" ]; then
  ok "exists"
  ls -la "$DEPLOY_DIR" | sed 's/^/    /'
  for f in docker-compose.yml .env; do
    if [ -f "$DEPLOY_DIR/$f" ]; then ok "$f present"; else warn "$f missing"; fi
  done
  for d in data public/apps; do
    if [ -d "$DEPLOY_DIR/$d" ]; then ok "$d/ present"; else warn "$d/ missing — will be auto-created on first deploy"; fi
  done
else
  err "$DEPLOY_DIR does not exist"
  echo "    fix: sudo mkdir -p $DEPLOY_DIR && sudo chown $(whoami):$(whoami) $DEPLOY_DIR"
fi

sec "Existing containers / compose projects on this host"
running=$(docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null)
if [ -z "$running" ]; then
  ok "no other containers running"
else
  echo "$running" | sed 's/^/    /'
  if echo "$running" | grep -qE '\b(justvibe|nocode)\b'; then
    warn "an existing container shares the justvibe/nocode name — old deploy?"
    echo "    consider: cd $DEPLOY_DIR && docker compose down  (before rerunning)"
  fi
fi

sec "Disk"
df -h "$DEPLOY_DIR" 2>/dev/null | sed 's/^/    /' || df -h / | sed 's/^/    /'
echo "  (the image is ~250MB; data + public/apps grow as users deploy.)"

sec "GHCR pull test"
if docker pull ghcr.io/tungtruong/nocode:latest >/dev/null 2>&1; then
  ok "can pull ghcr.io/tungtruong/nocode:latest (image is public OR you're logged in)"
else
  err "cannot pull image — either GHCR not logged in or image is private"
  echo "    fix: echo <GH_PAT_with_read:packages> | docker login ghcr.io -u tungtruong --password-stdin"
fi

sec "Summary"
echo "If anything above is ❌, fix it before re-running the GH Actions workflow."
echo "If everything is ✅/⚠️, the next deploy push should succeed."
