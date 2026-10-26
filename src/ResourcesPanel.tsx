import { useState } from 'react';
import { supabase, errorText } from './lib';

export type Resource = { id:string; name:string; kind:string; capacity:number; active:boolean };
export type ResourceOption = Resource & { available:boolean };

export function ResourcePicker({ options, selected, onChange, checking }:{
  options: ResourceOption[]; selected:string[]; onChange:(ids:string[])=>void; checking:boolean;
}) {
  return <section className="panel"><h3>Resources requested</h3>
    <p className="muted">Availability is checked for the selected dates. Booking is held only after final approval.</p>
    {checking && <p className="muted">Checking availability…</p>}
    {!options.length && <p className="muted">Enter start/end times to see registered resources.</p>}
    {options.map(res=><label className="checkbox resource-choice" key={res.id}>
      <input type="checkbox" checked={selected.includes(res.id)} disabled={!res.available&&!selected.includes(res.id)}
        onChange={e=>onChange(e.target.checked ? [...selected,res.id] : selected.filter(x=>x!==res.id))}/>
      <span>{res.name} <small>({res.kind}, capacity {res.capacity})</small>
        {!res.available && <small className="conflict">Already booked for these dates — select another resource</small>}</span>
    </label>)}
  </section>;
}

export function ResourceAdmin({ onSaved }: { onSaved:()=>Promise<void> }) {
  const [name,setName]=useState('');
  const [kind,setKind]=useState('equipment');
  const [capacity,setCapacity]=useState(1);
  const [error,setError]=useState('');
  const [working,setWorking]=useState(false);
  async function add() {
    setWorking(true);setError('');
    try {
      const {error:err}=await supabase.from('resources').insert({name:name.trim(),kind,capacity});
      if(err)throw err;
      setName('');
      await onSaved();
    } catch(e) {setError(errorText(e));}
    finally{setWorking(false);}
  }
  return <section className="panel"><h3>Add a resource (Admin)</h3>
    <label>Name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Bus 1 / Projector A"/></label>
    <label>Type<select value={kind} onChange={e=>setKind(e.target.value)}>
      {['bus','projector','room','equipment','other'].map(x=><option key={x} value={x}>{x}</option>)}
    </select></label>
    <label>Capacity<input type="number" min={1} value={capacity} onChange={e=>setCapacity(Number(e.target.value))}/></label>
    <button className="secondary" disabled={working||name.trim().length<2||capacity<1} onClick={()=>void add()}>Register resource</button>
    {error && <p className="error">{error}</p>}
  </section>;
}
