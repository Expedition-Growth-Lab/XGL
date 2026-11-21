import { createBrowserClient } from './supabase';
import { activeProgramEnrollments, loadPortalContext } from './portal';

const supabase = createBrowserClient();
const state: any = { context: null, orgId: '', view: 'overview', data: {}, isStaff: false };
const $ = (selector: string) => document.querySelector(selector) as HTMLElement | null;
const $$ = (selector: string) => [...document.querySelectorAll(selector)] as HTMLElement[];
const view = $('#view')!;
const notice = $('#notice')!;
const dialog = $('#portal-dialog') as HTMLDialogElement;
const form = $('#entity-form') as HTMLFormElement;
const fields = $('#form-fields')!;
let pendingEntity = '';

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character] as string));
const titleCase = (value = '') => String(value).replaceAll('_',' ').replace(/\b\w/g, (character) => character.toUpperCase());
const dateLabel = (value?: string) => value ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(value)) : 'No date';
const relativeDate = (value?: string) => {
  if (!value) return 'No due date';
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
  return days === 0 ? 'Due today' : days > 0 ? `Due in ${days} day${days === 1 ? '' : 's'}` : `${Math.abs(days)} day${days === -1 ? '' : 's'} overdue`;
};
const chip = (value: string, tone = '') => `<span class="portal-status-chip ${tone}">${escapeHtml(titleCase(value))}</span>`;
const empty = (title: string, copy: string, action = '') => `<div class="portal-empty"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p>${action}</div>`;
const projectName = (id?: string) => state.data.projects.find((item: any) => item.id === id)?.name ?? 'General workspace';
const documentName = (id: string) => state.data.documents.find((item: any) => item.id === id)?.title ?? 'Document';

function setNotice(message: string, isError = false) {
  notice.textContent = message;
  notice.classList.remove('portal-hidden','error');
  if (isError) notice.classList.add('error');
  window.setTimeout(() => notice.classList.add('portal-hidden'), 5000);
}

async function loadData() {
  const org = state.orgId;
  const queries: Record<string, any> = {
    projects: supabase.from('portal_projects').select('*').eq('organization_id',org).order('updated_at',{ascending:false}),
    workItems: supabase.from('portal_work_items').select('*').eq('organization_id',org).order('due_at',{ascending:true,nullsFirst:false}),
    decisions: supabase.from('portal_decisions').select('*').eq('organization_id',org).order('created_at',{ascending:false}),
    documents: supabase.from('portal_documents').select('*').eq('organization_id',org).order('updated_at',{ascending:false}),
    versions: supabase.from('portal_document_versions').select('*').eq('organization_id',org).order('version_number',{ascending:false}),
    deliverables: supabase.from('portal_deliverables').select('*').eq('organization_id',org).order('created_at',{ascending:false}),
    approvals: supabase.from('portal_approval_requests').select('*').eq('organization_id',org).order('requested_at',{ascending:false}),
    members: supabase.from('portal_organization_users').select('*').eq('organization_id',org).order('created_at'),
    invitations: supabase.from('portal_user_invitations').select('*').eq('organization_id',org).order('created_at',{ascending:false}),
    activity: supabase.from('portal_activity').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(80)
  };
  const entries = Object.entries(queries);
  const results = await Promise.all(entries.map(([,query]) => query));
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  state.data = Object.fromEntries(entries.map(([key], index) => [key, results[index].data ?? []]));
}

