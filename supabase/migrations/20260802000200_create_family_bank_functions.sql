begin;

create or replace function private.require_family_parent(target_family_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
begin
  if not private.is_family_parent(target_family_id) then
    raise exception 'Family access denied' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.require_kid_parent(target_kid_id text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  target_family_id uuid;
begin
  target_family_id := private.family_id_for_kid(target_kid_id);

  if target_family_id is null then
    raise exception 'Kid account not found' using errcode = 'P0002';
  end if;

  perform private.require_family_parent(target_family_id);
  return target_family_id;
end;
$$;

create or replace function private.bump_family_revision(target_family_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  next_revision bigint;
begin
  update public.family_settings
  set revision = revision + 1
  where family_id = target_family_id
  returning revision into next_revision;

  if next_revision is null then
    raise exception 'Family settings not found' using errcode = 'P0002';
  end if;

  return next_revision;
end;
$$;

revoke all on function private.require_family_parent(uuid) from public, anon;
revoke all on function private.require_kid_parent(text) from public, anon;
revoke all on function private.bump_family_revision(uuid) from public, anon, authenticated;
grant execute on function private.require_family_parent(uuid) to authenticated;
grant execute on function private.require_kid_parent(text) to authenticated;

create or replace function public.create_family(
  family_name text default 'The Family Bank'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  current_user_id uuid := auth.uid();
  new_family_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if char_length(trim(family_name)) not between 1 and 80 then
    raise exception 'Enter a family name between 1 and 80 characters';
  end if;

  insert into public.families (name)
  values (trim(family_name))
  returning id into new_family_id;

  insert into public.family_members (family_id, user_id, role)
  values (new_family_id, current_user_id, 'parent');

  insert into public.family_settings (family_id)
  values (new_family_id);

  return new_family_id;
end;
$$;

create or replace function public.set_bucket_balances(
  target_kid_id text,
  spending_cents bigint,
  saving_cents bigint,
  giving_cents bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  target_family_id uuid;
  current_spending bigint;
  current_saving bigint;
  current_giving bigint;
  allocated_saving bigint;
begin
  target_family_id := private.require_kid_parent(target_kid_id);

  if spending_cents < 0 or saving_cents < 0 or giving_cents < 0 then
    raise exception 'Bucket balances cannot be negative';
  end if;

  select b.spending_cents, b.saving_cents, b.giving_cents
  into current_spending, current_saving, current_giving
  from public.bucket_balances b
  where b.kid_id = target_kid_id
  for update;

  if not found then
    raise exception 'Bucket balances not found' using errcode = 'P0002';
  end if;

  select coalesce(sum(g.saved_cents), 0)
  into allocated_saving
  from public.goals g
  where g.kid_id = target_kid_id;

  if saving_cents < allocated_saving then
    raise exception 'Saving cannot be lower than allocated goal money';
  end if;

  update public.bucket_balances
  set spending_cents = set_bucket_balances.spending_cents,
      saving_cents = set_bucket_balances.saving_cents,
      giving_cents = set_bucket_balances.giving_cents
  where kid_id = target_kid_id;

  if spending_cents <> current_spending then
    insert into public.transactions
      (id, kid_id, type, bucket, amount_cents, description)
    values
      (gen_random_uuid()::text, target_kid_id, 'adjustment', 'spending',
       spending_cents - current_spending, 'Balance set — Spending');
  end if;

  if saving_cents <> current_saving then
    insert into public.transactions
      (id, kid_id, type, bucket, amount_cents, description)
    values
      (gen_random_uuid()::text, target_kid_id, 'adjustment', 'saving',
       saving_cents - current_saving, 'Balance set — Saving');
  end if;

  if giving_cents <> current_giving then
    insert into public.transactions
      (id, kid_id, type, bucket, amount_cents, description)
    values
      (gen_random_uuid()::text, target_kid_id, 'adjustment', 'giving',
       giving_cents - current_giving, 'Balance set — Giving');
  end if;

  return private.bump_family_revision(target_family_id);
end;
$$;

create or replace function public.pay_allowance(
  target_family_id uuid,
  payments jsonb,
  spending_percent smallint,
  saving_percent smallint,
  giving_percent smallint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  payment jsonb;
  target_kid_id text;
  total_cents bigint;
  spending_amount bigint;
  saving_amount bigint;
  giving_amount bigint;
begin
  perform private.require_family_parent(target_family_id);

  if spending_percent < 0 or saving_percent < 0 or giving_percent < 0 or
     spending_percent + saving_percent + giving_percent <> 100 then
    raise exception 'Allowance percentages must be nonnegative and total 100';
  end if;

  if jsonb_typeof(payments) <> 'array' or jsonb_array_length(payments) = 0 then
    raise exception 'Choose at least one child';
  end if;

  for payment in select value from jsonb_array_elements(payments)
  loop
    total_cents := (payment ->> 'amount_cents')::bigint;

    if total_cents <= 0 then
      raise exception 'Allowance must be greater than zero';
    end if;

    select k.id into target_kid_id
    from public.kids k
    where k.family_id = target_family_id
      and k.slug = payment ->> 'slug';

    if target_kid_id is null then
      raise exception 'Kid account not found' using errcode = 'P0002';
    end if;

    perform 1 from public.bucket_balances
    where kid_id = target_kid_id
    for update;

    if not found then
      raise exception 'Bucket balances not found' using errcode = 'P0002';
    end if;

    spending_amount := round(total_cents * spending_percent / 100.0)::bigint;
    saving_amount := round(total_cents * saving_percent / 100.0)::bigint;
    giving_amount := total_cents - spending_amount - saving_amount;

    update public.bucket_balances
    set spending_cents = spending_cents + spending_amount,
        saving_cents = saving_cents + saving_amount,
        giving_cents = giving_cents + giving_amount
    where kid_id = target_kid_id;

    insert into public.transactions
      (id, kid_id, type, bucket, amount_cents, description)
    values
      (gen_random_uuid()::text, target_kid_id, 'allowance', 'spending', spending_amount, 'Allowance — Spending'),
      (gen_random_uuid()::text, target_kid_id, 'allowance', 'saving', saving_amount, 'Allowance — Saving'),
      (gen_random_uuid()::text, target_kid_id, 'allowance', 'giving', giving_amount, 'Allowance — Giving');
  end loop;

  update public.family_settings
  set allowance_spending_percent = spending_percent,
      allowance_saving_percent = saving_percent,
      allowance_giving_percent = giving_percent
  where family_id = target_family_id;

  return private.bump_family_revision(target_family_id);
end;
$$;

create or replace function public.move_money(
  target_kid_id text,
  source_bucket text,
  destination_bucket text,
  amount_cents bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  target_family_id uuid;
  balances public.bucket_balances%rowtype;
  allocated_saving bigint;
  available_source bigint;
begin
  target_family_id := private.require_kid_parent(target_kid_id);

  if source_bucket not in ('spending', 'saving', 'giving') or
     destination_bucket not in ('spending', 'saving', 'giving') or
     source_bucket = destination_bucket then
    raise exception 'Choose two different valid buckets';
  end if;

  if amount_cents <= 0 then
    raise exception 'Transfer amount must be greater than zero';
  end if;

  select * into balances
  from public.bucket_balances
  where kid_id = target_kid_id
  for update;

  if not found then
    raise exception 'Bucket balances not found' using errcode = 'P0002';
  end if;

  select coalesce(sum(saved_cents), 0) into allocated_saving
  from public.goals where kid_id = target_kid_id;

  available_source := case source_bucket
    when 'spending' then balances.spending_cents
    when 'saving' then balances.saving_cents - allocated_saving
    when 'giving' then balances.giving_cents
  end;

  if available_source < amount_cents then
    raise exception 'The source bucket does not have enough available money';
  end if;

  update public.bucket_balances
  set spending_cents = spending_cents
        - case when source_bucket = 'spending' then amount_cents else 0 end
        + case when destination_bucket = 'spending' then amount_cents else 0 end,
      saving_cents = saving_cents
        - case when source_bucket = 'saving' then amount_cents else 0 end
        + case when destination_bucket = 'saving' then amount_cents else 0 end,
      giving_cents = giving_cents
        - case when source_bucket = 'giving' then amount_cents else 0 end
        + case when destination_bucket = 'giving' then amount_cents else 0 end
  where kid_id = target_kid_id;

  insert into public.transactions
    (id, kid_id, type, bucket, amount_cents, description)
  values
    (gen_random_uuid()::text, target_kid_id, 'transfer', destination_bucket,
     amount_cents, 'Moved ' || source_bucket || ' → ' || destination_bucket);

  return private.bump_family_revision(target_family_id);
end;
$$;

create or replace function public.create_purchase_request(
  target_kid_id text,
  request_description text,
  amount_cents bigint,
  request_bucket text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  target_family_id uuid;
  request_id text := gen_random_uuid()::text;
  available_balance bigint;
begin
  target_family_id := private.require_kid_parent(target_kid_id);

  if char_length(trim(request_description)) not between 1 and 80 then
    raise exception 'Enter a purchase description';
  end if;

  if amount_cents <= 0 or request_bucket not in ('spending', 'saving', 'giving') then
    raise exception 'Enter a valid purchase amount and bucket';
  end if;

  select case request_bucket
    when 'spending' then spending_cents
    when 'saving' then saving_cents
    when 'giving' then giving_cents
  end into available_balance
  from public.bucket_balances
  where kid_id = target_kid_id;

  if available_balance is null or available_balance < amount_cents then
    raise exception 'The bucket does not have enough money';
  end if;

  insert into public.purchase_requests
    (id, kid_id, description, amount_cents, bucket)
  values
    (request_id, target_kid_id, trim(request_description), amount_cents, request_bucket);

  perform private.bump_family_revision(target_family_id);
  return request_id;
end;
$$;

create or replace function public.resolve_purchase_request(
  request_id text,
  resolution text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  request public.purchase_requests%rowtype;
  target_family_id uuid;
  available_balance bigint;
begin
  select * into request
  from public.purchase_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;

  target_family_id := private.require_kid_parent(request.kid_id);

  if request.status <> 'pending' or resolution not in ('approved', 'declined') then
    raise exception 'Purchase request cannot be resolved';
  end if;

  if resolution = 'approved' then
    select case request.bucket
      when 'spending' then spending_cents
      when 'saving' then saving_cents
      when 'giving' then giving_cents
    end into available_balance
    from public.bucket_balances
    where kid_id = request.kid_id
    for update;

    if available_balance < request.amount_cents then
      raise exception 'The bucket no longer has enough money';
    end if;

    update public.bucket_balances
    set spending_cents = spending_cents
          - case when request.bucket = 'spending' then request.amount_cents else 0 end,
        saving_cents = saving_cents
          - case when request.bucket = 'saving' then request.amount_cents else 0 end,
        giving_cents = giving_cents
          - case when request.bucket = 'giving' then request.amount_cents else 0 end
    where kid_id = request.kid_id;

    insert into public.transactions
      (id, kid_id, type, bucket, amount_cents, description)
    values
      (gen_random_uuid()::text, request.kid_id, 'purchase', request.bucket,
       -request.amount_cents, request.description);
  end if;

  update public.purchase_requests
  set status = resolution,
      resolved_at = now()
  where id = request_id;

  return private.bump_family_revision(target_family_id);
end;
$$;

create or replace function public.create_goal(
  target_kid_id text,
  goal_name text,
  goal_emoji text,
  target_cents bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  target_family_id uuid;
  goal_id text := gen_random_uuid()::text;
begin
  target_family_id := private.require_kid_parent(target_kid_id);

  if char_length(trim(goal_name)) not between 1 and 80 or target_cents <= 0 then
    raise exception 'Enter a valid goal name and target';
  end if;

  insert into public.goals
    (id, kid_id, name, emoji, target_cents)
  values
    (goal_id, target_kid_id, trim(goal_name), coalesce(nullif(trim(goal_emoji), ''), '🎯'), target_cents);

  perform private.bump_family_revision(target_family_id);
  return goal_id;
end;
$$;

create or replace function public.edit_goal(
  goal_id text,
  goal_name text,
  goal_emoji text,
  target_cents bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  goal public.goals%rowtype;
  target_family_id uuid;
begin
  select * into goal from public.goals where id = goal_id for update;

  if not found then
    raise exception 'Savings goal not found' using errcode = 'P0002';
  end if;

  target_family_id := private.require_kid_parent(goal.kid_id);

  if char_length(trim(goal_name)) not between 1 and 80 or
     target_cents <= 0 or target_cents < goal.saved_cents then
    raise exception 'Enter a valid goal name and target';
  end if;

  update public.goals
  set name = trim(goal_name),
      emoji = coalesce(nullif(trim(goal_emoji), ''), '🎯'),
      target_cents = edit_goal.target_cents
  where id = goal_id;

  return private.bump_family_revision(target_family_id);
end;
$$;

create or replace function public.allocate_to_goal(
  goal_id text,
  amount_cents bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  goal public.goals%rowtype;
  target_family_id uuid;
  total_saving bigint;
  allocated_saving bigint;
begin
  select * into goal from public.goals where id = goal_id for update;

  if not found then
    raise exception 'Savings goal not found' using errcode = 'P0002';
  end if;

  target_family_id := private.require_kid_parent(goal.kid_id);

  if amount_cents <= 0 or goal.saved_cents + amount_cents > goal.target_cents then
    raise exception 'Enter a valid goal allocation';
  end if;

  select saving_cents into total_saving
  from public.bucket_balances where kid_id = goal.kid_id for update;

  select coalesce(sum(saved_cents), 0) into allocated_saving
  from public.goals where kid_id = goal.kid_id;

  if total_saving - allocated_saving < amount_cents then
    raise exception 'There is not enough available Saving';
  end if;

  update public.goals
  set saved_cents = saved_cents + amount_cents
  where id = goal_id;

  insert into public.transactions
    (id, kid_id, type, bucket, amount_cents, description)
  values
    (gen_random_uuid()::text, goal.kid_id, 'goal', 'saving', amount_cents,
     'Added to ' || goal.name);

  return private.bump_family_revision(target_family_id);
end;
$$;

create or replace function public.remove_from_goal(
  goal_id text,
  amount_cents bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  goal public.goals%rowtype;
  target_family_id uuid;
begin
  select * into goal from public.goals where id = goal_id for update;

  if not found then
    raise exception 'Savings goal not found' using errcode = 'P0002';
  end if;

  target_family_id := private.require_kid_parent(goal.kid_id);

  if amount_cents <= 0 or amount_cents > goal.saved_cents then
    raise exception 'Enter a valid amount to remove';
  end if;

  update public.goals
  set saved_cents = saved_cents - amount_cents
  where id = goal_id;

  insert into public.transactions
    (id, kid_id, type, bucket, amount_cents, description)
  values
    (gen_random_uuid()::text, goal.kid_id, 'goal', 'saving', -amount_cents,
     'Removed from ' || goal.name);

  return private.bump_family_revision(target_family_id);
end;
$$;

create or replace function public.delete_goal(goal_id text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  goal public.goals%rowtype;
  target_family_id uuid;
begin
  select * into goal from public.goals where id = goal_id for update;

  if not found then
    raise exception 'Savings goal not found' using errcode = 'P0002';
  end if;

  target_family_id := private.require_kid_parent(goal.kid_id);
  delete from public.goals where id = goal_id;

  if goal.saved_cents > 0 then
    insert into public.transactions
      (id, kid_id, type, bucket, amount_cents, description)
    values
      (gen_random_uuid()::text, goal.kid_id, 'goal', 'saving', -goal.saved_cents,
       'Closed ' || goal.name || ' goal');
  end if;

  return private.bump_family_revision(target_family_id);
end;
$$;

create or replace function public.complete_goal_purchase(goal_id text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  goal public.goals%rowtype;
  target_family_id uuid;
  saving_balance bigint;
begin
  select * into goal from public.goals where id = goal_id for update;

  if not found then
    raise exception 'Savings goal not found' using errcode = 'P0002';
  end if;

  target_family_id := private.require_kid_parent(goal.kid_id);

  if goal.saved_cents < goal.target_cents then
    raise exception 'This goal is not fully funded';
  end if;

  select saving_cents into saving_balance
  from public.bucket_balances where kid_id = goal.kid_id for update;

  if saving_balance < goal.target_cents then
    raise exception 'There is not enough money in Saving';
  end if;

  update public.bucket_balances
  set saving_cents = saving_cents - goal.target_cents
  where kid_id = goal.kid_id;

  delete from public.goals where id = goal_id;

  insert into public.transactions
    (id, kid_id, type, bucket, amount_cents, description)
  values
    (gen_random_uuid()::text, goal.kid_id, 'purchase', 'saving', -goal.target_cents,
     goal.name);

  return private.bump_family_revision(target_family_id);
end;
$$;

revoke execute on all functions in schema public from public, anon;

grant execute on function public.create_family(text) to authenticated;
grant execute on function public.set_bucket_balances(text, bigint, bigint, bigint) to authenticated;
grant execute on function public.pay_allowance(uuid, jsonb, smallint, smallint, smallint) to authenticated;
grant execute on function public.move_money(text, text, text, bigint) to authenticated;
grant execute on function public.create_purchase_request(text, text, bigint, text) to authenticated;
grant execute on function public.resolve_purchase_request(text, text) to authenticated;
grant execute on function public.create_goal(text, text, text, bigint) to authenticated;
grant execute on function public.edit_goal(text, text, text, bigint) to authenticated;
grant execute on function public.allocate_to_goal(text, bigint) to authenticated;
grant execute on function public.remove_from_goal(text, bigint) to authenticated;
grant execute on function public.delete_goal(text) to authenticated;
grant execute on function public.complete_goal_purchase(text) to authenticated;

commit;
