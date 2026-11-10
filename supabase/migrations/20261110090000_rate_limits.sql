-- Request counters shared by every server instance, in fixed time windows.

create table public.rate_hits (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (bucket, key, window_start)
);
alter table public.rate_hits enable row level security;
revoke all on public.rate_hits from anon;
create policy "server counts requests" on public.rate_hits for all to authenticated using (public.is_carpass_server()) with check (public.is_carpass_server());

-- Counts one request and says whether it is still within `p_max` for the
-- current window. Old windows are swept now and then.
create function public.carpass_hit(p_bucket text, p_key text, p_window_sec integer, p_max integer) returns boolean
language plpgsql set search_path = '' as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_sec) * p_window_sec);
  n integer;
begin
  insert into public.rate_hits (bucket, key, window_start, hits) values (p_bucket, p_key, w, 1)
  on conflict (bucket, key, window_start) do update set hits = public.rate_hits.hits + 1
  returning hits into n;
  if random() < 0.02 then
    delete from public.rate_hits where window_start < now() - interval '1 day';
  end if;
  return n <= p_max;
end $$;
revoke execute on function public.carpass_hit(text, text, integer, integer) from public, anon;
grant execute on function public.carpass_hit(text, text, integer, integer) to authenticated;
