-- Sponty CSWI: apply to a new Supabase project with the SQL editor or CLI.
-- Only security-definer RPCs may change request status; never trust client role/status fields.
create extension if not exists pgcrypto;
create type public.app_role as enum ('requestor','approver','admin');
create type public.request_status as enum ('draft','pending','changes_requested','approved','rejected','scheduled','in_progress','completed','cancelled');
create type public.resource_status as enum ('not_required','pending','arranged');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  created_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  primary key (user_id, role)
);
create or replace function public.seed_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,email,display_name)
  values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'full_name',split_part(coalesce(new.email,''),'@',1)))
  on conflict(id) do update set email=excluded.email;
  insert into public.user_roles(user_id,role) values(new.id,'requestor') on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.seed_profile();
create or replace function public.is_role(r public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.user_roles where user_id=auth.uid() and role=r)
$$;
create sequence public.cswi_number_seq;
create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('CSR-'||to_char(now(),'YYYY')||'-'||lpad(nextval('public.cswi_number_seq')::text,6,'0')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  approver_id uuid references public.profiles(id),
  title text not null check (length(trim(title)) between 4 and 180),
  description text not null default '',
  department text not null default '',
  location text not null default '',
  starts_at timestamptz,
  ends_at timestamptz,
  participant_count integer not null default 1 check (participant_count between 1 and 10000),
  equipment text not null default '',
  bus_required boolean not null default false,
  bus_passengers integer not null default 0 check(bus_passengers between 0 and 10000),
  transport_notes text not null default '',
  notes text not null default '',
  status public.request_status not null default 'draft',
  resource_status public.resource_status not null default 'pending',
  resource_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_dates check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint bus_count check (bus_required or bus_passengers=0)
);
create index cswi_requests_owner_idx on public.service_requests(created_by,created_at desc);
create index cswi_requests_approver_idx on public.service_requests(approver_id,status);
create index cswi_requests_status_idx on public.service_requests(status);

create or replace function public.can_view_request(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.service_requests r
  where r.id=rid and (r.created_by=auth.uid() or r.approver_id=auth.uid() or public.is_role('admin')))
$$;
create or replace function public.can_manage_request(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.service_requests r
  where r.id=rid and (r.approver_id=auth.uid() or public.is_role('admin')))
