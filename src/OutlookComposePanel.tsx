import { useMemo, useState } from 'react';
import { FileText, MailPlus, Search } from 'lucide-react';
import type { Request } from './lib';
import { composeSubject, insertComposeBody, setComposeSubject } from './office';

type Props = { requests: Request[]; onError: (error: string) => void; onNotice: (notice: string) => void };
const statusLabel = (status: string) => status.replaceAll('_', ' ');

export function OutlookComposePanel({ requests, onError, onNotice }: Props) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const visible = useMemo(() => requests.filter(r =>
    (r.reference + ' ' + r.title).toLowerCase().includes(query.trim().toLowerCase())).slice(0, 40),
    [requests, query]);
  const request = requests.find(r => r.id === selectedId);


  async function action(work: () => Promise<void>, success: string) {
    setBusy(true);
    onError('');
    try {
      await work();
      onNotice(success);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel compose-panel">
    <h3><MailPlus size={16}/> Compose with CSWI</h3>
    <div className="label-row"><Search size={15}/><strong>Find a request</strong></div>
    <input aria-label="Search requests for email" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)}/>
    <select aria-label="Select a request for email" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
      <option value="">Choose an accessible request</option>
      {visible.map(r => <option key={r.id} value={r.id}>{r.reference} — {r.title}</option>)}
    </select>
    {request && <div className="compose-preview">
      <strong>{request.title}</strong>
      <small>{request.reference} · {statusLabel(request.status)}</small>
    </div>}
    <div className="actions">
      <button className="secondary" disabled={busy || !request} onClick={() => void action(async () => {
        if (!request) return;
        const current = await composeSubject();
        const existing = current.match(/CSR-\d{4}-\d{6}/i)?.[0];
        if (existing && existing.toUpperCase() !== request.reference) {
          throw new Error('This draft already contains a different CSWI reference. Remove it first to avoid confusing recipients.');
        }
        const updated = existing ? current : ('[' + request.reference + '] ' + (current || request.title)).slice(0, 255);
        if (!existing) await setComposeSubject(updated);
      }, 'Request reference added to Outlook subject')}><MailPlus size={15}/> Insert reference in subject</button>
      <button className="secondary" disabled={busy || !request} onClick={() => void action(async () => {
        if (!request) return;
        const text = '\nCommunity Service Request: ' + request.title +
          '\nReference: ' + request.reference +
          '\nStatus: ' + statusLabel(request.status) +
          '\nRequest link: ' + window.location.origin + '/?request=' + encodeURIComponent(request.id) + '\n';
        await insertComposeBody(text);
      }, 'Request summary added at the Outlook cursor')}><FileText size={15}/> Insert request summary</button>
    </div>
  </section>;
}
