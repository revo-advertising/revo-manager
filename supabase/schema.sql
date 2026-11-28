-- Revo Manager : à exécuter une fois dans Supabase (SQL Editor).
-- Après création de votre utilisateur, désactivez les nouvelles inscriptions (Authentication).

create table public.workspace (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  version bigint not null default 1,
  save_id text,
  updated_at timestamptz not null default now()
);

-- état des données avant la première modification de chaque journée
create table public.workspace_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  data jsonb not null,
  unique (user_id, day)
);

create function public.keep_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_history (user_id, day, data)
  values (old.user_id, (now() at time zone 'Africa/Casablanca')::date, old.data)
  on conflict (user_id, day) do nothing;
  delete from public.workspace_history
  where user_id = old.user_id and id not in (
    select id from public.workspace_history where user_id = old.user_id order by day desc limit 30);
  new.updated_at := now();
  return new;
end $$;

create trigger keep_history before update on public.workspace
for each row execute function public.keep_history();

-- chaque utilisateur connecté ne voit que sa ligne ; les visiteurs non connectés ne voient rien
alter table public.workspace enable row level security;
alter table public.workspace_history enable row level security;

create policy "lire ses donnees" on public.workspace
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "creer ses donnees" on public.workspace
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "modifier ses donnees" on public.workspace
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "lire son historique" on public.workspace_history
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.workspace, public.workspace_history from anon, authenticated;
grant select, insert, update on public.workspace to authenticated;
grant select on public.workspace_history to authenticated;
revoke all on function public.keep_history() from public, anon, authenticated;