function renderOverview() {
  const actions = state.data.workItems.filter((item: any) => item.item_type === 'action' && !['complete','cancelled'].includes(item.status));
  const approvals = state.data.approvals.filter((item: any) => item.status === 'pending');
  const decisions = state.data.decisions.filter((item: any) => item.status === 'open');
  const deliverables = state.data.deliverables.filter((item: any) => !['delivered','archived'].includes(item.status));
  const attention = [
    ...actions.map((item: any) => ({...item,kind:'Action',label:item.title,detail:relativeDate(item.due_at)})),
    ...approvals.map((item: any) => ({...item,kind:'Approval',label:item.title,detail:relativeDate(item.due_at)})),
    ...decisions.map((item: any) => ({...item,kind:'Decision',label:item.title,detail:relativeDate(item.needed_by)}))
  ].slice(0,8);
  view.innerHTML = `<div class="portal-metric-grid">
    <article><span>Open actions</span><strong>${actions.length}</strong><button data-jump="actions">Review queue →</button></article>
    <article><span>Waiting decisions</span><strong>${decisions.length}</strong><button data-jump="decisions">Open register →</button></article>
    <article><span>Pending approvals</span><strong>${approvals.length}</strong><button data-jump="approvals">Review versions →</button></article>
    <article><span>Active deliverables</span><strong>${deliverables.length}</strong><button data-jump="deliverables">See delivery board →</button></article>
  </div>
  <div class="portal-content-grid"><section class="portal-panel"><div class="portal-panel-head"><div><div class="portal-eyebrow">Action center</div><h2>What needs attention</h2></div><button class="portal-text-button" data-new="action">Add action</button></div>
  ${attention.length ? `<div class="portal-record-list">${attention.map((item: any) => `<article class="portal-record"><div><span class="portal-record-kind">${item.kind}</span><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(projectName(item.project_id))}</p></div><div>${chip(item.status,item.status==='pending'?'gold':'')}<small>${escapeHtml(item.detail)}</small></div></article>`).join('')}</div>` : empty('The trail is clear','No open actions, decisions, or approvals need attention.')}</section>
  <aside class="portal-panel portal-panel-dark"><div class="portal-eyebrow">Recent movement</div><h2>Activity</h2>${state.data.activity.length ? `<ol class="portal-timeline">${state.data.activity.slice(0,8).map((item: any)=>`<li><span>${escapeHtml(item.summary)}</span><small>${dateLabel(item.created_at)}</small></li>`).join('')}</ol>` : '<p>No workspace activity has been recorded yet.</p>'}</aside></div>`;
}

function renderProjects() {
  view.innerHTML = `<div class="portal-view-head"><div><div class="portal-eyebrow">Portfolio</div><h2>Projects</h2><p>Scope, status, health, and the work connected to each engagement.</p></div><button class="portal-button primary" data-new="project">New project</button></div>
  ${state.data.projects.length ? `<div class="portal-card-grid">${state.data.projects.map((item: any)=>`<article class="portal-work-card"><div class="portal-card-top">${chip(item.status)}${chip(item.health,item.health==='at_risk'?'red':item.health==='attention'?'gold':'')}</div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description ?? 'No project description yet.')}</p><footer><span>${state.data.workItems.filter((work: any)=>work.project_id===item.id && !['complete','cancelled'].includes(work.status)).length} open items</span><span>${item.target_date ? `Target ${dateLabel(item.target_date)}` : 'No target date'}</span></footer></article>`).join('')}</div>` : empty('No projects yet','Create the first project to connect actions, decisions, documents, and approvals.','<button class="portal-button primary" data-new="project">Create project</button>')}`;
}

function renderActions() {
  view.innerHTML = `<div class="portal-view-head"><div><div class="portal-eyebrow">Execution</div><h2>Actions & milestones</h2><p>Visible ownership and next steps without a maze of status meetings.</p></div><button class="portal-button primary" data-new="action">New action</button></div>
  ${state.data.workItems.length ? `<div class="portal-table"><div class="portal-table-row head"><span>Work</span><span>Project</span><span>Priority</span><span>Due</span><span>Status</span></div>${state.data.workItems.map((item: any)=>`<article class="portal-table-row"><div><small>${titleCase(item.item_type)}</small><strong>${escapeHtml(item.title)}</strong></div><span>${escapeHtml(projectName(item.project_id))}</span><span>${chip(item.priority,item.priority==='urgent'?'red':item.priority==='high'?'gold':'')}</span><span>${escapeHtml(relativeDate(item.due_at))}</span><label><span class="sr-only">Status</span><select class="portal-mini-select" data-status-id="${item.id}">${['open','in_progress','blocked','complete','cancelled'].map((status)=>`<option value="${status}" ${status===item.status?'selected':''}>${titleCase(status)}</option>`).join('')}</select></label></article>`).join('')}</div>` : empty('No actions or milestones','Add the next concrete step.','<button class="portal-button primary" data-new="action">Add action</button>')}`;
}

