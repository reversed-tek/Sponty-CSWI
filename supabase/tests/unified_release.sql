-- Run after migrations 001-006: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select plan(12);

-- Real auth users exercise the profile trigger and PostgREST-like RLS context.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at)
values
('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000000551','authenticated','authenticated','unified-requestor@example.invalid','x',now()),
('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000000552','authenticated','authenticated','unified-approver1@example.invalid','x',now()),
('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000000553','authenticated','authenticated','unified-approver2@example.invalid','x',now());
insert into public.user_roles(user_id,role) values
('00000000-0000-4000-8000-000000000552','approver'),
('00000000-0000-4000-8000-000000000553','approver');

select has_table('resources','Resources catalog exists');
select has_table('resource_bookings','Resources booking ledger exists');
select has_table('approval_rules','Approval rules exists');
select has_table('approval_stages','Multi-stage approval ledger exists');
select has_column('service_requests','checklist_answers','Checklist answers are stored');
select has_column('service_requests','activity_type','Activity type is stored');

insert into public.resources(id,name,kind,capacity) values
('00000000-0000-4000-8000-000000000561','Test minibus 561','bus',20),
('00000000-0000-4000-8000-000000000562','Test minibus 562','bus',20);
insert into public.service_requests(id,created_by,title,description,location,starts_at,ends_at)
values
('00000000-0000-4000-8000-000000000571','00000000-0000-4000-8000-000000000551','Minibus request A','Test fixture event request','School',now()+interval '1 day',now()+interval '2 days'),
('00000000-0000-4000-8000-000000000572','00000000-0000-4000-8000-000000000551','Minibus request B','Test fixture event request','School',now()+interval '1 day',now()+interval '2 days'),
('00000000-0000-4000-8000-000000000573','00000000-0000-4000-8000-000000000551','Automatic route','Test fixture event request','School',now()+interval '3 days',now()+interval '4 days');
insert into public.resource_bookings(request_id,resource_id,during)
values ('00000000-0000-4000-8000-000000000571','00000000-0000-4000-8000-000000000561',
tstzrange(now()+interval '1 day',now()+interval '2 days','[)'));

select throws_ok(
$$insert into public.resource_bookings(request_id,resource_id,during)
values('00000000-0000-4000-8000-000000000572',
'00000000-0000-4000-8000-000000000561',
tstzrange(now()+interval '1 day',now()+interval '2 days','[)'))$$,
'23P01','conflicting key value violates exclusion constraint "prevent_double_booking"',
'Overlapping reservations for the same bus are rejected');
select lives_ok(
$$insert into public.resource_bookings(request_id,resource_id,during)
values('00000000-0000-4000-8000-000000000572',
'00000000-0000-4000-8000-000000000562',
tstzrange(now()+interval '1 day',now()+interval '2 days','[)'))$$,
'Different buses may be reserved at the same time');

insert into public.approval_rules(priority,department,primary_approver,secondary_approver)
values (1,'Events','00000000-0000-4000-8000-000000000552','00000000-0000-4000-8000-000000000553');

set local role authenticated;
do $jwt$ begin perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000551',true); end $jwt$;
select lives_ok(
$$select public.transition_request('00000000-0000-4000-8000-000000000573','submit','')$$,
'Requestor can submit to matching routing rule');
-- Fixture department must match routing rule; stage construction happens on submit.
select is((select status::text from public.service_requests where id='00000000-0000-4000-8000-000000000573'),
 'pending','Submitted request remains pending');
select is((select count(*) from public.resource_bookings),2::bigint,
 'Submit does not hold additional bookings');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000552',true);
select is((select count(*) from public.service_requests),0::bigint,
 'RLS keeps unrelated requests hidden from the first reviewer');
select * from finish();
rollback;
