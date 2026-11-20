-- One Rising Sun and XGL client portal foundation.
-- Authentication is shared. Program access is explicit and independent.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table public.portal_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portal_organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  legal_name text not null,
  display_name text not null,
  status text not null default 'pending'
    check (status in ('pending','active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portal_programs (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  name text not null,
  description text not null,
  portal_path text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portal_organization_users (
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner','admin','member','viewer')),
  status text not null default 'invited'
    check (status in ('invited','active','suspended','revoked')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.portal_program_enrollments (
  organization_id uuid not null references public.portal_organizations(id) on delete cascade,
  program_code text not null references public.portal_programs(code) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending','active','suspended','ended')),
  member_lane text,
  accepted_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, program_code),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.portal_resources (
  id uuid primary key default gen_random_uuid(),
  program_code text not null references public.portal_programs(code) on delete restrict,
  title text not null,
  description text,
  resource_type text not null default 'document'
    check (resource_type in ('document','link','course','opportunity','announcement')),
  storage_bucket text,
  storage_path text,
  external_url text,
  status text not null default 'draft'
    check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (storage_bucket is not null and storage_path is not null and external_url is null)
    or (storage_bucket is null and storage_path is null and external_url is not null)
    or (status = 'draft' and storage_bucket is null and storage_path is null and external_url is null)
  )
);

create index portal_organization_users_user_idx
  on public.portal_organization_users(user_id, status);
create index portal_program_enrollments_program_idx
  on public.portal_program_enrollments(program_code, status);
create index portal_resources_program_idx
  on public.portal_resources(program_code, status, published_at desc);

create or replace function private.portal_is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(private.xgl_role() in ('owner','admin','editor'), false)
$function$;

create or replace function private.portal_can_view_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and (
      private.portal_is_staff()
      or exists (
        select 1
        from public.portal_organization_users ou
        where ou.organization_id = target_organization_id
          and ou.user_id = (select auth.uid())
          and ou.status = 'active'
      )
    )
$function$;

create or replace function private.portal_has_program(target_program_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and (
      private.portal_is_staff()
      or exists (
        select 1
        from public.portal_organization_users ou
        join public.portal_organizations o
          on o.id = ou.organization_id
        join public.portal_program_enrollments pe
          on pe.organization_id = ou.organization_id
        where ou.user_id = (select auth.uid())
          and ou.status = 'active'
          and o.status = 'active'
          and pe.program_code = target_program_code
          and pe.status = 'active'
          and (pe.starts_at is null or pe.starts_at <= now())
          and (pe.ends_at is null or pe.ends_at > now())
      )
    )
$function$;

create or replace function private.portal_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create trigger portal_profiles_updated_at
before update on public.portal_profiles
for each row execute function private.portal_set_updated_at();
create trigger portal_organizations_updated_at
before update on public.portal_organizations
for each row execute function private.portal_set_updated_at();
create trigger portal_programs_updated_at
before update on public.portal_programs
for each row execute function private.portal_set_updated_at();
create trigger portal_organization_users_updated_at
before update on public.portal_organization_users
for each row execute function private.portal_set_updated_at();
create trigger portal_program_enrollments_updated_at
before update on public.portal_program_enrollments
for each row execute function private.portal_set_updated_at();
create trigger portal_resources_updated_at
before update on public.portal_resources
for each row execute function private.portal_set_updated_at();

alter table public.portal_profiles enable row level security;
alter table public.portal_organizations enable row level security;
alter table public.portal_programs enable row level security;
alter table public.portal_organization_users enable row level security;
alter table public.portal_program_enrollments enable row level security;
alter table public.portal_resources enable row level security;

revoke all on table
  public.portal_profiles,
  public.portal_organizations,
  public.portal_programs,
  public.portal_organization_users,
  public.portal_program_enrollments,
  public.portal_resources
from anon, authenticated;

grant select, insert, update on table public.portal_profiles to authenticated;
grant select on table
  public.portal_organizations,
  public.portal_programs,
  public.portal_organization_users,
  public.portal_program_enrollments,
  public.portal_resources
to authenticated;
grant select, insert, update, delete on table
  public.portal_profiles,
  public.portal_organizations,
  public.portal_programs,
  public.portal_organization_users,
  public.portal_program_enrollments,
  public.portal_resources
to service_role;

create policy "users can read their portal profile"
on public.portal_profiles for select to authenticated
using ((select auth.uid()) = user_id or private.portal_is_staff());

create policy "users can create their portal profile"
on public.portal_profiles for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "users can update their portal profile"
on public.portal_profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "members can read their organizations"
on public.portal_organizations for select to authenticated
using (private.portal_can_view_organization(id));

create policy "signed in users can read active portal programs"
on public.portal_programs for select to authenticated
using (active = true);

create policy "members can read their organization links"
on public.portal_organization_users for select to authenticated
using (
  user_id = (select auth.uid())
  or private.portal_can_view_organization(organization_id)
);

create policy "members can read their program enrollments"
on public.portal_program_enrollments for select to authenticated
using (private.portal_can_view_organization(organization_id));

create policy "members can read published entitled resources"
on public.portal_resources for select to authenticated
using (
  status = 'published'
  and published_at is not null
  and published_at <= now()
  and private.portal_has_program(program_code)
);

revoke all on function private.portal_is_staff() from public;
revoke all on function private.portal_can_view_organization(uuid) from public;
revoke all on function private.portal_has_program(text) from public;
revoke all on function private.portal_set_updated_at() from public;
grant execute on function private.portal_is_staff() to authenticated, service_role;
grant execute on function private.portal_can_view_organization(uuid) to authenticated, service_role;
grant execute on function private.portal_has_program(text) to authenticated, service_role;

insert into public.portal_programs (code, name, description, portal_path)
values
  (
    'one_rising_sun',
    'One Rising Sun',
    'The vetted membership network for independent builders, makers, service partners, product partners, Stewards, and community collaborators.',
    '/one-rising-sun/portal'
  ),
  (
    'xgl_client',
    'Expedition Growth Lab Client Portal',
    'Private deliverables, decisions, working materials, and account resources for active Expedition Growth Lab clients.',
    '/client-portal'
  )
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  portal_path = excluded.portal_path,
  active = true;

insert into public.portal_organizations (slug, legal_name, display_name, status)
values
  ('cascadia-trailer-equipment', 'Cascadia Trailer & Equipment', 'Cascadia Trailer & Equipment', 'active'),
  ('solar-ark-electrical', 'Solar Ark Electrical LLC', 'Solar Ark Electrical LLC', 'pending')
on conflict (slug) do update set
  legal_name = excluded.legal_name,
  display_name = excluded.display_name,
  status = excluded.status;

insert into public.portal_program_enrollments (
  organization_id,
  program_code,
  status,
  member_lane,
  accepted_at,
  starts_at
)
select id, 'one_rising_sun', 'active', 'Builder & Field Service', now(), now()
from public.portal_organizations
where slug = 'cascadia-trailer-equipment'
on conflict (organization_id, program_code) do update set
  status = excluded.status,
  member_lane = excluded.member_lane,
  accepted_at = coalesce(public.portal_program_enrollments.accepted_at, excluded.accepted_at),
  starts_at = coalesce(public.portal_program_enrollments.starts_at, excluded.starts_at);

insert into public.portal_program_enrollments (
  organization_id,
  program_code,
  status,
  member_lane
)
select id, 'one_rising_sun', 'pending', 'Electrical & Solar Service Partner'
from public.portal_organizations
where slug = 'solar-ark-electrical'
on conflict (organization_id, program_code) do update set
  status = excluded.status,
  member_lane = excluded.member_lane;

-- Give active XGL owners/admins access to the portal through Cascadia without
-- converting XGL employment into a One Rising Sun membership rule.
insert into public.portal_organization_users (
  organization_id,
  user_id,
  role,
  status,
  joined_at
)
select o.id, u.id, 'owner', 'active', now()
from public.portal_organizations o
join public.xgl_staff s on s.active = true and s.role in ('owner','admin')
join auth.users u on lower(u.email) = lower(s.email)
where o.slug = 'cascadia-trailer-equipment'
on conflict (organization_id, user_id) do update set
  role = excluded.role,
  status = excluded.status,
  joined_at = coalesce(public.portal_organization_users.joined_at, excluded.joined_at);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portal-documents',
  'portal-documents',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "members can download entitled portal documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'portal-documents'
  and private.portal_has_program((storage.foldername(name))[1])
);