function renderDecisions() {
  view.innerHTML = `<div class="portal-view-head"><div><div class="portal-eyebrow">Decision register</div><h2>Decisions</h2><p>Record what was decided, why, and what is still waiting.</p></div><button class="portal-button primary" data-new="decision">New decision</button></div>${state.data.decisions.length ? `<div class="portal-record-list">${state.data.decisions.map((item: any)=>`<article class="portal-record expanded"><div>${chip(item.status,item.status==='open'?'gold':'')}<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.context ?? 'No context recorded.')}</p>${item.decision?`<blockquote>${escapeHtml(item.decision)}</blockquote>`:''}</div><div><small>${escapeHtml(projectName(item.project_id))}</small><small>${escapeHtml(relativeDate(item.needed_by))}</small></div></article>`).join('')}</div>` : empty('No decisions recorded','Capture a decision request or a decision already made.','<button class="portal-button primary" data-new="decision">Add decision</button>')}`;
}

function renderDocuments() {
  view.innerHTML = `<div class="portal-view-head"><div><div class="portal-eyebrow">Private files</div><h2>Documents</h2><p>Versioned files in private storage. Downloads use short-lived signed links.</p></div><button class="portal-button primary" data-new="document">Upload document</button></div>${state.data.documents.length ? `<div class="portal-record-list">${state.data.documents.map((item: any)=>{const version=state.data.versions.find((candidate: any)=>candidate.document_id===item.id && candidate.version_number===item.current_version);return `<article class="portal-record expanded"><div>${chip(item.category)}<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description??'')}</p></div><div><small>Version ${item.current_version}</small>${version?`<button class="portal-text-button" data-download="${version.id}">Download</button><button class="portal-text-button" data-version-document="${item.id}">Add version</button>`:'<small>Awaiting first file</small>'}</div></article>`}).join('')}</div>` : empty('No documents yet','Upload a PDF or Word document to begin the private version history.','<button class="portal-button primary" data-new="document">Upload document</button>')}`;
}

function renderDeliverables() {
  view.innerHTML = `<div class="portal-view-head"><div><div class="portal-eyebrow">Delivery board</div><h2>Deliverables</h2><p>The work being prepared, reviewed, approved, and delivered.</p></div><button class="portal-button primary" data-new="deliverable">New deliverable</button></div>${state.data.deliverables.length ? `<div class="portal-card-grid">${state.data.deliverables.map((item: any)=>`<article class="portal-work-card"><div class="portal-card-top">${chip(item.status,item.status==='revision_requested'?'red':item.status==='in_review'?'gold':'')}</div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description??'No description recorded.')}</p><footer><span>${escapeHtml(projectName(item.project_id))}</span><span>${escapeHtml(relativeDate(item.due_at))}</span></footer></article>`).join('')}</div>` : empty('No deliverables yet','Add a deliverable when work is ready to track toward review and delivery.','<button class="portal-button primary" data-new="deliverable">Add deliverable</button>')}`;
}

function renderApprovals() {
  view.innerHTML = `<div class="portal-view-head"><div><div class="portal-eyebrow">Exact-version review</div><h2>Approvals</h2><p>Every request is bound to one immutable document version.</p></div><button class="portal-button primary" data-new="approval" ${state.data.versions.length?'':'disabled'}>Request approval</button></div>${state.data.approvals.length ? `<div class="portal-record-list">${state.data.approvals.map((item: any)=>{const version=state.data.versions.find((candidate: any)=>candidate.id===item.document_version_id);return `<article class="portal-record expanded"><div>${chip(item.status,item.status==='pending'?'gold':item.status==='revision_requested'?'red':'')}<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.instructions??'')}</p></div><div><small>${escapeHtml(version?`${documentName(version.document_id)} · v${version.version_number}`:'Version unavailable')}</small>${item.status==='pending'?`<button class="portal-text-button" data-approval="${item.id}" data-decision="approved">Approve exact version</button><button class="portal-text-button danger" data-approval="${item.id}" data-decision="revision_requested">Request revision</button>`:''}</div></article>`}).join('')}</div>` : empty('No approval requests','Upload a document version first, then bind an approval request to that exact version.')}`;
}

