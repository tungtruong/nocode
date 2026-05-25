# Custom domains with auto-issued HTTPS

Customers can point their own domain (e.g. `shop.khachhang.com`) at their
JustVibe app from **any DNS provider** — Vinahost, Mat Bao, Tenten, GoDaddy,
Namecheap, Z.com, you name it. No Cloudflare account required.

This works because the JustVibe VPS runs Caddy in front of Next.js. Caddy
auto-issues a Let's Encrypt certificate the first time someone visits a
new domain, with the JustVibe API gating issuance to prevent abuse.

## One-time DNS setup (the JustVibe apex zone)

Before customers can CNAME at us, add a single A record in the DNS zone for
`justvibe.me`:

```
Type:  A
Name:  proxy
Value: <VPS-IP — 116.118.9.133 currently>
TTL:   3600
```

That gives us a stable target (`proxy.justvibe.me`) that all customer CNAMEs
point at. If we later need to fail over to a new VPS, we only update this
one A record and every customer domain follows automatically — no per-app
DNS surgery.

## One-time VPS setup (Vinahost / Ubuntu)

```bash
# 1. Install Caddy from the official APT repo (signed packages, auto-updated)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy

# 2. Drop our Caddyfile in place
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile

# 3. Make sure ports 80 and 443 are open in the firewall
sudo ufw allow 80,443/tcp

# 4. If anything else is bound to 80/443 (nginx, apache, an old Caddy),
#    stop+disable it first.
sudo systemctl status nginx apache2 2>/dev/null

# 5. Reload Caddy — it picks up the new config + issues certs on demand
sudo systemctl reload caddy
sudo systemctl enable caddy

# 6. (Optional) Tail Caddy's cert-issuance log to watch the first
#    custom-domain hit work end-to-end:
sudo journalctl -u caddy -f | grep -E 'obtained|ASK|tls'
```

Next.js stays bound to `localhost:3002` (or wherever `npm start` listens).
Caddy is the only public-facing listener.

## How a customer adds their domain

From the customer's perspective:

1. In JustVibe → `Dashboard → app → Dữ liệu → 🌐 Domain riêng` tab,
   add the domain (e.g. `shop.khachhang.com`).
2. Login to their DNS provider, add a `CNAME` record:
   - **Name**: the subdomain (`shop`)
   - **Target**: `proxy.justvibe.me`
3. Wait 1–5 minutes for DNS propagation, then back in the dashboard click
   **Verify**. JustVibe does a live `dns.resolveCname(...)` to confirm the
   record points at us, then flips `verified_at` and the proxy starts
   routing requests for that domain.
4. The first visitor to `https://shop.khachhang.com` triggers Caddy →
   ACME → Let's Encrypt cert issuance (~10–30 s for the cold path).
   Subsequent visitors use the cached cert. Renewal happens automatically
   well before the 90-day expiry.

## How the ask hook prevents abuse

Caddy does NOT mint a certificate for every domain that resolves to us.
Before each cold-path issuance it calls `https://justvibe.me/api/cert-ask`
with `?domain=...`. The endpoint:

- Returns **200** when the domain exists in the `custom_domains` SQLite
  table — meaning a real owner added it via the dashboard.
- Returns **403** otherwise.

A `403` makes Caddy abort the issuance immediately. The Let's Encrypt
rate-limit budget (50 certs/week per registered domain) is preserved for
real customers.

## Rate limit notes

If a single customer rapidly adds + removes the same domain, we burn LE
attempts. The Caddyfile rate-limits to 5 issuances per minute globally,
which is plenty for normal use and a tight enough cap to prevent runaway
costs in pathological cases.

## Apex domain support

`shop.example.com` (subdomain) → works out of the box with a `CNAME`.

`example.com` (apex / root domain) requires the DNS provider to support
`ALIAS` / `ANAME` records (Cloudflare, DNSimple, Vercel DNS do; most
traditional providers do not). Document as a future improvement.

## Troubleshooting

Customer reports "không vào được" after Verify succeeded:

1. Check `dig CNAME shop.khachhang.com` returns a `*.justvibe.me` answer.
2. Check Caddy log: `sudo journalctl -u caddy -n 200`.
   Look for `obtained certificate` for the domain.
3. If you see `ASK denied`, the domain isn't in `custom_domains` —
   the customer needs to add it via the dashboard FIRST.
4. If you see `no certificate available for ...`, the issuance failed —
   usually means DNS doesn't actually point at us yet. Tell customer
   to wait + retry.
