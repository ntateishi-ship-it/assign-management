// ========== DIAGNOSTIC ==========
console.log('[DIAG] app.js loaded');
window.onerror = function(msg, src, line, col, err) {
  var text = 'ERROR: ' + msg + '\nFILE: ' + src + '\nLINE: ' + line + ' COL: ' + col;
  if (err && err.stack) { text += '\nSTACK: ' + err.stack; }
  console.error(text);
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:red;color:#fff;padding:8px;font:12px monospace;z-index:9999;white-space:pre;overflow:auto;max-height:40vh;';
  d.textContent = text;
  document.body.appendChild(d);
};

// ========== CONSTANTS ==========
const DOMAINS = ['産業用マニピュレータ','産業用モバイルロボット','研究用マニピュレータ','研究用モバイルロボット','Webフロントエンド','Webバックエンド'];
const SKILLS = ['分散コンピューティング（ROSなど）','シーケンス制御','画像処理','3次元コンピュータビジョン','運動学','各種通信','機械設計','リアルタイム制御','統計学','Webデザイン','Webアーキテクチャ','電気回路','空圧回路'];
const LEVELS = ['G1','G2','G3','G4','G5'];

// ========== SUPABASE ==========
console.log('[DIAG] step1: before createClient');
const SUPABASE_URL = 'https://iazqnnpfvuklyzxrtqrl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhenFubnBmdnVrbHl6eHJ0cXJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTcxOTUsImV4cCI6MjA5MDA5MzE5NX0.pwhMORHwk8P70M3OfTEn2sra08EPBMAXDaIBkaiu8lc';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log('[DIAG] step2: createClient OK, sb=', typeof sb);

// ===== インメモリキャッシュ（render関数はここを参照する）=====
const cache = { projects: [], engineers: [], assigns: [] };

// ===== ローディング / エラー UI =====
function showLoading(msg = '保存中...') {
  const el = document.getElementById('loading-overlay');
  document.getElementById('loading-msg').textContent = msg;
  el.style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}
function showError(msg) {
  const el = document.getElementById('error-toast');
  el.textContent = '⚠ ' + msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 6000);
}

// ========== AUTH ==========
async function sha256(msg) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
function isAdmin() { return sessionStorage.getItem('kibitech_admin') === '1'; }
function updateAuthUI() {
  const admin = isAdmin();
  document.body.classList.toggle('is-admin', admin);
  const label = document.getElementById('auth-label');
  const btn   = document.getElementById('auth-btn');
  if (admin) {
    label.textContent = '🔓 管理者モード中';
    btn.textContent   = 'ログアウト';
    btn.classList.add('btn-header-logout');
  } else {
    label.textContent = '';
    btn.textContent   = '管理者ログイン';
    btn.classList.remove('btn-header-logout');
  }
}
function onAuthBtnClick() {
  if (isAdmin()) {
    if (confirm('ログアウトしますか？')) {
      sessionStorage.removeItem('kibitech_admin');
      updateAuthUI();
    }
  } else {
    document.getElementById('login-pw').value = '';
    document.getElementById('login-error').style.display = 'none';
    openModal('login-modal');
  }
}
async function doLogin() {
  const pw = document.getElementById('login-pw').value;
  if (!pw) return;
  const hash = await sha256(pw);
  const {data, error} = await sb.from('admins').select('id').eq('password_hash', hash).maybeSingle();
  if (error || !data) {
    const el = document.getElementById('login-error');
    el.textContent = 'パスワードが正しくありません';
    el.style.display = 'block';
    return;
  }
  sessionStorage.setItem('kibitech_admin', '1');
  closeModal('login-modal');
  updateAuthUI();
}
async function ensureDefaultAdmin() {
  const {data} = await sb.from('admins').select('id').limit(1);
  if (!data || data.length === 0) {
    const hash = await sha256('admin1234');
    await sb.from('admins').insert({password_hash: hash});
  }
}

// ===== フィールドマッピング =====
// engineers: { id, name, employment_type, hourly_rate, weekly_hours, skills(jsonb), notes }
//   skills jsonb 構造: { domains: {分野名: レベル}, main: {スキル名: レベル} }
//   weekly_hours = 稼働可能工数（整数）
function rowToEngineer(r) {
  const sk = r.skills || {};
  return {
    id: r.id,
    name: r.name || '',
    employmentType: r.employment_type || '',
    availableHours: r.weekly_hours || 0,
    hourlyRate: r.hourly_rate || '',
    domainSkills: sk.domains || {},
    mainSkills: sk.main || {},
    notes: r.notes || ''
  };
}
function engineerToRow(e) {
  return {
    name: e.name,
    employment_type: e.employmentType || '',
    weekly_hours: Number(e.availableHours) || 0,
    hourly_rate: e.hourlyRate ? Number(e.hourlyRate) : null,
    skills: { domains: e.domainSkills || {}, main: e.mainSkills || {} },
    notes: e.notes || ''
  };
}

// projects: { id, name, client, status, start_date, end_date, weekly_required_hours(jsonb), required_skills(jsonb), notes }
//   weekly_required_hours jsonb 構造: { "YYYY-MM-DD": 時間数 }
//   required_skills jsonb 構造: { domains: {分野名: レベル}, main: {スキル名: レベル} }
function rowToProject(r) {
  const rsk = r.required_skills || {};
  return {
    id: r.id,
    name: r.name || '',
    client: r.client || '',
    status: r.status || '',
    startDate: r.start_date || '',
    endDate: r.end_date || '',
    weeklyHours: r.weekly_required_hours || {},
    requiredDomains: rsk.domains || {},
    requiredSkills: rsk.main || {},
    notes: r.notes || ''
  };
}
function projectToRow(p) {
  return {
    name: p.name,
    client: p.client,
    status: p.status,
    start_date: p.startDate || null,
    end_date: p.endDate || null,
    weekly_required_hours: p.weeklyHours || {},
    required_skills: { domains: p.requiredDomains || {}, main: p.requiredSkills || {} },
    notes: p.notes || ''
  };
}

// assignments: { id, engineer_id, project_id, role, weekly_hours(jsonb) }
//   weekly_hours jsonb 構造: { "YYYY-MM-DD": 時間数 }
function rowToAssign(r) {
  return {
    id: r.id,
    projectId: r.project_id,
    engineerId: r.engineer_id,
    role: r.role || '',
    weeklyHours: r.weekly_hours || {}
  };
}
function assignToRow(a) {
  return {
    project_id: a.projectId,
    engineer_id: a.engineerId,
    role: a.role || '',
    weekly_hours: a.weeklyHours || {}
  };
}

// ========== DB ==========
const DB = {
  get: k => JSON.parse(localStorage.getItem('kibitech_' + k) || '[]'),
  set: (k, v) => localStorage.setItem('kibitech_' + k, JSON.stringify(v)),
  nextId: k => { const a = DB.get(k); return a.length ? Math.max(...a.map(x=>x.id)) + 1 : 1; }
};

