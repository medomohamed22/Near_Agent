-- Off-chain copies of documents whose SHA-256 is registered on the CarPass
-- contract. The browser never talks to Supabase: only the CarPass server
-- account (flagged in app_metadata, which users cannot edit) may read or
-- write, through row-level security. Create that account first:
--   an auth user with email server@carpass.invalid and
--   raw_app_meta_data containing {"carpass_server": true}.

create table public.documents (
  contract_id text not null,
  vehicle_id bigint not null check (vehicle_id > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null,
  mime text not null,
  size_bytes integer not null check (size_bytes > 0),
  -- Fields the uploader reviewed. Frozen once the hash is on chain.
  extraction jsonb,
  -- False until the server has seen the hash registered on chain.
  published boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (contract_id, vehicle_id, sha256)
);
create index documents_pending on public.documents (created_at) where not published;
alter table public.documents enable row level security;
revoke all on public.documents from anon;

create function public.is_carpass_server() returns boolean
language sql stable set search_path = '' as
$$ select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'carpass_server')::boolean, false) $$;

create policy "server reads documents" on public.documents for select to authenticated using (public.is_carpass_server());
create policy "server writes documents" on public.documents for insert to authenticated with check (public.is_carpass_server());
create policy "server updates documents" on public.documents for update to authenticated using (public.is_carpass_server()) with check (public.is_carpass_server());
create policy "server deletes documents" on public.documents for delete to authenticated using (public.is_carpass_server());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "server reads document files" on storage.objects for select to authenticated using (bucket_id = 'documents' and public.is_carpass_server());
create policy "server writes document files" on storage.objects for insert to authenticated with check (bucket_id = 'documents' and public.is_carpass_server());
create policy "server updates document files" on storage.objects for update to authenticated using (bucket_id = 'documents' and public.is_carpass_server()) with check (bucket_id = 'documents' and public.is_carpass_server());
create policy "server deletes document files" on storage.objects for delete to authenticated using (bucket_id = 'documents' and public.is_carpass_server());
