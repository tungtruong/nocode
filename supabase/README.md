# Supabase setup for JustVibe

JustVibe uses one shared Supabase Postgres project for all user-generated app
data (form submissions, catalogs, anything an app saves). One table
`public.app_rows` partitioned by `(app_id, table_name)` keeps it simple and
multi-tenant. Security: server connects with SERVICE ROLE KEY (bypasses RLS);
ownership is checked in our Next route layer via `app_id → apps/projects`.

## One-time setup

1. **Create a Supabase project** at https://supabase.com (free tier covers
   500MB DB + 50K monthly active users — plenty for early launch). Region:
   pick **Singapore** (closest to VN, low latency).

2. **Run the schema**: Supabase Studio → SQL Editor → paste contents of
   `supabase/schema.sql` → Run.

3. **Get credentials**:
   - Settings → API → **Project URL** (e.g. `https://abcdef.supabase.co`)
   - Settings → API → **service_role secret** (long JWT under "Project API
     keys" → reveal **service_role** key, **NOT** the anon key)

4. **Add env vars** to the server `.env`:
   ```
   SUPABASE_URL=https://<your-project>.supabase.co
   SUPABASE_SERVICE_KEY=eyJ...<the service_role JWT>
   ```

   Server restart:
   ```bash
   ssh root@116.118.9.133 'cd /opt/justvibe && docker compose up -d --force-recreate'
   ```

5. **Update the GH `DEPLOY_ENV` secret** to include the same two lines so
   future deploys / fresh server bootstraps inherit them.

## Verify

After deploy, test from JV server:
```bash
ssh root@116.118.9.133 'cd /opt/justvibe && docker compose exec -T app node -e "
const { createClient } = require(\"@supabase/supabase-js\");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
sb.from(\"app_rows\").select(\"id\", { count: \"exact\", head: true }).then(r => console.log(r));
"'
```
Should print `{ data: null, count: 0, error: null, status: 200 }` on a fresh DB.

## Why no RLS

We could split each customer into its own logical "schema" or enforce
row-level security policies that check `app_id` against `apps.user_email`.
Both would require either (a) passing each user's JV-JWT as a Postgres role,
or (b) creating a Supabase user per customer.

Both add a whole identity layer for marginal benefit since our route layer
already does the ownership check. Service-role + careful route auth keeps
the implementation small and predictable. If we ever expose Supabase
directly to client-side code (we don't today), we'll need to revisit.