// ========== DATE UTILS ==========
function getMonday(d) {
  let date;
  if (typeof d === 'string') { const [y,m,dy] = d.split('-').map(Number); date = new Date(y, m-1, dy); }
  else { date = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  const dow = date.getDay();
  date.setDate(date.getDate() + (dow === 0 ? -6 : 1 - dow));
  return date;
}
function toWeekKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function currentWeekKey() { return toWeekKey(getMonday(new Date())); }
function getWeeksBetween(s, e) {
  const weeks = [], end = (typeof e==='string') ? (()=>{const [y,m,d]=e.split('-').map(Number);return new Date(y,m-1,d);})() : e;
  let cur = getMonday(s);
  while (cur <= end) { weeks.push(toWeekKey(new Date(cur))); cur.setDate(cur.getDate()+7); }
  return weeks;
}
function getTimelineWeeks() {
  const weeks = []; let cur = getMonday(new Date());
  for (let i=0; i<14; i++) { weeks.push(toWeekKey(new Date(cur))); cur.setDate(cur.getDate()+7); }
  return weeks;
}
function formatWeekHdr(wk) { const [,m,d]=wk.split('-').map(Number); return `${m}/${d}`; }
function formatWeekLabel(wk) { const [,m,d]=wk.split('-').map(Number); return `${m}/${d}(月)`; }
function generateWeekOptions(selectedKey) {
  let cur = getMonday(new Date()); cur.setMonth(cur.getMonth()-3); cur=getMonday(cur);
  const end = new Date(); end.setMonth(end.getMonth()+18);
  let html = '<option value="">週を選択...</option>';
  while (cur <= end) {
    const k = toWeekKey(new Date(cur));
    html += `<option value="${k}" ${k===selectedKey?'selected':''}>${formatWeekLabel(k)}</option>`;
    cur.setDate(cur.getDate()+7);
  }
  return html;
}

// ========== MISC HELPERS ==========
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escJs(s) { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function statusBadge(s) {
  const m={'受注済み':'badge-juchu','受注見込み':'badge-mikomi','提案中':'badge-teian','失注':'badge-shisshu'};
  return `<span class="badge ${m[s]||''}">${esc(s)}</span>`;
}
function fmtDate(d) { return d ? d.replace(/-/g,'/') : '—'; }
function fmtNum(n, sfx='') { return (n===''||n==null) ? '—' : Number(n).toLocaleString()+sfx; }
function levelIndex(l) { return LEVELS.indexOf(l); }

// ========== SKILL DISPLAY ==========
function skillTagsHTML(domainSkills, mainSkills, legacySkills) {
  const tags = [];
  Object.entries(domainSkills||{}).forEach(([k,v])=>tags.push(`<span class="tag tag-domain">${esc(k)} <span class="tag-level">${v}</span></span>`));
  Object.entries(mainSkills||{}).forEach(([k,v])=>tags.push(`<span class="tag">${esc(k)} <span class="tag-level">${v}</span></span>`));
  if (!tags.length && legacySkills) (legacySkills||'').split(',').map(s=>s.trim()).filter(Boolean).forEach(s=>tags.push(`<span class="tag">${esc(s)}</span>`));
  return tags.length ? tags.join('') : '<span class="text-muted">スキル未登録</span>';
}
function reqSkillTagsHTML(reqDomains, reqSkills) {
  const tags=[];
  Object.entries(reqDomains||{}).forEach(([k,v])=>tags.push(`<span class="tag tag-domain">${esc(k)} <span class="tag-level">${v}以上</span></span>`));
  Object.entries(reqSkills||{}).forEach(([k,v])=>tags.push(`<span class="tag">${esc(k)} <span class="tag-level">${v}以上</span></span>`));
  return tags.length ? tags.join('') : '<span class="text-muted">スキル条件なし</span>';
}

// ========== WORKLOAD HELPERS ==========
function getAssignWeekHours(assign, wk) {
  if (assign.weeklyHours) return Number(assign.weeklyHours[wk] || 0);
  return Number(assign.hours || 0);
}
function getProjectWeekRequired(project, wk) {
  if (project.weeklyHours && project.weeklyHours[wk] !== undefined) return Number(project.weeklyHours[wk]);
  if (project.startDate && project.endDate && project.requiredHours) {
    const sm = toWeekKey(getMonday(project.startDate));
    if (wk >= sm && wk <= project.endDate) return Number(project.requiredHours);
  }
  return 0;
}
function getProjectWeekAssigned(pid, wk, assigns) {
  return assigns.filter(a=>a.projectId===pid).reduce((s,a)=>s+getAssignWeekHours(a,wk),0);
}
function getEngineerWeekAssigned(eid, wk, assigns) {
  return assigns.filter(a=>a.engineerId===eid).reduce((s,a)=>s+getAssignWeekHours(a,wk),0);
}
function progressClass(assigned, required) {
  if (!required) return 'progress-ok';
  const r=assigned/required;
  return r>=1?'progress-ok':r>=0.7?'progress-warn':'progress-over';
}
function workloadClass(assigned, available) {
  if (assigned>available) return 'progress-over';
  if (assigned>=available*0.9) return 'progress-warn';
  return 'progress-ok';
}
function summarizeWeekHours(weeklyHours) {
  const vals = Object.values(weeklyHours||{});
  if (!vals.length) return '—';
  const mn=Math.min(...vals), mx=Math.max(...vals);
  return mn===mx ? `${mn}h/週` : `${mn}〜${mx}h/週`;
}
function assignWeekRange(weeklyHours) {
  const keys = Object.keys(weeklyHours||{}).sort();
  if (!keys.length) return '—';
  return keys.length===1 ? formatWeekLabel(keys[0]) : `${formatWeekHdr(keys[0])} 〜 ${formatWeekHdr(keys[keys.length-1])}`;
}

// ========== MIGRATION ==========
function migrateData() {
  const projects = DB.get('projects');
  let pc=false;
  projects.forEach(p => {
    if (!p.weeklyHours) {
      if (p.startDate && p.endDate && p.requiredHours) {
        p.weeklyHours = {};
        getWeeksBetween(p.startDate, p.endDate).forEach(w=>{ p.weeklyHours[w]=Number(p.requiredHours); });
      } else { p.weeklyHours={}; }
      pc=true;
    }
    if (!p.requiredDomains) { p.requiredDomains={}; pc=true; }
    if (!p.requiredSkills) { p.requiredSkills={}; pc=true; }
  });
  if (pc) DB.set('projects', projects);

  const assigns = DB.get('assigns');
  let ac=false;
  assigns.forEach(a => {
    if (!a.weeklyHours) {
      const proj = projects.find(p=>p.id===a.projectId);
      a.weeklyHours={};
      if (proj && proj.startDate && proj.endDate && a.hours) {
        getWeeksBetween(proj.startDate, proj.endDate).forEach(w=>{ a.weeklyHours[w]=Number(a.hours); });
      } else if (a.hours) {
        a.weeklyHours[currentWeekKey()]=Number(a.hours);
      }
      ac=true;
    }
  });
  if (ac) DB.set('assigns', assigns);

  const engineers = DB.get('engineers');
  let ec=false;
  engineers.forEach(e => {
    if (!e.domainSkills) { e.domainSkills={}; ec=true; }
    if (!e.mainSkills) { e.mainSkills={}; ec=true; }
  });
  if (ec) DB.set('engineers', engineers);
}

// ========== TAB ==========
function switchTab(tab) {
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-'+tab).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  if (tab==='dashboard') renderDashboard();
  if (tab==='projects') renderProjects();
  if (tab==='engineers') renderEngineers();
  if (tab==='assigns') renderAssigns();
  if (tab==='timeline') renderTimeline();
}

// ========== MODALS ==========
let editingProjectId=null, editingEngineerId=null, editingAssignId=null;
let qaProjectId=null, qaEngineerId=null;

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  editingProjectId=editingEngineerId=editingAssignId=null;
}
document.querySelectorAll('.modal-overlay').forEach(o=>{
  o.addEventListener('click', e=>{ if(e.target===o) o.classList.remove('open'); });
});

// ========== SKILL UI ==========
function buildSkillRows(containerId, items, selectedMap, levelSuffix) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = items.map(skill => {
    const lv = selectedMap && selectedMap[skill] ? selectedMap[skill] : '';
    const chk = !!lv;
    const opts = LEVELS.map(l=>`<option value="${l}" ${l===lv?'selected':''}>${l}${levelSuffix||''}</option>`).join('');
    return `<div class="skill-row">
      <label class="skill-check">
        <input type="checkbox" class="skill-cb" data-skill="${esc(skill)}" ${chk?'checked':''} onchange="onSkillCb(this)">
        <span>${esc(skill)}</span>
      </label>
      <select class="skill-level" style="visibility:${chk?'visible':'hidden'}">${opts}</select>
    </div>`;
  }).join('');
}
function onSkillCb(cb) {
  cb.closest('.skill-row').querySelector('.skill-level').style.visibility = cb.checked ? 'visible' : 'hidden';
}
function collectSkills(containerId) {
  const map={};
  document.querySelectorAll(`#${containerId} .skill-row`).forEach(row=>{
    const cb=row.querySelector('.skill-cb'), sel=row.querySelector('.skill-level');
    if (cb && cb.checked) map[cb.dataset.skill]=sel?sel.value:'G1';
  });
  return map;
}

