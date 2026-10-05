# Iron Log

Shared gym log for a small crew. Quick set entry prefilled from your last session, lift trends (estimated 1RM), and a big-three leaderboard.

Static site (GitHub Pages) + Supabase (email login and Postgres).

## Setup

1. **Supabase project** — create one at supabase.com (free tier is plenty).
2. **Database** — Dashboard → SQL Editor → paste `schema.sql` → Run.
3. **Add the crew** — in the SQL Editor:
   ```sql
   insert into public.crew_emails (email) values
     ('you@example.com'), ('friend@example.com')
   on conflict do nothing;
   ```
   Only these emails can read or write data.
4. **Login redirect** — Authentication → URL Configuration:
   - Site URL: `https://<github-user>.github.io/<repo>/`
   - Redirect URLs: add the same URL.
5. **Keys** — Project Settings → API → copy the Project URL and the `anon` public key into `config.js`.
6. **GitHub Pages** — repo Settings → Pages → Deploy from branch → `main` / root.

## Adding a friend later

Run step 3 with their email, then send them the link. They sign in with a one-tap email link and pick a display name.

## Security

The anon key is public by design. Row-level security (in `schema.sql`) lets crew members read everyone's workouts but only create, edit or delete their own.
