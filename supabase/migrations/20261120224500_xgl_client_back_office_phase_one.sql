-- XGL secure multi-tenant client back office: Phase 1.
-- All client records are organization-scoped. Staff access is either elevated
-- (owner/admin) or explicitly assigned to the organization.

create table public.portal_staff_assignments (
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_role text not null default 'manager' check (assignment_role in ('manager','contributor','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.portal_user_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role text not null default 'member' check (role in ('owner','admin','member','viewer')),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid references auth.users(id) on delete set null default auth.uid(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email, status)
);

create table public.portal_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'planned' check (status in ('planned','active','blocked','complete','archived')),
  health text not null default 'on_track' check (health in ('on_track','attention','at_risk')),
  starts_on date,
  target_date date,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_date is null or starts_on is null or target_date >= starts_on)
);

create table public.portal_work_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  project_id uuid references public.portal_projects(id) on delete cascade,
  item_type text not null check (item_type in ('milestone','action')),
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open','in_progress','blocked','complete','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portal_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  project_id uuid references public.portal_projects(id) on delete cascade,
  title text not null,
  context text,
  decision text,
  status text not null default 'open' check (status in ('open','decided','superseded')),
  needed_by timestamptz,
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portal_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  project_id uuid references public.portal_projects(id) on delete set null,
  title text not null,
  description text,
  category text not null default 'working' check (category in ('working','contract','strategy','creative','report','reference','other')),
  status text not null default 'active' check (status in ('active','archived')),
  current_version integer not null default 0 check (current_version >= 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portal_document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  document_id uuid not null references public.portal_documents(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  storage_bucket text not null default 'portal-documents' check (storage_bucket = 'portal-documents'),
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  version_note text,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (document_id, version_number),
  unique (storage_bucket, storage_path)
);

create table public.portal_deliverables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  project_id uuid references public.portal_projects(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','ready','in_review','approved','revision_requested','delivered','archived')),
  document_version_id uuid references public.portal_document_versions(id) on delete set null,
  due_at timestamptz,
  delivered_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portal_approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  project_id uuid references public.portal_projects(id) on delete set null,
  deliverable_id uuid references public.portal_deliverables(id) on delete cascade,
  document_version_id uuid not null references public.portal_document_versions(id) on delete restrict,
  title text not null,
  instructions text,
  status text not null default 'pending' check (status in ('pending','approved','revision_requested','cancelled')),
  requested_by uuid references auth.users(id) on delete set null default auth.uid(),
  requested_at timestamptz not null default now(),
  due_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portal_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  project_id uuid references public.portal_projects(id) on delete cascade,
  target_type text not null check (target_type in ('project','work_item','decision','document','deliverable','approval')),
  target_id uuid not null,
  body text not null check (length(trim(body)) > 0),
  author_id uuid references auth.users(id) on delete set null default auth.uid(),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portal_activity (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.portal_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  event_type text not null,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  recipient_email text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','cancelled')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  check (recipient_user_id is not null or recipient_email is not null)
);

create index portal_staff_assignments_user_idx on public.portal_staff_assignments(user_id, active);
create index portal_invitations_org_idx on public.portal_user_invitations(organization_id, status, created_at desc);
create index portal_projects_org_idx on public.portal_projects(organization_id, status, updated_at desc);
create index portal_work_items_org_idx on public.portal_work_items(organization_id, status, due_at);
create index portal_work_items_project_idx on public.portal_work_items(project_id, item_type, status);
create index portal_decisions_org_idx on public.portal_decisions(organization_id, status, needed_by);
create index portal_documents_org_idx on public.portal_documents(organization_id, status, updated_at desc);
create index portal_document_versions_document_idx on public.portal_document_versions(document_id, version_number desc);
create index portal_deliverables_org_idx on public.portal_deliverables(organization_id, status, due_at);
create index portal_approvals_org_idx on public.portal_approval_requests(organization_id, status, due_at);
create index portal_comments_target_idx on public.portal_comments(organization_id, target_type, target_id, created_at);
create index portal_activity_org_idx on public.portal_activity(organization_id, created_at desc);
create index portal_outbox_pending_idx on public.portal_notification_outbox(status, available_at) where status = 'pending';

create or replace function private.portal_is_admin()
returns boolean language sql stable security definer set search_path = '' as $function$
  select coalesce(private.xgl_role() in ('owner','admin'), false)
$function$;

create or replace function private.portal_is_assigned_staff(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select private.portal_is_admin() or exists (
    select 1 from public.portal_staff_assignments a
    where a.organization_id = target_organization_id
      and a.user_id = (select auth.uid()) and a.active = true
  )
$function$;

create or replace function private.portal_member_role(target_organization_id uuid)
returns text language sql stable security definer set search_path = '' as $function$
  select ou.role from public.portal_organization_users ou
  where ou.organization_id = target_organization_id
    and ou.user_id = (select auth.uid()) and ou.status = 'active' limit 1
$function$;

create or replace function private.portal_can_view_organization(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select (select auth.uid()) is not null and (
    private.portal_is_assigned_staff(target_organization_id)
    or private.portal_member_role(target_organization_id) is not null
  )
$function$;

create or replace function private.portal_can_edit_organization(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select (select auth.uid()) is not null and (
    private.portal_is_admin()
    or exists (select 1 from public.portal_staff_assignments a where a.organization_id=target_organization_id and a.user_id=(select auth.uid()) and a.active and a.assignment_role in ('manager','contributor'))
    or private.portal_member_role(target_organization_id) in ('owner','admin','member')
  )
$function$;

create or replace function private.portal_can_admin_organization(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select (select auth.uid()) is not null and (
    private.portal_is_admin()
    or exists (select 1 from public.portal_staff_assignments a where a.organization_id=target_organization_id and a.user_id=(select auth.uid()) and a.active and a.assignment_role='manager')
    or private.portal_member_role(target_organization_id) in ('owner','admin')
  )
$function$;

create or replace function private.portal_storage_org_id(object_name text)
returns uuid language plpgsql stable set search_path = '' as $function$
declare result uuid;
begin
  if (storage.foldername(object_name))[1] <> 'xgl_client' then return null; end if;
  result := ((storage.foldername(object_name))[2])::uuid;
  return result;
exception when others then return null;
end;
$function$;

create or replace function private.portal_audit_row()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare row_data jsonb; org uuid; entity uuid; label text;
begin
  row_data := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org := (row_data->>'organization_id')::uuid;
  entity := nullif(row_data->>'id','')::uuid;
  label := coalesce(row_data->>'title', row_data->>'name', initcap(replace(tg_table_name,'portal_','')));
  insert into public.portal_activity(organization_id,actor_user_id,entity_type,entity_id,action,summary,metadata)
  values (org,(select auth.uid()),replace(tg_table_name,'portal_',''),entity,lower(tg_op),label,jsonb_build_object('table',tg_table_name));
  return case when tg_op='DELETE' then old else new end;
end;
$function$;

create or replace function private.portal_set_document_current_version()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  update public.portal_documents set current_version = greatest(current_version,new.version_number), updated_at=now()
  where id=new.document_id and organization_id=new.organization_id;
  return new;
end;
$function$;

create or replace function private.portal_queue_approval_notification()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op='INSERT' or new.status is distinct from old.status then
    insert into public.portal_notification_outbox(organization_id,event_type,recipient_user_id,payload)
    select new.organization_id,'approval.'||new.status,ou.user_id,jsonb_build_object('approval_id',new.id,'title',new.title,'status',new.status)
    from public.portal_organization_users ou
    where ou.organization_id=new.organization_id and ou.status='active';
  end if;
  return new;
end;
$function$;

do $triggers$
declare t text;
begin
  foreach t in array array['portal_user_invitations','portal_projects','portal_work_items','portal_decisions','portal_documents','portal_deliverables','portal_approval_requests','portal_comments'] loop
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function private.portal_set_updated_at()',t,t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function private.portal_audit_row()',t,t);
  end loop;
end $triggers$;
create trigger portal_document_versions_audit after insert or delete on public.portal_document_versions for each row execute function private.portal_audit_row();
create trigger portal_document_versions_current after insert on public.portal_document_versions for each row execute function private.portal_set_document_current_version();
create trigger portal_approvals_notify after insert or update of status on public.portal_approval_requests for each row execute function private.portal_queue_approval_notification();

alter table public.portal_staff_assignments enable row level security;
alter table public.portal_user_invitations enable row level security;
alter table public.portal_projects enable row level security;
alter table public.portal_work_items enable row level security;
alter table public.portal_decisions enable row level security;
alter table public.portal_documents enable row level security;
alter table public.portal_document_versions enable row level security;
alter table public.portal_deliverables enable row level security;
alter table public.portal_approval_requests enable row level security;
alter table public.portal_comments enable row level security;
alter table public.portal_activity enable row level security;
alter table public.portal_notification_outbox enable row level security;

do $policies$
declare t text;
begin
  foreach t in array array['portal_user_invitations','portal_projects','portal_work_items','portal_decisions','portal_documents','portal_document_versions','portal_deliverables','portal_approval_requests','portal_comments'] loop
    execute format('create policy "organization members can read %1$s" on public.%1$I for select to authenticated using (private.portal_can_view_organization(organization_id))',t);
    execute format('create policy "organization editors can insert %1$s" on public.%1$I for insert to authenticated with check (private.portal_can_edit_organization(organization_id))',t);
    execute format('create policy "organization editors can update %1$s" on public.%1$I for update to authenticated using (private.portal_can_edit_organization(organization_id)) with check (private.portal_can_edit_organization(organization_id))',t);
    execute format('create policy "organization editors can delete %1$s" on public.%1$I for delete to authenticated using (private.portal_can_edit_organization(organization_id))',t);
  end loop;
end $policies$;

create policy "authorized users can read staff assignments" on public.portal_staff_assignments for select to authenticated using (private.portal_can_view_organization(organization_id));
create policy "organization admins manage staff assignments" on public.portal_staff_assignments for all to authenticated using (private.portal_can_admin_organization(organization_id)) with check (private.portal_can_admin_organization(organization_id));
create policy "organization members read activity" on public.portal_activity for select to authenticated using (private.portal_can_view_organization(organization_id));
create policy "admins read notification outbox" on public.portal_notification_outbox for select to authenticated using (private.portal_can_admin_organization(organization_id));

-- Membership management: select remains from the foundation; administration is explicit.
create policy "organization admins insert members" on public.portal_organization_users for insert to authenticated with check (private.portal_can_admin_organization(organization_id));
create policy "organization admins update members" on public.portal_organization_users for update to authenticated using (private.portal_can_admin_organization(organization_id)) with check (private.portal_can_admin_organization(organization_id));
create policy "organization admins remove members" on public.portal_organization_users for delete to authenticated using (private.portal_can_admin_organization(organization_id));

revoke all on table public.portal_staff_assignments,public.portal_user_invitations,public.portal_projects,public.portal_work_items,public.portal_decisions,public.portal_documents,public.portal_document_versions,public.portal_deliverables,public.portal_approval_requests,public.portal_comments,public.portal_activity,public.portal_notification_outbox from anon,authenticated;
grant select,insert,update,delete on table public.portal_staff_assignments,public.portal_user_invitations,public.portal_projects,public.portal_work_items,public.portal_decisions,public.portal_documents,public.portal_document_versions,public.portal_deliverables,public.portal_approval_requests,public.portal_comments to authenticated;
grant select on table public.portal_activity,public.portal_notification_outbox to authenticated;
grant usage,select on sequence public.portal_activity_id_seq to authenticated;

revoke all on function private.portal_is_admin(),private.portal_is_assigned_staff(uuid),private.portal_member_role(uuid),private.portal_can_edit_organization(uuid),private.portal_can_admin_organization(uuid),private.portal_storage_org_id(text),private.portal_audit_row(),private.portal_set_document_current_version(),private.portal_queue_approval_notification() from public;
grant execute on function private.portal_is_admin(),private.portal_is_assigned_staff(uuid),private.portal_member_role(uuid),private.portal_can_edit_organization(uuid),private.portal_can_admin_organization(uuid),private.portal_storage_org_id(text) to authenticated,service_role;

-- Client files use xgl_client/<organization uuid>/<document uuid>/<version>/<filename>.
create policy "client members download organization files" on storage.objects for select to authenticated using (bucket_id='portal-documents' and private.portal_can_view_organization(private.portal_storage_org_id(name)));
create policy "client editors upload organization files" on storage.objects for insert to authenticated with check (bucket_id='portal-documents' and private.portal_can_edit_organization(private.portal_storage_org_id(name)));
create policy "client editors update organization files" on storage.objects for update to authenticated using (bucket_id='portal-documents' and private.portal_can_edit_organization(private.portal_storage_org_id(name))) with check (bucket_id='portal-documents' and private.portal_can_edit_organization(private.portal_storage_org_id(name)));
create policy "client editors delete organization files" on storage.objects for delete to authenticated using (bucket_id='portal-documents' and private.portal_can_edit_organization(private.portal_storage_org_id(name)));

insert into public.portal_program_enrollments(organization_id,program_code,status,member_lane,accepted_at,starts_at)
select id,'xgl_client','active','Client Workspace',now(),now() from public.portal_organizations where slug='cascadia-trailer-equipment'
on conflict (organization_id,program_code) do update set status='active',member_lane='Client Workspace',accepted_at=coalesce(public.portal_program_enrollments.accepted_at,excluded.accepted_at),starts_at=coalesce(public.portal_program_enrollments.starts_at,excluded.starts_at);

insert into public.portal_staff_assignments(organization_id,user_id,assignment_role)
select o.id,u.id,'manager' from public.portal_organizations o
join public.xgl_staff s on s.active and s.role in ('owner','admin','editor')
join auth.users u on lower(u.email)=lower(s.email)
where o.slug='cascadia-trailer-equipment'
on conflict (organization_id,user_id) do update set active=true,assignment_role=excluded.assignment_role;

insert into public.portal_projects(organization_id,name,description,status,health,starts_on,created_by)
select o.id,'XGL Client Workspace','The shared operating room for active XGL work, decisions, approvals, and deliverables.','active','on_track',current_date,u.id
from public.portal_organizations o
join public.xgl_staff s on s.active and s.role in ('owner','admin')
join auth.users u on lower(u.email)=lower(s.email)
where o.slug='cascadia-trailer-equipment'
and not exists (select 1 from public.portal_projects p where p.organization_id=o.id and p.name='XGL Client Workspace');
