# Custom domains via Cloudflare for SaaS

Customers can point any domain (e.g. `shop.khachhang.com`) at their
JustVibe app from **any DNS provider** — Vinahost, Mat Bao, Tenten,
GoDaddy, Namecheap, Z.com. They CNAME to `customers.justvibe.me` and
Cloudflare for SaaS handles everything: cert issuance, edge caching,
DDoS shielding. SSL is free up to 100 custom hostnames, $0.10/hostname
beyond.

Zero changes to the production nginx config. CF talks to the existing
origin over the existing CF Origin Cert that nginx already terminates.

## One-time setup

### 1. Enable Cloudflare for SaaS on the zone

Cloudflare dashboard → `justvibe.me` zone → SSL/TLS → Custom Hostnames
→ **Enable Cloudflare for SaaS** (free tier).

Then create the fallback origin DNS record in the same zone:

```
Type:    CNAME (or A pointing to VPS IP — works either way)
Name:    customers
Target:  justvibe.me      (or 116.118.9.133)
Proxy:   ON (orange cloud — required, this is what gets the SaaS treatment)
TTL:     Auto
```

This `customers.justvibe.me` is what customer CNAMEs point at. CF
resolves the chain → recognises it owns the destination → applies the
SaaS proxy treatment → forwards HTTPS to the origin VPS.

### 2. Create an API token

Cloudflare dashboard → My Profile → API Tokens → **Create Token**.

Permissions:
- Zone → SSL and Certificates → Edit  (for `justvibe.me`)
- Zone → Custom Hostnames → Edit       (for `justvibe.me`)

Zone resources: Include → Specific zone → `justvibe.me`.

Copy the token — it shows once.

### 3. Add env vars on the server

```
CF_API_TOKEN=<the token from step 2>
CF_ZONE_ID=<justvibe.me zone ID from dashboard → Overview → API section>
CF_FALLBACK_HOSTNAME=customers.justvibe.me   # optional, defaults to this
```

Add the same vars to the GH secret `DEPLOY_ENV` so they get rolled
out on the next `gh workflow run deploy.yml`.

Restart the JustVibe process. The dashboard's `🌐 Domain riêng` tab
will start hitting CF's API for every add / verify / remove action.

## How a customer adds their domain

1. JustVibe → Dashboard → app → Dữ liệu → **🌐 Domain riêng**
2. Type `shop.khachhang.com` → **Thêm**.
3. JustVibe POSTs to CF `/zones/{zone}/custom_hostnames`; CF returns a
   hostname ID + initial `pending` status. JustVibe saves the ID in
   the `custom_domains.cf_hostname_id` column.
4. Customer logs into their DNS provider, adds a single record:
   ```
   Type:    CNAME
   Name:    shop
   Target:  customers.justvibe.me
   ```
5. Wait 1–5 minutes for DNS to propagate, then click **Verify** in the
   dashboard.
6. JustVibe calls CF `GET /custom_hostnames/{id}`. When `status=active`
   AND `ssl.status=active`, flips `verified_at` and the request proxy
   (`src/proxy.ts`) starts routing requests for that hostname to the
   correct app.

The CF cert issuance typically completes in 30–120s after DNS is in
place. If validation fails, CF returns a structured error in
`ssl.validation_errors` which the dashboard surfaces inline.

## Troubleshooting

**"Domain bị Cloudflare chặn"** — CF has policy blocks for sensitive
brand names (banks, government, big tech). Owner must pick a different
hostname.

**"CNAME chưa propagate"** — Common. Wait 5 min; many DNS providers
cache aggressively. `dig CNAME shop.khachhang.com` from any machine
should return `customers.justvibe.me`.

**"Cert pending after 10 min"** — Either DNS is still mis-pointing
(double-check `dig`), or CF rate-limited Let's Encrypt for this base
domain (50 certs/week/registered-domain). Wait or contact LE.

**Customer's domain works on HTTP but not HTTPS** — CF SaaS plan must
be enabled on the zone (step 1 above). Without it, `custom_hostnames`
API returns success but no SSL.

## Cost projection

- 1–100 custom hostnames: $0/mo (free tier).
- 101–500 hostnames: ($0.10 × extra)/mo.
- 1000 hostnames: ~$90/mo total.

Per-tier limits in `src/lib/quota.ts` (`CUSTOM_DOMAIN_LIMITS`) cap us:
free 0, Pro 5, Max 50. With those caps, even 1000 paying users wouldn't
exceed CF's free tier until ~20% of them are Max-tier with maxed-out
domains — at which point the revenue comfortably covers the marginal CF
fee.