$$;
create table public.request_events (
 id bigint generated always as identity primary key,
 request_id uuid not null references public.service_requests(id) on delete cascade,
 actor_id uuid references public.profiles(id),
 event text not null,
 detail text not null default '',
 created_at timestamptz not null default now()
);
create table public.request_comments (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.service_requests(id) on delete cascade,
 author_id uuid not null default auth.uid() references public.profiles(id),
 body text not null check(length(trim(body)) between 1 and 4000),
 internal boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.documents (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.service_requests(id) on delete cascade,
 uploaded_by uuid not null default auth.uid() references public.profiles(id),
 storage_path text not null unique,
 file_name text not null check(length(file_name) between 1 and 200),
 mime_type text not null,
 byte_size integer not null check(byte_size > 0 and byte_size <= 10485760),
 created_at timestamptz not null default now()
);
create table public.document_requests (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.service_requests(id) on delete cascade,
 requested_by uuid not null references public.profiles(id),
 prompt text not null check(length(trim(prompt)) between 1 and 2000),
 resolved_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.email_links (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.service_requests(id) on delete cascade,
 linked_by uuid not null default auth.uid() references public.profiles(id),
 message_id text not null check(length(message_id) between 1 and 1000),
 subject text not null default '',
 created_at timestamptz not null default now(),
 unique (request_id,message_id)
);
create table public.notifications (
 id bigint generated always as identity primary key,
 user_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid references public.service_requests(id) on delete cascade,
 subject text not null,
 body text not null,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 claimed_at timestamptz,
 attempts integer not null default 0,
 error text
);
create index cswi_notifications_unsent on public.notifications(created_at) where sent_at is null;
create or replace function public.enqueue(rid uuid, recipient uuid, title text, msg text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if recipient is not null then
   insert into public.notifications(user_id,request_id,subject,body) values(recipient,rid,title,msg);
 end if;
end $$;
revoke all on function public.enqueue(uuid,uuid,text,text) from public, anon, authenticated;

-- Enforce row-level security for all user-facing tables.
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.service_requests enable row level security;
alter table public.request_events enable row level security;
alter table public.request_comments enable row level security;
alter table public.documents enable row level security;
alter table public.document_requests enable row level security;
alter table public.email_links enable row level security;
alter table public.notifications enable row level security;

create policy profiles_read on public.profiles for select to authenticated
 using (id=auth.uid() or public.is_role('admin') or exists(
  select 1 from public.service_requests r
  where (r.created_by=auth.uid() and (r.created_by=profiles.id or r.approver_id=profiles.id))
     or (r.approver_id=auth.uid() and (r.created_by=profiles.id or r.approver_id=profiles.id))
 ));
create policy roles_read on public.user_roles for select to authenticated
 using (user_id=auth.uid() or public.is_role('admin'));
create policy roles_admin_insert on public.user_roles for insert to authenticated
 with check (public.is_role('admin'));
create policy roles_admin_delete on public.user_roles for delete to authenticated
 using (public.is_role('admin'));
create policy requests_read on public.service_requests for select to authenticated
 using (created_by=auth.uid() or approver_id=auth.uid() or public.is_role('admin'));
create policy requests_insert on public.service_requests for insert to authenticated
 with check (created_by=auth.uid() and status='draft' and approver_id is null);
create policy events_read on public.request_events for select to authenticated
 using (public.can_view_request(request_id));
create policy comments_read on public.request_comments for select to authenticated
 using (public.can_view_request(request_id) and (not internal or public.can_manage_request(request_id)));
create policy comments_insert on public.request_comments for insert to authenticated
 with check (author_id=auth.uid() and public.can_view_request(request_id) and (not internal or public.can_manage_request(request_id)));
create policy docs_read on public.documents for select to authenticated
 using (public.can_view_request(request_id));
create policy docs_insert on public.documents for insert to authenticated
 with check(uploaded_by=auth.uid() and public.can_view_request(request_id)
 and storage_path like request_id::text||'/'||auth.uid()::text||'/%');
create policy requests_docs_read on public.document_requests for select to authenticated
 using (public.can_view_request(request_id));
create policy email_links_read on public.email_links for select to authenticated
 using (public.can_view_request(request_id));
create policy email_links_insert on public.email_links for insert to authenticated
 with check(linked_by=auth.uid() and public.can_view_request(request_id));
create policy notifications_read on public.notifications for select to authenticated using (user_id=auth.uid());

-- Limit DML column privileges; immutable role/status fields can be changed ONLY via validated RPCs.
revoke all on public.service_requests from anon,authenticated;
grant select on public.service_requests to authenticated;
grant insert (created_by,title,description,department,location,starts_at,ends_at,participant_count,equipment,bus_required,bus_passengers,transport_notes,notes)
on public.service_requests to authenticated;
grant select on public.profiles,public.user_roles,public.request_events,public.request_comments,public.documents,public.document_requests,public.email_links,public.notifications to authenticated;
grant insert on public.request_comments,public.documents,public.email_links to authenticated;
grant insert,delete on public.user_roles to authenticated;
-- sequences: PostgreSQL default nextval used on inserts.
grant usage on sequence public.cswi_number_seq to authenticated;

create or replace function public.edit_request(rid uuid, payload jsonb)
returns public.service_requests language plpgsql security definer set search_path = '' as $$
declare r public.service_requests;
begin
 select * into r from public.service_requests where id=rid for update;
 if not found or r.created_by <> auth.uid() or r.status not in ('draft','changes_requested') then
   raise exception 'You cannot edit this request in its current state';
 end if;
 if jsonb_typeof(payload) <> 'object' or
   (select count(*) from jsonb_object_keys(payload) k where k not in (
   'title','description','department','location','starts_at','ends_at','participant_count',
   'equipment','bus_required','bus_passengers','transport_notes','notes')) > 0
 then raise exception 'Invalid request fields'; end if;
 update public.service_requests set
  title=coalesce(payload->>'title',title),
  description=coalesce(payload->>'description',description),
  department=coalesce(payload->>'department',department),
  location=coalesce(payload->>'location',location),
  starts_at=case when payload ? 'starts_at' then nullif(payload->>'starts_at','')::timestamptz else starts_at end,
  ends_at=case when payload ? 'ends_at' then nullif(payload->>'ends_at','')::timestamptz else ends_at end,
  participant_count=coalesce((payload->>'participant_count')::integer,participant_count),
  equipment=coalesce(payload->>'equipment',equipment),
  bus_required=coalesce((payload->>'bus_required')::boolean,bus_required),
  bus_passengers=case when payload ? 'bus_required' and payload->>'bus_required'='false' then 0 else coalesce((payload->>'bus_passengers')::integer,bus_passengers) end,
  transport_notes=coalesce(payload->>'transport_notes',transport_notes),
  notes=coalesce(payload->>'notes',notes),
  updated_at=now()
 where id=rid returning * into r;
 insert into public.request_events(request_id,actor_id,event) values(rid,auth.uid(),'edited');
 return r;
end $$;

create or replace function public.transition_request(rid uuid, action text, reason text default '')
returns public.service_requests language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; target public.request_status;
begin
 select * into r from public.service_requests where id=rid for update;
 if not found then raise exception 'Request not found'; end if;
 if action='submit' and r.created_by=auth.uid() and r.status in ('draft','changes_requested') then
   if length(trim(r.description))<10 or length(trim(r.location))<2 or r.starts_at is null or r.ends_at is null
   then raise exception 'Complete description, location and schedule before submitting'; end if;
   target:='pending';
 elsif action='cancel' and r.created_by=auth.uid() and r.status in ('draft','pending','changes_requested','approved') then target:='cancelled';
 elsif action in ('approve','reject','changes') and (r.approver_id=auth.uid() or public.is_role('admin')) and r.status='pending' then
   if action <> 'approve' and length(trim(reason)) < 3 then raise exception 'A reason is required'; end if;
   target:=case action when 'approve' then 'approved' when 'reject' then 'rejected' else 'changes_requested' end;
 elsif action in ('schedule','start','complete') and public.is_role('admin') and
   ((action='schedule' and r.status='approved') or (action='start' and r.status='scheduled') or (action='complete' and r.status='in_progress')) then
   target:=case action when 'schedule' then 'scheduled' when 'start' then 'in_progress' else 'completed' end;
 elsif action='admin_cancel' and public.is_role('admin') and r.status not in ('completed','rejected','cancelled') then
   if length(trim(reason))<3 then raise exception 'An audit reason is required'; end if;
   target:='cancelled';
 else raise exception 'Action is not allowed for this request'; end if;
 update public.service_requests set status=target,updated_at=now() where id=rid returning * into r;
 insert into public.request_events(request_id,actor_id,event,detail) values(rid,auth.uid(),action,left(reason,2000));
 if action='submit' then
   if r.approver_id is not null then perform public.enqueue(rid,r.approver_id,'Review requested: '||r.reference,r.title); end if;
   insert into public.notifications(user_id,request_id,subject,body)
     select user_id,rid,'New request: '||r.reference,r.title from public.user_roles where role='admin';
 else
   perform public.enqueue(rid,r.created_by,'Request '||r.reference||': '||target::text,coalesce(nullif(reason,''),r.title));
   if r.approver_id is not null and r.approver_id<>r.created_by then
    perform public.enqueue(rid,r.approver_id,'Request '||r.reference||': '||target::text,r.title);
   end if;
 end if;
 return r;
end $$;

create or replace function public.assign_approver(rid uuid, reviewer uuid)
returns public.service_requests language plpgsql security definer set search_path = '' as $$
declare r public.service_requests;
begin
 if not public.is_role('admin') then raise exception 'Admin role required'; end if;
 if not exists(select 1 from public.user_roles where user_id=reviewer and role in ('approver','admin'))
 then raise exception 'User is not an approver'; end if;
 update public.service_requests set approver_id=reviewer,updated_at=now() where id=rid
 and status in ('draft','pending','changes_requested') returning * into r;
 if not found then raise exception 'Cannot assign this request'; end if;
 insert into public.request_events(request_id,actor_id,event,detail) values(rid,auth.uid(),'approver_assigned',reviewer::text);
 if r.status='pending' then perform public.enqueue(rid,reviewer,'Assigned approval: '||r.reference,r.title); end if;
 return r;
end $$;
create or replace function public.coordinate_resources(rid uuid, state public.resource_status, detail text)
returns public.service_requests language plpgsql security definer set search_path = '' as $$
declare r public.service_requests;
begin
 if not public.is_role('admin') then raise exception 'Admin role required'; end if;
 update public.service_requests set resource_status=state,resource_notes=left(detail,3000),updated_at=now()
 where id=rid returning * into r;
 if not found then raise exception 'Request not found'; end if;
 insert into public.request_events(request_id,actor_id,event,detail) values(rid,auth.uid(),'resources_updated',state::text||': '||left(detail,1000));
 return r;
end $$;
create or replace function public.request_document(rid uuid, prompt_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; ref text;
begin
 if not public.can_manage_request(rid) or length(trim(prompt_text)) not between 1 and 2000 then
   raise exception 'Not allowed'; end if;
 select created_by,reference into owner_id,ref from public.service_requests where id=rid;
 insert into public.document_requests(request_id,requested_by,prompt) values(rid,auth.uid(),prompt_text);
 insert into public.request_events(request_id,actor_id,event,detail) values(rid,auth.uid(),'document_requested',prompt_text);
 perform public.enqueue(rid,owner_id,'Document requested: '||ref,prompt_text);
end $$;
create or replace function public.resolve_document_request(doc_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
 select request_id into rid from public.document_requests where id=doc_id;
 if rid is null or not public.can_manage_request(rid) then raise exception 'Not allowed'; end if;
 update public.document_requests set resolved_at=now() where id=doc_id;
end $$;

create or replace function public.log_document_upload() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.request_events(request_id,actor_id,event,detail) values(new.request_id,new.uploaded_by,'document_uploaded',new.file_name);
 return new;
end $$;
create trigger log_document after insert on public.documents for each row execute function public.log_document_upload();
create or replace function public.claim_notifications(n integer default 20)
returns setof public.notifications language plpgsql security definer set search_path = '' as $$
begin
 if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
 return query update public.notifications set claimed_at=now(),attempts=attempts+1
 where id in (select id from public.notifications where sent_at is null and attempts<5
 and (claimed_at is null or claimed_at < now()-interval '10 minutes')
 order by created_at asc limit least(greatest(n,1),100) for update skip locked)
 returning *;
end $$;
create or replace function public.finish_notification(nid bigint, delivered boolean, failure text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
 update public.notifications set sent_at=case when delivered then now() else null end,
  error=case when delivered then null else left(failure,300) end,claimed_at=null where id=nid;
end $$;
revoke all on function public.claim_notifications(integer),public.finish_notification(bigint,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_notifications(integer),public.finish_notification(bigint,boolean,text) to service_role;

-- Supabase Storage private bucket + authorization by request membership.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cswi-documents','cswi-documents',false,10485760,array[
 'application/pdf','image/png','image/jpeg','text/plain',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;
create policy cswi_storage_read on storage.objects for select to authenticated
 using(bucket_id='cswi-documents'
 and public.can_view_request(((storage.foldername(name))[1])::uuid));
create policy cswi_storage_insert on storage.objects for insert to authenticated
 with check(bucket_id='cswi-documents'
 and (storage.foldername(name))[2]=auth.uid()::text
 and public.can_view_request(((storage.foldername(name))[1])::uuid));
-- Users cannot delete stored documents. Administrators should implement retention by service_role.

-- ONE-TIME BOOTSTRAP after a designated admin has signed in:
-- insert into public.user_roles(user_id,role)
-- select id,'admin' from public.profiles where email='your-admin@tenant.onmicrosoft.com'
-- on conflict do nothing;
