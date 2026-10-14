-- PR #4: core invariants. Apply after 202610140003_notifications.sql.
-- Evidence is a specific document classification, NOT an arbitrary existing attachment.
alter table public.documents add column if not exists evidence_kind text not null default 'supporting';
alter table public.documents drop constraint if exists documents_evidence_kind_check;
alter table public.documents add constraint documents_evidence_kind_check
  check (evidence_kind in ('supporting','completion'));

-- Completion evidence can only be registered against an in-progress request, and
-- must reference an actual uploaded object in the private CSWI storage bucket.
create or replace function public.validate_completion_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare stage public.request_status;
begin
  if new.evidence_kind = 'completion' then
    select status into stage from public.service_requests
    where id = new.request_id for share;
    if stage is distinct from 'in_progress' then
      raise exception 'Completion evidence can only be uploaded while the activity is in progress';
    end if;
    if not exists(
      select 1 from storage.objects
      where bucket_id = 'cswi-documents' and name = new.storage_path
    ) then
      raise exception 'Upload the completion evidence file before registering it';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.validate_completion_evidence() from public, anon, authenticated;
drop trigger if exists cswi_validate_completion_evidence on public.documents;
create trigger cswi_validate_completion_evidence
before insert on public.documents
for each row execute function public.validate_completion_evidence();

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
 elsif action='cancel' and r.created_by=auth.uid() and r.status in ('draft','pending','changes_requested','approved') then
   target:='cancelled';
 elsif action in ('approve','reject','changes') and (r.approver_id=auth.uid() or public.is_role('admin'))
       and r.status='pending' then
   -- Even an admin may not decide their own request.
   if r.created_by = auth.uid() then raise exception 'You cannot review your own request'; end if;
   if action <> 'approve' and length(trim(reason)) < 3 then raise exception 'A reason is required'; end if;
   target:=case action when 'approve' then 'approved' when 'reject' then 'rejected' else 'changes_requested' end;
 elsif action in ('schedule','start','complete') and public.is_role('admin') and
   ((action='schedule' and r.status='approved') or (action='start' and r.status='scheduled') or (action='complete' and r.status='in_progress')) then
   if action='complete' and not exists (
     select 1 from public.documents d where d.request_id=rid and d.evidence_kind='completion'
   ) then raise exception 'Upload completion evidence before marking the activity completed'; end if;
   target:=case action when 'schedule' then 'scheduled' when 'start' then 'in_progress' else 'completed' end;
 elsif action='admin_cancel' and public.is_role('admin') and r.status not in ('completed','rejected','cancelled') then
   if length(trim(reason))<3 then raise exception 'An audit reason is required'; end if;
   target:='cancelled';
 else raise exception 'Action is not allowed for this request'; end if;

 update public.service_requests set status=target,updated_at=now() where id=rid returning * into r;
 insert into public.request_events(request_id,actor_id,event,detail)
   values(rid,auth.uid(),action,left(reason,2000));
 if action='submit' then
   if r.approver_id is not null then
     perform public.enqueue(rid,r.approver_id,'Review requested: '||r.reference,r.title);
   end if;
   insert into public.notifications(user_id,request_id,subject,body)
     select user_id,rid,'New request: '||r.reference,r.title
     from public.user_roles where role='admin';
 else
   perform public.enqueue(rid,r.created_by,'Request '||r.reference||': '||target::text,
     coalesce(nullif(reason,''),r.title));
   if r.approver_id is not null and r.approver_id<>r.created_by then
     perform public.enqueue(rid,r.approver_id,'Request '||r.reference||': '||target::text,r.title);
   end if;
   if action in ('approve','cancel','admin_cancel') then
     -- Send to administrators other than the actor (whose action already succeeded).
     insert into public.notifications(user_id,request_id,subject,body)
       select ur.user_id,rid,'Admin update: '||r.reference||' '||target::text,r.title
       from public.user_roles ur where ur.role='admin' and ur.user_id<>auth.uid();
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
 -- Lock the request so creation/assignment state cannot race other transitions.
 select * into r from public.service_requests where id=rid for update;
 if not found or r.status not in ('draft','pending','changes_requested')
 then raise exception 'Cannot assign this request'; end if;
 if r.created_by=reviewer then raise exception 'A requestor cannot be their own approver'; end if;
 update public.service_requests set approver_id=reviewer,updated_at=now() where id=rid returning * into r;
 insert into public.request_events(request_id,actor_id,event,detail)
   values(rid,auth.uid(),'approver_assigned',reviewer::text);
 if r.status='pending' then perform public.enqueue(rid,reviewer,'Assigned approval: '||r.reference,r.title); end if;
 return r;
end $$;

-- Preserve service-only invocation and speed up the unsent queue search.
create index if not exists cswi_notifications_eligible_idx
on public.notifications (created_at,id)
where sent_at is null and attempts<5;

create or replace function public.claim_notifications(n integer default 100)
returns setof public.notifications language plpgsql security definer set search_path = '' as $$
begin
 if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
 return query update public.notifications set claimed_at=now(),attempts=attempts+1
 where id in (select id from public.notifications where sent_at is null and attempts<5
 and (claimed_at is null or claimed_at < now()-interval '10 minutes')
 order by created_at asc limit least(greatest(coalesce(n,100),1),100) for update skip locked)
 returning *;
end $$;
revoke all on function public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;
