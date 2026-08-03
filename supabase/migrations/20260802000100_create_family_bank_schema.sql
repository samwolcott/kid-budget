begin;

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('parent')),
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create index family_members_user_id_idx
  on public.family_members(user_id);

create table public.family_settings (
  family_id uuid primary key references public.families(id) on delete cascade,
  parent_pin_verifier text,
  allowance_spending_percent smallint not null default 70
    check (allowance_spending_percent between 0 and 100),
  allowance_saving_percent smallint not null default 20
    check (allowance_saving_percent between 0 and 100),
  allowance_giving_percent smallint not null default 10
    check (allowance_giving_percent between 0 and 100),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint allowance_split_totals_100 check (
    allowance_spending_percent +
    allowance_saving_percent +
    allowance_giving_percent = 100
  )
);

create table public.kids (
  id text primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  emoji text not null default '🙂',
  allowance_amount_cents bigint not null default 0
    check (allowance_amount_cents >= 0),
  pin_verifier text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, slug)
);

create index kids_family_id_idx on public.kids(family_id);

create table public.bucket_balances (
  kid_id text primary key references public.kids(id) on delete cascade,
  spending_cents bigint not null default 0 check (spending_cents >= 0),
  saving_cents bigint not null default 0 check (saving_cents >= 0),
  giving_cents bigint not null default 0 check (giving_cents >= 0),
  updated_at timestamptz not null default now()
);

create table public.goals (
  id text primary key,
  kid_id text not null references public.kids(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  emoji text not null default '🎯',
  target_cents bigint not null check (target_cents > 0),
  saved_cents bigint not null default 0 check (saved_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_saved_not_above_target check (saved_cents <= target_cents)
);

create index goals_kid_id_idx on public.goals(kid_id);

create table public.transactions (
  id text primary key,
  kid_id text not null references public.kids(id) on delete cascade,
  type text not null check (
    type in ('allowance', 'purchase', 'transfer', 'goal', 'adjustment')
  ),
  bucket text not null check (bucket in ('spending', 'saving', 'giving')),
  amount_cents bigint not null,
  description text not null check (char_length(trim(description)) between 1 and 160),
  created_at timestamptz not null default now()
);

create index transactions_kid_created_at_idx
  on public.transactions(kid_id, created_at desc);

create table public.purchase_requests (
  id text primary key,
  kid_id text not null references public.kids(id) on delete cascade,
  description text not null check (char_length(trim(description)) between 1 and 80),
  amount_cents bigint not null check (amount_cents > 0),
  bucket text not null check (bucket in ('spending', 'saving', 'giving')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint purchase_resolution_matches_status check (
    (status = 'pending' and resolved_at is null) or
    (status in ('approved', 'declined') and resolved_at is not null)
  )
);

create index purchase_requests_kid_status_idx
  on public.purchase_requests(kid_id, status, requested_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
#variable_conflict use_variable
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger families_set_updated_at
before update on public.families
for each row execute function private.set_updated_at();

create trigger family_settings_set_updated_at
before update on public.family_settings
for each row execute function private.set_updated_at();

create trigger kids_set_updated_at
before update on public.kids
for each row execute function private.set_updated_at();

create trigger bucket_balances_set_updated_at
before update on public.bucket_balances
for each row execute function private.set_updated_at();

create trigger goals_set_updated_at
before update on public.goals
for each row execute function private.set_updated_at();

create or replace function private.is_family_parent(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members
    where family_id = target_family_id
      and user_id = (select auth.uid())
      and role = 'parent'
  );
$$;

create or replace function private.family_id_for_kid(target_kid_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select family_id
  from public.kids
  where id = target_kid_id;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.is_family_parent(uuid) from public, anon;
revoke all on function private.family_id_for_kid(text) from public, anon;
grant execute on function private.is_family_parent(uuid) to authenticated;
grant execute on function private.family_id_for_kid(text) to authenticated;

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_settings enable row level security;
alter table public.kids enable row level security;
alter table public.bucket_balances enable row level security;
alter table public.goals enable row level security;
alter table public.transactions enable row level security;
alter table public.purchase_requests enable row level security;

create policy families_parent_select
  on public.families for select to authenticated
  using ((select private.is_family_parent(families.id)));

create policy families_parent_update
  on public.families for update to authenticated
  using ((select private.is_family_parent(families.id)))
  with check ((select private.is_family_parent(families.id)));

create policy families_parent_delete
  on public.families for delete to authenticated
  using ((select private.is_family_parent(families.id)));

create policy family_members_parent_select
  on public.family_members for select to authenticated
  using ((select private.is_family_parent(family_members.family_id)));

create policy family_settings_parent_all
  on public.family_settings for all to authenticated
  using ((select private.is_family_parent(family_settings.family_id)))
  with check ((select private.is_family_parent(family_settings.family_id)));

create policy kids_parent_all
  on public.kids for all to authenticated
  using ((select private.is_family_parent(kids.family_id)))
  with check ((select private.is_family_parent(kids.family_id)));

create policy bucket_balances_parent_all
  on public.bucket_balances for all to authenticated
  using ((select private.is_family_parent(private.family_id_for_kid(bucket_balances.kid_id))))
  with check ((select private.is_family_parent(private.family_id_for_kid(bucket_balances.kid_id))));

create policy goals_parent_all
  on public.goals for all to authenticated
  using ((select private.is_family_parent(private.family_id_for_kid(goals.kid_id))))
  with check ((select private.is_family_parent(private.family_id_for_kid(goals.kid_id))));

create policy transactions_parent_all
  on public.transactions for all to authenticated
  using ((select private.is_family_parent(private.family_id_for_kid(transactions.kid_id))))
  with check ((select private.is_family_parent(private.family_id_for_kid(transactions.kid_id))));

create policy purchase_requests_parent_all
  on public.purchase_requests for all to authenticated
  using ((select private.is_family_parent(private.family_id_for_kid(purchase_requests.kid_id))))
  with check ((select private.is_family_parent(private.family_id_for_kid(purchase_requests.kid_id))));

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

grant select, update, delete on public.families to authenticated;
grant select on public.family_members to authenticated;
grant select, insert, update, delete on public.family_settings to authenticated;
grant select, insert, update, delete on public.kids to authenticated;
grant select, insert, update, delete on public.bucket_balances to authenticated;
grant select, insert, update, delete on public.goals to authenticated;
grant select, insert on public.transactions to authenticated;
grant select, insert, update, delete on public.purchase_requests to authenticated;

commit;
