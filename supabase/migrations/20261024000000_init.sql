-- Schema for the osu! web editor backend. Only the server talks to these tables, using the service role
-- key; RLS is enabled with no policies and the public API roles get no grants, so the anon key can't read them.

create table public.users (
  id bigint primary key,                       -- osu! user id
  username text not null,
  avatar_url text not null default '',
  country_code text not null default '',
  created_at timestamptz not null default now(),
  last_login timestamptz not null default now()
);

-- Session tokens are stored as SHA-256 hashes; the raw token only lives in the httpOnly cookie.
create table public.sessions (
  token_hash text primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_id_idx on public.sessions(user_id);
create index sessions_expires_at_idx on public.sessions(expires_at);

-- One row per cloud-synced beatmap project. The .osz lives in the projects bucket at object_path
-- (<user_id>/<id>/<upload id>.osz); every upload gets a fresh path and commit swaps the row over, so a
-- failed upload never clobbers the last good copy. created_at/updated_at are the editor's own
-- millisecond timestamps (used for newest-wins sync).
create table public.projects (
  user_id bigint not null references public.users(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9-]{8,64}$'),
  title text not null,
  created_at bigint not null,
  updated_at bigint not null,
  size bigint not null check (size >= 0),
  object_path text not null,
  primary key (user_id, id)
);

-- Signed upload URLs handed out but not yet committed. Their declared sizes count towards the quota
-- until they are committed or expire, so a user can't over-commit by requesting many URLs at once.
create table public.pending_uploads (
  object_path text primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  project_id text not null,
  size bigint not null check (size >= 0),
  expires_at timestamptz not null
);
create index pending_uploads_user_id_idx on public.pending_uploads(user_id);

alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.projects enable row level security;
alter table public.pending_uploads enable row level security;
revoke all on public.users, public.sessions, public.projects, public.pending_uploads from anon, authenticated;

-- Private bucket for .osz packages. 50 MB is the Supabase Free plan's maximum file size; raise it (and
-- MAX_PROJECT_BYTES on the server) on a paid plan.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('projects', 'projects', false, 52428800, array['application/octet-stream', 'application/zip', 'application/x-zip-compressed'])
on conflict (id) do nothing;
