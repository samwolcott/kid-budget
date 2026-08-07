begin;

update public.kids
set emoji = case slug
  when 'judah' then 'J'
  when 'max' then 'M'
end
where slug in ('judah', 'max');

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
    (gen_random_uuid()::text, target_family_id, 'judah', 'Judah', 'J', 2000,
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
    (gen_random_uuid()::text, target_family_id, 'max', 'Max', 'M', 2000,
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

revoke all on function public.setup_profile_pins(text, text, text) from public, anon;
grant execute on function public.setup_profile_pins(text, text, text) to authenticated;

commit;
