-- Unified release, part 2: routing, multistage approvals, delegations,
-- escalating assignments, checklists and field-level audit history.
alter table public.service_requests add column if not exists activity_type text not null default 'general'
 check (activity_type in ('general','bus_trip','off_site'));
alter table public.service_requests add column if not exists checklist_answers jsonb not null default '{}'::jsonb
 check (jsonb_typeof(checklist_answers)='object');
grant insert (activity_type,checklist_answers) on public.service_requests to authenticated;

create table public.approval_rules(
 id uuid primary key default gen_random_uuid(),
 priority integer not null default 100,
 department text,
 requires_bus boolean,
 minimum_participants integer check (minimum_participants is null or minimum_participants>0),
 primary_approver uuid not null references public.profiles(id),
 secondary_approver uuid references public.profiles(id),
 escalate_after_days integer not null default 2 check (escalate_after_days between 1 and 30),
 active boolean not null default true,
 check (secondary_approver is distinct from primary_approver)
);
create index cswi_approval_rule_order on public.approval_rules(priority,id) where active;

create table public.approval_stages (
 request_id uuid not null references public.service_requests(id) on delete cascade,
 stage integer not null check (stage between 1 and 5),
 approver_id uuid not null references public.profiles(id),
 status text not null default 'pending' check (status in ('pending','approved')),
 decided_at timestamptz,
 primary key(request_id,stage)
);
create table public.approval_delegations (
 id uuid primary key default gen_random_uuid(),
 principal_id uuid not null references public.profiles(id),
 delegate_id uuid not null references public.profiles(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 check (ends_at>starts_at and principal_id<>delegate_id)
);
alter table public.approval_rules enable row level security;
alter table public.approval_stages enable row level security;
alter table public.approval_delegations enable row level security;
create policy approval_rules_admin on public.approval_rules for all to authenticated
 using (public.is_role('admin')) with check (public.is_role('admin'));
create policy approval_stages_read on public.approval_stages for select to authenticated
 using (public.can_view_request(request_id));
create policy approval_delegations_read on public.approval_delegations for select to authenticated
 using (public.is_role('admin') or principal_id=auth.uid() or delegate_id=auth.uid());
create policy approval_delegations_admin on public.approval_delegations for all to authenticated
 using (public.is_role('admin')) with check (public.is_role('admin'));
revoke all on public.approval_rules,public.approval_stages,public.approval_delegations from public,anon,authenticated;
grant select on public.approval_rules,public.approval_stages,public.approval_delegations to authenticated;
grant insert,update,delete on public.approval_rules,public.approval_delegations to authenticated;

-- Resolve an active delegate only if they are a permitted reviewer and are not
-- the request owner. Delegation is applied when the stage is assigned.
create or replace function public.resolve_reviewer(principal uuid, owner_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
 select coalesce((
   select d.delegate_id from public.approval_delegations d
   where d.principal_id=principal and now() between d.starts_at and d.ends_at
   and d.delegate_id<>owner_id
   and exists(select 1 from public.user_roles ur where ur.user_id=d.delegate_id and ur.role in ('approver','admin'))
   order by d.starts_at desc limit 1
 ), principal)
$$;
revoke all on function public.resolve_reviewer(uuid,uuid) from public,anon,authenticated;

create or replace function public.match_approval_rule(r public.service_requests)
returns uuid language sql stable security definer set search_path = '' as $$
 select ar.id from public.approval_rules ar where ar.active
 and (ar.department is null or lower(trim(ar.department))=lower(trim(r.department)))
 and (ar.requires_bus is null or ar.requires_bus=r.bus_required)
 and (ar.minimum_participants is null or r.participant_count>=ar.minimum_participants)
 and ar.primary_approver<>r.created_by
 order by ar.priority,ar.id limit 1
$$;
revoke all on function public.match_approval_rule(public.service_requests) from public,anon,authenticated;

create or replace function public.route_submitted_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare matched public.approval_rules; chosen uuid;
begin
 if new.status='pending' and old.status in ('draft','changes_requested') then
   select * into matched from public.approval_rules ar
   where ar.id=public.match_approval_rule(new);
   if found then
     chosen:=public.resolve_reviewer(matched.primary_approver,new.created_by);
     if chosen<>new.created_by then new.approver_id:=chosen; end if;
   end if;
 end if;
 return new;
end $$;
revoke all on function public.route_submitted_request() from public,anon,authenticated;
drop trigger if exists cswi_route_request on public.service_requests;
create trigger cswi_route_request before update of status on public.service_requests
for each row execute function public.route_submitted_request();

create or replace function public.create_approval_stages()
returns trigger language plpgsql security definer set search_path = '' as $$
declare matched public.approval_rules; next_user uuid;
begin
 if new.status='pending' and old.status in ('draft','changes_requested') then
   delete from public.approval_stages where request_id=new.id;
   select * into matched from public.approval_rules ar where ar.id=public.match_approval_rule(new);
   if found and new.approver_id is not null then
     insert into public.approval_stages(request_id,stage,approver_id)
     values(new.id,1,new.approver_id);
     if matched.secondary_approver is not null and matched.secondary_approver<>new.created_by then
       next_user:=public.resolve_reviewer(matched.secondary_approver,new.created_by);
       if next_user<>new.approver_id and next_user<>new.created_by then
         insert into public.approval_stages(request_id,stage,approver_id)
         values(new.id,2,next_user);
       end if;
     end if;
   end if;
 end if;
 return new;
end $$;
revoke all on function public.create_approval_stages() from public,anon,authenticated;
drop trigger if exists cswi_approval_stages_created on public.service_requests;
create trigger cswi_approval_stages_created after update of status on public.service_requests
for each row execute function public.create_approval_stages();

-- Edit RPC extended to accept activity type and checklist data.
create or replace function public.edit_request(rid uuid, payload jsonb)
returns public.service_requests language plpgsql security definer set search_path = '' as $$
declare r public.service_requests;
begin
 select * into r from public.service_requests where id=rid for update;
 if not found or r.created_by<>auth.uid() or r.status not in ('draft','changes_requested') then
   raise exception 'You cannot edit this request in its current state'; end if;
 if jsonb_typeof(payload)<>'object' or
 (select count(*) from jsonb_object_keys(payload) k where k not in
 ('title','description','department','location','starts_at','ends_at','participant_count',
 'equipment','bus_required','bus_passengers','transport_notes','notes','activity_type','checklist_answers'))>0
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
  bus_passengers=case when payload ? 'bus_required' and payload->>'bus_required'='false' then 0
   else coalesce((payload->>'bus_passengers')::integer,bus_passengers) end,
  transport_notes=coalesce(payload->>'transport_notes',transport_notes),
  notes=coalesce(payload->>'notes',notes),
  activity_type=coalesce(payload->>'activity_type',activity_type),
  checklist_answers=case when payload ? 'checklist_answers' then payload->'checklist_answers' else checklist_answers end,
  updated_at=now()
 where id=rid returning * into r;
 insert into public.request_events(request_id,actor_id,event) values(rid,auth.uid(),'edited');
 return r;
end $$;

-- Audit every field delta including old/new values in a machine-readable event.
create or replace function public.log_request_diff()
returns trigger language plpgsql security definer set search_path = '' as $$
declare previous jsonb:=to_jsonb(old); current_row jsonb:=to_jsonb(new);
  field text; changes jsonb:='{}'::jsonb;
begin
 foreach field in array array['title','description','department','location','starts_at','ends_at',
 'participant_count','equipment','bus_required','bus_passengers','transport_notes','notes',
 'activity_type','checklist_answers'] loop
   if previous->field is distinct from current_row->field then
     changes:=changes||jsonb_build_object(field,jsonb_build_object('before',previous->field,'after',current_row->field));
   end if;
 end loop;
 if changes<>'{}'::jsonb then
   insert into public.request_events(request_id,actor_id,event,detail)
   values(new.id,auth.uid(),'fields_changed',jsonb_build_object('changes',changes)::text);
 end if;
 return new;
end $$;
revoke all on function public.log_request_diff() from public,anon,authenticated;
drop trigger if exists cswi_log_field_diffs on public.service_requests;
create trigger cswi_log_field_diffs after update on public.service_requests
for each row execute function public.log_request_diff();

-- Status changes are kept behind the validated RPC. This preserves the core
-- security guard, while requiring both approval stages when configured.
create or replace function public.transition_request(rid uuid, action text, reason text default '')
returns public.service_requests language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; target public.request_status; pending_stage public.approval_stages;
 next_stage public.approval_stages;
begin
 select * into r from public.service_requests where id=rid for update;
 if not found then raise exception 'Request not found'; end if;
 if action='submit' and r.created_by=auth.uid() and r.status in ('draft','changes_requested') then
   if length(trim(r.description))<10 or length(trim(r.location))<2 or r.starts_at is null or r.ends_at is null
   then raise exception 'Complete description, location and schedule before submitting'; end if;
   if r.activity_type='bus_trip' and
     (coalesce(r.checklist_answers->>'waivers_confirmed','false')<>'true'
      or coalesce(r.checklist_answers->>'transport_plan_confirmed','false')<>'true'
      or coalesce((r.checklist_answers->>'chaperone_count')::integer,0)<ceil(r.participant_count/20.0))
   then raise exception 'Bus trip requires waivers, transport plan and one chaperone per 20 participants'; end if;
   if r.activity_type='off_site' and coalesce(r.checklist_answers->>'risk_assessment_confirmed','false')<>'true'
   then raise exception 'Off-site activities require a confirmed risk assessment'; end if;
   target:='pending';
 elsif action='cancel' and r.created_by=auth.uid() and r.status in ('draft','pending','changes_requested','approved') then
   target:='cancelled';
 elsif action in ('approve','reject','changes') and r.status='pending' then
   if r.created_by=auth.uid() then raise exception 'You cannot review your own request'; end if;
   select * into pending_stage from public.approval_stages
    where request_id=rid and status='pending' order by stage limit 1 for update;
   if found then
     if pending_stage.approver_id<>auth.uid() then raise exception 'This approval stage is assigned to another reviewer'; end if;
   elsif r.approver_id is distinct from auth.uid() and not public.is_role('admin') then
     raise exception 'Not assigned as reviewer'; end if;
   if action<>'approve' and length(trim(reason))<3 then raise exception 'A reason is required'; end if;
   if action='approve' and pending_stage.request_id is not null then
     update public.approval_stages set status='approved',decided_at=now()
       where request_id=rid and stage=pending_stage.stage;
     select * into next_stage from public.approval_stages
       where request_id=rid and status='pending' order by stage limit 1;
     if found then
       update public.service_requests set approver_id=next_stage.approver_id,updated_at=now()
         where id=rid returning * into r;
       insert into public.request_events(request_id,actor_id,event,detail)
       values(rid,auth.uid(),'approval_stage_completed','Stage '||pending_stage.stage);
       perform public.enqueue(rid,next_stage.approver_id,'Approval stage assigned: '||r.reference,r.title);
       return r;
     end if;
   end if;
   target:=case action when 'approve' then 'approved' when 'reject' then 'rejected' else 'changes_requested' end;
 elsif action in ('schedule','start','complete') and public.is_role('admin') and
  ((action='schedule' and r.status='approved') or (action='start' and r.status='scheduled') or
  (action='complete' and r.status='in_progress')) then
   if action='complete' and not exists(
      select 1 from public.documents d where d.request_id=rid and d.evidence_kind='completion')
   then raise exception 'Upload completion evidence before marking the activity completed'; end if;
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
     perform public.enqueue(rid,r.approver_id,'Review requested: '||r.reference,r.title); end if;
   insert into public.notifications(user_id,request_id,subject,body)
     select user_id,rid,'New request: '||r.reference,r.title from public.user_roles where role='admin';
 else
   perform public.enqueue(rid,r.created_by,'Request '||r.reference||': '||target::text,coalesce(nullif(reason,''),r.title));
   if r.approver_id is not null and r.approver_id<>r.created_by then
     perform public.enqueue(rid,r.approver_id,'Request '||r.reference||': '||target::text,r.title);
   end if;
   if action in ('approve','cancel','admin_cancel') then
     insert into public.notifications(user_id,request_id,subject,body)
       select ur.user_id,rid,'Admin update: '||r.reference||' '||target::text,r.title
       from public.user_roles ur where ur.role='admin' and ur.user_id<>auth.uid();
   end if;
 end if;
 return r;
end $$;

-- Manual admin reassignment must keep the currently active approval stage in sync.
create or replace function public.assign_approver(rid uuid, reviewer uuid)
returns public.service_requests language plpgsql security definer set search_path = '' as $
declare r public.service_requests; stage_num integer;
begin
 if not public.is_role('admin') then raise exception 'Admin role required'; end if;
 if not exists(select 1 from public.user_roles where user_id=reviewer and role in ('approver','admin'))
 then raise exception 'User is not an approver'; end if;
 select * into r from public.service_requests where id=rid for update;
 if not found or r.status not in ('draft','pending','changes_requested') then
   raise exception 'Cannot assign this request'; end if;
 if r.created_by=reviewer then raise exception 'A requestor cannot be their own approver'; end if;
 update public.service_requests set approver_id=reviewer,updated_at=now() where id=rid returning * into r;
 select min(stage) into stage_num from public.approval_stages
 where request_id=rid and status='pending';
 if stage_num is not null then
   update public.approval_stages set approver_id=reviewer
   where request_id=rid and stage=stage_num;
 end if;
 insert into public.request_events(request_id,actor_id,event,detail)
 values(rid,auth.uid(),'approver_assigned',reviewer::text);
 if r.status='pending' then perform public.enqueue(rid,reviewer,'Assigned approval: '||r.reference,r.title); end if;
 return r;
end $;

-- Admin-only escalation to a different permitted reviewer, after the matching
-- rule's deadline, with an audit entry. Queue job runs with service role.
create or replace function public.escalate_pending_approvals()
returns integer language plpgsql security definer set search_path = '' as $$
declare req record; fallback_user uuid; escalated integer:=0;
begin
 if auth.role()<>'service_role' then raise exception 'Service role required'; end if;
 for req in
 select r.id,r.created_by,r.approver_id,r.reference,r.title,r.updated_at,
 coalesce(ar.escalate_after_days,2) as days_due
 from public.service_requests r
 left join lateral (
   select escalate_after_days from public.approval_rules ar
   where ar.id=public.match_approval_rule(r) limit 1
 ) ar on true
 where r.status='pending'
 for update of r skip locked
 loop
   if req.updated_at > now()-(req.days_due||' days')::interval then continue; end if;
   select ur.user_id into fallback_user from public.user_roles ur
   where ur.role='admin' and ur.user_id<>req.created_by and ur.user_id is distinct from req.approver_id
   order by ur.user_id limit 1;
   if fallback_user is null then continue; end if;
   update public.service_requests set approver_id=fallback_user,updated_at=now() where id=req.id;
   update public.approval_stages set approver_id=fallback_user
     where request_id=req.id and stage=(select min(stage) from public.approval_stages
                                        where request_id=req.id and status='pending');
   insert into public.request_events(request_id,event,detail)
     values(req.id,'approval_escalated','Automatically assigned to admin after deadline');
   perform public.enqueue(req.id,fallback_user,'Escalated approval: '||req.reference,req.title);
   escalated:=escalated+1;
 end loop;
 return escalated;
end $$;
revoke all on function public.escalate_pending_approvals() from public,anon,authenticated;
grant execute on function public.escalate_pending_approvals() to service_role;

create or replace function public.queue_daily_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
 if auth.role()<>'service_role' then raise exception 'Service role required'; end if;
 perform public.escalate_pending_approvals();
 with candidates as (
  select r.id,r.approver_id as recipient,'Approval reminder: '||r.reference as subject,
    r.title||' is awaiting your review.' as body
  from public.service_requests r where r.status='pending' and r.approver_id is not null
  and r.updated_at<now()-interval '1 day'
  union all
  select r.id,r.created_by,'Upcoming activity: '||r.reference,
    r.title||' is scheduled for '||to_char(r.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC.'
  from public.service_requests r where r.status in ('approved','scheduled')
  and r.starts_at between now() and now()+interval '2 days'
 ), pending as (
  select c.* from candidates c where not exists(
    select 1 from public.notifications n where n.request_id=c.id and n.user_id=c.recipient
    and n.subject=c.subject and n.created_at>now()-interval '24 hours'
  )
 )
 insert into public.notifications(user_id,request_id,subject,body)
 select recipient,id,subject,body from pending;
 get diagnostics inserted=row_count;
 return inserted;
end $$;
revoke all on function public.queue_daily_reminders() from public,anon,authenticated;
grant execute on function public.queue_daily_reminders() to service_role;
