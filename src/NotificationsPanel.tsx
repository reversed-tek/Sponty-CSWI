import { Bell, CheckCircle2 } from 'lucide-react';
import type { AppNotification } from './lib';

type Props = {
  items: AppNotification[];
  busy: boolean;
  onOpen: (item: AppNotification) => void;
  onMarkRead: (item: AppNotification) => void;
};

export function NotificationsPanel({ items, busy, onOpen, onMarkRead }: Props) {
  return <section>
    <div className="titleline"><div><h2>Notifications</h2><p className="muted">Updates to your community service requests.</p></div><Bell size={19}/></div>
    {!items.length && <p className="empty">No notifications yet.</p>}
    <div className="notification-list">{items.map(n =>
      <div key={n.id} className={'notification-card ' + (!n.read_at ? 'unread' : '')}>
        <div>
          <strong>{n.subject}</strong>
          {!n.read_at && <span className="unread-dot" aria-label="Unread"/>}
        </div>
        <p>{n.body}</p>
        <small>{new Date(n.created_at).toLocaleString()}</small>
        <div className="actions">
          {n.request_id && <button className="secondary compact" onClick={() => onOpen(n)}>Open request</button>}
          {!n.read_at && <button className="text-btn" disabled={busy} onClick={() => onMarkRead(n)}><CheckCircle2 size={14}/> Mark read</button>}
        </div>
      </div>)}</div>
  </section>;
}