// ========== PROJECT WEEK TABLE ==========
function updateProjectWeekTable() {
  const s=document.getElementById('p-start').value, e=document.getElementById('p-end').value;
  const c=document.getElementById('p-week-container');
  if (!s||!e||s>e) {
    c.innerHTML='<div class="text-muted text-sm" style="padding:8px">開始日と終了予定日を入力すると週次工数を設定できます</div>';
    return;
  }
  const weeks=getWeeksBetween(s,e);
  if (!weeks.length) { c.innerHTML='<div class="text-muted text-sm" style="padding:8px">対象週がありません</div>'; return; }
  const existMap = collectProjectWeekHours();
  c.innerHTML=`<div class="week-bulk-row">
    <input type="number" id="p-bulk-h" min="0" placeholder="一括工数（h/週）">
    <button class="btn btn-secondary btn-sm" onclick="setAllProjectWeekHours()">全週に設定</button>
  </div>
  <div class="week-table-container"><div class="week-rows" id="p-week-rows">
    ${weeks.map(w=>`<div class="week-row">
      <span class="week-label">${formatWeekLabel(w)}</span>
      <div class="week-input-wrap">
        <input type="number" class="week-input" data-week="${w}" min="0" value="${existMap[w]!==undefined?existMap[w]:''}" placeholder="0">
        <span class="week-unit">h/週</span>
      </div>
    </div>`).join('')}
  </div></div>`;
}
function setAllProjectWeekHours() {
  const v=document.getElementById('p-bulk-h').value;
  if (!v) return;
  document.querySelectorAll('#p-week-rows .week-input').forEach(i=>{ i.value=v; });
}
function collectProjectWeekHours() {
  const m={};
  document.querySelectorAll('#p-week-rows .week-input').forEach(i=>{ if(i.value!=='') m[i.dataset.week]=Number(i.value); });
  return m;
}

// ========== DASHBOARD ==========
function renderDashboard() {
  const projects=cache.projects, engineers=cache.engineers, assigns=cache.assigns;
  const wk=currentWeekKey();
  const juchu=projects.filter(p=>p.status==='受注済み');
  const mikomi=projects.filter(p=>p.status==='受注見込み');
  const totalAvail=engineers.reduce((s,e)=>s+Number(e.availableHours||0),0);
  const totalAssigned=engineers.reduce((s,e)=>s+getEngineerWeekAssigned(e.id,wk,assigns),0);

  document.getElementById('dash-kpi').innerHTML=`
    <div class="kpi-card kpi-card-blue"><div class="kpi-label">受注済み案件</div><div class="kpi-value">${juchu.length}<span class="kpi-unit">件</span></div><div class="kpi-sub">今週必要: ${juchu.reduce((s,p)=>s+getProjectWeekRequired(p,wk),0)}h</div></div>
    <div class="kpi-card kpi-card-green"><div class="kpi-label">受注見込み案件</div><div class="kpi-value">${mikomi.length}<span class="kpi-unit">件</span></div><div class="kpi-sub">今週必要: ${mikomi.reduce((s,p)=>s+getProjectWeekRequired(p,wk),0)}h</div></div>
    <div class="kpi-card kpi-card-yellow"><div class="kpi-label">エンジニア稼働可能（今週）</div><div class="kpi-value">${totalAvail}<span class="kpi-unit">h/週</span></div><div class="kpi-sub">アサイン済み: ${totalAssigned}h</div></div>
    <div class="kpi-card kpi-card-red"><div class="kpi-label">空き工数（今週）</div><div class="kpi-value">${Math.max(0,totalAvail-totalAssigned)}<span class="kpi-unit">h</span></div><div class="kpi-sub">稼働率: ${totalAvail>0?Math.round(totalAssigned/totalAvail*100):0}%</div></div>
  `;

  // 今週の工数不足案件
  const active=projects.filter(p=>p.status==='受注済み'||p.status==='受注見込み');
  const shortage=active.map(p=>({...p,req:getProjectWeekRequired(p,wk),asgn:getProjectWeekAssigned(p.id,wk,assigns)}))
    .filter(p=>p.req>0&&p.asgn<p.req).sort((a,b)=>(b.req-b.asgn)-(a.req-a.asgn));
  const alertsEl=document.getElementById('dash-alerts');
  if (!shortage.length) alertsEl.innerHTML=`<div class="alert alert-success">✓ 今週は全案件の工数が充足しています</div>`;
  else alertsEl.innerHTML=shortage.map(p=>`<div class="alert-item">
    <div class="alert-item-info"><div class="alert-item-name">${esc(p.name)}</div><div class="alert-item-client">🏢 ${esc(p.client)} ${statusBadge(p.status)}</div></div>
    <div class="alert-item-hours">不足: ${p.req-p.asgn}h<br><span style="font-size:11px;font-weight:400;color:var(--gray-500)">${p.asgn}/${p.req}h</span></div>
  </div>`).join('');

  // 今週空きのあるエンジニア（稼働率80%未満）
  const avails=engineers.map(e=>{
    const avl=Number(e.availableHours||0), asgn=getEngineerWeekAssigned(e.id,wk,assigns);
    return {...e,avl,asgn,free:avl-asgn,rate:avl>0?Math.round(asgn/avl*100):0};
  }).filter(e=>e.avl>0&&e.asgn<e.avl*0.8).sort((a,b)=>b.free-a.free);
  const availEl=document.getElementById('dash-avail');
  if (!avails.length) availEl.innerHTML=`<div class="alert alert-warning">今週は稼働率80%未満のエンジニアはいません</div>`;
  else availEl.innerHTML=avails.map(e=>`<div class="avail-card">
    <div class="alert-item-info"><div class="alert-item-name">👤 ${esc(e.name)}</div><div class="alert-item-client">${esc(e.employmentType)} / 稼働可能 ${e.avl}h/週</div></div>
    <div style="text-align:right;font-size:12px"><span style="font-weight:700;color:var(--success)">空き ${e.free}h</span><br><span style="color:var(--gray-400)">${e.rate}%稼働</span></div>
  </div>`).join('');

  // エンジニア稼働サマリー
  const engWl=engineers.map(e=>{
    const avl=Number(e.availableHours||0), asgn=getEngineerWeekAssigned(e.id,wk,assigns);
    return {...e,avl,asgn,free:avl-asgn};
  }).sort((a,b)=>b.free-a.free);
  const wlEl=document.getElementById('dash-workload');
  if (!engWl.length) { wlEl.innerHTML='<div class="text-muted text-sm">エンジニアが登録されていません</div>'; return; }
  wlEl.innerHTML=engWl.map(e=>{
    const isOver=e.asgn>e.avl, ratio=e.avl>0?Math.min(e.asgn/e.avl,1.2):0;
    const barW=Math.min(ratio*100,100), wClass=workloadClass(e.asgn,e.avl), pct=e.avl>0?Math.round(e.asgn/e.avl*100):0;
    return `<div class="workload-card${isOver?' card-over':''}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div class="workload-card-name">👤 ${esc(e.name)}</div>
        ${isOver?`<span class="badge chip-ng" style="font-size:10px">⚠超過</span>`:`<span class="badge chip-ok" style="font-size:10px">${pct}%</span>`}
      </div>
      <div class="workload-card-sub">${esc(e.employmentType)} / ${e.avl}h/週</div>
      <div class="${wClass} progress-wrap">
        <div class="progress-bar-bg" style="height:6px"><div class="progress-bar-fill" style="width:${barW}%"></div></div>
        <span class="progress-label" style="min-width:55px">${e.asgn}/${e.avl}h</span>
      </div>
      <div style="margin-top:4px;font-size:11px;color:${e.free>0?'var(--success)':'var(--danger)'}">空き: ${Math.max(0,e.free)}h</div>
    </div>`;
  }).join('');
}

