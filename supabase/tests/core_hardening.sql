-- Run locally with: supabase start && supabase test db
-- This transaction is rolled back after pgTAP execution.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

-- Isolated fixture identities, generated through the real auth.users trigger.
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at)
values
 ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000000111','authenticated','authenticated','cswi-owner-111@example.invalid','x',now()),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000000222','authenticated','authenticated','cswi-reviewer-222@example.invalid','x',now()),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000000333','authenticated','authenticated','cswi-requestor-333@example.invalid','x',now()),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000000444','authenticated','authenticated','cswi-admin-444@example.invalid','x',now());
insert into public.user_roles(user_id,role) values
 ('00000000-0000-4000-8000-000000000111','admin'),
 ('00000000-0000-4000-8000-000000000222','approver'),
 ('00000000-0000-4000-8000-000000000444','admin');

-- A is a legacy request already assigned to its own creator.
-- B is valid pending approval; C awaits evidence; D can be cancelled.
insert into public.service_requests
(id,created_by,approver_id,title,description,location,starts_at,ends_at,status)
values
 ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000111','Owner request','A full valid description','School',now()+interval '1 day',now()+interval '2 days','pending'),
 ('00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-000000000333','00000000-0000-4000-8000-000000000222','Reviewer request','A full valid description','School',now()+interval '1 day',now()+interval '2 days','pending'),
 ('00000000-0000-4000-8000-0000000000c3','00000000-0000-4000-8000-000000000333','00000000-0000-4000-8000-000000000222','In progress','A full valid description','School',now()+interval '1 day',now()+interval '2 days','in_progress'),
 ('00000000-0000-4000-8000-0000000000d4','00000000-0000-4000-8000-000000000333',null,'Draft request','A full valid description','School',now()+interval '1 day',now()+interval '2 days','draft');

select has_column('public','documents','evidence_kind','Completion evidence classification exists');

-- Real authenticated role + mocked JWT sub are essential for meaningful RLS tests.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000444',true);
select is((select count(*) from public.service_requests),4::bigint,'Admin may read authorized request list');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000222',true);
select is((select count(*) from public.service_requests),2::bigint,'Reviewer can see only their assignments');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000111',true);
select throws_ok(
  $$select public.transition_request('00000000-0000-4000-8000-0000000000a1','approve','')$$,
  'P0001','You cannot review your own request','Admin cannot approve own legacy-assigned request');
select throws_ok(
  $$select public.assign_approver('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000111')$$,
  'P0001','A requestor cannot be their own approver','Admin cannot assign requester as reviewer');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000222',true);
select lives_ok(
  $$select public.transition_request('00000000-0000-4000-8000-0000000000b2','approve','')$$,
  'Independent reviewer can approve');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000111',true);
select ok(exists (
  select 1 from public.notifications where request_id='00000000-0000-4000-8000-0000000000b2'
  and user_id='00000000-0000-4000-8000-000000000111'
  and subject like 'Admin update:%approved'
), 'Admin receives approval notification');

select throws_ok(
  $$select public.transition_request('00000000-0000-4000-8000-0000000000c3','complete','')$$,
  'P0001','Upload completion evidence before marking the activity completed',
  'Completing without evidence is blocked');
select is(
  (select status::text from public.service_requests where id='00000000-0000-4000-8000-0000000000c3'),
  'in_progress','Denied completion leaves status unchanged');

-- Add real storage and metadata fixture as privileged test setup.
reset role;
insert into storage.objects (bucket_id,name)
values ('cswi-documents','00000000-0000-4000-8000-0000000000c3/00000000-0000-4000-8000-000000000333/completion.pdf');
insert into public.documents
(request_id,uploaded_by,storage_path,file_name,mime_type,byte_size,evidence_kind)
values ('00000000-0000-4000-8000-0000000000c3','00000000-0000-4000-8000-000000000333',
'00000000-0000-4000-8000-0000000000c3/00000000-0000-4000-8000-000000000333/completion.pdf',
'completion.pdf','application/pdf',128,'completion');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000111',true);
select lives_ok(
  $$select public.transition_request('00000000-0000-4000-8000-0000000000c3','complete','')$$,
  'Completion works with registered evidence');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000333',true);
select lives_ok(
  $$select public.transition_request('00000000-0000-4000-8000-0000000000d4','cancel','')$$,
  'Owner can cancel their own draft');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000111',true);
select ok(exists (
  select 1 from public.notifications where request_id='00000000-0000-4000-8000-0000000000d4'
  and user_id='00000000-0000-4000-8000-000000000111' and subject like 'Admin update:%cancelled'
), 'Admin notified when a request is cancelled');

select * from finish();
rollback;
