import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ArrowLeft, Bell, CalendarPlus, Check, Download, FilePlus2, Inbox, Link2, LogOut, Mail, Paperclip, Plus, RefreshCw, Search, Send, ShieldCheck, Upload, Users } from 'lucide-react';
import { configured as hasConfig, supabase, errorText } from './lib';
import type { AppNotification, Request, Role, Document, Event, Comment, DocumentRequest } from './lib';
import { OutlookComposePanel } from './OutlookComposePanel';
import { NotificationsPanel } from './NotificationsPanel';
import { ResourcePicker, ResourceAdmin } from './ResourcesPanel';
import type { Resource, ResourceOption } from './ResourcesPanel';
import { RoutingAdmin } from './RoutingAdmin';
import { AnalyticsPanel } from './AnalyticsPanel';
import { proposeEmailFields } from './emailPrefill';
import { calendarDraft, emailReference, inOutlook, mimeFor, oauthDialog, readAttachment, readMail, replyDraft, outlookSurface } from './office';
import type { OutlookSurface } from './office';
import type { Mail as SelectedMail } from './office';

type Profile = { id: string; email: string; display_name: string };
type Page = 'my' | 'approvals' | 'all' | 'new' | 'notifications' | 'operations' | 'analytics';
type Rule = {id:string;priority:number;department:string|null;requires_bus:boolean|null;minimum_participants:number|null;primary_approver:string;secondary_approver:string|null;escalate_after_days:number};
const blank = {title:'',description:'',department:'',location:'',starts_at:'',ends_at:'',participant_count:1,equipment:'',bus_required:false,bus_passengers:0,transport_notes:'',notes:'',activity_type:'general',checklist_answers:{} as Record<string,number|boolean>};
type FormValue = typeof blank;
const fmt = (v?: string | null) => v ? new Date(v).toLocaleString() : 'Not set';
const inputDate = (v?: string | null) => v ? new Date(new Date(v).getTime()-new Date(v).getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
const cleanFile = (f: File) => {
  const allowed = new Set(['pdf','png','jpg','jpeg','txt','docx','xlsx']);
  const ext=f.name.split('.').pop()?.toLowerCase() || '';
  if (!allowed.has(ext) || !mimeFor(f.name) || f.size<=0 || f.size>10*1024*1024) throw new Error('Supported files: PDF, PNG, JPG, TXT, DOCX, XLSX (maximum 10 MB each).');
};
const friendlyStatus = (s:string) => s.replaceAll('_',' ').replace(/\b\w/g,x=>x.toUpperCase());

export function App({ configured=hasConfig }: { configured?: boolean }) {
  const [session,setSession]=useState<Session|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [roles,setRoles]=useState<Role[]>([]);
  const [requests,setRequests]=useState<Request[]>([]);
  const [people,setPeople]=useState<Profile[]>([]);
  const [userRoles,setUserRoles]=useState<{user_id:string;role:Role}[]>([]);
  const [mail,setMail]=useState<SelectedMail|null>(null);
  const [surface,setSurface]=useState<OutlookSurface>('none');
  const [mailLinkedRequestId,setMailLinkedRequestId]=useState<string|null>(null);
  const [notifications,setNotifications]=useState<AppNotification[]>([]);
  const [search,setSearch]=useState('');
  const [statusFilter,setStatusFilter]=useState('all');
  const [page,setPage]=useState<Page>('my');
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [editing,setEditing]=useState<Request|null>(null);
  const [form,setForm]=useState<FormValue>(blank);
  const [requestedResources,setRequestedResources]=useState<string[]>([]);
  const [resourceOptions,setResourceOptions]=useState<ResourceOption[]>([]);
  const [resourceChecking,setResourceChecking]=useState(false);
  const [resources,setResources]=useState<Resource[]>([]);
  const [rules,setRules]=useState<Rule[]>([]);
  const [resourceNames,setResourceNames]=useState<string[]>([]);
  const [approvalStages,setApprovalStages]=useState<{stage:number;approver_id:string;status:string}[]>([]);
  const [analyticsEvents,setAnalyticsEvents]=useState<Event[]>([]);
  const [analyticsLoading,setAnalyticsLoading]=useState(false);
  const [documents,setDocuments]=useState<Document[]>([]);
  const [events,setEvents]=useState<Event[]>([]);
  const [comments,setComments]=useState<Comment[]>([]);
  const [docRequests,setDocRequests]=useState<DocumentRequest[]>([]);
  const [links,setLinks]=useState<{message_id:string;subject:string}[]>([]);
  const [comment,setComment]=useState('');
  const [internal,setInternal]=useState(false);
  const [reason,setReason]=useState('');
  const [requestedDocument,setRequestedDocument]=useState('');
  const [reviewer,setReviewer]=useState('');
  const [resourceState,setResourceState]=useState('pending');
  const [resourceNote,setResourceNote]=useState('');
  const [roleTarget,setRoleTarget]=useState('');
  const [roleToGrant,setRoleToGrant]=useState<Role>('approver');
  const [uploaded,setUploaded]=useState(false);
  const user=session?.user;
  const isAdmin=roles.includes('admin');
  const canApprove=roles.includes('approver') || isAdmin;
  const selected=useMemo(()=>requests.find(r=>r.id===selectedId)||null,[requests,selectedId]);
  const mailMatch=useMemo(()=>requests.find(r=>r.reference===emailReference(mail) || r.id===mailLinkedRequestId),[requests,mail,mailLinkedRequestId]);
  const unread=notifications.filter(n=>!n.read_at).length;
  const pending=useMemo(()=>requests.filter(r=>r.status==='pending'&&(isAdmin||r.approver_id===user?.id)),[requests,isAdmin,user?.id]);
  const ordered=useMemo(()=>[...requests].sort((a,b)=>b.created_at.localeCompare(a.created_at)),[requests]);

  useEffect(()=>{
    if (!configured) {setLoading(false);return;}
    void supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>{setSession(s);});
    return ()=>subscription.unsubscribe();
  },[configured]);
  useEffect(()=>{
    if (typeof Office==='undefined') return;
    let disposed=false;
    void Office.onReady().then(()=>{
      if(disposed) return;
      const reread=()=>{setSurface(outlookSurface());void readMail().then(m=>{if(!disposed)setMail(m);}).catch(()=>{if(!disposed)setMail(null);});};
      reread();
      try {Office.context.mailbox.addHandlerAsync(Office.EventType.ItemChanged,reread);} catch { /* Not every Outlook client exposes ItemChanged. */ }
    });
    return ()=>{disposed=true;};
  },[]);

  const refresh=useCallback(async()=>{
    if(!user) return;
    const [roleResult,requestResult,notificationResult]=await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id',user.id),
      supabase.from('service_requests').select('*').order('created_at',{ascending:false}).limit(200),
      supabase.from('notifications').select('id,request_id,subject,body,created_at,read_at').order('created_at',{ascending:false}).limit(50)
    ]);
    if(roleResult.error) throw roleResult.error;
    if(requestResult.error) throw requestResult.error;
    if(notificationResult.error) throw notificationResult.error;
    setNotifications(notificationResult.data as AppNotification[] || []);
    const assigned=(roleResult.data||[]).map(x=>x.role as Role);
    setRoles(assigned);
    setRequests(requestResult.data as Request[] || []);
    if(assigned.includes('admin')){
      const [pr,rr]=await Promise.all([supabase.from('profiles').select('id,email,display_name').order('email'),
        supabase.from('user_roles').select('user_id,role')]);
      if(pr.error) throw pr.error;
      if(rr.error) throw rr.error;
      setPeople(pr.data as Profile[] || []);
      setUserRoles(rr.data as {user_id:string;role:Role}[] || []);
      const [res,rulesResult]=await Promise.all([supabase.from('resources').select('*').order('name'),supabase.from('approval_rules').select('*').order('priority')]);
      if(res.error)throw res.error;
      if(rulesResult.error)throw rulesResult.error;
      setResources(res.data as Resource[]||[]);
      setRules(rulesResult.data as Rule[]||[]);
    } else setPeople([]);
  },[user?.id]);

  const reloadDetails=useCallback(async(rid:string)=>{
    const results=await Promise.all([
      supabase.from('documents').select('*').eq('request_id',rid).order('created_at',{ascending:false}),
      supabase.from('request_events').select('*').eq('request_id',rid).order('created_at',{ascending:false}),
      supabase.from('request_comments').select('*').eq('request_id',rid).order('created_at',{ascending:false}),
      supabase.from('document_requests').select('*').eq('request_id',rid).order('created_at',{ascending:false}),
      supabase.from('email_links').select('message_id,subject').eq('request_id',rid),
      supabase.from('resource_requests').select('resource_id,resources(name)').eq('request_id',rid),
      supabase.from('approval_stages').select('stage,approver_id,status').eq('request_id',rid).order('stage')
    ]);
    const firstError=results.find(x=>x.error)?.error;
    if(firstError) throw firstError;
    setDocuments(results[0].data as Document[]||[]);
    setEvents(results[1].data as Event[]||[]);
    setComments(results[2].data as Comment[]||[]);
    setDocRequests(results[3].data as DocumentRequest[]||[]);
    setLinks(results[4].data as {message_id:string;subject:string}[]||[]);
    setResourceNames((results[5].data||[]).map((x:any)=>x.resources?.name||'Resource'));
    setApprovalStages(results[6].data as {stage:number;approver_id:string;status:string}[]||[]);
  },[]);

  useEffect(()=>{if(user) void refresh().catch(e=>setError(errorText(e)));else {setRequests([]);setNotifications([]);setRoles([]);setSelectedId(null);}},[user?.id,refresh]);
  useEffect(()=>{
    if(!user || !mail?.id) {setMailLinkedRequestId(null);return;}
    let cancelled=false;
    void supabase.from('email_links').select('request_id').eq('message_id',mail.id).limit(1)
      .then(({data})=>{if(!cancelled)setMailLinkedRequestId(data?.[0]?.request_id||null);});
    return ()=>{cancelled=true;};
  },[mail?.id,user?.id]);
  useEffect(()=>{
    const target = new URLSearchParams(window.location.search).get('request');
    if(!target || !requests.some(r=>r.id===target))return;
    setSelectedId(target);
    setPage('my');
    const url = new URL(window.location.href);
    url.searchParams.delete('request');
    window.history.replaceState(null,'',url.pathname+url.search+url.hash);
  },[requests]);
  useEffect(()=>{if(selectedId)void reloadDetails(selectedId).catch(e=>setError(errorText(e)));},[selectedId,reloadDetails]);
  useEffect(()=>{
    if(!user) return;
    const timer=window.setInterval(()=>void refresh().catch(()=>{}),60000);
    return ()=>window.clearInterval(timer);
  },[user?.id,refresh]);

  useEffect(()=>{
    if(page!=='new'||!user||!form.starts_at||!form.ends_at) {setResourceOptions([]);return;}
    const start=new Date(form.starts_at), end=new Date(form.ends_at);
    if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start){setResourceOptions([]);return;}
    let cancelled=false;
    setResourceChecking(true);
    void supabase.rpc('available_resources',{from_time:start.toISOString(),to_time:end.toISOString()})
      .then(({data,error:e})=>{
        if(cancelled)return;
        if(e)setError(e.message);
        else setResourceOptions((data||[]).map(x=>({id:x.id,name:x.name,kind:x.kind,capacity:x.capacity,available:x.available,active:true})));
      }).finally(()=>{if(!cancelled)setResourceChecking(false);});
    return ()=>{cancelled=true;};
  },[page,user?.id,form.starts_at,form.ends_at]);

  useEffect(()=>{
    if(page!=='analytics'||!isAdmin)return;
    let cancelled=false;
    setAnalyticsLoading(true);
    void supabase.from('request_events').select('*').order('created_at',{ascending:false}).limit(5000)
      .then(({data,error:e})=>{if(!cancelled){if(e)setError(e.message);else setAnalyticsEvents(data as Event[]||[]);}})
      .finally(()=>{if(!cancelled)setAnalyticsLoading(false);});
    return ()=>{cancelled=true;};
  },[page,isAdmin]);

  const suggestedFromEmail=useMemo(()=>mail ? proposeEmailFields(mail.preview) : [],[mail]);

  const setChecklist=(name:string,value:boolean|number)=>{
    setForm(old=>({...old,checklist_answers:{...old.checklist_answers,[name]:value}}));
  };

  const prettyEvent=(event:Event)=>{
    if(event.event!=='fields_changed')return event.detail;
    try {
      const record=JSON.parse(event.detail) as {changes?:Record<string,{before:unknown;after:unknown}>};
      return Object.entries(record.changes||{}).map(([field,v])=>
        field.replaceAll('_',' ')+': '+JSON.stringify(v.before)+' → '+JSON.stringify(v.after)).join('; ');
    }catch{return 'Fields updated';}
  };

  async function execute(action:()=>Promise<void>,success='Saved successfully') {
    setBusy(true);setError('');setNotice('');
    try {await action();await refresh();if(selectedId)await reloadDetails(selectedId);setNotice(success);}
    catch(e){setError(errorText(e));try{await refresh();}catch{/* Retain the original error. */}}finally{setBusy(false);}
  }
  async function login(){
    if(!configured)return;
    await execute(async()=>{
      const {data,error}=await supabase.auth.signInWithOAuth({
        provider:'azure',options:{scopes:'email',redirectTo:window.location.origin+'/auth/callback',skipBrowserRedirect:true}
      });
      if(error || !data.url) throw error || new Error('Could not begin Microsoft sign-in');
      await oauthDialog(data.url,async(access_token,refresh_token)=>{
        const {error:authError}=await supabase.auth.setSession({access_token,refresh_token});
        if(authError)throw authError;
        const {error:verifyError}=await supabase.auth.getUser();
        if(verifyError)throw verifyError;
      });
    },'Signed in successfully');
  }
  function startForm(seed?:Request|null){
    setEditing(seed||null);
    setForm(seed ? {
      title:seed.title,description:seed.description,department:seed.department,location:seed.location,
      starts_at:inputDate(seed.starts_at),ends_at:inputDate(seed.ends_at),participant_count:seed.participant_count,
      equipment:seed.equipment,bus_required:seed.bus_required,bus_passengers:seed.bus_passengers,
      transport_notes:seed.transport_notes,notes:seed.notes,
      activity_type:seed.activity_type||'general',checklist_answers:seed.checklist_answers||{}
    } : {...blank,title:mail?.subject||'',description:mail?.preview||''});
    setRequestedResources([]);
    if(seed) void supabase.from('resource_requests').select('resource_id').eq('request_id',seed.id)
      .then(({data,error:e})=>{if(e)setError(e.message);else setRequestedResources((data||[]).map(x=>x.resource_id));});
    setSelectedId(null);setPage('new');setNotice('');
  }
  const setField = <K extends keyof FormValue>(key:K,value:FormValue[K]) => setForm(old=>({...old,[key]:value}));
  async function saveRequest(submit:boolean) {
    if(!user) return;
    await execute(async()=>{
      if(!form.title.trim())throw new Error('Activity title is required.');
      const payload={...form, title:form.title.trim(),starts_at:form.starts_at ? new Date(form.starts_at).toISOString():null,
        ends_at:form.ends_at ? new Date(form.ends_at).toISOString():null,
        bus_passengers:form.bus_required ? form.bus_passengers : 0};
      let id=editing?.id;
      if(id){
        const {error:e}=await supabase.rpc('edit_request',{rid:id,payload});
        if(e)throw e;
      } else {
        const {data,error:e}=await supabase.from('service_requests').insert({...payload,created_by:user.id}).select('id').single();
        if(e)throw e;
        id=data.id;
      }
      const {error:resourceError}=await supabase.rpc('set_request_resources',{rid:id,resource_ids:requestedResources});
      if(resourceError)throw resourceError;
      if(submit){
        const {error:e}=await supabase.rpc('transition_request',{rid:id,action:'submit',reason:''});
        if(e){setPage('my');setSelectedId(id||null);throw new Error('Request saved as a draft, but submission failed: '+e.message);}
      }
      setPage('my');setSelectedId(id||null);
    },submit?'Request submitted':'Draft saved');
  }
  async function move(action:string){
    if(!selected)return;
    await execute(async()=>{
      const {error:e}=await supabase.rpc('transition_request',{rid:selected.id,action,reason:reason.trim()});
      if(e)throw e;
      setReason('');
    },'Request status updated');
  }
  async function assign(){
    if(!selected||!reviewer)return;
    await execute(async()=>{const {error:e}=await supabase.rpc('assign_approver',{rid:selected.id,reviewer});if(e)throw e;},'Approver assigned');
  }
  async function coordinate(){
    if(!selected)return;
    await execute(async()=>{const {error:e}=await supabase.rpc('coordinate_resources',{rid:selected.id,state:resourceState,detail:resourceNote});if(e)throw e;},'Resource coordination updated');
  }
  async function uploadFiles(files: FileList | File[], evidenceKind: 'supporting' | 'completion' = 'supporting'){
    if(!selected||!user)return;
    await execute(async()=>{
      for(const file of Array.from(files)){
        cleanFile(file);
        const ext=file.name.split('.').pop()!.toLowerCase();
        const path=selected.id+'/'+user.id+'/'+crypto.randomUUID()+'.'+ext;
        const {error:up}=await supabase.storage.from('cswi-documents').upload(path,file,{contentType:mimeFor(file.name),upsert:false});
        if(up)throw up;
        const {error:dbError}=await supabase.from('documents').insert({
          request_id:selected.id,uploaded_by:user.id,storage_path:path,file_name:file.name,mime_type:mimeFor(file.name),byte_size:file.size,evidence_kind:evidenceKind
        });
        if(dbError)throw new Error('File uploaded but metadata registration failed; contact an admin. '+dbError.message);
      }
      setUploaded(true);
    },'Document(s) uploaded');
  }
  async function download(doc:Document){
    await execute(async()=>{
      const {data,error:e}=await supabase.storage.from('cswi-documents').createSignedUrl(doc.storage_path,60);
      if(e||!data?.signedUrl)throw e||new Error('Could not open document');
      window.open(data.signedUrl,'_blank','noopener,noreferrer');
    },'Secure download link opened');
  }
  async function linkEmail(){
    if(!selected||!mail?.id||!user) return;
    await execute(async()=>{
      const {error:e}=await supabase.from('email_links').upsert({request_id:selected.id,linked_by:user.id,message_id:mail.id,subject:mail.subject},{onConflict:'request_id,message_id',ignoreDuplicates:true});
      if(e)throw e;
      setMailLinkedRequestId(selected.id);
    },'Email linked to request');
  }
  function replyWith(template:'status'|'document'){
    if(!selected)return;
    try {
      replyDraft('Re: '+selected.reference+' — '+selected.title+'\n\n'+
        (template==='document'?'Please provide the supporting documents requested for this activity.':'Your community service request is currently '+friendlyStatus(selected.status)+'.')+
        '\n\nReference: '+selected.reference+'\n');
    } catch(e){setError(errorText(e));}
  }
  async function commentOnRequest(){
    if(!selected||!user||!comment.trim())return;
    await execute(async()=>{
      const {error:e}=await supabase.from('request_comments').insert({request_id:selected.id,author_id:user.id,body:comment.trim(),internal});
      if(e)throw e;setComment('');setInternal(false);
    },'Comment added');
  }
  async function requestMoreDocuments(){
    if(!selected||!requestedDocument.trim())return;
    await execute(async()=>{
      const {error:e}=await supabase.rpc('request_document',{rid:selected.id,prompt_text:requestedDocument.trim()});
      if(e)throw e;setRequestedDocument('');
    },'Document request sent');
  }
  async function assignRole(){
    await execute(async()=>{
      if(!roleTarget)throw new Error('Select a user.');
      const {error:e}=await supabase.from('user_roles').insert({user_id:roleTarget,role:roleToGrant});
      if(e)throw e;
    },'Role assigned');
  }
  async function removeRole(userId:string,role:Role){
    await execute(async()=>{
      if(role==='admin' && userRoles.filter(r=>r.role==='admin').length<=1)throw new Error('Cannot remove the last administrator.');
      const {error:e}=await supabase.from('user_roles').delete().eq('user_id',userId).eq('role',role);
      if(e)throw e;
    },'Role removed');
  }
  if(!configured)return <main className="setup"><h1>Sponty CSWI</h1><p>Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your Vercel project before installing the add-in.</p></main>;
  if(loading)return <main className="setup">Loading Sponty CSWI…</main>;
  if(!user)return <main className="signin"><div className="brand-mark"><ShieldCheck size={24}/></div><h1>Sponty CSWI</h1><p>Community service requests, approvals and document coordination — directly in Outlook.</p><button className="primary" disabled={busy} onClick={()=>void login()}>Sign in with Microsoft</button><small>Access is limited to the configured Microsoft Entra tenant.</small>{error&&<p className="error" role="alert">{error}</p>}</main>;

  const visibleBase=page==='approvals'?ordered.filter(r=>r.status==='pending'&&(isAdmin||r.approver_id===user.id)):page==='all'&&isAdmin?ordered:ordered.filter(r=>r.created_by===user.id);
  const visible=visibleBase.filter(r=>(statusFilter==='all'||r.status===statusFilter)&&
    (r.title+' '+r.reference+' '+r.location).toLowerCase().includes(search.trim().toLowerCase()));
  async function markNotificationRead(n:AppNotification){
    await execute(async()=>{
      const {error:e}=await supabase.rpc('mark_notification_read',{nid:n.id});
      if(e)throw e;
    },'Notification marked as read');
  }
  function openNotification(n:AppNotification){
    if(!n.request_id)return;
    const target=requests.find(r=>r.id===n.request_id);
    if(!target){setError('This request is not in your accessible recent requests. Contact an administrator if you need access.');return;}
    setSelectedId(target.id);
    setPage('my');
    if(!n.read_at)void markNotificationRead(n);
  }
  function exportVisibleCsv(){
    const columns=['reference','title','status','location','starts_at','ends_at','participant_count','bus_required','equipment','created_at'] as const;
    const cell=(value:unknown)=>{const raw=String(value??''); const safe=/^[\s\u0000-\u001f]*[=+\-@]/u.test(raw)?"'"+raw:raw; return '"'+safe.replaceAll('"','""')+'"';};
    const csv=[columns.join(','),...visible.map(r=>columns.map(c=>cell(r[c])).join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download='cswi-requests.csv';document.body.appendChild(link);link.click();link.remove();
    URL.revokeObjectURL(url);
  }
  const hasReviewer=selected && selected.created_by!==user.id && (selected.approver_id===user.id||isAdmin);
  return <div className="shell">
    <header className="header"><div className="brand"><div className="brand-mark"><ShieldCheck size={19}/></div><div><strong>Sponty CSWI</strong><small>Community Service</small></div></div><button className="icon-btn" title="Refresh" onClick={()=>void execute(refresh,'Updated')}><RefreshCw size={17}/></button></header>
    <nav className="nav">
      <button className={page==='my'?'active':''} onClick={()=>{setPage('my');setSelectedId(null);}}><Inbox size={15}/> My Requests</button>
      {canApprove&&<button className={page==='approvals'?'active':''} onClick={()=>{setPage('approvals');setSelectedId(null);}}><Check size={15}/> Approvals <span className="count">{pending.length}</span></button>}
      {isAdmin&&<button className={page==='all'?'active':''} onClick={()=>{setPage('all');setSelectedId(null);}}><Users size={15}/> All Requests</button>}
      <button className={page==='notifications'?'active':''} onClick={()=>{setPage('notifications');setSelectedId(null);}}><Bell size={15}/> Updates {unread>0&&<span className="count">{unread}</span>}</button>
    </nav>
    <div className="content">
      <div className="user-row"><span>{user.email}</span><span className="tag">{isAdmin?'Admin':canApprove?'Approver':'Requestor'}</span><button className="text-btn" title="Sign out" onClick={()=>void supabase.auth.signOut()}><LogOut size={15}/></button></div>
      {error&&<div className="error" role="alert">{error}<button className="dismiss" onClick={()=>setError('')}>×</button></div>}
      {notice&&<div className="success" role="status">{notice}<button className="dismiss" onClick={()=>setNotice('')}>×</button></div>}
      {surface==='compose'&&<OutlookComposePanel key={user.id+String(surface)} requests={requests} onError={setError} onNotice={setNotice}/>}
      {mail&&surface==='read'&&<section className="mail-card"><div className="label-row"><Mail size={16}/><strong>Open email</strong></div><p className="ellipsis">{mail.subject||'(no subject)'}</p>{mailMatch?<button className="link" onClick={()=>{setSelectedId(mailMatch.id);setPage('my');}}>View linked request {mailMatch.reference} →</button>:<button className="link" onClick={()=>startForm()}>Create request from this email →</button>}</section>}
      {page==='new'?
        <section><button className="back" onClick={()=>{setPage('my');setSelectedId(editing?.id||null);}}><ArrowLeft size={15}/> Back</button><h2>{editing?'Edit request':'New request'}</h2>
          <form onSubmit={e=>{e.preventDefault();void saveRequest(false);}}>
            <label>Activity title *<input required minLength={4} maxLength={180} value={form.title} onChange={e=>setField('title',e.target.value)}/></label>
            <label>Activity description *<textarea rows={4} value={form.description} onChange={e=>setField('description',e.target.value)} placeholder="Purpose and planned activities"/></label>
            <label>Department / group<input value={form.department} onChange={e=>setField('department',e.target.value)}/></label>
            <label>Venue / address *<input value={form.location} onChange={e=>setField('location',e.target.value)}/></label>
            <div className="two"><label>Starts *<input type="datetime-local" value={form.starts_at} onChange={e=>setField('starts_at',e.target.value)}/></label><label>Ends *<input type="datetime-local" value={form.ends_at} onChange={e=>setField('ends_at',e.target.value)}/></label></div>
            <label>Expected participants<input type="number" min="1" max="10000" value={form.participant_count} onChange={e=>setField('participant_count',Number(e.target.value))}/></label>
            <label>Equipment required<textarea rows={2} placeholder="Projector, chairs, tables…" value={form.equipment} onChange={e=>setField('equipment',e.target.value)}/></label>
            <label className="checkbox"><input type="checkbox" checked={form.bus_required} onChange={e=>setField('bus_required',e.target.checked)}/> School bus needed</label>
            {form.bus_required&&<><label>Bus passenger count<input type="number" min="1" value={form.bus_passengers} onChange={e=>setField('bus_passengers',Number(e.target.value))}/></label><label>Pickup, drop-off and other transport notes<textarea rows={2} value={form.transport_notes} onChange={e=>setField('transport_notes',e.target.value)}/></label></>}
            <label>Additional notes<textarea rows={2} value={form.notes} onChange={e=>setField('notes',e.target.value)}/></label>
            <div className="actions"><button disabled={busy} type="submit" className="secondary">Save draft</button><button disabled={busy} className="primary" type="button" onClick={()=>void saveRequest(true)}><Send size={15}/> Submit request</button></div>
          </form>
        </section>:
      selected?
        <section className="detail">
          <button className="back" onClick={()=>setSelectedId(null)}><ArrowLeft size={15}/> All requests</button>
          <div className="titleline"><h2>{selected.title}</h2><span className={'status status-'+selected.status}>{friendlyStatus(selected.status)}</span></div>
          <p className="muted">{selected.reference} · Created {fmt(selected.created_at)}</p>
          <dl className="info"><dt>Description</dt><dd>{selected.description||'—'}</dd><dt>Department</dt><dd>{selected.department||'—'}</dd><dt>Location</dt><dd>{selected.location||'—'}</dd><dt>Schedule</dt><dd>{fmt(selected.starts_at)} → {fmt(selected.ends_at)}</dd><dt>Participants</dt><dd>{selected.participant_count}</dd><dt>Equipment</dt><dd>{selected.equipment||'None specified'}</dd><dt>School bus</dt><dd>{selected.bus_required?'Yes · '+selected.bus_passengers+' passengers':'No'}</dd>{selected.bus_required&&<><dt>Transport notes</dt><dd>{selected.transport_notes||'—'}</dd></>}<dt>Other notes</dt><dd>{selected.notes||'—'}</dd><dt>Resources</dt><dd>{friendlyStatus(selected.resource_status)} — {selected.resource_notes||'No notes'}</dd></dl>
          {selected.created_by===user.id&&['draft','changes_requested'].includes(selected.status)&&<button className="primary full" disabled={busy} onClick={()=>startForm(selected)}>Edit request</button>}
          {selected.created_by===user.id&&['draft','changes_requested'].includes(selected.status)&&<button className="secondary full" disabled={busy} onClick={()=>void move('submit')}>Submit for approval</button>}
          {selected.created_by===user.id&&['draft','pending','changes_requested','approved'].includes(selected.status)&&<button className="danger-ghost full" disabled={busy} onClick={()=>void move('cancel')}>Cancel request</button>}
          {selected.status==='pending'&&hasReviewer&&<section className="panel"><h3>Approval decision</h3><label>Reason (required for rejection or changes)<textarea rows={2} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="actions"><button disabled={busy} className="primary" onClick={()=>void move('approve')}><Check size={15}/> Approve</button><button disabled={busy||reason.trim().length<3} className="secondary" onClick={()=>void move('changes')}>Request changes</button><button disabled={busy||reason.trim().length<3} className="danger-ghost" onClick={()=>void move('reject')}>Reject</button></div></section>}
          {isAdmin&&<section className="panel"><h3>Admin coordination</h3>{['draft','pending','changes_requested'].includes(selected.status)&&<><label>Assign approver<select value={reviewer} onChange={e=>setReviewer(e.target.value)}><option value="">Choose reviewer</option>{people.filter(p=>p.id!==selected.created_by&&userRoles.some(r=>r.user_id===p.id&&(r.role==='approver'||r.role==='admin'))).map(p=><option key={p.id} value={p.id}>{p.display_name||p.email} ({p.email})</option>)}</select></label><button className="secondary" disabled={busy||!reviewer} onClick={()=>void assign()}>Assign reviewer</button></>}
            <label>Equipment / transport status<select value={resourceState} onChange={e=>setResourceState(e.target.value)}><option value="pending">Pending</option><option value="arranged">Arranged</option><option value="not_required">Not required</option></select></label>
            <label>Coordination notes<textarea rows={2} value={resourceNote} onChange={e=>setResourceNote(e.target.value)}/></label><button className="secondary" disabled={busy} onClick={()=>void coordinate()}>Save coordination</button>
            {selected.status==='approved'&&<button className="primary full" onClick={()=>void move('schedule')}>Mark scheduled</button>}
            {selected.status==='scheduled'&&<button className="primary full" onClick={()=>void move('start')}>Mark in progress</button>}
            {selected.status==='in_progress'&&<><button className="primary full" disabled={!documents.some(d=>d.evidence_kind==='completion')} onClick={()=>void move('complete')}>Mark completed</button>{!documents.some(d=>d.evidence_kind==='completion')&&<small>Upload completion evidence below before marking this activity completed.</small>}</>}
            {!['completed','rejected','cancelled'].includes(selected.status)&&<><label>Administrative cancellation reason<textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="danger-ghost" disabled={busy||reason.trim().length<3} onClick={()=>void move('admin_cancel')}>Admin cancel</button></>}
          </section>}
          {['approved','scheduled','in_progress','completed'].includes(selected.status)&&selected.starts_at&&selected.ends_at&&<button className="secondary full" onClick={()=>{try{calendarDraft(selected.title+' ('+selected.reference+')',selected.starts_at!,selected.ends_at!,selected.location,selected.description);}catch(e){setError(errorText(e));}}}><CalendarPlus size={16}/> Draft Outlook calendar event</button>}
          {mail&&<section className="panel"><h3>Current email actions</h3><div className="actions"><button className="secondary" disabled={!mail.id||busy} onClick={()=>void linkEmail()}><Link2 size={15}/> Link email</button><button className="secondary" onClick={()=>replyWith('status')}><Mail size={15}/> Draft reply</button><button className="secondary" onClick={()=>replyWith('document')}><Mail size={15}/> Request documents reply</button></div>{mail.attachments.length>0&&<><h4>Import from email</h4>{mail.attachments.map(x=><div key={x.id} className="row-item"><span className="ellipsis">{x.name}</span><button disabled={busy} onClick={()=>void (async()=>{try{const file=await readAttachment(x.id,x.name);await uploadFiles([file]);}catch(e){setError(errorText(e));}})()}>Import</button></div>)}</>}</section>}
          <section className="panel"><h3><Paperclip size={16}/> Documents</h3><label className="upload"><Upload size={15}/> Upload files<input aria-label="Upload supporting documents" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx" disabled={busy} onChange={e=>{if(e.target.files?.length)void uploadFiles(e.target.files);e.target.value='';}}/></label><small>Private files · 10 MB each · PDF, images, Office files, text</small>{selected.status==='in_progress'&&(selected.created_by===user.id||isAdmin)&&<label className="upload"><Upload size={15}/> Upload completion evidence<input aria-label="Upload completion evidence" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx" disabled={busy} onChange={e=>{if(e.target.files?.length)void uploadFiles(e.target.files,'completion');e.target.value='';}}/></label>}{uploaded&&<small>Most recent upload recorded.</small>}{documents.map(d=><div key={d.id} className="row-item"><span className="ellipsis">{d.evidence_kind==='completion'?'[Completion evidence] ':''}{d.file_name}</span><button onClick={()=>void download(d)}>Open</button></div>)}
            {docRequests.filter(d=>!d.resolved_at).map(d=><div className="request-note" key={d.id}><strong>Document requested:</strong> {d.prompt}{hasReviewer&&<button className="text-btn" onClick={()=>void execute(async()=>{const {error:e}=await supabase.rpc('resolve_document_request',{doc_id:d.id});if(e)throw e;},'Marked received')}>Mark received</button>}</div>)}
            {hasReviewer&&<><label>Request additional document<textarea rows={2} value={requestedDocument} onChange={e=>setRequestedDocument(e.target.value)}/></label><button className="secondary" disabled={busy||!requestedDocument.trim()} onClick={()=>void requestMoreDocuments()}><FilePlus2 size={15}/> Send document request</button></>}
          </section>
          <section className="panel"><h3>Comments & notes</h3>{comments.map(c=><div key={c.id} className="comment"><small>{fmt(c.created_at)} {c.internal?'· Internal':''}</small><p>{c.body}</p></div>)}<label>Add a comment<textarea rows={2} value={comment} onChange={e=>setComment(e.target.value)}/></label>{hasReviewer&&<label className="checkbox"><input type="checkbox" checked={internal} onChange={e=>setInternal(e.target.checked)}/> Internal note (not visible to requestor)</label>}<button disabled={busy||!comment.trim()} className="secondary" onClick={()=>void commentOnRequest()}>Post comment</button></section>
          <section className="panel"><h3>Request history</h3>{events.map(e=><div key={e.id} className="event"><span>{friendlyStatus(e.event)}</span><small>{fmt(e.created_at)}</small>{e.detail&&<p>{e.detail}</p>}</div>)}<h4>Linked emails</h4>{links.length?links.map((l,i)=><p className="muted" key={i}>{l.subject}</p>):<p className="muted">No emails linked yet.</p>}</section>
        </section>:
      page==='notifications'?
        <NotificationsPanel items={notifications} busy={busy} onOpen={openNotification} onMarkRead={n=>void markNotificationRead(n)}/>:
        <section>
          <div className="titleline"><div><h2>{page==='approvals'?'Pending approvals':page==='all'?'All requests':'My requests'}</h2><p className="muted">{visible.length} request(s) visible</p></div><button className="primary compact" onClick={()=>startForm()}><Plus size={16}/> New</button></div>
          {page==='approvals'&&pending.length===0&&<p className="empty">No requests awaiting your approval.</p>}
          <div className="request-filters">
            <label className="search-field"><Search size={15}/><input aria-label="Search community service requests" placeholder="Search title, reference or location" value={search} onChange={e=>setSearch(e.target.value)}/></label>
            <select aria-label="Filter request status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>{['draft','pending','changes_requested','approved','rejected','scheduled','in_progress','completed','cancelled'].map(x=><option key={x} value={x}>{friendlyStatus(x)}</option>)}
            </select>
            {isAdmin&&page==='all'&&<button className="secondary compact" onClick={exportVisibleCsv}><Download size={14}/> Export visible CSV</button>}
          </div>
          <div className="request-list">{visible.map(r=><button className="request-card" key={r.id} onClick={()=>{setSelectedId(r.id);setReviewer(r.approver_id||'');setResourceState(r.resource_status);setResourceNote(r.resource_notes);}}>
            <div><strong>{r.title}</strong><small>{r.reference} · {fmt(r.created_at)}</small></div><span className={'status status-'+r.status}>{friendlyStatus(r.status)}</span>
          </button>)}</div>
          {!visible.length&&page!=='approvals'&&<p className="empty">No requests yet. Create a community service request to get started.</p>}
          {isAdmin&&page==='all'&&<section className="panel"><h3><Users size={16}/> Manage roles</h3><label>User<select value={roleTarget} onChange={e=>setRoleTarget(e.target.value)}><option value="">Select user</option>{people.map(p=><option value={p.id} key={p.id}>{p.email}</option>)}</select></label><label>Role<select value={roleToGrant} onChange={e=>setRoleToGrant(e.target.value as Role)}><option value="approver">Approver</option><option value="admin">Admin</option><option value="requestor">Requestor</option></select></label><button className="secondary" disabled={busy||!roleTarget} onClick={()=>void assignRole()}>Add role</button>{people.filter(p=>userRoles.some(r=>r.user_id===p.id)).map(p=><div key={p.id} className="row-item"><span className="ellipsis">{p.email}<small>{userRoles.filter(r=>r.user_id===p.id).map(r=>r.role).join(', ')}</small></span>{userRoles.filter(r=>r.user_id===p.id&&r.role!=='requestor').map(r=><button key={r.role} className="text-btn" onClick={()=>void removeRole(p.id,r.role)}>Remove {r.role}</button>)}</div>)}</section>}
        </section>}
      <footer><small>{inOutlook()?'Outlook add-in':'CSWI portal'} · Request access is controlled by Supabase RLS.</small></footer>
    </div>
  </div>;
}
