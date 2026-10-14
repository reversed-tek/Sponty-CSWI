import { useState } from 'react';
import { supabase } from './lib';
type Person={id:string;email:string;display_name:string};
type Rule={id:string;priority:number;department:string|null;requires_bus:boolean|null;minimum_participants:number|null;primary_approver:string;secondary_approver:string|null;escalate_after_days:number};
export function RoutingAdmin({people,rules,delegations,onSaved}: {people:Person[];rules:Rule[];delegations:{id:string;principal_id:string;delegate_id:string;starts_at:string;ends_at:string}[];onSaved:()=>Promise<void>}) {
  const [department,setDepartment]=useState('');
  const [requiresBus,setRequiresBus]=useState('any');
  const [minimum,setMinimum]=useState('');
  const [first,setFirst]=useState('');
  const [second,setSecond]=useState('');
  const [priority,setPriority]=useState(100);
  const [escalation,setEscalation]=useState(2);
  const [principal,setPrincipal]=useState('');
  const [delegate,setDelegate]=useState('');
  const [delegateFrom,setDelegateFrom]=useState('');
  const [delegateUntil,setDelegateUntil]=useState('');
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  async function add() {
    setSaving(true);setError('');
    try {
      const {error:err}=await supabase.from('approval_rules').insert({
        department:department.trim()||null,requires_bus:requiresBus==='any'?null:requiresBus==='yes',
        minimum_participants:minimum?Number(minimum):null,
        primary_approver:first,secondary_approver:second||null,
        priority,escalate_after_days:escalation
      });
      if(err)throw err;
      await onSaved();setDepartment('');setMinimum('');setFirst('');setSecond('');
    } catch(e) {setError(e instanceof Error?e.message:String(e));}
    finally{setSaving(false);}
  }
  async function addDelegation(){
    setSaving(true);setError('');
    try {
      const {error:err}=await supabase.from('approval_delegations').insert({principal_id:principal,delegate_id:delegate,starts_at:new Date(delegateFrom).toISOString(),ends_at:new Date(delegateUntil).toISOString()});
      if(err)throw err;
      await onSaved();setPrincipal('');setDelegate('');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setSaving(false);}
  }
  return <section className="panel">
    <h3>Automatic approval routing (Admin)</h3>
    <p className="muted">The lowest priority number matches first. Only newly submitted requests use these rules; previously submitted requests retain their assignments.</p>
    {rules.map(rule=><div className="row-item" key={rule.id}><span>
      Priority {rule.priority}: {rule.department||'Any department'} / {rule.requires_bus===null?'Any bus requirement':rule.requires_bus?'Bus required':'No bus'} / {rule.minimum_participants||0}+ participants
      <small>Escalation after {rule.escalate_after_days} days</small></span>
      <button disabled={saving} onClick={()=>void (async()=>{const {error:err}=await supabase.from('approval_rules').delete().eq('id',rule.id);if(err)setError(err.message);else await onSaved();})()}>Remove</button>
    </div>)}
    <label>Department (leave blank for any)<input value={department} onChange={e=>setDepartment(e.target.value)}/></label>
    <label>Bus requirement<select value={requiresBus} onChange={e=>setRequiresBus(e.target.value)}>
      <option value="any">Any</option><option value="yes">Bus required</option><option value="no">Bus not required</option>
    </select></label>
    <label>Minimum participants<input type="number" min="1" value={minimum} onChange={e=>setMinimum(e.target.value)}/></label>
    <label>First approver<select value={first} onChange={e=>setFirst(e.target.value)}>
      <option value="">Select approver</option>{people.map(p=><option value={p.id} key={p.id}>{p.display_name||p.email}</option>)}
    </select></label>
    <label>Second approver (optional)<select value={second} onChange={e=>setSecond(e.target.value)}>
      <option value="">None</option>{people.filter(p=>p.id!==first).map(p=><option value={p.id} key={p.id}>{p.display_name||p.email}</option>)}
    </select></label>
    <div className="two"><label>Priority<input type="number" value={priority} onChange={e=>setPriority(Number(e.target.value))}/></label>
      <label>Escalate after days<input type="number" min="1" max="30" value={escalation} onChange={e=>setEscalation(Number(e.target.value))}/></label></div>
    <button className="primary" disabled={saving||!first||first===second||escalation<1||escalation>30} onClick={()=>void add()}>Add rule</button>
    <div className="panel"><h3>Reviewer delegations</h3><p className="muted">A delegation takes effect when a new approval stage is assigned during the configured date range.</p>
    {delegations.map(d=><div className="row-item" key={d.id}><span>{people.find(p=>p.id===d.principal_id)?.email||'Reviewer'} → {people.find(p=>p.id===d.delegate_id)?.email||'Delegate'}<small>{new Date(d.starts_at).toLocaleDateString()} – {new Date(d.ends_at).toLocaleDateString()}</small></span><button onClick={()=>void (async()=>{const {error:e}=await supabase.from('approval_delegations').delete().eq('id',d.id);if(e)setError(e.message);else await onSaved();})()}>Remove</button></div>)}
    <label>Delegating reviewer<select value={principal} onChange={e=>setPrincipal(e.target.value)}><option value="">Select reviewer</option>{people.map(p=><option key={p.id} value={p.id}>{p.email}</option>)}</select></label>
    <label>Delegate<select value={delegate} onChange={e=>setDelegate(e.target.value)}><option value="">Select delegate</option>{people.filter(p=>p.id!==principal).map(p=><option key={p.id} value={p.id}>{p.email}</option>)}</select></label>
    <div className="two"><label>From<input type="datetime-local" value={delegateFrom} onChange={e=>setDelegateFrom(e.target.value)}/></label><label>Until<input type="datetime-local" value={delegateUntil} onChange={e=>setDelegateUntil(e.target.value)}/></label></div>
    <button className="secondary" disabled={saving||!principal||!delegate||!delegateFrom||!delegateUntil||delegateFrom>=delegateUntil} onClick={()=>void addDelegation()}>Save delegation</button>
    </div>
    {error&&<p className="error">{error}</p>}
  </section>;
}
