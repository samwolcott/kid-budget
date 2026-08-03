begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'parent-a@example.test',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'parent-b@example.test',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.families (id, name)
values
  ('a0000000-0000-0000-0000-000000000001', 'Family A'),
  ('b0000000-0000-0000-0000-000000000002', 'Family B');

insert into public.family_members (family_id, user_id, role)
values
  (
    'a0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'parent'
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'parent'
  );

insert into public.family_settings (family_id)
values
  ('a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select array_agg(name order by name) from public.families),
  array['Family A']::text[],
  'Parent A can read only Family A'
);

select is(
  (
    with changed as (
      update public.families
      set name = 'Changed by A'
      where id = 'b0000000-0000-0000-0000-000000000002'
      returning 1
    )
    select count(*) from changed
  ),
  0::bigint,
  'Parent A cannot update Family B'
);

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select array_agg(name order by name) from public.families),
  array['Family B']::text[],
  'Parent B can read only Family B'
);

select is(
  (
    with changed as (
      update public.families
      set name = 'Changed by B'
      where id = 'a0000000-0000-0000-0000-000000000001'
      returning 1
    )
    select count(*) from changed
  ),
  0::bigint,
  'Parent B cannot update Family A'
);

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select is(
  (select count(*) from public.families),
  0::bigint,
  'Unauthenticated users cannot read family data'
);

select * from finish();
rollback;
