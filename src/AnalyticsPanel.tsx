import type { Request, Event } from './lib';

export function AnalyticsPanel({ requests, events, loading }: { requests: Request[]; events: Event[]; loading: boolean }) {
  const eventsByRequest = new Map<string,Event[]>();
  for (const event of events) {
    const list = eventsByRequest.get(event.request_id) || [];
    list.push(event);
    eventsByRequest.set(event.request_id,list);
  }
  const cycles: number[] = [];
  for (const list of eventsByRequest.values()) {
    const submitted = list.filter(e=>e.event==='submit').sort((a,b)=>a.created_at.localeCompare(b.created_at))[0];
    const approved = list.filter(e=>e.event==='approve').sort((a,b)=>a.created_at.localeCompare(b.created_at))[0];
    if (submitted && approved && approved.created_at>=submitted.created_at) cycles.push((Date.parse(approved.created_at)-Date.parse(submitted.created_at))/3600000);
  }
  const average = cycles.length ? (cycles.reduce((a,b)=>a+b,0)/cycles.length).toFixed(1)+' hours' : 'Not enough data';
  const stalled = requests.filter(r=>r.status==='pending' && Date.now()-Date.parse(r.updated_at||r.created_at)>48*3600000);
  const byStatus = ['draft','pending','changes_requested','approved','scheduled','in_progress','completed','rejected','cancelled']
    .map(s=>({status:s,count:requests.filter(r=>r.status===s).length})).filter(x=>x.count);
  return <section>
    <h2>Operational dashboard</h2>
    <p className="muted">Based on the requests and event history accessible to administrators. Recent records only.</p>
    {loading && <p>Loading request activity…</p>}
    <div className="metric-grid">
      <div className="metric"><strong>{requests.length}</strong><small>Requests loaded</small></div>
      <div className="metric"><strong>{requests.filter(r=>r.status==='completed').length}</strong><small>Completed</small></div>
      <div className="metric"><strong>{stalled.length}</strong><small>Pending over 48h</small></div>
      <div className="metric"><strong>{average}</strong><small>Average submit → approve</small></div>
    </div>
    <div className="panel"><h3>Status distribution</h3>
      {byStatus.map(x=><div key={x.status} className="row-item"><span>{x.status.replaceAll('_',' ')}</span><strong>{x.count}</strong></div>)}
    </div>
    <div className="panel"><h3>Oldest awaiting review</h3>
      {stalled.sort((a,b)=>a.updated_at.localeCompare(b.updated_at)).slice(0,10).map(r=>
        <div key={r.id} className="row-item"><span>{r.reference} — {r.title}</span><small>{new Date(r.updated_at).toLocaleDateString()}</small></div>)}
      {!stalled.length && <p className="muted">No requests older than 48 hours.</p>}
    </div>
  </section>;
}
