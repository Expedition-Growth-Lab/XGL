-- Staff-only candidate-source intake for Command Central.
-- Candidates are not monitored and are not public until reviewed/promoted.

create table if not exists public.source_candidates (
  id uuid primary key default gen_random_uuid(),
  submitted_url text not null,
  normalized_url text not null,
  hostname text,
  source_name text,
  submitter_note text,
  suggested_region text,
  suggested_watchtower_category text,
  suggested_public_desk text,
  status text not null default 'new',
  duplicate_source_id uuid references public.sources(id) on delete set null,
  promoted_source_id uuid references public.sources(id) on delete set null,
  geographic_scope text,
  likely_source_type text,
  suggested_cadence text,
  authority_score smallint,
  independence_score smallint,
  relevance_score smallint,
  machine_readability_score smallint,
  freshness_score smallint,
  conflict_notes text,
  review_summary text,
  recommendation text,
  submitted_by uuid,
  reviewed_by uuid,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.source_candidates enable row level security;

-- Access is intentionally through staff RPCs only.
revoke all on table public.source_candidates from anon, authenticated;

create unique index if not exists source_candidates_normalized_url_idx
  on public.source_candidates(normalized_url);

create index if not exists source_candidates_status_idx
  on public.source_candidates(status, submitted_at desc);
