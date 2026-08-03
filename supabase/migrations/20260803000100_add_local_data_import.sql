begin;

create or replace function public.import_local_family_state(
  import_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  target_family_id uuid := private.current_parent_family_id();
  kid_record jsonb;
  goal_record jsonb;
  transaction_record jsonb;
  request_record jsonb;
  target_kid_id text;
  target_kid_ids text[];
  next_revision bigint;
  kid_count integer;
  goal_count integer;
  transaction_count integer;
  request_count integer;
  total_balance_cents bigint;
begin
  if target_family_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if jsonb_typeof(import_payload) <> 'object'
     or jsonb_typeof(import_payload -> 'kids') <> 'array'
     or jsonb_array_length(import_payload -> 'kids') <> 2
     or jsonb_typeof(import_payload -> 'purchase_requests') <> 'array'
     or jsonb_typeof(import_payload -> 'allowance_split') <> 'object' then
    raise exception 'The local data package is incomplete';
  end if;

  if (import_payload #>> '{allowance_split,spending}')::smallint < 0
     or (import_payload #>> '{allowance_split,saving}')::smallint < 0
     or (import_payload #>> '{allowance_split,giving}')::smallint < 0
     or (import_payload #>> '{allowance_split,spending}')::smallint
      + (import_payload #>> '{allowance_split,saving}')::smallint
      + (import_payload #>> '{allowance_split,giving}')::smallint <> 100 then
    raise exception 'Allowance percentages must be nonnegative and total 100';
  end if;

  perform 1
  from public.family_settings
  where family_id = target_family_id
  for update;

  select array_agg(id) into target_kid_ids
  from public.kids
  where family_id = target_family_id
    and slug in ('judah', 'max');

  if coalesce(array_length(target_kid_ids, 1), 0) <> 2 then
    raise exception 'Set up the family PINs before importing local data';
  end if;

  delete from public.purchase_requests
  where kid_id = any(target_kid_ids);

  delete from public.transactions
  where kid_id = any(target_kid_ids);

  delete from public.goals
  where kid_id = any(target_kid_ids);

  for kid_record in
    select value from jsonb_array_elements(import_payload -> 'kids')
  loop
    if kid_record ->> 'slug' not in ('judah', 'max') then
      raise exception 'The local data contains an unknown kid account';
    end if;

    select id into target_kid_id
    from public.kids
    where family_id = target_family_id
      and slug = kid_record ->> 'slug';

    if target_kid_id is null then
      raise exception 'Kid account not found' using errcode = 'P0002';
    end if;

    update public.kids
    set name = trim(kid_record ->> 'name'),
        emoji = kid_record ->> 'emoji',
        allowance_amount_cents = (kid_record ->> 'allowance_amount_cents')::bigint
    where id = target_kid_id;

    insert into public.bucket_balances
      (kid_id, spending_cents, saving_cents, giving_cents)
    values
      (
        target_kid_id,
        (kid_record #>> '{buckets,spending_cents}')::bigint,
        (kid_record #>> '{buckets,saving_cents}')::bigint,
        (kid_record #>> '{buckets,giving_cents}')::bigint
      )
    on conflict (kid_id) do update
    set spending_cents = excluded.spending_cents,
        saving_cents = excluded.saving_cents,
        giving_cents = excluded.giving_cents;

    if jsonb_typeof(kid_record -> 'goals') <> 'array'
       or jsonb_typeof(kid_record -> 'transactions') <> 'array' then
      raise exception 'A kid account is missing goals or transactions';
    end if;

    for goal_record in
      select value from jsonb_array_elements(kid_record -> 'goals')
    loop
      insert into public.goals
        (id, kid_id, name, emoji, target_cents, saved_cents)
      values
        (
          target_family_id::text || ':' || goal_record ->> 'id',
          target_kid_id,
          trim(goal_record ->> 'name'),
          goal_record ->> 'emoji',
          (goal_record ->> 'target_cents')::bigint,
          (goal_record ->> 'saved_cents')::bigint
        );
    end loop;

    for transaction_record in
      select value from jsonb_array_elements(kid_record -> 'transactions')
    loop
      insert into public.transactions
        (id, kid_id, type, bucket, amount_cents, description, created_at)
      values
        (
          target_family_id::text || ':' || transaction_record ->> 'id',
          target_kid_id,
          transaction_record ->> 'type',
          transaction_record ->> 'bucket',
          (transaction_record ->> 'amount_cents')::bigint,
          trim(transaction_record ->> 'description'),
          ((transaction_record ->> 'date') || 'T12:00:00Z')::timestamptz
        );
    end loop;
  end loop;

  if (
    select count(distinct value ->> 'slug')
    from jsonb_array_elements(import_payload -> 'kids')
  ) <> 2 then
    raise exception 'The import must contain Judah and Max exactly once';
  end if;

  for request_record in
    select value from jsonb_array_elements(import_payload -> 'purchase_requests')
  loop
    select id into target_kid_id
    from public.kids
    where family_id = target_family_id
      and slug = request_record ->> 'kid_slug';

    if target_kid_id is null then
      raise exception 'A purchase request has an unknown kid account';
    end if;

    insert into public.purchase_requests
      (id, kid_id, description, amount_cents, bucket, status, requested_at, resolved_at)
    values
      (
        target_family_id::text || ':' || request_record ->> 'id',
        target_kid_id,
        trim(request_record ->> 'description'),
        (request_record ->> 'amount_cents')::bigint,
        request_record ->> 'bucket',
        request_record ->> 'status',
        (request_record ->> 'requested_at')::timestamptz,
        case
          when request_record ->> 'status' = 'pending' then null
          else (request_record ->> 'requested_at')::timestamptz
        end
      );
  end loop;

  update public.family_settings
  set allowance_spending_percent =
        (import_payload #>> '{allowance_split,spending}')::smallint,
      allowance_saving_percent =
        (import_payload #>> '{allowance_split,saving}')::smallint,
      allowance_giving_percent =
        (import_payload #>> '{allowance_split,giving}')::smallint,
      revision = revision + 1
  where family_id = target_family_id
  returning revision into next_revision;

  select count(*),
         coalesce(sum(
           balances.spending_cents + balances.saving_cents + balances.giving_cents
         ), 0)
  into kid_count, total_balance_cents
  from public.kids kids
  join public.bucket_balances balances on balances.kid_id = kids.id
  where kids.family_id = target_family_id;

  select count(*) into goal_count
  from public.goals goals
  join public.kids kids on kids.id = goals.kid_id
  where kids.family_id = target_family_id;

  select count(*) into transaction_count
  from public.transactions transactions
  join public.kids kids on kids.id = transactions.kid_id
  where kids.family_id = target_family_id;

  select count(*) into request_count
  from public.purchase_requests requests
  join public.kids kids on kids.id = requests.kid_id
  where kids.family_id = target_family_id;

  return jsonb_build_object(
    'kid_count', kid_count,
    'goal_count', goal_count,
    'transaction_count', transaction_count,
    'request_count', request_count,
    'total_balance_cents', total_balance_cents,
    'revision', next_revision
  );
end;
$$;

revoke all on function public.import_local_family_state(jsonb) from public, anon;
grant execute on function public.import_local_family_state(jsonb) to authenticated;

commit;
