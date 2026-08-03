begin;

create extension if not exists pgcrypto with schema extensions;

create or replace function private.current_parent_family_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select family_id
  from public.family_members
  where user_id = (select auth.uid())
    and role = 'parent'
  order by created_at
  limit 1;
$$;

revoke all on function private.current_parent_family_id()
  from public, anon, authenticated;

create or replace function public.setup_profile_pins(
  parent_pin text,
  judah_pin text,
  max_pin text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  target_family_id uuid := private.current_parent_family_id();
  target_kid_id text;
begin
  if target_family_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if parent_pin !~ '^\d{4}$' or judah_pin !~ '^\d{4}$' or max_pin !~ '^\d{4}$' then
    raise exception 'Each PIN must contain exactly 4 numbers';
  end if;

  update public.family_settings
  set parent_pin_verifier = extensions.crypt(parent_pin, extensions.gen_salt('bf'))
  where family_id = target_family_id;

  insert into public.kids
    (id, family_id, slug, name, emoji, allowance_amount_cents, pin_verifier)
  values
    (gen_random_uuid()::text, target_family_id, 'judah', 'Judah', '😎', 2000,
     extensions.crypt(judah_pin, extensions.gen_salt('bf')))
  on conflict (family_id, slug) do update
  set pin_verifier = excluded.pin_verifier,
      name = excluded.name,
      emoji = excluded.emoji;

  select id into target_kid_id
  from public.kids
  where family_id = target_family_id and slug = 'judah';

  insert into public.bucket_balances (kid_id)
  values (target_kid_id)
  on conflict (kid_id) do nothing;

  insert into public.kids
    (id, family_id, slug, name, emoji, allowance_amount_cents, pin_verifier)
  values
    (gen_random_uuid()::text, target_family_id, 'max', 'Max', '🤘', 2000,
     extensions.crypt(max_pin, extensions.gen_salt('bf')))
  on conflict (family_id, slug) do update
  set pin_verifier = excluded.pin_verifier,
      name = excluded.name,
      emoji = excluded.emoji;

  select id into target_kid_id
  from public.kids
  where family_id = target_family_id and slug = 'max';

  insert into public.bucket_balances (kid_id)
  values (target_kid_id)
  on conflict (kid_id) do nothing;
end;
$$;

create or replace function public.get_profile_lock_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with current_family as (
    select private.current_parent_family_id() as id
  )
  select jsonb_build_object(
    'configured',
    coalesce(settings.parent_pin_verifier is not null, false)
      and count(kids.id) filter (where kids.pin_verifier is not null) = 2,
    'profiles',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'slug', kids.slug,
          'name', kids.name,
          'emoji', kids.emoji
        ) order by kids.name
      ) filter (where kids.id is not null),
      '[]'::jsonb
    )
  )
  from current_family
  left join public.family_settings settings on settings.family_id = current_family.id
  left join public.kids kids
    on kids.family_id = current_family.id
    and kids.slug in ('judah', 'max')
  group by settings.parent_pin_verifier;
$$;

create or replace function public.verify_profile_pin(
  profile_slug text,
  supplied_pin text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  target_family_id uuid := private.current_parent_family_id();
  stored_verifier text;
begin
  if target_family_id is null then
    return false;
  end if;

  if profile_slug = 'parent' then
    select parent_pin_verifier into stored_verifier
    from public.family_settings
    where family_id = target_family_id;
  elsif profile_slug in ('judah', 'max') then
    select pin_verifier into stored_verifier
    from public.kids
    where family_id = target_family_id and slug = profile_slug;
  else
    return false;
  end if;

  return stored_verifier is not null
    and extensions.crypt(supplied_pin, stored_verifier) = stored_verifier;
end;
$$;

revoke all on function public.setup_profile_pins(text, text, text) from public, anon;
revoke all on function public.get_profile_lock_state() from public, anon;
revoke all on function public.verify_profile_pin(text, text) from public, anon;

grant execute on function public.setup_profile_pins(text, text, text) to authenticated;
grant execute on function public.get_profile_lock_state() to authenticated;
grant execute on function public.verify_profile_pin(text, text) to authenticated;

commit;
