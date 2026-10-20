import { useState } from 'react';
import { Bell, CheckCircle2 } from 'lucide-react';
import type { AppNotification, Request } from './lib';

type Props = {
  items: AppNotification[];
  requests: Request[];
  userId: string;
  busy: boolean;
  onOpen: (item: AppNotification) => void;
  onMarkRead: (item: AppNotification) => void;
  onApprove: (item: AppNotification) => void;
  onReject: (item: AppNotification,reason:string) => void;
};
export function NotificationsPanel({items,requests,userId,busy,onOpen,onMarkRead,onApprove,onReject}:Props) {
  const [rejectId,setRejectId]=useState<number|null>(null);
  const [reason,setReason]=useState('');
  return <section>
    <div className="titleline"><h2>Notifications</h2><Bell size={19}/></div>
    {!items.length && <p className="empty">No notifications yet.</p>}
    <div className="notification-list">{items.map(n=>{
      const request=requests.find(r=>r.id===n.request_id);
      const canAct=!!request && request.status==='pending' && request.approver_id===userId && request.created_by!==userId;
      return <div key={n.id} className={'notification-card '+(!n.read_at?'unread':'')}>
        <div><strong>{n.subject}</strong>{!n.read_at&&<span className="unread-dot" aria-label="Unread"/>}</div>
        <p>{n.body}</p><small>{new Date(n.created_at).toLocaleString()}</small>
        <div className="actions">
          {n.request_id&&<button className="secondary compact" onClick={()=>onOpen(n)}>Open request</button>}
          {canAct&&<button className="primary compact" disabled={busy} onClick={()=>onApprove(n)}>Approve</button>}
          {canAct&&<button className="danger-ghost compact" disabled={busy} onClick={()=>{setRejectId(n.id);setReason('');}}>Reject…</button>}
          {!n.read_at&&<button className="text-btn" disabled={busy} onClick={()=>onMarkRead(n)}><CheckCircle2 size={14}/> Mark read</button>}
        </div>
        {rejectId===n.id&&canAct&&<div className="panel"><label>Reason for rejection
          <textarea rows={2} value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label>
          <div className="actions"><button className="danger-ghost compact" disabled={busy||reason.trim().length<3}
            onClick={()=>{onReject(n,reason.trim());setRejectId(null);}}>Confirm rejection</button>
          <button className="secondary compact" onClick={()=>setRejectId(null)}>Cancel</button></div></div>}
      </div>;
    })}</div>
  </section>;
}
