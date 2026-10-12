-- Command Central intelligence taxonomy
-- Watchtower = internal collection/analysis structure.
-- public_desk = public-facing translation/output.

alter table public.sources
  add column if not exists watchtower_category text;

alter table public.intelligence_items
  add column if not exists watchtower_category text,
  add column if not exists public_desk text;

-- Allowed Watchtower categories:
-- Business Watch, Regulatory Watch, Economic Watch,
-- Technology Watch, Community Watch, Environmental Watch.
--
-- Allowed public desks:
-- Field Signal, Regulatory Watch, Public Lands Watch,
-- Builder Intelligence, Industry Headlines, Emergency Response,
-- Event Calendar, Inside the Lab.

create or replace function public.apply_source_watchtower_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.watchtower_category is null then
    new.watchtower_category := case
      when new.stream = 'Regulatory Watch' then 'Regulatory Watch'
      when new.stream = 'Public Lands Watch' then 'Environmental Watch'
      when new.stream = 'Event Calendar' then 'Community Watch'
      when new.stream = 'Builder Intelligence' then 'Business Watch'
      when new.stream = 'Industry Headlines' then 'Business Watch'
      when new.stream = 'Emergency Response' then 'Community Watch'
      when new.stream = 'Inside the Lab' then 'Business Watch'
      else null
    end;
  end if;
  return new;
end;
$$;

create or replace function public.apply_command_central_taxonomy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_watch text;
begin
  if new.public_desk is null then new.public_desk := new.stream; end if;

  if new.watchtower_category is null and new.source_id is not null then
    select s.watchtower_category into source_watch
    from public.sources s
    where s.id = new.source_id;
    new.watchtower_category := source_watch;
  end if;

  if new.watchtower_category is null then
    new.watchtower_category := case
      when new.public_desk = 'Regulatory Watch' then 'Regulatory Watch'
      when new.public_desk = 'Public Lands Watch' then 'Environmental Watch'
      when new.public_desk = 'Event Calendar' then 'Community Watch'
      when new.public_desk = 'Builder Intelligence' then 'Business Watch'
      when new.public_desk = 'Industry Headlines' then 'Business Watch'
      when new.public_desk = 'Emergency Response' then 'Community Watch'
      when new.public_desk = 'Inside the Lab' then 'Business Watch'
      else null
    end;
  end if;

  return new;
end;
$$;
