# Deploy guide — JustVibe

Stack: Next 16 (standalone) + SQLite (better-sqlite3) + persistent
`public/apps/` for generated user apps. Needs a **VPS with persistent
disk** — does not run on serverless (Vercel Functions / CF Pages).

Recommended flow: GitHub Actions builds a Docker image to GHCR on every
push to `master`, then SSHes into your server, `docker compose pull`,
restarts the container.

---

## 1. One-time server setup

On the server (Ubuntu/Debian, fresh):

```bash
# Install Docker + Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # logout/in once
sudo apt install -y docker-compose-plugin

# Working directory for the app
sudo mkdir -p /opt/justvibe && sudo chown $USER:$USER /opt/justvibe
cd /opt/justvibe

# Pull these two files from the repo (or scp them)
curl -O https://raw.githubusercontent.com/tungtruong/nocode/master/docker-compose.yml
curl -O https://raw.githubusercontent.com/tungtruong/nocode/master/.env.example
mv .env.example .env

# Edit .env — fill in real secrets (see section 2 below)
nano .env

# Create persistent dirs the container expects to mount
mkdir -p data public/apps

# First-time login to GHCR (so docker compose pull can read the image)
echo <YOUR_GITHUB_PAT> | docker login ghcr.io -u tungtruong --password-stdin
# PAT needs scope: read:packages

# Boot
docker compose up -d
docker compose logs -f
```

App now listens on `127.0.0.1:3000`. Put nginx/Caddy in front for TLS:

### nginx example

```nginx
server {
    listen 443 ssl http2;
    server_name justvibe.me *.justvibe.me;
    ssl_certificate     /etc/letsencrypt/live/justvibe.me/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/justvibe.me/privkey.pem;

    # Pass the Host header through unchanged — the app routes <slug>.justvibe.me
    # to the right deployed app via that header.
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Connection        $http_connection;
        proxy_set_header   Upgrade           $http_upgrade;
        # Long streaming responses from /api/chat and /api/edit.
        proxy_read_timeout 300s;
        proxy_buffering    off;
    }
}
```

Get the wildcard cert with certbot DNS challenge against Cloudflare:

```bash
sudo apt install -y certbot python3-certbot-dns-cloudflare
# Save a CF API token (scope: Zone DNS Edit) to /etc/letsencrypt/cf.ini, chmod 600
sudo certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cf.ini \
  -d justvibe.me -d '*.justvibe.me'
```

(If you proxy through Cloudflare instead, you can use CF's "Full (strict)"
mode + CF Origin Cert — easier than Let's Encrypt.)

---

## 2. Environment variables (`.env`)

Required:

```
AUTH_SECRET=<openssl rand -base64 32>    # JWT signing key, 32+ bytes
DEEPSEEK_API_KEY=sk-...                  # primary LLM
NEXT_PUBLIC_BASE_URL=https://justvibe.me
APPS_DOMAIN=justvibe.me                  # wildcard subdomain routing
```

Optional but recommended:

```
OPENAI_API_KEY=sk-proj-...               # fallback when DeepSeek times out
OPENAI_MODEL=gpt-4.1-mini

# Google OAuth (login)
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...

# PayPal (subscriptions)
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_PLAN_PRO=P-...
PAYPAL_PLAN_TEAM=P-...
PAYPAL_WEBHOOK_ID=...
PAYPAL_MODE=live
```

**Do not** set `DEV_INSECURE_COOKIE` or `UNLIMITED_QUOTA` in prod.

After editing `.env` on the server: `docker compose up -d` (re-creates
the container with new env).

---

## 3. Cloudflare DNS

In CF dashboard for `justvibe.me`:

| Type  | Name | Value           | Proxy   |
|-------|------|-----------------|---------|
| A     | `@`  | `<server-ipv4>` | Proxied |
| A     | `*`  | `<server-ipv4>` | Proxied |
| AAAA  | `@`  | `<server-ipv6>` | Proxied |
| AAAA  | `*`  | `<server-ipv6>` | Proxied |

(IPv6 rows optional — only if your server has IPv6.)

SSL/TLS mode: **Full (strict)** if you use Let's Encrypt or CF Origin
Cert on the server; **Flexible** is fine for quick start but encrypts
only browser↔CF, not CF↔server (don't ship to prod that way).

---

## 4. GitHub Actions auto-deploy

Add these repository secrets (Settings → Secrets and variables →
Actions):

| Secret           | Value                                      |
|------------------|--------------------------------------------|
| `DEPLOY_HOST`    | `123.45.67.89` (server IP or hostname)     |
| `DEPLOY_USER`    | ssh username (e.g. `deploy` or `root`)     |
| `DEPLOY_PORT`    | `22` (omit if default)                     |
| `DEPLOY_SSH_KEY` | contents of a private key authorized on the server |
| `DEPLOY_DIR`     | `/opt/justvibe` (where compose lives)      |

Generate the deploy key locally:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/justvibe_deploy -C "github-actions" -N ""
# Put the public key in the server user's ~/.ssh/authorized_keys
ssh-copy-id -i ~/.ssh/justvibe_deploy.pub <user>@<server>
# Paste the PRIVATE key into the DEPLOY_SSH_KEY secret
cat ~/.ssh/justvibe_deploy
```

Push to `master` → GH Actions builds, pushes to
`ghcr.io/tungtruong/nocode:latest`, SSHes to your server, runs
`docker compose pull && docker compose up -d`.

Manual trigger: Actions tab → "Build & Deploy" → Run workflow.

---

## 5. Rollback

Each build also tags `ghcr.io/tungtruong/nocode:sha-<commit>`. To roll
back manually on the server:

```bash
cd /opt/justvibe
sed -i 's|:latest|:sha-abc1234|' docker-compose.yml
docker compose up -d
```

(Set it back to `:latest` when you want auto-deploys to resume.)

---

## 6. Backups

Two paths hold all state:

```
/opt/justvibe/data         # SQLite DB
/opt/justvibe/public/apps  # deployed user HTML files
```

Nightly backup to S3/B2/rclone target:

```bash
0 3 * * * cd /opt/justvibe && tar czf - data public/apps | rclone rcat remote:justvibe-backups/$(date +\%F).tar.gz
```
