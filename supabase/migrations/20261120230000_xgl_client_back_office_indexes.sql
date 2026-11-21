-- Phase 1 hardening: covering indexes and one-policy-per-operation cleanup.

drop policy if exists "organization admins manage staff assignments" on public.portal_staff_assignments;
create policy "organization admins insert staff assignments" on public.portal_staff_assignments for insert to authenticated with check (private.portal_can_admin_organization(organization_id));
create policy "organization admins update staff assignments" on public.portal_staff_assignments for update to authenticated using (private.portal_can_admin_organization(organization_id)) with check (private.portal_can_admin_organization(organization_id));
create policy "organization admins delete staff assignments" on public.portal_staff_assignments for delete to authenticated using (private.portal_can_admin_organization(organization_id));

create index portal_activity_actor_idx on public.portal_activity(actor_user_id);
create index portal_approvals_project_idx on public.portal_approval_requests(project_id);
create index portal_approvals_deliverable_idx on public.portal_approval_requests(deliverable_id);
create index portal_approvals_version_idx on public.portal_approval_requests(document_version_id);
create index portal_approvals_requested_by_idx on public.portal_approval_requests(requested_by);
create index portal_approvals_decided_by_idx on public.portal_approval_requests(decided_by);
create index portal_comments_project_idx on public.portal_comments(project_id);
create index portal_comments_author_idx on public.portal_comments(author_id);
create index portal_decisions_project_idx on public.portal_decisions(project_id);
create index portal_decisions_created_by_idx on public.portal_decisions(created_by);
create index portal_decisions_decided_by_idx on public.portal_decisions(decided_by);
create index portal_deliverables_project_idx on public.portal_deliverables(project_id);
create index portal_deliverables_version_idx on public.portal_deliverables(document_version_id);
create index portal_deliverables_created_by_idx on public.portal_deliverables(created_by);
create index portal_document_versions_org_idx on public.portal_document_versions(organization_id);
create index portal_document_versions_uploaded_by_idx on public.portal_document_versions(uploaded_by);
create index portal_documents_project_idx on public.portal_documents(project_id);
create index portal_documents_created_by_idx on public.portal_documents(created_by);
create index portal_outbox_org_idx on public.portal_notification_outbox(organization_id);
create index portal_outbox_user_idx on public.portal_notification_outbox(recipient_user_id);
create index portal_projects_created_by_idx on public.portal_projects(created_by);
create index portal_invitations_invited_by_idx on public.portal_user_invitations(invited_by);
create index portal_work_items_assigned_to_idx on public.portal_work_items(assigned_to);
create index portal_work_items_created_by_idx on public.portal_work_items(created_by);