// ========== PROJECTS ==========
function openProjectModal(id=null) {
  editingProjectId=id;
  document.getElementById('project-modal-title').textContent=id?'案件編集':'案件登録';
  const p=id?cache.projects.find(x=>x.id===id):null;
  document.getElementById('p-name').value=p?.name||'';
  document.getElementById('p-client').value=p?.client||'';
  document.getElementById('p-status').value=p?.status||'受注済み';
  document.getElementById('p-start').value=p?.startDate||'';
  document.getElementById('p-end').value=p?.endDate||'';
  document.getElementById('p-notes').value=p?.notes||'';
  buildSkillRows('p-domain-skills', DOMAINS, p?.requiredDomains||{}, '以上');
  buildSkillRows('p-main-skills', SKILLS, p?.requiredSkills||{}, '以上');
  // Week table
  if (p?.startDate && p?.endDate) {
    // pre-load existing weeklyHours
    setTimeout(()=>{
      updateProjectWeekTable();
      if (p.weeklyHours) {
        document.querySelectorAll('#p-week-rows .week-input').forEach(inp=>{
          if (p.weeklyHours[inp.dataset.week]!==undefined) inp.value=p.weeklyHours[inp.dataset.week];
        });
      }
    }, 10);
  } else {
    document.getElementById('p-week-container').innerHTML='<div class="text-muted text-sm" style="padding:8px">開始日と終了予定日を入力すると週次工数を設定できます</div>';
  }
  openModal('project-modal');
}
async function saveProject() {
  const name=document.getElementById('p-name').value.trim();
  const client=document.getElementById('p-client').value.trim();
  if (!name) { alert('案件名を入力してください'); return; }
  if (!client) { alert('クライアント名を入力してください'); return; }
  const data={
    name, client,
    status: document.getElementById('p-status').value,
    startDate: document.getElementById('p-start').value,
    endDate: document.getElementById('p-end').value,
    weeklyHours: collectProjectWeekHours(),
    requiredDomains: collectSkills('p-domain-skills'),
    requiredSkills: collectSkills('p-main-skills'),
    notes: document.getElementById('p-notes').value,
  };
  const savingProjectId=editingProjectId;  // closeModal で null になる前に退避
  closeModal('project-modal');
  showLoading('保存中...');
  try {
    if (savingProjectId) {
      const {error}=await sb.from('projects').update(projectToRow(data)).eq('id',savingProjectId);
      if (error) throw error;
      const idx=cache.projects.findIndex(x=>x.id===savingProjectId);
      if (idx>=0) cache.projects[idx]={...cache.projects[idx],...data};
    } else {
      const {data:row,error}=await sb.from('projects').insert(projectToRow(data)).select('id').single();
      if (error) throw error;
      cache.projects.push({...data,id:row.id});
    }
  } catch(e) { showError('案件の保存に失敗しました: '+(e.message||e)); }
  finally { hideLoading(); }
  renderProjects();
}
async function deleteProject(id) {
  if (!confirm('この案件を削除しますか？アサイン情報も削除されます。')) return;
  showLoading('削除中...');
  try {
    await sb.from('assignments').delete().eq('project_id',id);
    const {error}=await sb.from('projects').delete().eq('id',id);
    if (error) throw error;
    cache.projects=cache.projects.filter(p=>p.id!==id);
    cache.assigns=cache.assigns.filter(a=>a.projectId!==id);
  } catch(e) { showError('案件の削除に失敗しました: '+(e.message||e)); }
  finally { hideLoading(); }
  renderProjects();
}
function renderProjects() {
  const grid=document.getElementById('projects-grid');
  const search=document.getElementById('project-search').value.toLowerCase();
  const sf=document.getElementById('project-status-filter').value;
  let projects=cache.projects.slice();
  if (search) projects=projects.filter(p=>p.name.toLowerCase().includes(search)||p.client.toLowerCase().includes(search));
  if (sf) projects=projects.filter(p=>p.status===sf);
  if (!projects.length) {
    grid.innerHTML=`<div class="card" style="grid-column:1/-1"><div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">案件が登録されていません</div></div></div>`;
    return;
  }
  const assigns=cache.assigns, engineers=cache.engineers, wk=currentWeekKey();
  grid.innerHTML=projects.map(p=>{
    const req=getProjectWeekRequired(p,wk), asgn=getProjectWeekAssigned(p.id,wk,assigns);
    const ratio=req>0?Math.min(asgn/req,1):1, pClass=progressClass(asgn,req), barW=Math.min(ratio*100,100);
    const statusOK=asgn>=req;
    const alertBadge=req>0?`<span class="badge ${statusOK?'chip-ok':'chip-ng'}" style="font-size:10px">${statusOK?'✓充足':'⚠不足'}</span>`:'';
    const pas=assigns.filter(a=>a.projectId===p.id);
    const assignHTML=pas.length?pas.map(a=>{
      const eng=engineers.find(e=>e.id===a.engineerId);
      if(!eng) return '';
      const h=getAssignWeekHours(a,wk);
      return `<div class="assign-item"><span class="assign-item-name">👤 ${esc(eng.name)}${a.role?` <span style="font-size:10px;color:var(--gray-400)">[${esc(a.role)}]</span>`:''}</span><span class="assign-item-hours">${h}h/週</span></div>`;
    }).join(''):'<div class="text-muted text-sm">アサイン未登録</div>';
    const hasReqSkills=Object.keys(p.requiredDomains||{}).length+Object.keys(p.requiredSkills||{}).length>0||p.skills;
    return `<div class="card">
      <div class="card-header">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">
            <span style="font-size:15px;font-weight:700">${esc(p.name)}</span>${statusBadge(p.status)}
          </div>
          <div style="font-size:12px;color:var(--gray-500)">🏢 ${esc(p.client)}</div>
        </div>
        <div class="actions admin-only" style="flex-shrink:0">
          <button class="btn btn-secondary btn-sm" onclick="openProjectModal('${p.id}')">編集</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProject('${p.id}')">削除</button>
        </div>
      </div>
      <div class="card-body">
        <div class="info-grid" style="margin-bottom:10px">
          <div class="info-item"><span class="info-label">期間</span><span class="info-value">${fmtDate(p.startDate)} 〜 ${fmtDate(p.endDate)}</span></div>
          <div class="info-item"><span class="info-label">今週必要工数</span><span class="info-value">${req?req+'h/週':'—'}</span></div>
        </div>
        ${hasReqSkills?`<div style="margin-bottom:10px"><div class="info-label" style="margin-bottom:4px">必要スキル</div><div class="tags">${reqSkillTagsHTML(p.requiredDomains,p.requiredSkills)}</div></div>`:''}
        ${req>0?`<div style="margin-bottom:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px"><span class="info-label">今週アサイン工数</span>${alertBadge}</div>
          <div class="${pClass} progress-wrap"><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${barW}%"></div></div><span class="progress-label">${asgn}/${req}h</span></div>
        </div>`:''}
        <div style="margin-bottom:10px"><div class="info-label" style="margin-bottom:5px">アサインメンバー（今週）</div><div class="assign-list">${assignHTML}</div></div>
        <button class="btn btn-success btn-sm" style="width:100%;justify-content:center" onclick="openCandidateModal('${p.id}')">🔍 候補者を探す</button>
        ${p.notes?`<div style="margin-top:10px;padding:7px 10px;background:var(--gray-50);border-radius:6px;font-size:12px;color:var(--gray-600)">${esc(p.notes)}</div>`:''}
      </div>
    </div>`;
  }).join('');
}

