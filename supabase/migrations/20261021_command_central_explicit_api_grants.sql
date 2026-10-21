-- Command Central API grant hardening ahead of Supabase's 2026-10-30 default change.

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

revoke all privileges on all tables in schema public from anon;
revoke all privileges on all tables in schema public from authenticated;

grant select on table public.events to anon;
grant select on table public.intelligence_items to anon;
grant select on table public.deadlines to anon;

grant select, insert, update, delete on table
  public.producers,
  public.sources,
  public.events,
  public.deadlines,
  public.intelligence_items,
  public.approvals,
  public.publication_versions,
  public.source_checks
to authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;

revoke execute on function public.apply_command_central_taxonomy() from public, anon, authenticated;
revoke execute on function public.apply_source_watchtower_category() from public, anon, authenticated;

revoke execute on function public.command_central_route_staff(uuid,text,text) from public, anon;
grant execute on function public.command_central_route_staff(uuid,text,text) to authenticated;

revoke execute on function public.command_central_action_staff(text,uuid,text,text,timestamptz) from public, anon;
grant execute on function public.command_central_action_staff(text,uuid,text,text,timestamptz) to authenticated;

revoke execute on function public.current_xgl_role() from public, anon;
grant execute on function public.current_xgl_role() to authenticated;
revoke execute on function public.editorial_queue() from public, anon;
grant execute on function public.editorial_queue() to authenticated;
revoke execute on function public.source_candidate_queue_staff() from public, anon;
grant execute on function public.source_candidate_queue_staff() to authenticated;
revoke execute on function public.source_candidate_review_staff(uuid,text,jsonb) from public, anon;
grant execute on function public.source_candidate_review_staff(uuid,text,jsonb) to authenticated;
revoke execute on function public.source_watch_status() from public, anon;
grant execute on function public.source_watch_status() to authenticated;
revoke execute on function public.submit_source_candidate_staff(text,text,text,text,text,text) from public, anon;
grant execute on function public.submit_source_candidate_staff(text,text,text,text,text,text) to authenticated;

revoke execute on function public.public_event_brief(text) from public;
grant execute on function public.public_event_brief(text) to anon, authenticated;

create or replace function public.command_central_public_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'active_sources', (select count(*) from public.sources where active = true),
    'regulatory_sources', (select count(*) from public.sources where active = true and stream = 'Regulatory Watch'),
    'public_lands_sources', (select count(*) from public.sources where active = true and stream = 'Public Lands Watch'),
    'event_sources', (select count(*) from public.sources where active = true and stream = 'Event Calendar'),
    'builder_sources', (select count(*) from public.sources where active = true and stream = 'Builder Intelligence'),
    'industry_sources', (select count(*) from public.sources where active = true and stream = 'Industry Headlines'),
    'emergency_sources', (select count(*) from public.sources where active = true and stream = 'Emergency Response'),
    'inside_lab_sources', (select count(*) from public.sources where active = true and stream = 'Inside the Lab'),
    'pipeline_items', (
      select count(*) from public.intelligence_items
      where editorial_status not in ('killed','archived')
    )
  )
$function$;

revoke execute on function public.command_central_public_status() from public;
grant execute on function public.command_central_public_status() to anon, authenticated;

create index if not exists source_candidates_duplicate_source_id_idx
  on public.source_candidates(duplicate_source_id);
create index if not exists source_candidates_promoted_source_id_idx
  on public.source_candidates(promoted_source_id);
