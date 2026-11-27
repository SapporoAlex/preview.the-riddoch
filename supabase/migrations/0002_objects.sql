-- Layouts can now hold 3D objects (photos on plinths) as well as hung images.
-- Their photos must be readable by everyone who can view the layout, and must
-- not be cleaned up as "unused".

create or replace function public.layout_uses_asset(l public.layouts, p_asset uuid)
returns boolean
language sql
immutable
as $$
  select l.thumbnail_asset_id = p_asset
      or l.doc -> 'artworks' @> jsonb_build_array(jsonb_build_object('assetId', p_asset::text))
      or coalesce(l.doc -> 'objects', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('assetId', p_asset::text));
$$;

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
        where public.layout_uses_asset(l, p_asset)
          and (l.owner_id = auth.uid()
               or exists (select 1 from shares s where s.layout_id = l.id and s.recipient_id = auth.uid()))
      );
$$;

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
    and not exists (select 1 from layouts l where public.layout_uses_asset(l, a.id));
$$;