// ========== CANDIDATE MATCHING ==========
function openCandidateModal(projectId) {
  const projects=cache.projects, engineers=cache.engineers, assigns=cache.assigns;
  const p=projects.find(x=>x.id===projectId);
  if (!p) return;
  const wk=currentWeekKey();
  const alreadyIds=assigns.filter(a=>a.projectId===projectId).map(a=>a.engineerId);
  const reqD=p.requiredDomains||{}, reqS=p.requiredSkills||{};
  const totalReq=Object.keys(reqD).length+Object.keys(reqS).length;

  const scored=engineers.map(e=>{
    const ed=e.domainSkills||{}, es=e.mainSkills||{};
    let matchCnt=0, matchedItems=[];
    Object.entries(reqD).forEach(([k,rv])=>{
      const ev=ed[k]; const ok=ev&&levelIndex(ev)>=levelIndex(rv);
      if(ok) matchCnt++;
      matchedItems.push({name:k,engLv:ev||null,reqLv:rv,ok});
    });
    Object.entries(reqS).forEach(([k,rv])=>{
      const ev=es[k]; const ok=ev&&levelIndex(ev)>=levelIndex(rv);
      if(ok) matchCnt++;
      matchedItems.push({name:k,engLv:ev||null,reqLv:rv,ok});
    });
    // Legacy text match if no new skills defined
    if (!totalReq && p.skills) {
      const req2=p.skills.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
      const str=(e.skills||'').toLowerCase();
      matchCnt=req2.filter(r=>str.includes(r)).length;
    }
    const asgn=getEngineerWeekAssigned(e.id,wk,assigns), avl=Number(e.availableHours||0), free=avl-asgn;
    return {...e, matchCnt, matchedItems, asgn, avl, free, isAssigned:alreadyIds.includes(e.id)};
  }).sort((a,b)=>b.matchCnt-a.matchCnt||b.free-a.free);

  document.getElementById('candidate-modal-title').textContent=`候補エンジニア — ${p.name}`;
  document.getElementById('candidate-project-info').innerHTML=`📋 <strong>${esc(p.name)}</strong> &nbsp;|&nbsp; 必要スキル: ${reqSkillTagsHTML(reqD,reqS)}`;

  document.getElementById('candidate-list').innerHTML=scored.length?scored.map(e=>{
    const freeClass=e.free>10?'candidate-avail-ok':e.free>0?'candidate-avail-low':'candidate-avail-none';
    const freeLabel=e.free>0?`空き ${e.free}h/週`:e.free===0?'空き 0h':'超過';
    const matchBar=totalReq>0?`<span style="font-size:11px;color:${e.matchCnt>0?'var(--success)':'var(--gray-400)'}">マッチ: ${e.matchCnt}/${totalReq}</span>`:'';
    const skillTags=e.matchedItems.map(item=>`<span class="tag" style="${item.ok?'background:#dcfce7;color:#166534;border:1px solid #86efac':''}">${esc(item.name)} ${item.engLv?`<span class="tag-level">${item.engLv}</span>`:''}</span>`).join('');
    const allSkillTags=skillTagsHTML(e.domainSkills,e.mainSkills,e.skills);
    return `<div class="candidate-item">
      <div class="candidate-info">
        <div class="candidate-name">👤 ${esc(e.name)} ${e.isAssigned?`<span class="badge chip-ok" style="font-size:10px">アサイン済</span>`:''} ${matchBar}</div>
        <div class="tags" style="margin:4px 0">${e.matchedItems.length?skillTags:allSkillTags}</div>
        <div style="font-size:11px;color:var(--gray-500)">${esc(e.employmentType)} / 稼働可能 ${e.avl}h/週 / 今週アサイン ${e.asgn}h</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0">
        <span class="${freeClass}" style="font-size:12px">${freeLabel}</span>
        ${e.isAssigned
          ?`<button class="btn btn-secondary btn-sm" disabled style="opacity:.5">アサイン済</button>`
          :`<button class="btn btn-primary btn-sm admin-only" onclick="openQuickAssign('${p.id}','${e.id}','${escJs(e.name)}')">アサイン</button>`}
      </div>
    </div>`;
  }).join(''):'<div class="empty-state" style="padding:24px"><div class="empty-state-text">エンジニアが登録されていません</div></div>';

  openModal('candidate-modal');
}
function openQuickAssign(pid,eid,eName) {
  qaProjectId=pid; qaEngineerId=eid;
  const p=cache.projects.find(x=>x.id===pid);
  document.getElementById('qa-title').textContent=`アサイン登録 — ${eName}`;
  document.getElementById('qa-info').innerHTML=`👤 <strong>${esc(eName)}</strong> を 📋 <strong>${p?esc(p.name):''}</strong> にアサイン`;
  document.getElementById('qa-hours').value='';
  setRoleValue('qa-role','qa-role-other','EG');
  closeModal('candidate-modal');
  openModal('quick-assign-modal');
}
async function confirmQuickAssign() {
  const hours=Number(document.getElementById('qa-hours').value), role=getRoleValue('qa-role','qa-role-other');
  if (!hours||hours<=0) { alert('工数を入力してください'); return; }
  const proj=cache.projects.find(p=>p.id===qaProjectId);
  const weeklyHours={};
  if (proj&&proj.startDate&&proj.endDate) getWeeksBetween(proj.startDate,proj.endDate).forEach(w=>{ weeklyHours[w]=hours; });
  else weeklyHours[currentWeekKey()]=hours;
  const ex=cache.assigns.find(a=>a.projectId===qaProjectId&&a.engineerId===qaEngineerId);
  closeModal('quick-assign-modal');
  showLoading('保存中...');
  try {
    if (ex) {
      if (!confirm('既にアサインされています。上書きしますか？')) { hideLoading(); return; }
      const {error}=await sb.from('assignments').update({weekly_hours:weeklyHours,role}).eq('id',ex.id);
      if (error) throw error;
      ex.weeklyHours=weeklyHours; ex.role=role;
    } else {
      const {data:row,error}=await sb.from('assignments').insert(assignToRow({projectId:qaProjectId,engineerId:qaEngineerId,role,weeklyHours})).select('id').single();
      if (error) throw error;
      cache.assigns.push({id:row.id,projectId:qaProjectId,engineerId:qaEngineerId,role,weeklyHours});
    }
  } catch(e) { showError('アサインの保存に失敗しました: '+(e.message||e)); }
  finally { hideLoading(); }
  renderProjects();
}

// ========== ENGINEERS ==========
function updateMonthlyCalc() {
  const h=Number(document.getElementById('e-hourly').value)||0;
  const w=Number(document.getElementById('e-available').value)||0;
  const m=h*w*4;
  document.getElementById('e-monthly-calc').textContent=m>0?`${m.toLocaleString()}円/月（約${(m/10000).toFixed(1)}万円）`:'—';
}
function openEngineerModal(id=null) {
  editingEngineerId=id;
  document.getElementById('engineer-modal-title').textContent=id?'エンジニア編集':'エンジニア登録';
  const e=id?cache.engineers.find(x=>x.id===id):null;
  document.getElementById('e-name').value=e?.name||'';
  document.getElementById('e-type').value=e?.employmentType||'正社員・契約社員・パートタイム';
  document.getElementById('e-available').value=e?.availableHours||'';
  document.getElementById('e-hourly').value=e?.hourlyRate||'';
  document.getElementById('e-notes').value=e?.notes||'';
  buildSkillRows('e-domain-skills', DOMAINS, e?.domainSkills||{}, '');
  buildSkillRows('e-main-skills', SKILLS, e?.mainSkills||{}, '');
  updateMonthlyCalc();
  openModal('engineer-modal');
}
async function saveEngineer() {
  const name=document.getElementById('e-name').value.trim();
  const available=document.getElementById('e-available').value;
  if (!name) { alert('氏名を入力してください'); return; }
  if (!available) { alert('稼働可能工数を入力してください'); return; }
  const data={
    name, employmentType:document.getElementById('e-type').value,
    availableHours:Number(available), hourlyRate:document.getElementById('e-hourly').value,
    domainSkills:collectSkills('e-domain-skills'), mainSkills:collectSkills('e-main-skills'),
    notes:document.getElementById('e-notes').value,
  };
  const savingEngineerId=editingEngineerId;  // closeModal で null になる前に退避
  closeModal('engineer-modal');
  showLoading('保存中...');
  try {
    if (savingEngineerId) {
      const {error}=await sb.from('engineers').update(engineerToRow(data)).eq('id',savingEngineerId);
      if (error) throw error;
      const idx=cache.engineers.findIndex(x=>x.id===savingEngineerId);
      if (idx>=0) cache.engineers[idx]={...cache.engineers[idx],...data};
    } else {
      const {data:row,error}=await sb.from('engineers').insert(engineerToRow(data)).select('id').single();
      if (error) throw error;
      cache.engineers.push({...data,id:row.id});
    }
  } catch(e) { showError('エンジニアの保存に失敗しました: '+(e.message||e)); }
  finally { hideLoading(); }
  renderEngineers();
}
async function deleteEngineer(id) {
  if (!confirm('このエンジニアを削除しますか？アサイン情報も削除されます。')) return;
  showLoading('削除中...');
  try {
    await sb.from('assignments').delete().eq('engineer_id',id);
    const {error}=await sb.from('engineers').delete().eq('id',id);
    if (error) throw error;
    cache.engineers=cache.engineers.filter(e=>e.id!==id);
    cache.assigns=cache.assigns.filter(a=>a.engineerId!==id);
  } catch(e) { showError('エンジニアの削除に失敗しました: '+(e.message||e)); }
  finally { hideLoading(); }
  renderEngineers();
}
function renderEngineers() {
  const grid=document.getElementById('engineers-grid');
  const search=document.getElementById('engineer-search').value.toLowerCase();
  const tf=document.getElementById('engineer-type-filter').value;
  let engineers=cache.engineers.slice();
  if (search) engineers=engineers.filter(e=>e.name.toLowerCase().includes(search)||(e.skills||'').toLowerCase().includes(search)||Object.keys(e.domainSkills||{}).some(k=>k.toLowerCase().includes(search))||Object.keys(e.mainSkills||{}).some(k=>k.toLowerCase().includes(search)));
  if (tf) engineers=engineers.filter(e=>e.employmentType===tf);
  if (!engineers.length) { grid.innerHTML=`<div class="card" style="grid-column:1/-1"><div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-text">エンジニアが登録されていません</div></div></div>`; return; }
  const assigns=cache.assigns, projects=cache.projects, wk=currentWeekKey();
  grid.innerHTML=engineers.map(e=>{
    const asgn=getEngineerWeekAssigned(e.id,wk,assigns), avl=Number(e.availableHours||0);
    const isOver=asgn>avl, wClass=workloadClass(asgn,avl), ratio=avl>0?Math.min(asgn/avl,1.2):0;
    const barW=Math.min(ratio*100,100), pct=avl>0?Math.round(asgn/avl*100):0;
    const monthly=(Number(e.hourlyRate)||0)*(Number(e.availableHours)||0)*4;
    const eAssigns=assigns.filter(a=>a.engineerId===e.id);
    const assignHTML=eAssigns.length?eAssigns.map(a=>{
      const proj=projects.find(p=>p.id===a.projectId); if(!proj)return'';
      const h=getAssignWeekHours(a,wk);
      return `<div class="assign-item"><span class="assign-item-name">📋 ${esc(proj.name)}${a.role?` <span style="font-size:10px;color:var(--gray-400)">[${esc(a.role)}]</span>`:''}</span><span class="assign-item-hours">${h}h/週</span></div>`;
    }).join(''):'<div class="text-muted text-sm">アサイン案件なし</div>';
    const typColors={'正社員・契約社員・パートタイム':'#C8E6C9|#1B5E20','派遣社員':'#fef3c7|#92400e','業務委託':'#d1fae5|#065f46','その他':'#f3f4f6|#4b5563'};
    const [eBg,eC]=(typColors[e.employmentType]||'#f3f4f6|#4b5563').split('|');
    return `<div class="card${isOver?' card-over':''}">
      <div class="card-header">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">
            <span style="font-size:15px;font-weight:700">👤 ${esc(e.name)}</span>
            <span class="badge" style="background:${eBg};color:${eC}">${esc(e.employmentType)}</span>
          </div>
          <div style="font-size:12px;color:var(--gray-500)">稼働可能: ${avl}h/週${monthly?' / 月額: '+(monthly/10000).toFixed(1)+'万円':''}</div>
        </div>
        <div class="actions admin-only" style="flex-shrink:0">
          <button class="btn btn-secondary btn-sm" onclick="openEngineerModal('${e.id}')">編集</button>
          <button class="btn btn-danger btn-sm" onclick="deleteEngineer('${e.id}')">削除</button>
        </div>
      </div>
      <div class="card-body">
        <div style="margin-bottom:10px"><div class="info-label" style="margin-bottom:4px">スキル・得意技術</div><div class="tags">${skillTagsHTML(e.domainSkills,e.mainSkills,e.skills)}</div></div>
        <div class="info-grid" style="margin-bottom:10px">
          <div class="info-item"><span class="info-label">今週アサイン済み</span><span class="info-value">${asgn}h/週</span></div>
          <div class="info-item"><span class="info-label">空き工数</span><span class="info-value" style="color:${avl-asgn>0?'var(--success)':'var(--danger)'}">${Math.max(0,avl-asgn)}h/週</span></div>
          <div class="info-item"><span class="info-label">稼働率（今週）</span><span class="info-value">${pct}%</span></div>
        </div>
        <div style="margin-bottom:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
            <span class="info-label">稼働状況</span>
            ${isOver?`<span class="badge chip-ng" style="font-size:10px">⚠超過</span>`:`<span class="badge chip-ok" style="font-size:10px">✓正常</span>`}
          </div>
          <div class="${wClass} progress-wrap"><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${barW}%"></div></div><span class="progress-label">${asgn}/${avl}h</span></div>
        </div>
        <div><div class="info-label" style="margin-bottom:5px">アサイン案件（今週）</div><div class="assign-list">${assignHTML}</div></div>
        ${e.notes?`<div style="margin-top:10px;padding:7px 10px;background:var(--gray-50);border-radius:6px;font-size:12px;color:var(--gray-600)">${esc(e.notes)}</div>`:''}
      </div>
    </div>`;
  }).join('');
}

