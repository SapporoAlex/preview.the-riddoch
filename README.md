# Gallery Studio (prototype)

Plan an exhibition in a 3D model of a gallery: hang images at real-world size, paint walls,
leave notes for collaborators and walk the rooms at eye level.

## Run it

```
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
npm run test:db    # check the database access rules
```

By default the app runs in **local mode**: everything is stored in this browser. To use real online
accounts, sharing and image storage, connect it to Supabase: see [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md).

## What's in the prototype

- **Accounts** – sign up / sign in with email + password (stored in this browser only).
- **Layouts** – each user can create, rename, duplicate and delete layouts. Saving stores a thumbnail.
- **Design view** – Sims-style build camera: drag to orbit, right-drag or WASD to pan, scroll to zoom,
  Q/E to turn. Exterior walls nearest the camera drop to a stub ("cutaway"); toggle in the top bar.
- **Images** – upload PNG/JPEG, enter the real size in cm (aspect ratio locked by default), then click
  any wall to hang it. Drag to move (including onto another wall), or type the exact centre height /
  offset in the inspector. Images can't overlap doorways or run off a wall. Frame: none/black/white/oak.
- **Paint** – curated palette plus custom colour with RGB sliders, RGB values and hex shown.
  Hover previews the colour; "Paint all walls in room" is available.
- **Lights** – each room has a ceiling laylight plus wall-wash lighting; toggle per room.
- **Visit** – first-person walk at ~6 ft (eye height 1.70 m) with wall collision. WASD/arrows, Shift to
  go faster, mouse to look, Esc to pause. "Design view" returns to the build camera.
- **Sharing** – share by email with another account (view + notes only). Viewers see the last saved
  version and update live when the owner saves.
- **Notes** – speech bubbles pinned to a wall or an image (they follow the image if it moves).
  The layout owner can delete any note; authors can delete their own.
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z), Ctrl+S to save, unsaved-changes guard.

### Trying sharing locally

All data lives in this browser. Create the second account here, then share with its email. To be signed in
as two people at once, sign in on a second tab with **Keep me signed in** unticked (that session is tab-only).

## Architecture

```
src/
  domain/         Pure model: types, building geometry, permission rules
    building.ts   Declarative floor plan -> wall pieces + hangable surfaces
  services/
    contracts.ts  Interfaces the UI depends on (Auth, Users, Layouts, Shares, Notes, Assets)
    local/        Local mode: localStorage + IndexedDB (images)
    supabase/     Online mode: Supabase auth, Postgres, Storage, Realtime
    index.tsx     Composition root – picks the backend from .env.local
supabase/
  migrations/     Database schema, access rules and storage policies
  tests/          Access-rule tests (npm run test:db)
  auth/           Auth context
  pages/          Sign-in and layouts dashboard
  editor/
    store.ts      Zustand editor state (working copy, history, tools, selection)
    scene/        React Three Fiber scene: building, lighting, artworks, notes, cameras, input
    ui/           Top bar, tool rail, inspector, colour picker, upload & share dialogs
```

### Scaling to a real backend

1. Implement the interfaces in `services/contracts.ts` against your API (e.g. `HttpLayoutRepository`)
   and swap them in `services/index.tsx`. No UI changes are needed.
2. Auth: replace `LocalAuthService` with a hosted identity provider. Its passwords are hashed with PBKDF2,
   but a client-side auth system is not secure.
3. Images: `AssetStore` maps to object storage with signed upload URLs; `getUrl` returns the CDN URL.
4. Enforce the rules in `domain/permissions.ts` on the server too.
5. `subscribe()` methods currently use BroadcastChannel; back them with websockets or SSE for live updates.
6. Layouts carry `schemaVersion` and a `buildingId`, so real floor plans can be added as new
   `BuildingSpec`s in `domain/building.ts` and old layouts can be migrated.
