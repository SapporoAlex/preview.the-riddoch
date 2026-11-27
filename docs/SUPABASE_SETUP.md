# Connecting Gallery Studio to Supabase

Without these steps the app runs in **local mode**: accounts, layouts and images stay in one browser. Once
connected, accounts work on any computer, sharing works between real users, and images are stored online.

Takes about 15 minutes. Everything here is on Supabase's free plan.

## 1. Create the project

1. Sign up at [supabase.com](https://supabase.com) and click **New project**.
2. Pick a name (e.g. `gallery-studio`), set a strong database password (save it in a password manager),
   and choose the **region closest to your testers**.
3. Wait a minute or two for it to finish setting up.

## 2. Create the database

1. In the project, open **SQL Editor → New query**.
2. Paste the whole of [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) and click **Run**.
   You should see "Success. No rows returned". Then do the same with
   [`0002_objects.sql`](../supabase/migrations/0002_objects.sql) (lets viewers see 3D object photos).
3. Check **Table Editor**: you should see `profiles`, `layouts`, `shares`, `notes` and `assets`.
   **Storage** should show a private bucket called `assets`.

Run the file once only. Later changes come as new numbered files (`0002_…sql`), each run once in order.

## 3. Sign-in settings

Open **Authentication → Sign In / Providers → Email** (older dashboards: **Authentication → Providers → Email**):

- **Enable email provider:** on.
- **Confirm email:** see the note below.
- **Minimum password length:** 8 (the app also checks this).

Open **Authentication → URL Configuration**:

- **Site URL:** `http://localhost:5173` while developing. Change it to your real address (e.g.
  `https://app.yourdomain.com`) when you publish.
- **Redirect URLs:** add `http://localhost:5173/**` and, later, your real address with `/**`.

> **About confirmation emails:** Supabase's built-in email sender only delivers to members of your
> Supabase team, and only a few emails an hour. Until you've connected Resend (step 1 of the roadmap), either:
> - turn **Confirm email** off while you test with your own accounts, or
> - invite your test addresses to the Supabase team (**Organization settings → Team**).
>
> Turn **Confirm email** back on before inviting artists.

## 4. Connect the app

1. Open **Project Settings → API** (or **Data API**). Copy the **Project URL** and the **anon / public** key.
2. In the project folder, copy `.env.example` to a new file called `.env.local` and paste them in:

   ```
   VITE_SUPABASE_URL=https://abcdefghijkl.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

3. Restart the dev server (`npm run dev`). The "stored only in this browser" note on the sign-in page
   disappears when the app is connected.

The anon key is designed to be public: the access rules in the database decide what each person can do.
**Never** put the `service_role` key in the app or in `.env.local`; it bypasses every rule.

`.env.local` is ignored by git, so the keys don't end up in your repository.

## 5. Check it works

1. Sign up as yourself, create a layout, upload an image, paint a wall and **Save**.
2. In a private/incognito window, sign up as a second person.
3. Back in the first window, **Share** the layout with the second email.
4. In the private window, the layout appears under **Shared with you**. Open it, leave a note, and watch
   the note appear in the first window without reloading.

If something fails, the browser console (F12) shows the error. **Logs** in the Supabase dashboard shows
the server side.

## What carries over from local mode

Nothing: local-mode accounts and layouts live in each browser and aren't uploaded. Testers start fresh
once the app is connected.

## Checking the access rules

`npm run test:db` runs the migrations in a throwaway in-memory Postgres and checks the access rules as
three different users: owner, viewer and stranger (48 checks). Run it after any change to the SQL.

## Free-plan limits to keep in mind

- **1 GB file storage.** The app limits each account to 50 images (thumbnails don't count) and deletes
  images no layout uses an hour after they were uploaded, the next time that person saves.
- **Projects pause after a week with no activity.** Un-pause them from the dashboard. Upgrade to Pro (about
  $25/month) once a client is paying.
