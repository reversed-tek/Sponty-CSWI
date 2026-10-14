-- Unified release, part 1: first-class resources and race-safe bookings.
-- Apply after 202610140004_core_hardening.sql.
create extension if not exists btree_gist;

create table public.resources (
 id uuid primary key default gen_random_uuid(),
 name text not null unique check (length(trim(name)) between 2 and 120),
 kind text not null check (kind in ('bus','projector','room','equipment','other')),
 capacity integer not null default 1 check (capacity > 0),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.resource_requests (
 request_id uuid not null references public.service_requests(id) on delete cascade,
 resource_id uuid not null references public.resources(id),
 primary key (request_id,resource_id)
);
create table public.resource_bookings (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.service_requests(id) on delete cascade,
 resource_id uuid not null references public.resources(id),
 during tstzrange not null,
 state text not null default 'held' check (state in ('held','released')),
 created_at timestamptz not null default now(),
 constraint valid_booking_range check (not isempty(during) and not lower_inf(during) and not upper_inf(during) and lower_inc(during) and not upper_inc(during)),
 constraint unique_resource_per_request unique (request_id,resource_id),
 constraint prevent_double_booking exclude using gist (resource_id with =, during with &&) where (state = 'held')
);
create index cswi_resource_bookings_request_idx on public.resource_bookings(request_id);

alter table public.resources enable row level security;
alter table public.resource_requests enable row level security;
alter table public.resource_bookings enable row level security;
create policy resources_visible on public.resources for select to authenticated using (true);
create policy resources_manage on public.resources for all to authenticated
 using (public.is_role('admin')) with check (public.is_role('admin'));
create policy resource_requests_visible on public.resource_requests for select to authenticated
 using (public.can_view_request(request_id));
create policy bookings_visible on public.resource_bookings for select to authenticated
 using (public.can_view_request(request_id));

revoke all on public.resources, public.resource_requests, public.resource_bookings from anon,authenticated;
grant select on public.resources,public.resource_requests,public.resource_bookings to authenticated;
grant insert,update,delete on public.resources to authenticated;
-- No direct DML to bookings or resource_requests; use validated RPCs.

create or replace function public.set_request_resources(rid uuid, resource_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare r public.service_requests;
begin
 select * into r from public.service_requests where id=rid for update;
 if not found or r.created_by<>auth.uid() or r.status not in ('draft','changes_requested')
 then raise exception 'Resources can only be edited by the request owner while the request is editable'; end if;
 if coalesce(array_length(resource_ids,1),0)>20 then raise exception 'Too many resources requested'; end if;
 if exists(select 1 from unnest(resource_ids) as x(id)
           where not exists(select 1 from public.resources res where res.id=x.id and res.active))
 then raise exception 'Selected resource is unavailable'; end if;
 delete from public.resource_requests where request_id=rid;
 insert into public.resource_requests(request_id,resource_id)
 select rid,x.id from (select distinct unnest(coalesce(resource_ids,array[]::uuid[])) as id) x;
 insert into public.request_events(request_id,actor_id,event,detail)
 values(rid,auth.uid(),'resources_requested','Resource selection updated');
end $$;
revoke all on function public.set_request_resources(uuid,uuid[]) from public,anon;
grant execute on function public.set_request_resources(uuid,uuid[]) to authenticated;

-- The RPC exposes only resource identity and availability; no booking ownership.
create or replace function public.available_resources(from_time timestamptz, to_time timestamptz)
returns table(id uuid,name text,kind text,capacity integer,available boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if from_time is null or to_time is null or to_time<=from_time
 then raise exception 'Provide a valid start and end'; end if;
 return query select res.id,res.name,res.kind,res.capacity,not exists(
  select 1 from public.resource_bookings b
  where b.resource_id=res.id and b.state='held'
    and b.during && tstzrange(from_time,to_time,'[)')
 ) from public.resources res where res.active order by res.kind,res.name;
end $$;
revoke all on function public.available_resources(timestamptz,timestamptz) from public,anon;
grant execute on function public.available_resources(timestamptz,timestamptz) to authenticated;

-- Fail submission early when a known conflict exists, but the exclusion
-- constraint is the ultimate race-safe authority when approval reserves.
create or replace function public.check_requested_resource_availability()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.status='pending' and old.status in ('draft','changes_requested') and exists(
  select 1 from public.resource_requests rr
  join public.resource_bookings b on b.resource_id=rr.resource_id
  where rr.request_id=new.id and b.state='held'
    and b.during && tstzrange(new.starts_at,new.ends_at,'[)')
 ) then
  raise exception 'A requested resource is already booked; choose an available alternative';
 end if;
 return new;
end $$;
revoke all on function public.check_requested_resource_availability() from public,anon,authenticated;
drop trigger if exists cswi_check_requested_resources on public.service_requests;
create trigger cswi_check_requested_resources before update of status on public.service_requests
for each row execute function public.check_requested_resource_availability();

-- Holds are inserted as part of the same transaction as the final approval.
-- Partial failure rolls back the approval and all holds.
create or replace function public.sync_resource_holds()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.status='approved' and old.status is distinct from new.status then
   insert into public.resource_bookings(request_id,resource_id,during,state)
   select new.id,rr.resource_id,tstzrange(new.starts_at,new.ends_at,'[)'),'held'
   from public.resource_requests rr where rr.request_id=new.id
   on conflict (request_id,resource_id) do update set
    during=excluded.during,state='held';
 elsif new.status='cancelled' and old.status is distinct from new.status then
   update public.resource_bookings set state='released' where request_id=new.id;
 end if;
 return new;
end $$;
revoke all on function public.sync_resource_holds() from public,anon,authenticated;
drop trigger if exists cswi_sync_resource_holds on public.service_requests;
create trigger cswi_sync_resource_holds after update of status on public.service_requests
for each row execute function public.sync_resource_holds();