function renderTeam() {
  view.innerHTML = `<div class="portal-view-head"><div><div class="portal-eyebrow">Access control</div><h2>Team & invitations</h2><p>Organization roles and invitation records. There is no public signup.</p></div><button class="portal-button primary" data-new="invite">Invite teammate</button></div><div class="portal-content-grid"><section class="portal-panel"><h3>Active members</h3>${state.data.members.length?`<div class="portal-record-list compact">${state.data.members.map((item: any)=>`<article class="portal-record"><div><strong>User ${escapeHtml(item.user_id.slice(0,8))}</strong><p>Joined ${dateLabel(item.joined_at??item.created_at)}</p></div><div>${chip(item.role)}${chip(item.status)}</div></article>`).join('')}</div>`:empty('No active members','Invite a teammate to begin the access process.')}</section><section class="portal-panel"><h3>Invitations</h3>${state.data.invitations.length?`<div class="portal-record-list compact">${state.data.invitations.map((item: any)=>`<article class="portal-record"><div><strong>${escapeHtml(item.email)}</strong><p>Expires ${dateLabel(item.expires_at)}</p></div><div>${chip(item.role)}${chip(item.status,item.status==='pending'?'gold':'')}</div></article>`).join('')}</div>`:empty('No invitations','Invitation records will appear here.')}</section></div>`;
}

function renderActivity() {
  view.innerHTML = `<div class="portal-view-head"><div><div class="portal-eyebrow">Audit trail</div><h2>Activity</h2><p>An append-oriented record of workspace changes.</p></div></div>${state.data.activity.length?`<ol class="portal-timeline large">${state.data.activity.map((item: any)=>`<li><span><strong>${escapeHtml(titleCase(item.action))}</strong> ${escapeHtml(item.summary)}</span><small>${new Date(item.created_at).toLocaleString()}</small></li>`).join('')}</ol>`:empty('No activity yet','Changes to workspace records will appear here automatically.')}`;
}

const renderers: Record<string,()=>void> = {overview:renderOverview,projects:renderProjects,actions:renderActions,decisions:renderDecisions,documents:renderDocuments,deliverables:renderDeliverables,approvals:renderApprovals,team:renderTeam,activity:renderActivity};
function render() { renderers[state.view](); bindViewEvents(); }
function setView(name: string) { state.view=name; $$('[data-view]').forEach((button) => button.classList.toggle('active',(button as HTMLElement).dataset.view===name)); render(); }