// ========== ASSIGNS ==========
let assignAxis='project';

function setAxis(ax) {
  assignAxis=ax;
  document.getElementById('axis-btn-project').classList.toggle('active',ax==='project');
  document.getElementById('axis-btn-engineer').classList.toggle('active',ax==='engineer');
  renderAssignTable();
}

const ROLE_OPTIONS = ['EG','WebEG','MechatroEG','UM','EM','PM','QA','その他'];
function onRoleChange(selectId, otherId) {
  document.getElementById(otherId).style.display =
    document.getElementById(selectId).value === 'その他' ? '' : 'none';
}
function getRoleValue(selectId, otherId) {
  const sel = document.getElementById(selectId).value;
  if (sel === 'その他') return document.getElementById(otherId).value.trim() || 'その他';
  return sel;
}
function setRoleValue(selectId, otherId, role) {
  if (ROLE_OPTIONS.includes(role)) {
    document.getElementById(selectId).value = role;
    document.getElementById(otherId).style.display = 'none';
  } else {
    document.getElementById(selectId).value = 'その他';
    document.getElementById(otherId).value = role || '';
    document.getElementById(otherId).style.display = '';
  }
}

function openAssignModal(id=null) {
  editingAssignId=id;
  document.getElementById('assign-modal-title').textContent=id?'アサイン編集':'アサイン登録';
  // Populate selects
  const projects=cache.projects, engineers=cache.engineers;
  document.getElementById('a-project').innerHTML='<option value="">案件を選択...</option>'+projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  document.getElementById('a-engineer').innerHTML='<option value="">エンジニアを選択...</option>'+engineers.map(e=>`<option value="${e.id}">${esc(e.name)} (${e.availableHours}h/週)</option>`).join('');
  const weekOpts=generateWeekOptions('');
  document.getElementById('a-start-week').innerHTML=weekOpts;
  document.getElementById('a-end-week').innerHTML=weekOpts;
  document.getElementById('a-default-hours').value='';
  document.getElementById('a-per-week').checked=false;
  document.getElementById('a-week-table-wrap').style.display='none';
  document.getElementById('a-week-rows').innerHTML='';
  setRoleValue('a-role','a-role-other','EG');
  if (id) {
    const a=cache.assigns.find(x=>x.id===id);
    if (a) {
      document.getElementById('a-project').value=a.projectId;
      document.getElementById('a-engineer').value=a.engineerId;
      setRoleValue('a-role','a-role-other',a.role||'EG');
      const keys=Object.keys(a.weeklyHours||{}).sort();
      if (keys.length) {
        document.getElementById('a-start-week').innerHTML=generateWeekOptions(keys[0]);
        document.getElementById('a-end-week').innerHTML=generateWeekOptions(keys[keys.length-1]);
        const vals=Object.values(a.weeklyHours);
        const mn=Math.min(...vals),mx=Math.max(...vals);
        document.getElementById('a-default-hours').value=mn;
        if (mn!==mx) {
          document.getElementById('a-per-week').checked=true;
          updateAssignWeekTable(a.weeklyHours);
        }
      }
    }
  }
  openModal('assign-modal');
}

