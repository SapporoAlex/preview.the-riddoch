-- Gallery Studio: initial schema.
--
-- Tables: profiles, layouts, shares, notes, assets.
-- Every table has row-level security. The rules mirror src/domain/permissions.ts:
--   * owners edit, rename, share and delete their layouts;
--   * people a layout is shared with can view it and add notes;
--   * the layout owner can delete any note on it, authors can delete their own;
--   * images are readable only by their owner and by people who can view a
--     layout that uses them.
--
-- Run once in the Supabase SQL editor (or `supabase db push`).

-- ---------------------------------------------------------------------------
-- Profiles: one row per account, created automatically on sign-up.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Layouts. The hang plan (artworks, wall paint, room lights) is one JSON
-- document, matching the app's Layout type; it is always saved as a whole.
-- ---------------------------------------------------------------------------
create table public.layouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  building_id text not null,
  schema_version int not null default 1,
  doc jsonb not null default '{"artworks": [], "wallPaint": {}, "rooms": {}}'::jsonb,
  artwork_count int generated always as (coalesce(jsonb_array_length(doc -> 'artworks'), 0)) stored,
  thumbnail_asset_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index layouts_owner_idx on public.layouts (owner_id, updated_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger layouts_touch
  before update on public.layouts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Shares: view-only access for another account.
-- ---------------------------------------------------------------------------
create table public.shares (
  id uuid primary key default gen_random_uuid(),
  layout_id uuid not null references public.layouts (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  recipient_email text not null,
  permission text not null default 'view' check (permission in ('view')),
  created_at timestamptz not null default now(),
  unique (layout_id, recipient_id)
);
create index shares_recipient_idx on public.shares (recipient_id);

-- ---------------------------------------------------------------------------
-- Notes: speech bubbles. Separate from the layout so viewers can add them.
-- ---------------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  layout_id uuid not null references public.layouts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  author_name text not null default '',
  text text not null check (char_length(text) between 1 and 1000),
  anchor jsonb not null,
  created_at timestamptz not null default now()
);
create index notes_layout_idx on public.notes (layout_id, created_at);

-- Author name comes from the profile, never from the client.
create or replace function public.set_note_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.author_id = auth.uid();
  select display_name into new.author_name from public.profiles where id = new.author_id;
  new.author_name = coalesce(new.author_name, 'Someone');
  return new;
end;
$$;

create trigger notes_set_author
  before insert on public.notes
  for each row execute function public.set_note_author();

-- ---------------------------------------------------------------------------
-- Assets: metadata for uploaded images and layout thumbnails. The file itself
-- lives in the private `assets` storage bucket at `<owner_id>/<asset id>`.
-- ---------------------------------------------------------------------------
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null default 'artwork' check (kind in ('artwork', 'thumbnail')),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg')),
  width int not null check (width >= 0),
  height int not null check (height >= 0),
  byte_size int not null check (byte_size between 1 and 31457280),
  created_at timestamptz not null default now()
);
create index assets_owner_idx on public.assets (owner_id, kind);

alter table public.layouts
  add constraint layouts_thumbnail_fk foreign key (thumbnail_asset_id) references public.assets (id) on delete set null;

-- Beta limit on uploaded images per account. Thumbnails don't count.
create or replace function public.enforce_asset_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  used int;
begin
  if new.kind = 'artwork' then
    select count(*) into used from public.assets where owner_id = new.owner_id and kind = 'artwork';
    if used >= 50 then
      raise exception 'upload_limit_reached' using errcode = 'P0001',
        hint = 'The beta allows 50 images per account. Remove some images to upload more.';
    end if;
  end if;
  return new;
end;
$$;

create trigger assets_quota
  before insert on public.assets
  for each row execute function public.enforce_asset_quota();

-- ---------------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so policies can consult other tables
-- without recursive RLS checks.
-- ---------------------------------------------------------------------------
create or replace function public.can_view_layout(p_layout uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from layouts where id = p_layout and owner_id = auth.uid())
      or exists (select 1 from shares where layout_id = p_layout and recipient_id = auth.uid());
$$;

create or replace function public.is_layout_owner(p_layout uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from layouts where id = p_layout and owner_id = auth.uid());
$$;

-- An image is readable by its owner, or by anyone who can view a layout that
-- hangs it or uses it as the thumbnail.
create or replace function public.can_read_asset(p_asset uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from assets where id = p_asset and owner_id = auth.uid())
      or exists (
        select 1
        from layouts l
        where (l.thumbnail_asset_id = p_asset
               or l.doc -> 'artworks' @> jsonb_build_array(jsonb_build_object('assetId', p_asset::text)))
          and (l.owner_id = auth.uid()
               or exists (select 1 from shares s where s.layout_id = l.id and s.recipient_id = auth.uid()))
      );
$$;

