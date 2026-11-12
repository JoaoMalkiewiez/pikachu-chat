-- Reference bootstrap for a NEW, isolated database only.
-- V25 already has these tables: do NOT run this over the existing project.
-- Runtime never applies DDL. Review docs/PRODUCAO.md before any schema changes.
create table if not exists public.users (
  username text primary key check (char_length(username) between 3 and 24),
  salt text not null, password_hash text not null,
  bio text not null default '', status text not null default 'Disponível',
  avatar text not null default '💬',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists users_username_lower_idx on public.users(lower(username));
create table if not exists public.sessions (
  id uuid primary key, username text not null references public.users(username) on delete cascade,
  token_hash text not null unique, expires_at timestamptz not null,
  created_at timestamptz not null default now(), last_seen_at timestamptz not null default now()
);
create index if not exists sessions_username_idx on public.sessions(username);
create index if not exists sessions_expires_at_idx on public.sessions(expires_at);
create table if not exists public.messages (
  id uuid primary key, conversation text not null,
  sender text not null references public.users(username), recipient text references public.users(username),
  text text not null default '', reply_to uuid references public.messages(id) on delete set null,
  edited boolean not null default false, deleted boolean not null default false,
  kind text not null default 'text', media_path text, duration numeric not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx on public.messages(conversation,created_at desc);
create table if not exists public.reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  username text not null references public.users(username) on delete cascade,
  read_at timestamptz not null default now(), primary key(message_id,username)
);
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.reads enable row level security;
-- No public grants/policies. Custom auth is enforced by the backend, not auth.uid().
-- Bucket chat-media must remain PRIVATE. Files are signed only after authorization.