function updateAssignWeekTable(existingMap) {
  const startKey=document.getElementById('a-start-week').value;
  const endKey=document.getElementById('a-end-week').value;
  const perWeek=document.getElementById('a-per-week').checked;
  const wrap=document.getElementById('a-week-table-wrap');
  if (!perWeek||!startKey||!endKey||startKey>endKey) { wrap.style.display='none'; return; }
  wrap.style.display='block';
  const defH=document.getElementById('a-default-hours').value;
  const weeks=getWeeksBetween(startKey,endKey);
  document.getElementById('a-week-rows').innerHTML=weeks.map(w=>{
    const v=existingMap&&existingMap[w]!==undefined?existingMap[w]:(defH||'');
    return `<div class="week-row"><span class="week-label">${formatWeekLabel(w)}</span><div class="week-input-wrap"><input type="number" class="asgn-week-input" data-week="${w}" min="0" value="${v}" placeholder="0"><span class="week-unit">h/週</span></div></div>`;
  }).join('');
}
function onDefaultHoursChange() {
  const defH=document.getElementById('a-default-hours').value;
  document.querySelectorAll('.asgn-week-input').forEach(i=>{ if(!i.value||i.value==='0') i.value=defH; });
}
function collectAssignWeekHours() {
  const sk=document.getElementById('a-start-week').value, ek=document.getElementById('a-end-week').value;
  const defH=Number(document.getElementById('a-default-hours').value)||0, perWeek=document.getElementById('a-per-week').checked;
  if (!sk||!ek) return {};
  const weeks=getWeeksBetween(sk,ek), map={};
  if (perWeek) { document.querySelectorAll('.asgn-week-input').forEach(i=>{ map[i.dataset.week]=Number(i.value)||0; }); }
  else { weeks.forEach(w=>{ map[w]=defH; }); }
  return map;
}
async function saveAssign() {
  const pid=document.getElementById('a-project').value;
  const eid=document.getElementById('a-engineer').value;
  const role=getRoleValue('a-role','a-role-other');
  const sk=document.getElementById('a-start-week').value, ek=document.getElementById('a-end-week').value;
  const defH=Number(document.getElementById('a-default-hours').value)||0;
  if (!pid) { alert('案件を選択してください'); return; }
  if (!eid) { alert('エンジニアを選択してください'); return; }
  if (!sk||!ek) { alert('開始週・終了週を選択してください'); return; }
  if (!defH) { alert('工数を入力してください'); return; }
  if (sk>ek) { alert('終了週は開始週以降を選択してください'); return; }
  const weeklyHours=collectAssignWeekHours();
  const savingAssignId=editingAssignId;  // closeModal で null になる前に退避
  closeModal('assign-modal');
  showLoading('保存中...');
  try {
    if (savingAssignId) {
      const {error}=await sb.from('assignments').update({project_id:pid,engineer_id:eid,role,weekly_hours:weeklyHours}).eq('id',savingAssignId);
      if (error) throw error;
      const idx=cache.assigns.findIndex(x=>x.id===savingAssignId);
      if (idx>=0) cache.assigns[idx]={...cache.assigns[idx],projectId:pid,engineerId:eid,role,weeklyHours};
    } else {
      const ex=cache.assigns.find(a=>a.projectId===pid&&a.engineerId===eid);
      if (ex) {
        if (!confirm('既にアサインされています。上書きしますか？')) { hideLoading(); return; }
        const {error}=await sb.from('assignments').update({role,weekly_hours:weeklyHours}).eq('id',ex.id);
        if (error) throw error;
        ex.weeklyHours=weeklyHours; ex.role=role;
      } else {
        const {data:row,error}=await sb.from('assignments').insert(assignToRow({projectId:pid,engineerId:eid,role,weeklyHours})).select('id').single();
        if (error) throw error;
        cache.assigns.push({id:row.id,projectId:pid,engineerId:eid,role,weeklyHours});
      }
    }
  } catch(e) { showError('アサインの保存に失敗しました: '+(e.message||e)); }
  finally { hideLoading(); }
  renderAssigns();
}
async function removeAssign(id) {
  if (!confirm('このアサインを解除しますか？')) return;
  showLoading('削除中...');
  try {
    const {error}=await sb.from('assignments').delete().eq('id',id);
    if (error) throw error;
    cache.assigns=cache.assigns.filter(a=>a.id!==id);
  } catch(e) { showError('アサインの解除に失敗しました: '+(e.message||e)); }
  finally { hideLoading(); }
  renderAssigns();
}
function renderAssigns() {
  const assigns=cache.assigns, engineers=cache.engineers, wk=currentWeekKey();
  // Workload summary
  const sumEl=document.getElementById('workload-summary');
  sumEl.innerHTML=engineers.length?engineers.map(e=>{
    const asgn=getEngineerWeekAssigned(e.id,wk,assigns), avl=Number(e.availableHours||0);
    const wClass=workloadClass(asgn,avl), barW=Math.min(avl>0?(asgn/avl)*100:0,100), isOver=asgn>avl;
    return `<div class="workload-card${isOver?' card-over':''}">
      <div class="workload-card-name">👤 ${esc(e.name)}</div>
      <div class="workload-card-sub">${esc(e.employmentType)} / ${avl}h/週</div>
      <div class="${wClass} progress-wrap"><div class="progress-bar-bg" style="height:6px"><div class="progress-bar-fill" style="width:${barW}%"></div></div><span class="progress-label" style="min-width:55px">${asgn}/${avl}h</span></div>
    </div>`;
  }).join(''):'<div class="text-muted text-sm">エンジニアが登録されていません</div>';
  renderAssignTable();
}
function renderAssignTable() {
  const assigns=cache.assigns, projects=cache.projects, engineers=cache.engineers;
  const thead=document.getElementById('assign-thead'), tbody=document.getElementById('assign-tbody');
  if (!assigns.length) {
    thead.innerHTML=''; tbody.innerHTML=`<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--gray-400)">アサインが登録されていません</td></tr>`; return;
  }
  if (assignAxis==='project') {
    thead.innerHTML=`<tr><th>案件名</th><th>クライアント</th><th>ステータス</th><th>エンジニア</th><th>役割</th><th>期間 / 工数</th><th>操作</th></tr>`;
    const byProj={};
    assigns.forEach(a=>{ if(!byProj[a.projectId])byProj[a.projectId]=[]; byProj[a.projectId].push(a); });
    let rows='';
    projects.forEach(p=>{
      const pa=byProj[p.id]||[]; if(!pa.length)return;
      pa.forEach((a,i)=>{
        const eng=engineers.find(x=>x.id===a.engineerId); if(!eng)return;
        rows+=`<tr>
          ${i===0?`<td rowspan="${pa.length}" style="font-weight:600;border-right:1px solid var(--gray-100)">${esc(p.name)}</td><td rowspan="${pa.length}">${esc(p.client)}</td><td rowspan="${pa.length}">${statusBadge(p.status)}</td>`:'' }
          <td>👤 ${esc(eng.name)}</td>
          <td>${a.role?`<span class="badge" style="background:#E8F5E9;color:#2E7D32">${esc(a.role)}</span>`:'—'}</td>
          <td><div style="font-size:12px">${assignWeekRange(a.weeklyHours)}</div><div style="font-weight:600;color:var(--primary)">${summarizeWeekHours(a.weeklyHours)}</div></td>
          <td><div class="actions admin-only"><button class="btn btn-secondary btn-sm" onclick="openAssignModal('${a.id}')">編集</button><button class="btn btn-danger btn-sm" onclick="removeAssign('${a.id}')">解除</button></div></td>
        </tr>`;
      });
    });
    tbody.innerHTML=rows||`<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--gray-400)">データなし</td></tr>`;
  } else {
    thead.innerHTML=`<tr><th>エンジニア</th><th>雇用形態</th><th>案件名</th><th>ステータス</th><th>役割</th><th>期間 / 工数</th><th>操作</th></tr>`;
    const byEng={};
    assigns.forEach(a=>{ if(!byEng[a.engineerId])byEng[a.engineerId]=[]; byEng[a.engineerId].push(a); });
    let rows='';
    engineers.forEach(e=>{
      const ea=byEng[e.id]||[]; if(!ea.length)return;
      ea.forEach((a,i)=>{
        const proj=projects.find(x=>x.id===a.projectId); if(!proj)return;
        rows+=`<tr>
          ${i===0?`<td rowspan="${ea.length}" style="font-weight:600;border-right:1px solid var(--gray-100)">👤 ${esc(e.name)}</td><td rowspan="${ea.length}">${esc(e.employmentType)}</td>`:'' }
          <td>${esc(proj.name)}</td>
          <td>${statusBadge(proj.status)}</td>
          <td>${a.role?`<span class="badge" style="background:#E8F5E9;color:#2E7D32">${esc(a.role)}</span>`:'—'}</td>
          <td><div style="font-size:12px">${assignWeekRange(a.weeklyHours)}</div><div style="font-weight:600;color:var(--primary)">${summarizeWeekHours(a.weeklyHours)}</div></td>
          <td><div class="actions admin-only"><button class="btn btn-secondary btn-sm" onclick="openAssignModal('${a.id}')">編集</button><button class="btn btn-danger btn-sm" onclick="removeAssign('${a.id}')">解除</button></div></td>
        </tr>`;
      });
    });
    tbody.innerHTML=rows||`<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--gray-400)">データなし</td></tr>`;
  }
}

