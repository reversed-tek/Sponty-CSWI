-- PR #2: notification inbox, read receipts and comment activity.
-- Apply after 202610140002_reminders.sql.
alter table public.notifications add column if not exists read_at timestamptz;
create index if not exists cswi_notification_inbox
  on public.notifications (user_id,created_at desc);

create or replace function public.mark_notification_read(nid bigint)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare changed boolean;
begin
  update public.notifications
     set read_at = coalesce(read_at, now())
   where id = nid and user_id = auth.uid();
  get diagnostics changed = row_count;
  return changed;
end $$;
revoke all on function public.mark_notification_read(bigint) from public, anon;
grant execute on function public.mark_notification_read(bigint) to authenticated;

create or replace function public.notify_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid;
  reviewer_id uuid;
  reference_text text;
begin
  select created_by, approver_id, reference
    into owner_id, reviewer_id, reference_text
    from public.service_requests where id = new.request_id;

  insert into public.request_events (request_id, actor_id, event, detail)
  values (new.request_id, new.author_id,
    case when new.internal then 'internal_note' else 'comment_added' end, '');

  if new.internal then
    -- Internal notes must never notify a requestor who is not the reviewer.
    if reviewer_id is not null and reviewer_id <> new.author_id then
      perform public.enqueue(new.request_id, reviewer_id,
        'Internal note: ' || reference_text, 'A reviewer added an internal note.');
    end if;
  else
    if owner_id is not null and owner_id <> new.author_id then
      perform public.enqueue(new.request_id, owner_id,
        'New comment: ' || reference_text, 'A comment was added to your request.');
    end if;
    if reviewer_id is not null and reviewer_id <> new.author_id and reviewer_id is distinct from owner_id then
      perform public.enqueue(new.request_id, reviewer_id,
        'New comment: ' || reference_text, 'A comment was added to your assigned request.');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists cswi_comment_notification on public.request_comments;
create trigger cswi_comment_notification
after insert on public.request_comments
for each row execute function public.notify_comment();