const projectOptions = () => `<option value="">General workspace</option>${state.data.projects.map((item: any)=>`<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}`;
const field = (label: string,name: string,type='text',extra='') => `<label><span>${label}</span><input name="${name}" type="${type}" ${extra}></label>`;
const textarea = (label: string,name: string) => `<label class="wide"><span>${label}</span><textarea name="${name}"></textarea></label>`;
const select = (label: string,name: string,options: string,extra='') => `<label><span>${label}</span><select name="${name}" ${extra}>${options}</select></label>`;

function openForm(entity: string, options: any = {}) {
  pendingEntity=entity;
  $('#dialog-title')!.textContent=({project:'New project',action:'New action or milestone',decision:'New decision',document:options.documentId?'Add document version':'Upload document',deliverable:'New deliverable',approval:'Request approval',invite:'Invite teammate'} as any)[entity];
  const forms: Record<string,string> = {
    project: field('Project name','name','text','required')+textarea('Description','description')+select('Status','status',['planned','active','blocked'].map((v)=>`<option value="${v}">${titleCase(v)}</option>`).join(''))+field('Target date','target_date','date'),
    action: select('Type','item_type','<option value="action">Action</option><option value="milestone">Milestone</option>')+field('Title','title','text','required')+select('Project','project_id',projectOptions())+select('Priority','priority',['normal','high','urgent','low'].map((v)=>`<option value="${v}">${titleCase(v)}</option>`).join(''))+field('Due','due_at','datetime-local')+textarea('Description','description'),
    decision: field('Decision title','title','text','required')+select('Project','project_id',projectOptions())+field('Needed by','needed_by','datetime-local')+textarea('Context','context'),
    document: `<input type="hidden" name="document_id" value="${options.documentId??''}">${options.documentId?'':field('Document title','title','text','required')+select('Project','project_id',projectOptions())+select('Category','category',['working','contract','strategy','creative','report','reference','other'].map((v)=>`<option value="${v}">${titleCase(v)}</option>`).join(''))+textarea('Description','description')}${field('PDF or Word file','file','file','accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required')}${textarea('Version note','version_note')}`,
    deliverable: field('Deliverable title','title','text','required')+select('Project','project_id',projectOptions())+field('Due','due_at','datetime-local')+textarea('Description','description'),
    approval: field('Request title','title','text','required')+select('Exact document version','document_version_id',state.data.versions.map((v: any)=>`<option value="${v.id}">${escapeHtml(documentName(v.document_id))} · v${v.version_number}</option>`).join(''),'required')+field('Due','due_at','datetime-local')+textarea('Review instructions','instructions'),
    invite: field('Email','email','email','required')+select('Role','role',['member','viewer','admin'].map((v)=>`<option value="${v}">${titleCase(v)}</option>`).join(''))
  };
  fields.innerHTML=forms[entity];
  dialog.showModal();
}

async function saveEntity(data: any) {
  const org=state.orgId;
  if (pendingEntity==='project') return supabase.from('portal_projects').insert({organization_id:org,name:data.name,description:data.description||null,status:data.status,target_date:data.target_date||null});
  if (pendingEntity==='action') return supabase.from('portal_work_items').insert({organization_id:org,project_id:data.project_id||null,item_type:data.item_type,title:data.title,description:data.description||null,priority:data.priority,due_at:data.due_at?new Date(data.due_at).toISOString():null});
  if (pendingEntity==='decision') return supabase.from('portal_decisions').insert({organization_id:org,project_id:data.project_id||null,title:data.title,context:data.context||null,needed_by:data.needed_by?new Date(data.needed_by).toISOString():null});
  if (pendingEntity==='deliverable') return supabase.from('portal_deliverables').insert({organization_id:org,project_id:data.project_id||null,title:data.title,description:data.description||null,due_at:data.due_at?new Date(data.due_at).toISOString():null});
  if (pendingEntity==='approval') return supabase.from('portal_approval_requests').insert({organization_id:org,title:data.title,instructions:data.instructions||null,document_version_id:data.document_version_id,due_at:data.due_at?new Date(data.due_at).toISOString():null});
  if (pendingEntity==='invite') return supabase.from('portal_user_invitations').insert({organization_id:org,email:String(data.email).trim().toLowerCase(),role:data.role});
  throw new Error('Unknown workspace record.');
}

async function uploadDocument(formData: FormData) {
  const org=state.orgId;
  const file=formData.get('file');
  if (!(file instanceof File)) throw new Error('Choose a file.');
  let documentId=String(formData.get('document_id')||'');
  let versionNumber=1;
  if (!documentId) {
    const {data,error}=await supabase.from('portal_documents').insert({organization_id:org,project_id:formData.get('project_id')||null,title:formData.get('title'),description:formData.get('description')||null,category:formData.get('category')}).select().single();
    if (error) throw error;
    documentId=data.id;
  } else {
    const document=state.data.documents.find((item: any)=>item.id===documentId);
    versionNumber=(document?.current_version??0)+1;
  }
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]+/g,'-');
  const storagePath=`xgl_client/${org}/${documentId}/${versionNumber}/${crypto.randomUUID()}-${safeName}`;
  const upload=await supabase.storage.from('portal-documents').upload(storagePath,file,{contentType:file.type,upsert:false});
  if(upload.error) throw upload.error;
  const version=await supabase.from('portal_document_versions').insert({organization_id:org,document_id:documentId,version_number:versionNumber,storage_path:storagePath,original_filename:file.name,mime_type:file.type||'application/octet-stream',size_bytes:file.size,version_note:formData.get('version_note')||null});
  if(version.error){await supabase.storage.from('portal-documents').remove([storagePath]);throw version.error;}
}

function bindViewEvents() {
  view.querySelectorAll<HTMLElement>('[data-new]').forEach((button)=>button.addEventListener('click',()=>openForm(button.dataset.new!)));
  view.querySelectorAll<HTMLElement>('[data-jump]').forEach((button)=>button.addEventListener('click',()=>setView(button.dataset.jump!)));
  view.querySelectorAll<HTMLElement>('[data-version-document]').forEach((button)=>button.addEventListener('click',()=>openForm('document',{documentId:button.dataset.versionDocument})));
  view.querySelectorAll<HTMLSelectElement>('[data-status-id]').forEach((selectElement)=>selectElement.addEventListener('change',async()=>{const {error}=await supabase.from('portal_work_items').update({status:selectElement.value,completed_at:selectElement.value==='complete'?new Date().toISOString():null}).eq('id',selectElement.dataset.statusId);if(error)setNotice(error.message,true);else{setNotice('Status updated.');await refresh();}}));
  view.querySelectorAll<HTMLElement>('[data-download]').forEach((button)=>button.addEventListener('click',async()=>{const version=state.data.versions.find((item: any)=>item.id===button.dataset.download);if(!version)return;const {data,error}=await supabase.storage.from('portal-documents').createSignedUrl(version.storage_path,60);if(error)setNotice(error.message,true);else window.location.assign(data.signedUrl);}));
  view.querySelectorAll<HTMLElement>('[data-approval]').forEach((button)=>button.addEventListener('click',async()=>{const note=button.dataset.decision==='revision_requested'?window.prompt('What needs revision?'):'Exact version approved in this workspace.';if(note===null)return;const {error}=await supabase.from('portal_approval_requests').update({status:button.dataset.decision,decision_note:note,decided_at:new Date().toISOString(),decided_by:state.context.user.id}).eq('id',button.dataset.approval);if(error)setNotice(error.message,true);else{setNotice('Approval decision recorded.');await refresh();}}));
}

async function refresh(){await loadData();render();}
$$('[data-view]').forEach((button)=>button.addEventListener('click',()=>setView(button.dataset.view!)));
$$('[data-new]').forEach((button)=>button.addEventListener('click',()=>openForm(button.dataset.new!)));
$('#organization-select')!.addEventListener('change',async(event)=>{state.orgId=(event.target as HTMLSelectElement).value;$('#organization-name')!.textContent=state.context.organizations.find((item: any)=>item.id===state.orgId)?.display_name??'Client workspace';await refresh();});
$('#sign-out')!.addEventListener('click',async()=>{await supabase.auth.signOut();window.location.replace('/portal/login');});
form.addEventListener('submit',async(event)=>{
  event.preventDefault();
  const submitter=(event as SubmitEvent).submitter as HTMLButtonElement;
  if(submitter?.value==='cancel'){dialog.close();return;}
  const save=$('#save-entity') as HTMLButtonElement; save.disabled=true;
  try {
    const formData=new FormData(form);
    if(pendingEntity==='document') await uploadDocument(formData);
    else {const payload=Object.fromEntries(formData.entries());const {error}=await saveEntity(payload);if(error)throw error;}
    dialog.close();form.reset();setNotice('Workspace updated.');await refresh();
  } catch(error: any) {setNotice(error.message??'Could not save this item.',true);} finally {save.disabled=false;}
});

async function boot() {
  try {
    state.context=await loadPortalContext(supabase);
    if(!state.context){window.location.replace('/portal/login?next=/client-portal');return;}
    const enrollments=activeProgramEnrollments(state.context,'xgl_client');
    $('#loading')!.classList.add('portal-hidden');
    if(!enrollments.length){$('#denied')!.classList.remove('portal-hidden');return;}
    const orgIds=[...new Set(enrollments.map((item: any)=>item.organization_id))] as string[];
    const selectElement=$('#organization-select') as HTMLSelectElement;
    for(const orgId of orgIds){const org=state.context.organizations.find((item: any)=>item.id===orgId);if(!org)continue;const option=document.createElement('option');option.value=org.id;option.textContent=org.display_name;selectElement.append(option);}
    state.orgId=orgIds[0];
    $('#organization-name')!.textContent=state.context.organizations.find((item: any)=>item.id===state.orgId)?.display_name??'Client workspace';
    const {data:role}=await supabase.rpc('current_xgl_role');
    state.isStaff=['owner','admin','editor'].includes(role);
    if(state.isStaff)$('#staff-admin-link')!.classList.remove('portal-hidden');
    await loadData();
    $('#workspace')!.classList.remove('portal-hidden');
    render();
  } catch(error) {
    console.error(error);
    $('#loading')!.classList.add('portal-hidden');
    $('#error')!.textContent='The client back office could not load. Please try again or contact XGL.';
    $('#error')!.classList.remove('portal-hidden');
  }
}

void boot();
