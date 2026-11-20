import type { SupabaseClient, User } from '@supabase/supabase-js';

export type PortalOrganization = {
  id: string;
  slug: string;
  legal_name: string;
  display_name: string;
  status: string;
};

export type PortalProgram = {
  code: string;
  name: string;
  description: string;
  portal_path: string;
  active: boolean;
};

export type PortalEnrollment = {
  organization_id: string;
  program_code: string;
  status: string;
  member_lane: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

export type PortalOrganizationUser = {
  organization_id: string;
  user_id: string;
  role: string;
  status: string;
};

export type PortalContext = {
  user: User;
  organizations: PortalOrganization[];
  programs: PortalProgram[];
  enrollments: PortalEnrollment[];
  organizationUsers: PortalOrganizationUser[];
};

export async function loadPortalContext(supabase: SupabaseClient): Promise<PortalContext | null> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return null;

  const { data: links, error: linkError } = await supabase
    .from('portal_organization_users')
    .select('organization_id,user_id,role,status')
    .eq('user_id', user.id)
    .eq('status', 'active');

  if (linkError) throw linkError;

  const organizationUsers = (links ?? []) as PortalOrganizationUser[];
  const organizationIds = organizationUsers.map((link) => link.organization_id);

  const organizationsPromise = organizationIds.length
    ? supabase
        .from('portal_organizations')
        .select('id,slug,legal_name,display_name,status')
        .in('id', organizationIds)
    : Promise.resolve({ data: [], error: null });

  const enrollmentsPromise = organizationIds.length
    ? supabase
        .from('portal_program_enrollments')
        .select('organization_id,program_code,status,member_lane,starts_at,ends_at')
        .in('organization_id', organizationIds)
    : Promise.resolve({ data: [], error: null });

  const programsPromise = supabase
    .from('portal_programs')
    .select('code,name,description,portal_path,active')
    .eq('active', true);

  const [organizationsResult, enrollmentsResult, programsResult] = await Promise.all([
    organizationsPromise,
    enrollmentsPromise,
    programsPromise
  ]);

  const firstError = organizationsResult.error || enrollmentsResult.error || programsResult.error;
  if (firstError) throw firstError;

  return {
    user,
    organizations: (organizationsResult.data ?? []) as PortalOrganization[],
    programs: (programsResult.data ?? []) as PortalProgram[],
    enrollments: (enrollmentsResult.data ?? []) as PortalEnrollment[],
    organizationUsers
  };
}

export function activeProgramEnrollments(context: PortalContext, programCode?: string) {
  const now = Date.now();
  return context.enrollments.filter((enrollment) => {
    if (programCode && enrollment.program_code !== programCode) return false;
    if (enrollment.status !== 'active') return false;
    if (enrollment.starts_at && Date.parse(enrollment.starts_at) > now) return false;
    if (enrollment.ends_at && Date.parse(enrollment.ends_at) <= now) return false;
    return context.organizations.some(
      (organization) => organization.id === enrollment.organization_id && organization.status === 'active'
    );
  });
}

export function safePortalNext(value: string | null) {
  const allowed = new Set(['/portal', '/one-rising-sun/portal', '/client-portal']);
  return value && allowed.has(value) ? value : '/portal';
}