// ========== TIMELINE ==========
let tlAxis='project';
function setTlAxis(ax) {
  tlAxis=ax;
  document.getElementById('tl-axis-btn-project').classList.toggle('active',ax==='project');
  document.getElementById('tl-axis-btn-engineer').classList.toggle('active',ax==='engineer');
  renderTimeline();
}
function renderTimeline() {
  const weeks=getTimelineWeeks(), curWk=currentWeekKey();
  const assigns=cache.assigns, projects=cache.projects, engineers=cache.engineers;
  const c=document.getElementById('timeline-content');
  const headerCols=weeks.map(w=>`<th class="tl-week-th${w===curWk?' tl-current-th':''}">${formatWeekHdr(w)}<br><span style="font-size:10px;font-weight:400">(月)</span></th>`).join('');

  if (tlAxis==='project') {
    const activeProjects=projects.filter(p=>p.status!=='失注');
    if (!activeProjects.length) { c.innerHTML='<div class="empty-state" style="padding:40px"><div class="empty-state-icon">📋</div><div class="empty-state-text">表示できる案件がありません</div></div>'; return; }
    const rows=activeProjects.map(p=>{
      const dataCells=weeks.map(w=>{
        const req=getProjectWeekRequired(p,w), asgn=getProjectWeekAssigned(p.id,w,assigns);
        const isCur=w===curWk;
        let clr='tl-gray';
        if (req>0||asgn>0) {
          if (!req) clr='tl-green';
          else { const r=asgn/req; clr=r>=1?'tl-green':r>=0.5?'tl-yellow':'tl-red'; }
        }
        const tip=`必要:${req}h アサイン:${asgn}h${req>0?' ('+Math.round(asgn/req*100)+'%)':''}`;
        return `<td class="tl-cell ${clr}${isCur?' tl-current-col':''}" title="${esc(tip)}">${asgn>0?asgn+'h':'<span class="tl-zero">—</span>'}</td>`;
      }).join('');
      const detailCells=weeks.map(w=>{
        const isCur=w===curWk;
        const wa=assigns.filter(a=>a.projectId===p.id&&getAssignWeekHours(a,w)>0);
        const tags=wa.map(a=>{ const eng=engineers.find(e=>e.id===a.engineerId); return eng?`<span class="tl-eng-tag">${esc(eng.name.split(/\s/)[0])} ${getAssignWeekHours(a,w)}h</span>`:'' }).join('');
        return `<td class="tl-detail-cell${isCur?' tl-current-col':''}">${tags?`<div class="tl-eng-tags">${tags}</div>`:''}</td>`;
      }).join('');
      const reqVals=weeks.map(w=>getProjectWeekRequired(p,w)).filter(v=>v>0);
      const reqLabel=reqVals.length?(Math.min(...reqVals)===Math.max(...reqVals)?`${reqVals[0]}h/週必要`:`${Math.min(...reqVals)}〜${Math.max(...reqVals)}h/週`):'';
      return `<tr class="tl-project-row">
        <td class="tl-name-cell"><div class="tl-name-cell-inner">${esc(p.name)}</div>${statusBadge(p.status)}${reqLabel?`<div class="tl-req-label">${esc(reqLabel)}</div>`:''}</td>
        ${dataCells}
      </tr><tr>
        <td class="tl-detail-name"></td>${detailCells}
      </tr>`;
    }).join('');
    c.innerHTML=`<div class="tl-wrap"><table class="tl-table"><thead><tr><th class="tl-name-header">案件名</th>${headerCols}</tr></thead><tbody>${rows}</tbody></table></div>`;
  } else {
    if (!engineers.length) { c.innerHTML='<div class="empty-state" style="padding:40px"><div class="empty-state-icon">👥</div><div class="empty-state-text">エンジニアが登録されていません</div></div>'; return; }
    const rows=engineers.map(e=>{
      const avl=Number(e.availableHours||0);
      const dataCells=weeks.map(w=>{
        const asgn=getEngineerWeekAssigned(e.id,w,assigns), isCur=w===curWk;
        let clr='tl-gray';
        if (asgn>0) { const r=avl>0?asgn/avl:1; clr=r>1?'tl-red':r>=0.8?'tl-green':'tl-yellow'; }
        const wa=assigns.filter(a=>a.engineerId===e.id&&getAssignWeekHours(a,w)>0);
        const tip=wa.map(a=>{ const p=projects.find(x=>x.id===a.projectId); return `${p?p.name:'?'}: ${getAssignWeekHours(a,w)}h`; }).join('\n')+(avl?`\n合計: ${asgn}/${avl}h`:'');
        return `<td class="tl-cell ${clr}${isCur?' tl-current-col':''}" title="${esc(tip)}">${asgn>0?asgn+'h':'<span class="tl-zero">—</span>'}</td>`;
      }).join('');
      return `<tr><td class="tl-name-cell"><div class="tl-name-cell-inner">👤 ${esc(e.name)}</div><div class="tl-req-label">${avl}h/週</div></td>${dataCells}</tr>`;
    }).join('');
    c.innerHTML=`<div class="tl-wrap"><table class="tl-table"><thead><tr><th class="tl-name-header">エンジニア</th>${headerCols}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
}

// ========== DATA LOAD ==========
async function loadAll() {
  showLoading('データを読み込み中...');
  try {
    const [pRes,eRes,aRes] = await Promise.all([
      sb.from('projects').select('*').order('id'),
      sb.from('engineers').select('*').order('id'),
      sb.from('assignments').select('*').order('id'),
    ]);
    if (pRes.error) throw pRes.error;
    if (eRes.error) throw eRes.error;
    if (aRes.error) throw aRes.error;
    cache.projects  = (pRes.data||[]).map(rowToProject);
    cache.engineers = (eRes.data||[]).map(rowToEngineer);
    cache.assigns   = (aRes.data||[]).map(rowToAssign);
  } catch(e) {
    showError('データの読み込みに失敗しました: '+(e.message||e));
  } finally {
    hideLoading();
  }
}

// ========== LOCALSTORAGE MIGRATION ==========
async function migrateFromLocalStorage() {
  if (localStorage.getItem('kibitech_migrated_supabase')) return;

  // 旧localStorage から読み込み（v1.0形式）
  let lsProjects  = JSON.parse(localStorage.getItem('kibitech_projects')  || '[]');
  let lsEngineers = JSON.parse(localStorage.getItem('kibitech_engineers') || '[]');
  let lsAssigns   = JSON.parse(localStorage.getItem('kibitech_assigns')   || '[]');

  if (!lsProjects.length && !lsEngineers.length && !lsAssigns.length) {
    localStorage.setItem('kibitech_migrated_supabase', '1');
    return;
  }

  // 旧データを正規化（weeklyHours/スキル未設定のレコードを補完）
  lsProjects.forEach(p => {
    if (!p.weeklyHours) {
      p.weeklyHours = {};
      if (p.startDate && p.endDate && p.requiredHours)
        getWeeksBetween(p.startDate, p.endDate).forEach(w => { p.weeklyHours[w]=Number(p.requiredHours); });
    }
    if (!p.requiredDomains) p.requiredDomains = {};
    if (!p.requiredSkills)  p.requiredSkills  = {};
  });
  lsEngineers.forEach(e => {
    if (!e.domainSkills) e.domainSkills = {};
    if (!e.mainSkills)   e.mainSkills   = {};
  });
  lsAssigns.forEach(a => {
    if (!a.weeklyHours) {
      a.weeklyHours = {};
      const proj = lsProjects.find(p => p.id === a.projectId);
      if (proj && proj.startDate && proj.endDate && a.hours)
        getWeeksBetween(proj.startDate, proj.endDate).forEach(w => { a.weeklyHours[w]=Number(a.hours); });
      else if (a.hours)
        a.weeklyHours[currentWeekKey()] = Number(a.hours);
    }
  });

  showLoading('既存データを移行中...');
  try {
    const projectIdMap = {}, engineerIdMap = {};

    for (const p of lsProjects) {
      const {data,error} = await sb.from('projects').insert(projectToRow(p)).select('id').single();
      if (!error && data) projectIdMap[p.id] = data.id;
    }
    for (const e of lsEngineers) {
      const {data,error} = await sb.from('engineers').insert(engineerToRow(e)).select('id').single();
      if (!error && data) engineerIdMap[e.id] = data.id;
    }
    for (const a of lsAssigns) {
      const newPid = projectIdMap[a.projectId], newEid = engineerIdMap[a.engineerId];
      if (!newPid || !newEid) continue;
      await sb.from('assignments').insert({ project_id:newPid, engineer_id:newEid, role:a.role||'', weekly_hours:a.weeklyHours||{} });
    }

    localStorage.setItem('kibitech_migrated_supabase', '1');
  } catch(e) {
    showError('データ移行に失敗しました: '+(e.message||e));
  } finally {
    hideLoading();
  }
}

// ========== INIT ==========
(async () => {
  try {
    console.log('[DIAG] step3: IIFE start');
    updateAuthUI();
    console.log('[DIAG] step4: updateAuthUI OK');
    await ensureDefaultAdmin();
    console.log('[DIAG] step5: ensureDefaultAdmin OK');
    migrateData();
    console.log('[DIAG] step6: migrateData OK');
    await migrateFromLocalStorage();
    console.log('[DIAG] step7: migrateFromLocalStorage OK');
    await loadAll();
    console.log('[DIAG] step8: loadAll OK');
    renderDashboard();
    console.log('[DIAG] step9: renderDashboard OK - INIT COMPLETE');
  } catch(e) {
    console.error('[INIT ERROR]', e);
    var div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:80px;left:0;right:0;background:#1f2937;color:#fbbf24;padding:10px;font:12px monospace;z-index:99999;white-space:pre-wrap;';
    div.textContent = '[INIT ERROR] ' + e.message + '\n' + (e.stack || '');
    document.body.appendChild(div);
  }
})();
