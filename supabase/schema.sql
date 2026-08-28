-- Execute this once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.users (
  username text primary key,
  salt text not null,
  password_hash text not null,
  bio text not null default '',
  status text not null default 'Disponível',
  avatar text not null default '💬',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key,
  conversation text not null,
  sender text not null references public.users(username) on delete cascade,
  recipient text references public.users(username) on delete cascade,
  text text not null,
  reply_to uuid null references public.messages(id) on delete set null,
  edited boolean not null default false,
  deleted boolean not null default false,
  kind text not null default 'text' check (kind in ('text','audio','image')),
  media_path text null,
  duration numeric null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messages_conversation_time
  on public.messages(conversation, created_at desc);

create table if not exists public.reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  username text not null references public.users(username) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, username)
);

alter table public.users disable row level security;
alter table public.messages disable row level security;
alter table public.reads disable row level security;

-- Create a Storage bucket named exactly:
-- chat-media
-- Keep it PRIVATE. The Node server generates signed URLs.