-- Two accounts are "connected" when one has shared a layout with the other.
-- Only connected accounts can see each other's name and email.
create or replace function public.are_connected(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from shares
    where (owner_id = auth.uid() and recipient_id = p_other)
       or (owner_id = p_other and recipient_id = auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.layouts enable row level security;
alter table public.shares enable row level security;
alter table public.notes enable row level security;
alter table public.assets enable row level security;

-- profiles
create policy "read own or connected profiles" on public.profiles
  for select to authenticated using (id = auth.uid() or public.are_connected(id));
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- layouts
-- Checks the row's own owner_id directly (not via can_view_layout), so a row
-- being inserted is visible to INSERT ... RETURNING in the same statement.
create policy "view own or shared layouts" on public.layouts
  for select to authenticated using (
    owner_id = auth.uid()
    or exists (select 1 from public.shares s where s.layout_id = layouts.id and s.recipient_id = auth.uid())
  );
create policy "create own layouts" on public.layouts
  for insert to authenticated with check (owner_id = auth.uid());
create policy "owners update layouts" on public.layouts
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners delete layouts" on public.layouts
  for delete to authenticated using (owner_id = auth.uid());

-- shares: created only through share_layout(); owners can revoke.
create policy "see shares you own or receive" on public.shares
  for select to authenticated using (owner_id = auth.uid() or recipient_id = auth.uid());
create policy "owners revoke shares" on public.shares
  for delete to authenticated using (owner_id = auth.uid());

-- notes
create policy "read notes on viewable layouts" on public.notes
  for select to authenticated using (public.can_view_layout(layout_id));
create policy "add notes to viewable layouts" on public.notes
  for insert to authenticated with check (public.can_view_layout(layout_id));
create policy "authors and layout owners delete notes" on public.notes
  for delete to authenticated using (author_id = auth.uid() or public.is_layout_owner(layout_id));

-- assets
create policy "read accessible assets" on public.assets
  for select to authenticated using (owner_id = auth.uid() or public.can_read_asset(id));
create policy "create own assets" on public.assets
  for insert to authenticated with check (owner_id = auth.uid());
create policy "delete own assets" on public.assets
  for delete to authenticated using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Sharing by email. Runs on the server so clients can't list accounts.
-- ---------------------------------------------------------------------------
create or replace function public.share_layout(p_layout uuid, p_email text)
returns public.shares
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  recipient public.profiles;
  result public.shares;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not exists (select 1 from layouts where id = p_layout and owner_id = me) then
    raise exception 'not_owner' using errcode = 'P0001', hint = 'Only the owner can share this layout.';
  end if;
  select * into recipient from profiles where email = lower(trim(p_email));
  if recipient.id is null then
    raise exception 'no_account' using errcode = 'P0001',
      hint = 'No account uses that email yet. Ask them to sign up first, then share again.';
  end if;
  if recipient.id = me then
    raise exception 'self_share' using errcode = 'P0001', hint = 'You can''t share a layout with yourself.';
  end if;
  insert into shares (layout_id, owner_id, recipient_id, recipient_email)
  values (p_layout, me, recipient.id, recipient.email)
  on conflict (layout_id, recipient_id) do update set recipient_email = excluded.recipient_email
  returning * into result;
  return result;
end;
$$;

revoke all on function public.share_layout(uuid, text) from public;
grant execute on function public.share_layout(uuid, text) to authenticated;

-- The caller's uploaded images that no layout of theirs uses any more (older
-- than an hour, so an image waiting to be hung isn't caught). The app deletes
-- these after saving, so removed images stop counting toward the upload limit.
create or replace function public.unused_asset_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.id
  from assets a
  where a.owner_id = auth.uid()
    and a.created_at < now() - interval '1 hour'
    and not exists (
      select 1 from layouts l
      where l.thumbnail_asset_id = a.id
         or l.doc -> 'artworks' @> jsonb_build_array(jsonb_build_object('assetId', a.id::text))
    );
$$;

revoke all on function public.unused_asset_ids() from public;
grant execute on function public.unused_asset_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, files at `<owner_id>/<asset id>`.
-- Upload requires the matching assets row (where the quota is enforced).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets', 'assets', false, 31457280, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

create or replace function public.asset_id_from_path(p_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return split_part(p_name, '/', 2)::uuid;
exception when others then
  return null;
end;
$$;

create policy "upload own asset files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'assets'
    and split_part(name, '/', 1) = auth.uid()::text
    and exists (
      select 1 from public.assets a
      where a.id = public.asset_id_from_path(name) and a.owner_id = auth.uid()
    )
  );
create policy "read accessible asset files" on storage.objects
  for select to authenticated using (
    bucket_id = 'assets' and public.can_read_asset(public.asset_id_from_path(name))
  );
create policy "delete own asset files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'assets' and split_part(name, '/', 1) = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Live updates: viewers hear saves and new notes. RLS still applies.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.layouts, public.notes;
