-- Staff override for Command Central intelligence routing.
-- Watchtower category = internal collection/analysis origin.
-- Public desk = how readers encounter the signal.

create or replace function public.command_central_route_staff(
  target_id uuid,
  watchtower_category text,
  public_desk text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.xgl_role() not in ('owner','admin','editor') then
    raise exception 'Not authorized';
  end if;

  if watchtower_category not in (
    'Business Watch','Regulatory Watch','Economic Watch',
    'Technology Watch','Community Watch','Environmental Watch'
  ) then
    raise exception 'Invalid Watchtower category';
  end if;

  if public_desk not in (
    'Field Signal','Regulatory Watch','Public Lands Watch',
    'Builder Intelligence','Industry Headlines','Emergency Response',
    'Event Calendar','Inside the Lab'
  ) then
    raise exception 'Invalid public desk';
  end if;

  update public.intelligence_items
  set watchtower_category = command_central_route_staff.watchtower_category,
      public_desk = command_central_route_staff.public_desk,
      stream = command_central_route_staff.public_desk,
      updated_at = now()
  where id = target_id;

  if not found then
    raise exception 'Intelligence item not found';
  end if;

  return jsonb_build_object(
    'id', target_id,
    'watchtower_category', watchtower_category,
    'public_desk', public_desk
  );
end;
$$;

revoke all on function public.command_central_route_staff(uuid,text,text) from public;
grant execute on function public.command_central_route_staff(uuid,text,text) to authenticated;
