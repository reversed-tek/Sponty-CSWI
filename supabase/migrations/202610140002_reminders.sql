-- Service role only: queue daily pending-approval reminders and upcoming-activity reminders.
create or replace function public.queue_daily_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
 if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
 with candidates as (
  select r.id,r.approver_id as recipient, 'Approval reminder: '||r.reference as subject,
    r.title||' is awaiting your review.' as body
  from public.service_requests r where r.status='pending' and r.approver_id is not null and r.updated_at < now()-interval '1 day'
  union all
  select r.id,r.created_by,'Upcoming activity: '||r.reference,r.title||' is scheduled for '||to_char(r.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC.'
  from public.service_requests r where r.status in ('approved','scheduled') and r.starts_at between now() and now()+interval '2 days'
 ), pending as (
   select c.* from candidates c where not exists(
      select 1 from public.notifications n where n.request_id=c.id and n.user_id=c.recipient
      and n.subject=c.subject and n.created_at>now()-interval '24 hours'
   )
 )
 insert into public.notifications(user_id,request_id,subject,body)
 select recipient,id,subject,body from pending;
 get diagnostics inserted = row_count;
 return inserted;
end $$;
revoke all on function public.queue_daily_reminders() from public,anon,authenticated;
grant execute on function public.queue_daily_reminders() to service_role;

-- Requiring a live request avoids uploads to unrelated or closed records.
drop policy if exists docs_insert on public.documents;
create policy docs_insert on public.documents for insert to authenticated
 with check(uploaded_by=auth.uid() and public.can_view_request(request_id)
 and exists(select 1 from public.service_requests r where r.id=request_id
   and r.status not in ('completed','rejected','cancelled'))
 and storage_path like request_id::text||'/'||auth.uid()::text||'/%');
drop policy if exists cswi_storage_insert on storage.objects;
create policy cswi_storage_insert on storage.objects for insert to authenticated
 with check(bucket_id='cswi-documents'
 and (storage.foldername(name))[2]=auth.uid()::text
 and public.can_view_request(((storage.foldername(name))[1])::uuid)
 and exists(select 1 from public.service_requests r
 where r.id=((storage.foldername(name))[1])::uuid and r.status not in ('completed','rejected','cancelled')));

create or replace function public.log_document_upload() returns trigger language plpgsql security definer set search_path = '' as $$
declare reviewer uuid; owner uuid; ref text;
begin
 insert into public.request_events(request_id,actor_id,event,detail) values(new.request_id,new.uploaded_by,'document_uploaded',new.file_name);
 select approver_id,created_by,reference into reviewer,owner,ref from public.service_requests where id=new.request_id;
 if reviewer is not null and new.uploaded_by <> reviewer then
   perform public.enqueue(new.request_id,reviewer,'Document uploaded: '||ref,new.file_name);
 elsif owner is not null and new.uploaded_by <> owner then
   perform public.enqueue(new.request_id,owner,'Document uploaded: '||ref,new.file_name);
 end if;
 return new;
end $$;
