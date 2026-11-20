-- Command Central newsroom hierarchy and future personalized-feed metadata.
alter table public.intelligence_items
  add column if not exists editorial_priority text,
  add column if not exists featured boolean not null default false,
  add column if not exists topic_tags text[] not null default '{}',
  add column if not exists geography_tags text[] not null default '{}',
  add column if not exists parent_story_id uuid references public.intelligence_items(id) on delete set null;

create index if not exists intelligence_items_public_desk_priority_idx
  on public.intelligence_items(public_desk, editorial_priority, published_at desc);

create index if not exists intelligence_items_topic_tags_gin
  on public.intelligence_items using gin(topic_tags);

create index if not exists intelligence_items_geography_tags_gin
  on public.intelligence_items using gin(geography_tags);

create or replace function public.command_central_story_metadata_staff(
  target_id uuid,
  story_priority text default null,
  story_featured boolean default false,
  story_topic_tags text[] default '{}',
  story_geography_tags text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  role_name text;
begin
  role_name := private.xgl_role();

  if auth.uid() is null or role_name not in ('owner','admin','editor') then
    raise exception 'Not authorized';
  end if;

  if story_priority is not null and story_priority not in ('red','amber','green') then
    raise exception 'Invalid editorial priority';
  end if;

  if story_featured then
    update public.intelligence_items
    set featured=false, updated_at=now()
    where public_desk=(select public_desk from public.intelligence_items where id=target_id)
      and id<>target_id
      and featured=true;
  end if;

  update public.intelligence_items
  set editorial_priority=story_priority,
      featured=coalesce(story_featured,false),
      topic_tags=coalesce(story_topic_tags,'{}'),
      geography_tags=coalesce(story_geography_tags,'{}'),
      updated_at=now()
  where id=target_id;

  if not found then raise exception 'Intelligence item not found'; end if;

  return jsonb_build_object('ok',true,'id',target_id);
end;
$function$;

revoke all on function public.command_central_story_metadata_staff(uuid,text,boolean,text[],text[]) from public, anon;
grant execute on function public.command_central_story_metadata_staff(uuid,text,boolean,text[],text[]) to authenticated;
