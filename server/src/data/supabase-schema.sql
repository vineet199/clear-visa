-- Enable pgvector for embeddings
create extension if not exists vector;

-- Source pages to crawl (IRCC and other official sites)
create table if not exists crawl_sources (
  id bigserial primary key,
  country text not null,
  program text not null,
  source_url text not null unique,
  status text not null default 'active',
  last_crawled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crawl_snapshots (
  id bigserial primary key,
  source_id bigint not null references crawl_sources(id) on delete cascade,
  storage_path text not null,
  content_hash text not null,
  captured_at timestamptz not null default now(),
  parser_version text,
  unique(source_id, content_hash)
);

-- Normalized rules used by scoring engine
create table if not exists immigration_rules (
  id bigserial primary key,
  country text not null,
  program text not null,
  rule_version text not null,
  rule_json jsonb not null,
  source_urls text[] not null default '{}',
  effective_date date,
  last_verified_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_immigration_rules_country_program_active
  on immigration_rules(country, program, active);

-- Evidence chunks for RAG retrieval
create table if not exists evidence_chunks (
  id bigserial primary key,
  source_id bigint references crawl_sources(id) on delete set null,
  country text not null,
  program text not null,
  chunk_text text not null,
  metadata jsonb not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists idx_evidence_chunks_country_program
  on evidence_chunks(country, program);

-- Vector similarity search (cosine)
create index if not exists idx_evidence_chunks_embedding
  on evidence_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create table if not exists rule_change_log (
  id bigserial primary key,
  rule_id bigint references immigration_rules(id) on delete cascade,
  previous_hash text,
  new_hash text not null,
  diff_summary text,
  changed_at timestamptz not null default now()
);

-- RPC helper for retrieval
create or replace function match_evidence_chunks(
  query_embedding vector(1536),
  match_count int,
  filter_country text default null,
  filter_program text default null
)
returns table (
  id bigint,
  chunk_text text,
  metadata jsonb,
  source_id bigint,
  similarity float
)
language sql
as $$
  select
    ec.id,
    ec.chunk_text,
    ec.metadata,
    ec.source_id,
    1 - (ec.embedding <=> query_embedding) as similarity
  from evidence_chunks ec
  where
    (filter_country is null or lower(ec.country) = lower(filter_country))
    and (filter_program is null or lower(ec.program) = lower(filter_program))
  order by ec.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;
