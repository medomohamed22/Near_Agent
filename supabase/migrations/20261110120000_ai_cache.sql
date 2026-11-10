-- Answers the AI already gave, so the same document or question is not paid for twice.
create table public.carpass_ai_cache (
  kind text not null check (kind in ('extract', 'ask')),
  key text not null check (key ~ '^[0-9a-f]{64}$'),
  lang text not null check (lang in ('en', 'ar')),
  value jsonb not null,
  created_at timestamptz not null default now(),
  primary key (kind, key, lang)
);
alter table public.carpass_ai_cache enable row level security;
revoke all on public.carpass_ai_cache from anon;
create policy "server reads ai cache" on public.carpass_ai_cache for select to authenticated using (public.is_carpass_server());
create policy "server writes ai cache" on public.carpass_ai_cache for insert to authenticated with check (public.is_carpass_server());
create policy "server updates ai cache" on public.carpass_ai_cache for update to authenticated using (public.is_carpass_server()) with check (public.is_carpass_server());
