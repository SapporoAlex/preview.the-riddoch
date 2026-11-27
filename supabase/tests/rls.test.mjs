// Runs the Gallery Studio migration in PGlite with stand-ins for Supabase's
// auth/storage schemas, then checks the row-level security rules as 3 users.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Applies every migration in order, like `supabase db push` would.
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
const db = new PGlite();

const STUBS = `
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role authenticated;
create role anon;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create publication supabase_realtime;
`;
const GRANTS = `
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, delete on storage.objects to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function auth.uid() to authenticated;
`;

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

async function as(user, sql, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
  await db.exec('set role authenticated');
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
  }
}
async function asErr(user, sql, params = []) {
  try { await as(user, sql, params); return null; } catch (e) { return e.message; }
}

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';

try {
await db.exec(STUBS);
for (const f of migrations) await db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
await db.exec(GRANTS);
console.log('Migration applied.');

await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${A}', 'Owner@Example.test', '{"display_name":"Ada Owner"}'),
  ('${B}', 'viewer@example.test', '{"display_name":"Ben Viewer"}'),
  ('${C}', 'stranger@example.test', '{}')`);
const profs = await db.query('select id, email, display_name from profiles order by email');
check('profiles created on sign-up (email lower-cased, name fallback)',
  profs.rows.length === 3 && profs.rows.some((r) => r.email === 'owner@example.test') && profs.rows.some((r) => r.display_name === 'stranger'));

// Owner creates a layout + an asset.
const lay = (await as(A, `insert into layouts (owner_id, name, building_id) values ($1, 'Spring show', 'practice-v1') returning id`, [A])).rows[0].id;
check('owner can create a layout', !!lay);
check('cannot create a layout for someone else', !!(await asErr(A, `insert into layouts (owner_id, name, building_id) values ($1, 'x', 'p')`, [B])));
const asset = (await as(A, `insert into assets (mime_type, width, height, byte_size) values ('image/png', 10, 10, 100) returning id, owner_id`)).rows[0];
check('asset owner defaults to the signed-in user', asset.owner_id === A);
check('owner can upload file at own/<asset id>', !(await asErr(A, `insert into storage.objects (bucket_id, name) values ('assets', $1)`, [`${A}/${asset.id}`])));
check('upload refused without a matching asset row', !!(await asErr(A, `insert into storage.objects (bucket_id, name) values ('assets', $1)`, [`${A}/11111111-1111-1111-1111-111111111111`])));
check('upload refused into another user\'s folder', !!(await asErr(B, `insert into storage.objects (bucket_id, name) values ('assets', $1)`, [`${A}/${asset.id}`])));
await as(A, `update layouts set doc = jsonb_build_object('artworks', jsonb_build_array(jsonb_build_object('id','art1','assetId',$2::text,'title','Sunset')), 'wallPaint', '{}'::jsonb, 'rooms', '{}'::jsonb) where id = $1`, [lay, asset.id]);
check('artwork_count is computed from the doc', (await as(A, `select artwork_count from layouts where id=$1`, [lay])).rows[0].artwork_count === 1);

// Before sharing.
check('stranger cannot see the layout', (await as(B, `select id from layouts where id=$1`, [lay])).rows.length === 0);
check('viewer cannot read the image before sharing', (await as(B, `select id from assets where id=$1`, [asset.id])).rows.length === 0);
check('viewer cannot see owner profile before sharing', (await as(B, `select id from profiles where id=$1`, [A])).rows.length === 0);

// Sharing.
check('cannot share someone else\'s layout', /not_owner/.test(await asErr(B, `select share_layout($1, 'stranger@example.test')`, [lay]) ?? ''));
check('share to unknown email gives no_account', /no_account/.test(await asErr(A, `select share_layout($1, 'nobody@example.test')`, [lay]) ?? ''));
check('cannot share with yourself', /self_share/.test(await asErr(A, `select share_layout($1, 'owner@example.test')`, [lay]) ?? ''));
const sh = (await as(A, `select (share_layout($1, ' Viewer@Example.test ')).*`, [lay])).rows[0];
check('owner shares by email (case/space-insensitive)', sh?.recipient_id === B);
check('sharing twice does not duplicate', (await as(A, `select (share_layout($1, 'viewer@example.test')).id`, [lay])).rows[0].id === sh.id);
check('direct insert into shares is refused', !!(await asErr(B, `insert into shares (layout_id, owner_id, recipient_id, recipient_email) values ($1,$2,$3,'x')`, [lay, A, C])));

// Viewer.
check('viewer can see the shared layout', (await as(B, `select id from layouts where id=$1`, [lay])).rows.length === 1);
check('viewer update changes nothing', (await as(B, `update layouts set name='hacked' where id=$1 returning id`, [lay])).rows.length === 0);
check('viewer delete changes nothing', (await as(B, `delete from layouts where id=$1 returning id`, [lay])).rows.length === 0);
check('viewer can read the hung image row', (await as(B, `select id from assets where id=$1`, [asset.id])).rows.length === 1);
check('viewer can read the image file', (await as(B, `select id from storage.objects where name=$1`, [`${A}/${asset.id}`])).rows.length === 1);
check('stranger cannot read the image file', (await as(C, `select id from storage.objects where name=$1`, [`${A}/${asset.id}`])).rows.length === 0);
check('viewer can now see the owner profile', (await as(B, `select display_name from profiles where id=$1`, [A])).rows[0]?.display_name === 'Ada Owner');
check('viewer cannot see an unconnected profile', (await as(B, `select id from profiles where id=$1`, [C])).rows.length === 0);
check('viewer sees the share they received', (await as(B, `select id from shares`)).rows.length === 1);
check('viewer cannot revoke the share', (await as(B, `delete from shares where id=$1 returning id`, [sh.id])).rows.length === 0);

// Notes.
const nB = (await as(B, `insert into notes (layout_id, author_id, author_name, text, anchor) values ($1, $2, 'Fake Name', 'Love this wall', '{}') returning id, author_name, author_id`, [lay, A])).rows[0];
check('viewer can add a note; author and name come from the server', nB.author_id === B && nB.author_name === 'Ben Viewer');
const nA = (await as(A, `insert into notes (layout_id, text, anchor) values ($1, 'Thanks!', '{}') returning id`, [lay])).rows[0];
check('stranger cannot add a note', !!(await asErr(C, `insert into notes (layout_id, text, anchor) values ($1, 'spam', '{}')`, [lay])));
check('stranger cannot read notes', (await as(C, `select id from notes where layout_id=$1`, [lay])).rows.length === 0);
check('empty note is rejected', !!(await asErr(B, `insert into notes (layout_id, text, anchor) values ($1, '', '{}')`, [lay])));
check('viewer cannot delete the owner\'s note', (await as(B, `delete from notes where id=$1 returning id`, [nA.id])).rows.length === 0);
const nB2 = (await as(B, `insert into notes (layout_id, text, anchor) values ($1, 'Second thought', '{}') returning id`, [lay])).rows[0];
check('author can delete their own note', (await as(B, `delete from notes where id=$1 returning id`, [nB2.id])).rows.length === 1);
check('owner can delete a viewer\'s note', (await as(A, `delete from notes where id=$1 returning id`, [nB.id])).rows.length === 1);

// Revoke.
check('owner can revoke the share', (await as(A, `delete from shares where id=$1 returning id`, [sh.id])).rows.length === 1);
check('after revoke the viewer loses access', (await as(B, `select id from layouts where id=$1`, [lay])).rows.length === 0);

// Quota.
await db.exec('reset role');
for (let i = 0; i < 49; i++) await as(A, `insert into assets (mime_type, width, height, byte_size) values ('image/jpeg', 1, 1, 1)`);
check('51st artwork upload is refused', /upload_limit_reached/.test(await asErr(A, `insert into assets (mime_type, width, height, byte_size) values ('image/jpeg', 1, 1, 1)`) ?? ''));
check('thumbnails do not count toward the limit', !(await asErr(A, `insert into assets (kind, mime_type, width, height, byte_size) values ('thumbnail','image/jpeg', 1, 1, 1)`)));
check('non-image uploads are refused', !!(await asErr(A, `insert into assets (mime_type, width, height, byte_size) values ('text/html', 1, 1, 1)`)));

// 3D object photos (migration 0002).
const objAsset = (await as(A, `insert into assets (mime_type, width, height, byte_size, kind) values ('image/png', 10, 10, 100, 'thumbnail') returning id`)).rows[0].id;
await as(A, `update layouts set doc = doc || jsonb_build_object('objects', jsonb_build_array(jsonb_build_object('id','o1','assetId',$2::text))) where id = $1`, [lay, objAsset]);
await as(A, `select share_layout($1, 'viewer@example.test')`, [lay]);
check('viewer can read a 3D object photo on a shared layout', (await as(B, `select id from assets where id=$1`, [objAsset])).rows.length === 1);
check('stranger cannot read the object photo', (await as(C, `select id from assets where id=$1`, [objAsset])).rows.length === 0);
await as(A, `delete from shares where layout_id=$1`, [lay]);

// Unused-image cleanup.
await db.exec('reset role');
await db.query(`update assets set created_at = now() - interval '2 hours'`);
const unusedA = (await as(A, `select unused_asset_ids() as id`)).rows.map((r) => r.id);
check('cleanup lists old images no layout uses', unusedA.length === 50 && !unusedA.includes(asset.id), `${unusedA.length} listed`);
check('cleanup keeps 3D object photos that are in use', !unusedA.includes(objAsset));
check('cleanup never lists someone else\'s images', (await as(B, `select unused_asset_ids() as id`)).rows.length === 0);
const fresh = (await as(A, `insert into assets (kind, mime_type, width, height, byte_size) values ('thumbnail','image/png',1,1,1) returning id`)).rows[0].id;
check('cleanup skips images uploaded in the last hour', !(await as(A, `select unused_asset_ids() as id`)).rows.some((r) => r.id === fresh));

// Cascades.
await as(A, `select share_layout($1, 'viewer@example.test')`, [lay]);
check('owner can delete the layout', (await as(A, `delete from layouts where id=$1 returning id`, [lay])).rows.length === 1);
await db.exec('reset role');
check('deleting a layout removes its shares and notes',
  (await db.query(`select count(*)::int n from shares where layout_id=$1`, [lay])).rows[0].n === 0 &&
  (await db.query(`select count(*)::int n from notes where layout_id=$1`, [lay])).rows[0].n === 0);
check('signed-out requests see nothing', (await as(null, `select id from layouts`)).rows.length === 0);

} catch (e) { console.log('CRASH  ' + e.message); fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
