/* =====================================================================
   Evoke Organogram — application logic
   No build step, no dependencies. Pure browser JS.
   ===================================================================== */
(function () {
  "use strict";

  const CFG = window.ORG_CONFIG || {};
  const RAW = (window.EVOKE_DATA || []).slice();
  const LS_KEY = "evoke_org_draft_v2";   // v2: drop stale pre-June-payroll drafts
  const LS_LOG = "evoke_org_log_v2";
  const LS_CFG = "evoke_org_cfg_v2";     // empty groups + any live hierarchy tweaks
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));

  /* ---- editing gate: read-only unless allowed AND (editByDefault or ?edit=1) ----
     When Supabase is configured (cloud mode), editing additionally requires a
     login: EDIT starts false and cloud.js flips it on via ORG.setEditAllowed()
     after a successful sign-in. Without Supabase, behaviour is unchanged. */
  const params = new URLSearchParams(location.search);
  const wantsEdit = params.get("edit") === "1" || params.get("edit") === "true";
  const SC = window.SUPABASE_CONFIG;
  const CLOUD = !!(SC && /^https?:\/\//.test(SC.url || "") && (SC.anonKey || "").length > 20);
  const wantEdit = !!CFG.allowEditing && (!!CFG.editByDefault || wantsEdit);
  let EDIT = CLOUD ? false : wantEdit;
  if (!EDIT) document.body.classList.add("readonly");

  /* ---- state ---- */
  let EMP = [];                 // working records, each with _id
  let committedSnapshot = "";   // JSON of the committed (file) data, for dirty check
  let hierarchy = (CFG.hierarchy || []).slice();   // array of field keys
  let path = [];                // [{field,value}]
  let editCount = 0;
  let changeLog = [];           // [{ts,type,emp_no,name,field,from,to}] — every movement/edit

  /* ---- field helpers ---- */
  const FIELDS = CFG.fields || [];
  const fieldLabel = (k) => (FIELDS.find((f) => f.key === k) || {}).label || k;
  const groupableFields = () => FIELDS.filter((f) => f.group).map((f) => f.key);
  const CHIPS = CFG.cardChips || [];
  const ACCENT = CFG.accent || "#c1872c";

  /* ---- utils ---- */
  const norm = (s) => (s == null ? "" : String(s)).toLowerCase();
  const val = (e, k) => { const v = e[k]; return (v == null || v === "") ? "—" : v; };
  function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function cssEsc(s){return String(s).replace(/["\\]/g,"\\$&");}
  function hue(n){let h=0;for(let i=0;i<n.length;i++)h=(h*31+n.charCodeAt(i))%360;return h;}
  function color(n,l=46,s=52){return`hsl(${hue(String(n))} ${s}% ${l}%)`;}
  function initials(n){const p=String(n).trim().split(/\s+/);return(((p[0]||"")[0]||"")+((p[1]||"")[0]||"")).toUpperCase();}
  /* ---- money / payroll helpers ---- */
  const numv = (v)=>{ const n=Number(v); return isFinite(n)?n:0; };
  const money = (n)=> "Rs " + Math.round(numv(n)).toLocaleString();   // employee level: full rupees
  function moneyShort(n){ n=Math.round(numv(n)); const a=Math.abs(n);
    if(a>=1e6) return "Rs "+(n/1e6).toFixed(1)+"M"; if(a>=1e3) return "Rs "+(n/1e3).toFixed(0)+"K";
    return "Rs "+n.toLocaleString(); }
  /* group / department / apex level: always in millions */
  function moneyM(n){ const m=numv(n)/1e6; return "Rs "+m.toFixed(Math.abs(m)>=10?1:2)+"M"; }
  /* two colour-coded salary figures (gross then payment) for any group node */
  function payDuo(g,n){ return `<span class="m-gross" title="Gross salary (total)">${moneyM(g)}</span>`+
    `<span class="m-net" title="Payment (total)">${moneyM(n)}</span>`; }
  function fmtDate(s){ if(!s) return "—"; const d=new Date(s); return isNaN(d)? String(s)
    : d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); }
  /* length of service from date of joining to today, e.g. "5y 3m" */
  function tenure(s){ if(!s) return ""; const d=new Date(s); if(isNaN(d)) return "";
    const now=new Date(); let m=(now.getFullYear()-d.getFullYear())*12+(now.getMonth()-d.getMonth());
    if(now.getDate()<d.getDate()) m--; if(m<0) m=0;
    const y=Math.floor(m/12), mm=m%12; return (y?y+"y ":"")+(mm||!y?mm+"m":"").trim(); }
  const ROLLUPS = CFG.rollups || [];
  function sumPay(list){ const o={g:0,n:0}; for(const e of list){ o.g+=numv(e.gross); o.n+=numv(e.net); } return o; }

  /* ---- position ranking (lower = more senior) ----
     The Lead of any group is the person with the most senior POSITION.
     Order matters: the FIRST matching pattern wins, so specific titles must
     come before generic ones. Chain of command used here:
       Chairman > C-suite > Director/Board > (Senior) GM > Deputy GM >
       General Manager > Zonal/Regional/Functional Head > Senior Manager > …
     A General Manager (3) therefore outranks both a "Zonal Head" and a
     "Head of <function>" (both 4) — matching your marked example where the
     GM, not the Zonal Head, is the Lead. */
  const RANKS = [
    [0,/chairman/],
    [1,/chief|\bceo\b|founder|president/],
    [2,/director|board/],
    [2,/senior general manager|\bsgm\b/],
    [3.5,/deputy general manager|\bdgm\b/],
    [3,/general manager|\bgm\b/],
    [4,/zonal head|regional head|head of|\bhead\b/],
    [5,/senior manager/],
    [7,/deputy manager|assistant manager|\bam\b|asst/],
    [6,/manager/],
    [8,/\blead\b|qualifier/],
    [9,/senior /],
    [10,/executive|engineer|officer|advisor|consultant|architect|analyst|specialist|coordinator|designer|relationship/],
    [11,/supervisor/],
    [12,/technician|operator|draftsman|visualizer|controller/],
    [13,/electrician|plumber|welder|painter|carpenter|mason|fabricator|gardener|horticulture/],
    [14,/driver|rider|cook|janitor|helper|office boy|security|guard|store keeper|lift|front desk|peon/],
    [15,/intern/]
  ];
  function rank(pos){const p=norm(pos);for(const[r,re]of RANKS)if(re.test(p))return r;return 50;}
  function bySeniority(a,b){return (rank(a.position)-rank(b.position))||String(a.name).localeCompare(b.name);}

  /* ---- data load + draft ---- */
  function reindex(arr){return arr.map((e,i)=>({...e,_id:i}));}
  function strip(arr){return arr.map(({_id,...r})=>r);}
  function serialize(arr){return JSON.stringify(strip(arr));}

  // ?seed=file — one-time load of the bundled data/employees.js OVER whatever is
  // in the cloud, so an admin can review it and Publish it live. Skips the cloud
  // fetch (see cloud.js) and force-marks the working set dirty so Publish appears.
  const SEED_FILE = /[?&]seed=file\b/.test(location.search);
  function init(){
    EMP = reindex(RAW);
    committedSnapshot = serialize(EMP);
    if(SEED_FILE){
      try{ localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_LOG); localStorage.removeItem(LS_CFG); }catch(e){}
      window.__SEED_FILE = true;              // tell cloud.js not to overwrite the file data
      committedSnapshot = "";                 // force dirty -> the Publish banner shows once signed in
    }
    if (EDIT && !SEED_FILE){
      try{
        const d = localStorage.getItem(LS_KEY);
        if (d){ const arr = JSON.parse(d); if(Array.isArray(arr)&&arr.length){ EMP = reindex(arr); } }
      }catch(e){}
      // A draft saved BEFORE payroll was merged lacks doj/gross/net and would
      // render "Rs 0". Backfill those fields from the published data by emp_no,
      // without touching any edits the draft actually made.
      const rawByNo=new Map(RAW.map(r=>[String(r.emp_no), r]));
      EMP.forEach(e=>{ const src=rawByNo.get(String(e.emp_no)); if(!src) return;
        ["doj","gross","net"].forEach(k=>{ if((e[k]==null||e[k]==="") && src[k]!=null && src[k]!=="") e[k]=src[k]; }); });
      try{
        const l = localStorage.getItem(LS_LOG);
        if (l){ const arr = JSON.parse(l); if(Array.isArray(arr)) changeLog = arr; }
      }catch(e){}
      try{
        const c = localStorage.getItem(LS_CFG);
        if (c){ const o = JSON.parse(c);
          if(o && Array.isArray(o.emptyGroups)) CFG.emptyGroups = o.emptyGroups;
          if(o && Array.isArray(o.hierarchy) && o.hierarchy.length) hierarchy = o.hierarchy.slice();
          if(o && Array.isArray(o.fields)) o.fields.forEach(f=>{ if(f&&f.key&&!FIELDS.some(x=>x.key===f.key)) FIELDS.push(f); });
        }
      }catch(e){}
    }
    pruneEmpty();
    // brand
    $("#brand-name").textContent = CFG.orgName || "Organogram";
    $("#brand-sub").textContent = CFG.subtitle || "";
    document.title = (CFG.orgName||"Org") + " Organogram";
    if(!EDIT){ const b=$("#ro-badge"); if(b) b.style.display=""; }
    document.documentElement.style.setProperty("--gold", ACCENT);
  }

  function dirty(){ return EDIT && serialize(EMP) !== committedSnapshot; }
  function saveDraft(){
    if(!EDIT) return;
    try{ localStorage.setItem(LS_KEY, JSON.stringify(strip(EMP))); }catch(e){}
    try{ localStorage.setItem(LS_LOG, JSON.stringify(changeLog)); }catch(e){}
    try{ localStorage.setItem(LS_CFG, JSON.stringify({emptyGroups:emptyGroups(), hierarchy:hierarchy.slice(), fields:FIELDS})); }catch(e){}
    refreshBanner();
    // let the cloud layer auto-publish this edit so other browsers get it live
    if(window.ORG && typeof window.ORG.onEdit==="function"){ try{ window.ORG.onEdit(); }catch(e){} }
  }

  /* ---- change log: record every movement / edit (as-is → to-be) ---- */
  function logChange(type, e, changes){
    const ts=Date.now();
    changes.forEach(c=>{
      const lbl = FIELDS.some(f=>f.key===c.field) ? fieldLabel(c.field) : c.field;
      changeLog.push({ts, type, emp_no:val(e,"emp_no"), name:val(e,"name"), field:lbl, from:c.from, to:c.to});
    });
    updateChangesBadge();
  }
  function updateChangesBadge(){ const b=$("#changes-ct"); if(b) b.textContent=changeLog.length; }
  function refreshBanner(){
    const b=$("#banner"); if(!b) return;
    b.classList.toggle("show", dirty());
  }

  /* ---- aggregation against current path ---- */
  function matchesPath(e){ return path.every((p)=> val(e,p.field) === p.value ); }
  function scoped(){ return EMP.filter(matchesPath); }
  function currentField(){ return hierarchy[path.length]; }   // undefined => leaf
  /* From startDepth, skip any hierarchy level that has 0 or 1 distinct group
     (a single sub-node is redundant) and return the next MEANINGFUL level —
     so e.g. a department with one section opens its people directly. */
  function planLevel(startDepth, list){
    let depth=startDepth; const skipped=[];
    while(depth<hierarchy.length){
      const g=groupsAt(hierarchy[depth], list);
      if(list.length>0 && g.length<=1){
        if(g.length===1) skipped.push({field:hierarchy[depth], value:g[0][0]});
        depth++; continue;
      }
      break;
    }
    return { depth, field: depth<hierarchy.length ? hierarchy[depth] : undefined, skipped };
  }
  /* every existing FULL path through the hierarchy (a real leaf node) */
  function leafPaths(){
    const seen=new Map();
    for(const e of EMP){
      const p=hierarchy.map(f=>({field:f, value:val(e,f)}));
      const key=p.map(x=>x.field+"="+x.value).join("|");
      if(!seen.has(key)) seen.set(key,p);
    }
    return [...seen.values()];
  }
  const pathKey=(p)=>p.map(x=>x.field+"="+x.value).join("|");
  function parsePathKey(k){ return k.split("|").map(s=>{const i=s.indexOf("=");return{field:s.slice(0,i),value:s.slice(i+1)};}); }
  /* <optgroup>…</optgroup> for the "Move to…" picker — built once per render
     (reset in render) and shared by every card instead of rebuilt per card */
  let _moveOptsCache=null;
  function moveOptionsHTML(){
    if(_moveOptsCache!=null) return _moveOptsCache;
    const byTop=new Map();
    leafPaths().forEach(p=>{ const top=p[0].value; if(!byTop.has(top)) byTop.set(top,[]); byTop.get(top).push(p); });
    _moveOptsCache=[...byTop.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([top,ps])=>{
      const opts=ps.map(p=>{
        const label=p.slice(1).map(x=>x.value).join(" › ")||p[0].value;
        return `<option value="${esc(pathKey(p))}">${esc(label)}</option>`;
      }).join("");
      return `<optgroup label="${esc(top)}">${opts}</optgroup>`;
    }).join("");
    return _moveOptsCache;
  }
  function groupsAt(field, list){
    const m=new Map();
    for(const e of list){ const k=val(e,field); m.set(k,(m.get(k)||0)+1); }
    return [...m.entries()].sort((a,b)=>b[1]-a[1]);
  }

  /* ---- empty groups: departments/sections created with no people yet.
     Stored in CFG.emptyGroups as full paths [{field,value},…]. They render as
     0-people boxes so a unit can exist before anyone is assigned to it, and
     self-prune the moment a real person lands on that exact path. ---- */
  function emptyGroups(){ return (CFG.emptyGroups = CFG.emptyGroups || []); }
  function pruneEmpty(){
    CFG.emptyGroups = emptyGroups().filter(g =>
      Array.isArray(g) && g.length &&
      !EMP.some(e => g.every(p => val(e, p.field) === p.value)));
  }
  function sameScope(a, b){
    return a.length === b.length &&
      a.every((p, i) => b[i] && p.field === b[i].field && String(p.value) === String(b[i].value));
  }
  /* names of empty groups that sit directly under `parentScope` at level `f` */
  function emptyNamesAt(parentScope, f){
    return emptyGroups().filter(g =>
      Array.isArray(g) && g.length === parentScope.length + 1 &&
      g[g.length - 1].field === f &&
      parentScope.every((p, i) => g[i] && g[i].field === p.field && String(g[i].value) === String(p.value))
    ).map(g => g[g.length - 1].value);
  }
  /* top-level units incl. empty ones — used by the sidebar, stats and apex */
  function unitsAtTop(){
    const topField = hierarchy[0]; if(!topField) return [];
    const g = groupsAt(topField, EMP);
    const extra = emptyNamesAt([], topField).filter(n => !g.some(([x]) => x === n));
    return g.concat(extra.map(n => [n, 0]));
  }
  /* deepest hierarchy level actually used by a set of people, from level iG down */
  function deepestLevel(people, iG){
    let maxL = iG;
    people.forEach(e => hierarchy.forEach((f, idx) => {
      if(idx >= iG){ const v = e[f]; if(v != null && v !== "" && v !== "—") maxL = Math.max(maxL, idx); }
    }));
    return maxL;
  }
  /* make sure the drill hierarchy is at least `n` levels deep, appending
     synthetic sub-levels as needed. Levels that stay unused ("—") are auto-
     skipped by planLevel, so other departments are visually unaffected. */
  function ensureDepth(n){
    const labels = ["Sub-section", "Sub-unit", "Sub-group", "Tier 4", "Tier 5"];
    let changed = false;
    while(hierarchy.length < n){
      const i = hierarchy.length, key = "lvl" + i;
      hierarchy.push(key);
      if(!FIELDS.some(f => f.key === key))
        FIELDS.push({ key, label: labels[i - 2] || ("Level " + (i + 1)), group: true });
      changed = true;
    }
    return changed;
  }
  function leadOf(list){ return list.find(e=>e.is_lead) || list.slice().sort(bySeniority)[0]; }
  /* people sorted senior-first, but the (manual or inferred) Lead pinned to top */
  function peopleSorted(list){
    const arr=list.slice().sort(bySeniority);
    const lead=leadOf(list);
    if(lead){ const i=arr.indexOf(lead); if(i>0){ arr.splice(i,1); arr.unshift(lead); } }
    return {arr, lead};
  }
  function topPerson(){ return EMP.slice().sort(bySeniority)[0]; }

  /* ---- stats ---- */
  function stats(){
    $("#s-emp").textContent = EMP.length.toLocaleString();
    const topField = hierarchy[0];
    const units = topField ? unitsAtTop().length : 0;
    $("#s-units").textContent = units;
    $("#s-units-lbl").textContent = topField ? fieldLabel(topField)+"s" : "Levels";
    $("#side-lbl").textContent = topField ? fieldLabel(topField) : "Units";
    const ed=$("#s-edits"); if(ed) ed.textContent=editCount;
  }

  /* ---- sidebar (top-level units, drag-drop targets) ---- */
  function renderSidebar(){
    const topField = hierarchy[0];
    const body=$("#body"), side=$("#sidebar");
    if(!topField){ body.classList.add("no-side"); return; }
    body.classList.remove("no-side");
    const units = unitsAtTop();
    $("#side-total").textContent = units.length;
    // gross salary total per top-level unit (for the sidebar list)
    const grossBy=new Map();
    if(ROLLUPS.length) for(const e of EMP){ const k=val(e,topField); grossBy.set(k,(grossBy.get(k)||0)+numv(e.gross)); }
    const box=$("#unitlist"); box.innerHTML="";
    const activeTop = path[0] ? path[0].value : null;
    for(const [name,ct] of units){
      const el=document.createElement("div");
      el.className="unit"+(name===activeTop?" active":"");
      el.dataset.name=name;
      const grHTML = ROLLUPS.length ? `<span class="gr" title="Gross salary (total)">${esc(moneyM(grossBy.get(name)||0))}</span>` : "";
      el.innerHTML=`<span class="sw" style="background:${color(name)}"></span>
        <span class="nm" title="${esc(name)}">${esc(name)}</span>
        <span class="uvals"><span class="ct">${ct}</span>${grHTML}</span>`;
      el.onclick=()=>{ path=[{field:topField,value:name}]; render(); $(".stage").scrollTop=0; };
      if(EDIT){
        el.ondragover=(ev)=>{ev.preventDefault();el.classList.add("drop");};
        el.ondragleave=()=>el.classList.remove("drop");
        el.ondrop=(ev)=>{ev.preventDefault();el.classList.remove("drop");
          const id=+ev.dataTransfer.getData("text/plain");
          moveToNode(id, [{field:topField, value:name}]);};
      }
      box.appendChild(el);
    }
  }

  /* ---- node markup ---- */
  function apexNode(){
    const topField=hierarchy[0];
    const units = topField? unitsAtTop().length : 0;
    const s=sumPay(EMP);
    return `<div class="node apex">
      <div class="role-eyebrow">${esc(CFG.orgName||"Organisation")}</div>
      <div class="nm">CHAIRMAN</div>
      <div class="hc"><span class="pic">👥</span> ${EMP.length.toLocaleString()} employees${topField?` · ${units} ${esc(fieldLabel(topField).toLowerCase())}s`:""}</div>
      ${ROLLUPS.length?`<div class="hc money full"><span class="m-gross">Gross ${money(s.g)}</span> · <span class="m-net">Payment ${money(s.n)}</span></div>`:""}
    </div>`;
  }
  /* a single ancestor (or current) node in the vertical lineage spine */
  function lineageNode(i){
    const p=path[i], isCurrent=(i===path.length-1);
    const sub=EMP.filter(e=>path.slice(0,i+1).every(q=>val(e,q.field)===q.value));
    const s=sumPay(sub);
    return `<div class="node lineage${isCurrent?" current":""}" data-nav="${i}">
      <div class="role-eyebrow">${esc(fieldLabel(p.field))}</div>
      <div class="nm">${esc(p.value)}</div>
      <div class="hc"><span class="pic">👥</span> ${sub.length.toLocaleString()} people</div>
      ${ROLLUPS.length?`<div class="hc money">${payDuo(s.g,s.n)}</div>`:""}
    </div>`;
  }
  /* the whole chain from the top down to (and including) the current node,
     so you always see a node's parents, e.g. Chairman › Facilities › Fleet */
  function lineageSpine(){
    let h=apexNode();
    for(let i=0;i<path.length;i++) h+=`<div class="down"></div>`+lineageNode(i);
    return h;
  }
  function wireSpine(){
    const apex=$(".node.apex"); if(apex){ apex.style.cursor="pointer";
      apex.onclick=()=>{ path=[]; render(); $(".stage").scrollTop=0; }; }
    $$(".node.lineage[data-nav]").forEach(n=>n.onclick=()=>{
      const i=+n.dataset.nav; path=path.slice(0,i+1); render(); $(".stage").scrollTop=0;
    });
  }
  function groupBox(field,name,count,lead,isLeafParent,tot,acts){
    return `<div class="box" data-name="${esc(name)}" data-field="${esc(field)}">
      ${acts&&EDIT?`<div class="box-acts edit-only">
        <button class="bx-add" title="Add a person to this ${esc(fieldLabel(field))}">＋</button>
        <button class="bx-ren" title="Rename this ${esc(fieldLabel(field))}">✎</button>
        <button class="bx-move" title="Move / copy this ${esc(fieldLabel(field))}">↪</button>
        <button class="bx-del" title="Delete this ${esc(fieldLabel(field))}">✕</button>
      </div>`:""}
      <div class="swatch" style="background:${color(name)}"></div>
      <div class="bname-row">
        <div class="bname">${esc(name)}</div>
        ${lead?`<div class="blead-nm"><span>Lead</span><b>${esc(lead.name)}</b></div>`:""}
      </div>
      ${lead?`<div class="blead-pos">${esc(lead.position)}</div>`:""}
      <div class="foot">
        <div class="cnt">${count} <span>${count===1?"person":"people"}</span></div>
        ${tot&&ROLLUPS.length?`<div class="boxpay">${payDuo(tot.g,tot.n)}</div>`:""}
        <span class="go">open ›</span>
      </div>
    </div>`;
  }
  function childrenRow(arr){
    // One child -> a single centred connector. Two or more -> a responsive
    // wrapping grid under the parent, so any fan-out (2 or 29) fits every
    // screen size instead of forcing a wide horizontal row.
    const cls = arr.length===1 ? "children single" : "children grid";
    return `<div class="${cls}">${arr.map(b=>`<div class="child">${b}</div>`).join("")}</div>`;
  }

  function empCard(e,isLead){
    const drag = EDIT? " draggable" : "";
    const chips = CHIPS.map(k=>`<span class="chip">${esc(val(e,k))}</span>`).join("");
    let actions="";
    if(EDIT){
      const move = hierarchy.length ? `<button class="ic" data-move="${e._id}" title="Move / reassign">↪</button>` : "";
      const leadBtn=`<button class="ic lead-btn${e.is_lead?" on":""}" data-lead="${e._id}" title="${e.is_lead?"Remove Lead":"Make Lead of this group"}">${e.is_lead?"★":"☆"}</button>`;
      // compact icon toolbar, revealed only on hover (see .ec-actions in CSS)
      actions=`<div class="ec-actions edit-only">${move}${leadBtn}<button class="ic" data-edit="${e._id}" title="Edit">✎</button></div>`;
    }
    const ten = tenure(e.doj);
    return `<div class="ecard${isLead?" lead":""}${e.absent?" absent":""}${drag?" draggable":""}"${drag?' draggable="true"':""} data-id="${e._id}">
      <span class="ec-id">#${esc(val(e,"emp_no"))}</span>
      <div class="top">
        <div class="av" style="background:${color(val(e,hierarchy[0]||"department"),42,55)}">${esc(initials(val(e,"name")))}</div>
        <div style="min-width:0">
          <div class="ec-name">${esc(val(e,"name"))}</div>
          <div class="ec-pos">${esc(val(e,"position"))}${isLead?'<span class="leadtag">Lead</span>':""}</div>
        </div>
      </div>
      <div class="ec-meta">${e.absent?'<span class="absent-flag" title="Not in the June 2026 payroll workbook">Not in June payroll</span>':""}${chips}</div>
      ${ROLLUPS.length?`<div class="ec-pay">
        <div class="ec-join">Joined <b>${esc(fmtDate(e.doj))}</b>${ten?` · <span class="ten">${esc(ten)} tenure</span>`:""}</div>
        <div class="ec-sal">
          <span class="ecp"><label>Gross</label><b class="m-gross">${e.gross?esc(money(e.gross)):"—"}</b></span>
          <span class="ecp"><label>Payment</label><b class="m-net">${e.net?esc(money(e.net)):"—"}</b></span>
        </div>
      </div>`:""}
      ${actions}
    </div>`;
  }

  /* ---- breadcrumb ---- */
  function renderCrumbs(){
    const c=$("#crumbs");
    const parts=[`<a data-i="-1" class="${path.length===0?"here":""}">${esc(CFG.orgName||"Top")}</a>`];
    path.forEach((p,i)=>{
      parts.push(`<span class="sep">›</span><a data-i="${i}" class="${i===path.length-1?"here":""}">${esc(p.value)}</a>`);
    });
    c.innerHTML=parts.join("");
    c.querySelectorAll("a").forEach(a=>a.onclick=()=>{
      const i=+a.dataset.i; path = i<0? [] : path.slice(0,i+1); render(); $(".stage").scrollTop=0;
    });
  }

  /* ---- outline / "expand the whole organogram at once" view ---- */
  let viewMode = "drill";          // "drill" = step-by-step chart; "tree" = full outline
  let chartExpanded = false;       // Chart view: every branch blown open at once
  const expanded = new Set();      // open node keys in outline mode
  function nodeKey(p){ return p.map(x=>x.field+"="+x.value).join("|"); }
  function allGroupKeys(){
    const keys=[];
    (function walk(p,list){
      const f=hierarchy[p.length]; if(!f) return;
      for(const [name] of groupsAt(f,list)){
        const np=p.concat([{field:f,value:name}]);
        keys.push(nodeKey(np));
        walk(np, list.filter(e=>val(e,f)===name));
      }
    })([],EMP);
    return keys;
  }
  function setView(m){
    viewMode=m;
    document.body.classList.toggle("treemode", m==="tree");
    $$("#viewseg button").forEach(b=>b.classList.toggle("active", b.dataset.view===m));
    syncChartExpandBtn();
  }
  function syncChartExpandBtn(){
    const ce=$("#chart-expand"); if(ce) ce.textContent = chartExpanded ? "⊟ Collapse" : "⊞ Expand all";
  }
  function setChartExpanded(v){
    chartExpanded=v;
    document.body.classList.toggle("chart-expanded", v);
    syncChartExpandBtn();
  }
  /* one branch of the fully-expanded chart: a group box with its whole
     sub-tree (sections, etc.) connected beneath it, recursing to the leaves */
  function chartBranch(p, list){
    const plan=planLevel(p.length, list);       // skip redundant single-group levels
    const field=plan.field;
    if(!field) return "";                       // people are the leaves; not drawn as boxes
    const isLeafParent=(plan.depth===hierarchy.length-1);
    const cells=groupsAt(field,list).map(([name,ct])=>{
      const np=p.concat(plan.skipped,[{field,value:name}]);
      const sub=list.filter(e=>val(e,field)===name);
      const box=groupBox(field,name,ct,leadOf(sub),isLeafParent,sumPay(sub));
      const below=planLevel(np.length,sub).field ? `<div class="down"></div>`+chartBranch(np,sub) : "";
      return `<div class="child"><div class="boxwrap" data-navpath="${esc(JSON.stringify(np))}">${box}</div>${below}</div>`;
    });
    const cls = cells.length===1 ? "children single" : "children chart-row";
    return `<div class="${cls}">${cells.join("")}</div>`;
  }
  function renderChartAll(){
    const tree=$("#tree");
    tree.innerHTML = `<div class="chart-canvas">${apexNode()}<div class="down"></div>${chartBranch([],EMP)}</div>`;
    const apex=$(".node.apex"); if(apex){ apex.style.cursor="default"; }
    tree.querySelectorAll(".boxwrap[data-navpath]").forEach(w=>w.onclick=(e)=>{
      e.stopPropagation();
      setChartExpanded(false);            // clicking a branch focuses it in normal drill
      path=JSON.parse(w.dataset.navpath);
      render(); $(".stage").scrollTop=0; $(".stage").scrollLeft=0;
    });
  }
  function treePerson(e,isLead,depth){
    return `<div class="tperson${isLead?" lead":""}" style="--d:${depth}">
      <span class="tav" style="background:${color(val(e,hierarchy[0]||"department"),42,55)}">${esc(initials(val(e,"name")))}</span>
      <span class="tpbody">
        <span class="tpname">${esc(val(e,"name"))}${isLead?'<span class="leadtag">Lead</span>':""}</span>
        <span class="tppos">${esc(val(e,"position"))}</span>
      </span>
      <span class="tpid">#${esc(val(e,"emp_no"))}</span>
    </div>`;
  }
  function treeRows(p,list,depth){
    const field=hierarchy[p.length];
    if(!field){ // leaf -> people
      const ld=peopleSorted(list);
      return `<div class="tkids people" style="--d:${depth}">`+ld.arr.map(e=>treePerson(e, ld.arr.length>1 && e===ld.lead, depth)).join("")+`</div>`;
    }
    let html="";
    for(const [name,ct] of groupsAt(field,list)){
      const np=p.concat([{field,value:name}]);
      const key=nodeKey(np), sub=list.filter(e=>val(e,field)===name);
      const lead=leadOf(sub), open=expanded.has(key);
      const leafParent=(np.length===hierarchy.length);
      html+=`<div class="trow${open?" open":""}" style="--d:${depth}" data-toggle="${esc(key)}">
        <span class="tcaret">${open?"▾":"▸"}</span>
        <span class="tsw" style="background:${color(name)}"></span>
        <span class="tname">${esc(name)}</span>
        <span class="tcount">${ct}</span>
        ${lead?`<span class="tlead">Lead: <b>${esc(lead.name)}</b></span>`:""}
      </div>`;
      if(open) html+=treeRows(np,sub,depth+1);
    }
    return html;
  }
  function renderTree(){
    const tree=$("#tree");
    tree.innerHTML=`<div class="toutbar">
        <button class="tbtn primary" id="exp-all">⊞ Expand whole organogram</button>
        <button class="tbtn" id="col-all">⊟ Collapse all</button>
        <span class="thint">…or open one level at a time by clicking a row.</span>
      </div>
      <div class="outline">${treeRows([],EMP,0)||'<div class="empty">No data.</div>'}</div>`;
    $("#exp-all").onclick=()=>{ allGroupKeys().forEach(k=>expanded.add(k)); renderTree(); };
    $("#col-all").onclick=()=>{ expanded.clear(); renderTree(); };
    tree.querySelectorAll(".trow[data-toggle]").forEach(r=>r.onclick=()=>{
      const k=r.dataset.toggle; expanded.has(k)?expanded.delete(k):expanded.add(k); renderTree();
    });
  }

  /* people-level header, with a contextual "Add person" that pre-fills the
     current path (so the new hire lands in the section you're looking at) */
  function peopleHdr(label){
    const add = EDIT ? `<button class="addhere edit-only" id="add-here" title="Add a person to this group">＋ Add person</button>` : "";
    return `<div class="grouphdr"><span>${esc(label)}</span><span class="gh-line"></span>${add}</div>`;
  }
  function wireAddHere(){
    const ah=$("#add-here"); if(!ah) return;
    ah.onclick=()=>{ const pre={}; path.forEach(p=>pre[p.field]=p.value); openEditor(null, pre); };
  }
  /* group-level header with a contextual "Add <level>" (department/section…) */
  function groupAddHdr(field, scope){
    const lbl = fieldLabel(field);
    const add = EDIT ? `<button class="addhere edit-only" id="add-group" title="Add a new ${esc(lbl.toLowerCase())}">＋ Add ${esc(lbl.toLowerCase())}</button>` : "";
    // inside a unit you can also drop a person straight in (no sub-group needed)
    const addP = (EDIT && (scope||[]).length) ? `<button class="addhere edit-only" id="add-here-grp" title="Add a person directly to this ${esc((scope[scope.length-1].field===field?fieldLabel(field):fieldLabel(scope[scope.length-1].field)).toLowerCase())}">＋ Add person</button>` : "";
    return `<div class="grouphdr"><span>${esc(lbl)}s</span><span class="gh-line"></span>${addP}${add}</div>`;
  }

  /* ---- main render ---- */
  function render(){
    if(EDIT) pruneEmpty();               // clear any empty group that now has people
    stats();
    _moveOptsCache=null;                 // rebuild move-picker once per render
    if(viewMode==="tree"){ renderTree(); return; }
    renderCrumbs(); renderSidebar();
    const tree=$("#tree");
    if(chartExpanded){ renderChartAll(); return; }
    const list=scoped();
    if(path.length===0 && hierarchy.length===0){
      // no hierarchy configured -> everyone as leaves
      tree.innerHTML = apexNode()+`<div class="down"></div>`+
        peopleHdr("All people · senior first")+
        `<div class="emps">${list.slice().sort(bySeniority).map((e,i)=>empCard(e,false)).join("")}</div>`;
      wireSpine(); wireCards(); wireAddHere(); return;
    }
    // lineageSpine() = apex + every ancestor down to the current node, so the
    // parent chain is always visible (Chairman › Facilities Mgmt › Fleet › …)
    const plan = planLevel(path.length, list);   // skip redundant single-group levels
    if(plan.field){ // group level
      const f = plan.field;
      const isLeafParent = (plan.depth === hierarchy.length-1);
      const parentScope = path.concat(plan.skipped);
      const groups = groupsAt(f, list);
      const extra = emptyNamesAt(parentScope, f).filter(n=>!groups.some(([g])=>g===n));
      const allGroups = groups.concat(extra.map(n=>[n,0]));
      const boxes = allGroups.map(([name,ct])=>{
        const sub = list.filter(e=>val(e,f)===name);
        return groupBox(f,name,ct,leadOf(sub),isLeafParent,sumPay(sub),true);
      });
      tree.innerHTML = lineageSpine()+`<div class="down"></div>`+groupAddHdr(f, parentScope)+childrenRow(boxes);
      wireSpine(); wireBoxes(f, plan.skipped); adjustBar();
      const ag=$("#add-group"); if(ag) ag.onclick=()=>openAddGroup(parentScope, f);
      const ap=$("#add-here-grp"); if(ap) ap.onclick=()=>{ const pre={}; parentScope.forEach(p=>pre[p.field]=p.value); openEditor(null, pre); };
    } else { // leaf: employees
      const {arr,lead}=peopleSorted(list);
      tree.innerHTML = lineageSpine()+`<div class="down"></div>`+
        peopleHdr("People · senior first")+
        `<div class="emps">${arr.map(e=>empCard(e, arr.length>1 && e===lead)).join("")}</div>`;
      wireSpine(); wireCards(); wireAddHere();
    }
  }

  function adjustBar(){
    const row=$(".children"); if(!row||row.classList.contains("single")||row.classList.contains("grid"))return;
    const kids=row.querySelectorAll(".child"); if(kids.length<2)return;
    const rB=row.getBoundingClientRect();
    const f=kids[0].getBoundingClientRect(), l=kids[kids.length-1].getBoundingClientRect();
    row.style.setProperty("--l",((f.left+f.width/2)-rB.left)+"px");
    row.style.setProperty("--r",(rB.right-(l.left+l.width/2))+"px");
  }
  window.addEventListener("resize",()=>{ if(currentField()) adjustBar(); });

  /* ---- wiring ---- */
  function wireBoxes(field, skipped){
    skipped = skipped || [];
    $$(".box").forEach(b=>{
      const name=b.dataset.name;
      b.onclick=()=>{ path=path.concat(skipped, [{field,value:name}]); render(); $(".stage").scrollTop=0; };
      const ad=b.querySelector(".bx-add"); if(ad) ad.onclick=(ev)=>{ev.stopPropagation();
        const gp=path.concat(skipped,[{field,value:name}]); const pre={}; gp.forEach(p=>pre[p.field]=p.value);
        openEditor(null, pre);};
      const rn=b.querySelector(".bx-ren"); if(rn) rn.onclick=(ev)=>{ev.stopPropagation(); openRename(field,name,skipped);};
      const mv=b.querySelector(".bx-move"); if(mv) mv.onclick=(ev)=>{ev.stopPropagation(); openGroupMove(field,name,skipped);};
      const dl=b.querySelector(".bx-del"); if(dl) dl.onclick=(ev)=>{ev.stopPropagation(); deleteGroup(field,name,skipped);};
    });
  }
  function wireCards(){
    if(!EDIT) return;
    $$(".ecard.draggable").forEach(c=>{
      const id=+c.dataset.id;
      c.ondragstart=(ev)=>{ev.dataTransfer.setData("text/plain",id);ev.dataTransfer.effectAllowed="move";c.classList.add("dragging");};
      c.ondragend=()=>c.classList.remove("dragging");
    });
    $$("[data-move]").forEach(btn=>btn.onclick=()=>openMove(+btn.dataset.move));
    $$("[data-lead]").forEach(btn=>btn.onclick=()=>setLead(+btn.dataset.lead));
    $$("[data-edit]").forEach(btn=>btn.onclick=()=>openEditor(+btn.dataset.edit));
  }

  /* jump the chart to a person's leaf and flash their card, so a moved person
     is never "lost" — the view follows them to their new home. */
  function focusPerson(e){
    if(viewMode==="tree") setView("drill");
    setChartExpanded(false);
    path = hierarchy.map(k=>({field:k,value:val(e,k)}));
    render(); $(".stage").scrollTop=0;
    setTimeout(()=>{ const card=document.querySelector(`.ecard[data-id="${e._id}"]`);
      if(card){ card.scrollIntoView({block:"center",behavior:"smooth"}); card.classList.remove("hl"); void card.offsetWidth; card.classList.add("hl"); } },70);
  }

  /* ---- move: transfer a person to a COMPLETE existing node ----
     Sets every field along targetPath, then fills any deeper level with a real
     existing child so we never create an orphan combo (e.g. Vision Office › SAP).
     Records each field change in the log. */
  function moveToNode(id, targetPath, opts){
    opts=opts||{};
    const e=EMP.find(x=>x._id===id); if(!e) return;
    const changes=[];
    targetPath.forEach(p=>{ const from=val(e,p.field); if(from!==p.value){ changes.push({field:p.field,from,to:p.value}); e[p.field]=p.value; } });
    let list=EMP.filter(x=>x._id!==id && targetPath.every(p=>val(x,p.field)===p.value));
    // fixDeeper (default true): keep deeper levels a real existing node, no orphan.
    // When false ("just a department") the rest of the person's path is left as-is.
    for(let d=targetPath.length; opts.fixDeeper!==false && d<hierarchy.length; d++){
      const f=hierarchy[d], g=groupsAt(f,list), cur=val(e,f);
      if(g.length && !g.some(([v])=>v===cur)){ const to=g[0][0]; changes.push({field:f,from:cur,to}); e[f]=to; }
      list=list.filter(x=>val(x,f)===val(e,f));
    }
    if(!changes.length){ toast(`${e.name} is already there`); return; }
    editCount++; logChange("Move", e, changes); saveDraft();
    const dest=hierarchy.map(f=>val(e,f)).filter(v=>v&&v!=="—").join(" › ");
    toast(`${e.name} → ${dest}`, changes.map(c=>fieldLabel(c.field)+": "+c.from+" → "+c.to).join("; "));
    focusPerson(e);   // follow the person to their new home so they're never lost
  }

  /* ---- single-person move: pick a destination, then apply scope ---- */
  let movingId=null;
  function openMove(id){
    const e=EMP.find(x=>x._id===id); if(!e) return;
    movingId=id;
    const top=fieldLabel(hierarchy[0]||"department");
    $("#mv-title").textContent=`Move ${e.name}`;
    $("#mv-msg").innerHTML=`Reassign <b>${esc(e.name)}</b> — ${esc(val(e,"position"))}. Pick a destination, then apply to the whole hierarchy or just the ${esc(top)}.`;
    $("#mv-target").innerHTML=`<option value="">Select destination…</option>`+moveOptionsHTML();
    $("#mv-dept").textContent=`Just the ${top}`;
    $("#mv-overlay").classList.add("show");
  }
  function doPersonMove(scope){
    const sel=$("#mv-target"); if(!sel || !sel.value){ toast("Pick a destination first"); return; }
    const id=movingId, tp=parsePathKey(sel.value);
    $("#mv-overlay").classList.remove("show");
    if(scope==="full") moveToNode(id, tp);
    else moveToNode(id, [tp[0]], {fixDeeper:false});
  }

  /* ---- generic choice dialog (returns a Promise of the chosen value) ---- */
  function choose(title, msg, options){
    return new Promise(res=>{
      $("#choice-title").textContent=title;
      $("#choice-msg").innerHTML=msg;
      const foot=$("#choice-foot"); foot.innerHTML="";
      const close=(v)=>{ $("#choice-overlay").classList.remove("show"); res(v); };
      options.forEach(o=>{ const b=document.createElement("button");
        b.className="mbtn "+(o.kind||"subtle"); b.textContent=o.label;
        b.onclick=()=>close(o.value); foot.appendChild(b); });
      const c=document.createElement("button"); c.className="mbtn subtle"; c.textContent="Cancel";
      c.onclick=()=>close(null); foot.appendChild(c);
      $("#choice-overlay").classList.add("show"); $("#choice-overlay").dataset.res="1";
      $("#choice-overlay")._cancel=()=>close(null);
    });
  }

  /* ---- assign / clear a manual Lead for a group ---- */
  function setLead(id){
    const e=EMP.find(x=>x._id===id); if(!e) return;
    const groupPath=hierarchy.map(f=>({field:f,value:val(e,f)}));
    const peers=EMP.filter(x=>groupPath.every(p=>val(x,p.field)===p.value));
    if(e.is_lead){ delete e.is_lead; logChange("Lead", e, [{field:"Lead",from:"Lead",to:"—"}]); toast(`${e.name} is no longer the Lead`); }
    else { peers.forEach(x=>{ if(x._id!==id) delete x.is_lead; }); e.is_lead=true;
      logChange("Lead", e, [{field:"Lead",from:"—",to:"Lead of "+(groupPath[groupPath.length-1]||{}).value}]); toast(`${e.name} set as Lead`); }
    editCount++; saveDraft(); render();
  }

  /* ---- move / copy an entire group (department or section) ---- */
  function groupPeople(field, name, skipped){
    const gp=path.concat(skipped||[], [{field,value:name}]);
    return { gp, people: EMP.filter(e=>gp.every(p=>val(e,p.field)===p.value)) };
  }
  /* destination picker options: every department AND every section (incl. newly
     added / empty ones), grouped, minus the group being moved and its subtree */
  function groupMoveOptions(excludeGp){
    const parent=excludeGp.slice(0,-1);
    const bad=(tp)=>
      (tp.length>=excludeGp.length && excludeGp.every((p,i)=>tp[i]&&tp[i].field===p.field&&String(tp[i].value)===String(p.value)))
      || sameScope(tp,parent);            // self / descendant, or the current parent (no-op)
    const top=hierarchy[0], secF=hierarchy[1];
    const depts=unitsAtTop().map(([v])=>[{field:top,value:v}]);
    const dOpts=depts.filter(tp=>!bad(tp))
      .map(tp=>`<option value="${esc(pathKey(tp))}">${esc(tp[0].value)}</option>`).join("");
    let sOpts="";
    if(secF) depts.forEach(dtp=>{
      const dv=dtp[0].value, ppl=EMP.filter(e=>val(e,top)===dv);
      const named=groupsAt(secF,ppl).map(([v])=>v).filter(v=>v&&v!=="—");
      const all=[...new Set(named.concat(emptyNamesAt([{field:top,value:dv}],secF)))];
      all.forEach(sv=>{ const tp=[{field:top,value:dv},{field:secF,value:sv}];
        if(!bad(tp)) sOpts+=`<option value="${esc(pathKey(tp))}">${esc(dv+" › "+sv)}</option>`; });
    });
    return `<optgroup label="${esc(fieldLabel(top))}s">${dOpts}</optgroup>`+
      (sOpts?`<optgroup label="${esc(fieldLabel(secF)||"Section")}s">${sOpts}</optgroup>`:"");
  }
  function openGroupMove(field, name, skipped){
    const {people, gp}=groupPeople(field,name,skipped);
    $("#gm-title").textContent=`Move ${fieldLabel(field)}: ${name}`;
    $("#gm-msg").innerHTML=`<b>${people.length}</b> ${people.length===1?"person":"people"}. `+
      `Pick where to put “${esc(name)}” — a ${esc(fieldLabel(hierarchy[0]).toLowerCase())} or a ${esc((fieldLabel(hierarchy[1])||"section").toLowerCase())} — then Move or Copy.`;
    $("#gm-target").innerHTML=groupMoveOptions(gp);
    $("#gm-overlay").dataset.field=field; $("#gm-overlay").dataset.name=name;
    $("#gm-overlay").dataset.skipped=JSON.stringify(skipped||[]);
    $("#gm-overlay").classList.add("show");
  }
  async function doGroupMove(mode){
    const ov=$("#gm-overlay"), field=ov.dataset.field, name=ov.dataset.name;
    const skipped=JSON.parse(ov.dataset.skipped||"[]");
    const tkey=$("#gm-target").value;
    if(!tkey){ ov.classList.remove("show"); return; }
    const TP=parsePathKey(tkey);
    const {people}=groupPeople(field,name,skipped);
    if(!people.length){ ov.classList.remove("show"); return; }
    ov.classList.remove("show");
    const iG=hierarchy.indexOf(field);
    const tLabel=TP.map(p=>p.value).join(" › ");
    // does this group hold named sub-groups (sections / sub-sections) under it?
    const childField=hierarchy[iG+1];
    const childVals=childField ? [...new Set(people.map(e=>val(e,childField)).filter(v=>v&&v!=="—"))] : [];
    let nest=true;                        // default: keep the group whole, nested under the target
    if(childVals.length){
      const cl=fieldLabel(childField).toLowerCase();
      const verb=mode==="copy"?"Copy":"Move";
      const c=await choose(`${verb} ${fieldLabel(field)}: ${name}`,
        `<b>${esc(name)}</b> holds <b>${childVals.length}</b> ${esc(cl)}${childVals.length===1?"":"s"}. `+
        `Keep it whole as a sub-unit under <b>${esc(tLabel)}</b> (${esc(tLabel)} › ${esc(name)} › …), `+
        `or move just its ${esc(cl)}s into <b>${esc(tLabel)}</b> and drop “${esc(name)}”?`,
        [{label:`Keep ${name} whole`, kind:"primary", value:"whole"},
         {label:`Just the ${cl}s`, value:"children"}]);
      if(c==null) return;                 // cancelled
      nest = (c==="whole");
    }
    applyGroupMove(people, iG, TP, mode, nest, {field, name});
  }
  /* perform the relocation/duplication. TP = target path (department, or
     department+section, …); nest keeps the group as a named sub-unit under TP,
     otherwise its children move straight into TP and the group name is dropped. */
  function applyGroupMove(people, iG, TP, mode, nest, meta){
    const single=people.length===1;
    const who=single ? val(people[0],"name") : `${meta.name} (${people.length} people)`;
    const tLabel=TP.map(p=>p.value).join(" › ");
    const insert=TP.length;                              // level the moved subtree lands at
    const maxL=deepestLevel(people, iG);
    const from=nest ? iG : iG+1;                          // include the group's own level, or skip it
    ensureDepth(insert + Math.max(0, maxL-from+1));
    const relocate=(dst,src)=>{
      const vals=[]; for(let L=from;L<=maxL;L++) vals.push(src[hierarchy[L]]);
      for(let i=0;i<TP.length;i++) dst[hierarchy[i]]=TP[i].value;
      for(let k=0;k<vals.length;k++) dst[hierarchy[insert+k]]=vals[k];
      for(let L=insert+vals.length; L<hierarchy.length; L++) dst[hierarchy[L]]="";   // clear leftovers
    };
    const to = nest ? tLabel+" › "+meta.name : tLabel;
    if(mode==="copy"){
      let nextId=EMP.reduce((m,e)=>Math.max(m,e._id),-1);
      people.forEach(src=>{ const {_id,...r}=src; relocate(r, src); EMP.push({...r,_id:++nextId}); });
      logChange("Copy", {emp_no:single?val(people[0],"emp_no"):"—",name:who}, [{field:fieldLabel(meta.field),from:meta.name,to}]);
      toast(`Copied ${who} → ${tLabel}${nest?" (kept whole)":""}`);
    } else {
      people.forEach(e=>relocate(e, e));
      logChange("Move", {emp_no:single?val(people[0],"emp_no"):"—",name:who}, [{field:fieldLabel(meta.field),from:meta.name,to}]);
      toast(`Moved ${who} → ${tLabel}${nest?" (kept whole)":""}`);
    }
    editCount++; saveDraft();
    // follow a moved single person to their new home; otherwise focus the target node
    if(mode!=="copy" && single){ focusPerson(people[0]); }
    else { path=TP.slice(); render(); $(".stage").scrollTop=0; }
  }
  /* ---- delete a whole group (department / section) ---- */
  async function deleteGroup(field, name, skipped){
    const {people, gp}=groupPeople(field,name,skipped);
    const empty=people.length===0;
    const msg = empty
      ? `Remove the empty ${esc(fieldLabel(field).toLowerCase())} <b>${esc(name)}</b>?`
      : `This removes the <b>${people.length}</b> people in <b>${esc(name)}</b> from the organisation. This cannot be undone except via Discard.`;
    const c=await choose(`Delete ${fieldLabel(field)}: ${name}`, msg,
      [{label: empty?`Remove ${name}`:`Delete ${people.length} people`, kind:"danger", value:"del"}]);
    if(c!=="del") return;
    if(!empty){ const ids=new Set(people.map(p=>p._id)); EMP=EMP.filter(e=>!ids.has(e._id)); }
    // drop the empty-group entry for this slot + any of its empty descendants
    CFG.emptyGroups=emptyGroups().filter(g=>
      !(g.length>=gp.length && gp.every((p,i)=>g[i]&&g[i].field===p.field&&String(g[i].value)===String(p.value))));
    editCount++;
    logChange("Remove", {emp_no:"—",name:`${name} (${people.length})`}, [{field:fieldLabel(field)+" deleted",from:name,to:"—"}]);
    // step out if we were inside the deleted group
    path=path.filter((p,i)=>!(p.field===field&&p.value===name));
    saveDraft(); render(); toast(empty?`Removed ${name}`:`Deleted ${name} (${people.length} people)`);
  }

  /* ---- name prompt (rename / add group), returns Promise<string|null> ---- */
  function promptName(title, note, initial, okLabel){
    return new Promise(res=>{
      $("#name-title").textContent=title;
      $("#name-note").innerHTML=note;
      const inp=$("#name-input"); inp.value=initial||"";
      $("#name-save").textContent=okLabel||"Save";
      const ov=$("#name-overlay");
      const done=(v)=>{ ov.classList.remove("show"); ov._cancel=null; res(v); };
      $("#name-save").onclick=()=>{ const v=inp.value.trim(); if(v) done(v); };
      $("#name-cancel").onclick=()=>done(null);
      inp.onkeydown=(e)=>{ if(e.key==="Enter"){e.preventDefault(); const v=inp.value.trim(); if(v) done(v);} else if(e.key==="Escape") done(null); };
      ov.classList.add("show"); ov._cancel=()=>done(null);
      setTimeout(()=>{ inp.focus(); inp.select(); },40);
    });
  }

  /* ---- rename a whole department / section (updates all its people) ---- */
  async function openRename(field, name, skipped){
    const parent=path.concat(skipped||[]);
    const cnt=EMP.filter(e=>parent.every(p=>val(e,p.field)===p.value)&&val(e,field)===name).length;
    const where=parent.map(p=>p.value).join(" › ")||CFG.orgName||"the top";
    const lbl=fieldLabel(field).toLowerCase();
    const note = cnt
      ? `Under <b>${esc(where)}</b>. Renames this ${esc(lbl)} for all <b>${cnt}</b> ${cnt===1?"person":"people"}.`
      : `Under <b>${esc(where)}</b>. This ${esc(lbl)} has no people yet.`;
    const nn=await promptName(`Rename ${fieldLabel(field)}`, note, name, "Rename");
    if(!nn || nn===name) return;
    const people=EMP.filter(e=>parent.every(p=>val(e,p.field)===p.value)&&val(e,field)===name);
    people.forEach(e=>{ e[field]=nn; });
    // keep any empty-group entries (self + descendants under this exact slot) in sync
    const idx=parent.length;
    emptyGroups().forEach(g=>{
      if(g.length>idx && g[idx] && g[idx].field===field && String(g[idx].value)===String(name)
        && parent.every((p,i)=>g[i]&&g[i].field===p.field&&String(g[i].value)===String(p.value)))
        g[idx]={field, value:nn};
    });
    editCount++; logChange("Rename", {emp_no:"—",name:`${nn} (${people.length})`}, [{field:fieldLabel(field),from:name,to:nn}]);
    path=path.map(p=>(p.field===field && p.value===name)?{field,value:nn}:p);   // keep breadcrumb valid
    saveDraft(); render(); toast(`Renamed ${name} → ${nn}`);
  }

  /* ---- add a new department / sub-department (confirms the parent, then adds
     its first person so the group actually exists) ---- */
  async function openAddGroup(parentPath, field){
    const lbl=fieldLabel(field).toLowerCase();
    const where=parentPath.map(p=>p.value).join(" › ")||CFG.orgName||"the top";
    const nn=await promptName(`New ${fieldLabel(field)}`,
      `Adds a new empty ${esc(lbl)} under <b>${esc(where)}</b>. You can assign people to it afterwards with ＋ Add person.`,
      "", "Add");
    if(!nn) return;
    const scope=parentPath.map(p=>({field:p.field,value:p.value}));
    const g=scope.concat([{field, value:nn}]);
    const existsReal = EMP.some(e=> g.every(p=>val(e,p.field)===p.value));
    const existsEmpty = emptyGroups().some(x=>sameScope(x,g));
    if(existsReal || existsEmpty){ toast(`“${nn}” already exists here`); return; }
    emptyGroups().push(g);
    editCount++;
    logChange("Add", {emp_no:"—",name:nn}, [{field:fieldLabel(field)+" added",from:"—",to:nn}]);
    path=g.slice();                              // drill straight into the new unit
    saveDraft(); render(); $(".stage").scrollTop=0;
    toast(`Added ${lbl} “${nn}”`, "empty for now — use ＋ Add person to fill it");
  }

  /* ---- employee editor / add ---- */
  let editingId=null;
  function openEditor(id, prefill){
    editingId=id;
    const e = id==null ? (prefill||{}) : EMP.find(x=>x._id===id) || {};
    $("#emp-title").textContent = id==null ? "Add person" : "Edit person";
    $("#emp-delete").style.display = id==null ? "none" : "";
    const body=$("#emp-fields");
    body.innerHTML = FIELDS.map(f=>{
      const cur = e[f.key]!=null ? e[f.key] : "";
      if(f.group){
        const existing=[...new Set(EMP.map(x=>x[f.key]).filter(v=>v!=null&&v!==""))].sort();
        const opts=existing.map(v=>`<option value="${esc(v)}"${v===cur?" selected":""}>${esc(v)}</option>`).join("");
        return `<div class="field"><label>${esc(f.label)}</label>
          <div class="combo">
            <select data-fk="${esc(f.key)}" data-sel>
              <option value="">— pick existing —</option>${opts}
            </select>
            <input data-fk="${esc(f.key)}" data-txt placeholder="or type new" value="${esc(opts.includes("selected")?"":cur)}">
          </div></div>`;
      }
      return `<div class="field"><label>${esc(f.label)}</label>
        <input data-fk="${esc(f.key)}" value="${esc(cur)}"></div>`;
    }).join("");
    // sync combo: typing clears select, selecting clears text
    body.querySelectorAll("[data-sel]").forEach(sel=>{
      sel.onchange=()=>{ const t=body.querySelector(`input[data-txt][data-fk="${cssEsc(sel.dataset.fk)}"]`); if(t&&sel.value)t.value=""; };
    });
    body.querySelectorAll("[data-txt]").forEach(t=>{
      t.oninput=()=>{ const s=body.querySelector(`select[data-sel][data-fk="${cssEsc(t.dataset.fk)}"]`); if(s&&t.value)s.value=""; };
    });
    $("#emp-overlay").classList.add("show");
  }
  function readEditor(){
    const out={}; const body=$("#emp-fields");
    FIELDS.forEach(f=>{
      const sel=body.querySelector(`select[data-sel][data-fk="${cssEsc(f.key)}"]`);
      const txt=body.querySelector(`input[data-txt][data-fk="${cssEsc(f.key)}"]`);
      const plain=body.querySelector(`input[data-fk="${cssEsc(f.key)}"]:not([data-txt])`);
      let v="";
      if(plain) v=plain.value.trim();
      else { v=(txt&&txt.value.trim()) || (sel&&sel.value) || ""; }
      out[f.key]=v;
    });
    return out;
  }
  function saveEditor(){
    const data=readEditor();
    if(!data.name){ toast("Name is required"); return; }
    if(editingId==null){
      const nextId=(EMP.reduce((m,e)=>Math.max(m,e._id),-1))+1;
      const rec={...data,_id:nextId}; EMP.push(rec); editCount++;
      logChange("Add", rec, [{field:"Person added", from:"—", to:`${data.position||""}`.trim()||"new record"}]);
      toast(`Added ${data.name}`);
    } else {
      const e=EMP.find(x=>x._id===editingId);
      const diffs=FIELDS.map(f=>({field:f.key,from:val(e,f.key),to:(data[f.key]==null||data[f.key]==="")?"—":data[f.key]}))
        .filter(c=>c.from!==c.to);
      Object.assign(e,data); editCount++;
      if(diffs.length) logChange("Edit", e, diffs);
      toast(`Saved ${data.name}`);
    }
    $("#emp-overlay").classList.remove("show");
    saveDraft(); render();
  }
  function deleteEditor(){
    if(editingId==null) return;
    const e=EMP.find(x=>x._id===editingId);
    if(!confirm(`Remove ${e.name} from the organisation?`)) return;
    logChange("Remove", e, [{field:"Person removed", from:`${val(e,"position")} · ${hierarchy.map(f=>val(e,f)).join(" › ")}`, to:"—"}]);
    EMP=EMP.filter(x=>x._id!==editingId); editCount++;
    $("#emp-overlay").classList.remove("show");
    saveDraft(); render(); toast(`Removed ${e.name}`);
  }

  /* ---- change log panel (separate "tab") ---- */
  function openLog(){ renderLog(); $("#log-overlay").classList.add("show"); }
  function renderLog(){
    const body=$("#log-body");
    if(!changeLog.length){
      body.innerHTML=`<p class="note" style="margin-top:0">No changes yet. Every move, edit, add or removal you make is recorded here as <b>As-is → To-be</b>, so you can review the whole set before publishing.</p>`;
      return;
    }
    const rows=changeLog.slice().reverse().map(c=>`<tr>
      <td class="lg-t">${esc(new Date(c.ts).toLocaleString())}</td>
      <td><span class="lg-type lg-${esc(String(c.type).toLowerCase())}">${esc(c.type)}</span></td>
      <td>${esc(c.name)} <span class="lg-id">#${esc(c.emp_no)}</span></td>
      <td>${esc(c.field)}</td>
      <td class="lg-from">${esc(String(c.from))}</td>
      <td class="lg-to">${esc(String(c.to))}</td>
    </tr>`).join("");
    body.innerHTML=`<div class="lg-wrap"><table class="lg">
      <thead><tr><th>When</th><th>Action</th><th>Employee</th><th>Field</th><th>As-is</th><th>To-be</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="note">${changeLog.length} change${changeLog.length===1?"":"s"} recorded. Export for a side-by-side as-is / to-be sheet.</p>`;
  }
  function exportLog(){
    const cols=["When","Action","Emp No","Employee","Field","As-is","To-be"];
    const cell=v=>{v=(v==null?"":String(v));return /[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
    const rows=changeLog.map(c=>[new Date(c.ts).toLocaleString(),c.type,c.emp_no,c.name,c.field,c.from,c.to].map(cell).join(","));
    download("organogram-changes.csv","﻿"+[cols.join(","),...rows].join("\r\n"),"text/csv;charset=utf-8");
    toast("Exported change log");
  }

  /* ---- As-is vs To-be comparison ----
     RAW = the published (committed) data = baseline "as-is".
     EMP = the current working set = "to-be". Compared by the top level. */
  function aggBy(arr, field){
    const m=new Map();
    for(const e of arr){ const k=(e[field]==null||e[field]==="")?"—":e[field];
      const o=m.get(k)||{n:0,g:0,p:0}; o.n++; o.g+=numv(e.gross); o.p+=numv(e.net); m.set(k,o); }
    return m;
  }
  function compareRows(){
    const field=hierarchy[0]||"department";
    const A=aggBy(RAW,field), B=aggBy(EMP,field);
    const keys=[...new Set([...A.keys(),...B.keys()])].sort();
    return {field, A, B, keys};
  }
  function openCompare(){ renderCompare(); $("#cmp-overlay").classList.add("show"); }
  /* The original published organogram (As-is), rendered intact from RAW as a
     CHART (boxes + connectors). Collapsed = top level under the Chairman;
     "Expand all" blows the whole tree open. Always read-only reference. */
  const blOpen=new Set();   // expanded node keys in the As-is chart (per-node)
  const blKey=(p)=>p.map(x=>x.field+"="+x.value).join("|");
  /* a compact person node for the expanded baseline chart (the leaves) */
  function blPerson(e,isLead){
    return `<div class="pnode${isLead?" lead":""}${e.absent?" absent":""}">
      <div class="pn-top">
        <span class="pn-av" style="background:${color(val(e,hierarchy[0]||"department"),42,55)}">${esc(initials(val(e,"name")))}</span>
        <span class="pn-id">#${esc(val(e,"emp_no"))}</span>
      </div>
      <div class="pn-name">${esc(val(e,"name"))}${isLead?'<span class="leadtag">Lead</span>':""}</div>
      <div class="pn-pos">${esc(val(e,"position"))}</div>
      ${ROLLUPS.length?`<div class="pn-pay"><span class="m-gross">${e.gross?esc(money(e.gross)):"—"}</span> <span class="m-net">${e.net?esc(money(e.net)):"—"}</span></div>`:""}
    </div>`;
  }
  /* every group node key in the baseline (for global Expand all) */
  function allBlKeys(list){
    const keys=[];
    (function walk(p,sub){ const f=hierarchy[p.length]; if(!f) return;
      for(const [name] of groupsAt(f,sub)){ const np=p.concat([{field:f,value:name}]);
        keys.push(blKey(np)); walk(np, sub.filter(e=>val(e,f)===name)); } })([],list);
    return keys;
  }
  /* one level of the baseline chart; a group's children are drawn only when its
     own node is in blOpen — so you can open a single department on its own */
  function blTree(p, list){
    const field=hierarchy[p.length];
    if(!field){ // leaf -> people
      const arr=list.slice().sort(bySeniority), lead=arr[0];
      const cells=arr.map(e=>`<div class="child"><div class="boxwrap">${blPerson(e, arr.length>1&&e===lead)}</div></div>`);
      const cls=cells.length===1?"children single":"children chart-row";
      return `<div class="${cls}">${cells.join("")}</div>`;
    }
    const isLeafParent=(p.length===hierarchy.length-1);
    const cells=groupsAt(field,list).map(([name,ct])=>{
      const np=p.concat([{field,value:name}]), key=blKey(np);
      const sub=list.filter(e=>val(e,field)===name), open=blOpen.has(key);
      const box=groupBox(field,name,ct,leadOf(sub),isLeafParent,sumPay(sub));
      const below = open ? `<div class="down"></div>`+blTree(np,sub) : "";
      return `<div class="child"><div class="boxwrap${open?" open":""}" data-blkey="${esc(key)}">${box}</div>${below}</div>`;
    });
    const cls=cells.length===1?"children single":"children chart-row";
    return `<div class="${cls}">${cells.join("")}</div>`;
  }
  function baselineChart(){
    const blData=reindex(RAW);
    const topField=hierarchy[0];
    const units=topField?groupsAt(topField,blData).length:0;
    const s=sumPay(blData);
    const allOpen = topField && blOpen.size>=allBlKeys(blData).length && blOpen.size>0;
    const apex=`<div class="node apex">
      <div class="role-eyebrow">${esc(CFG.orgName||"Organisation")}</div>
      <div class="nm">CHAIRMAN</div>
      <div class="hc"><span class="pic">👥</span> ${blData.length.toLocaleString()} employees${topField?` · ${units} ${esc(fieldLabel(topField).toLowerCase())}s`:""}</div>
      ${ROLLUPS.length?`<div class="hc money full"><span class="m-gross">Gross ${money(s.g)}</span> · <span class="m-net">Payment ${money(s.n)}</span></div>`:""}
    </div>`;
    const body = topField ? blTree([],blData) : "";
    return `<div class="bl-head">
        <span class="bl-title">Original organogram (As-is)</span>
        <span class="bl-hint">Click a department to open it.</span>
        <button class="tbtn" id="bl-toggle">${allOpen?"⊟ Collapse all":"⊞ Expand all"}</button>
      </div>
      <div class="bl-chart"><div class="chart-canvas">${apex}${body?`<div class="down"></div>`+body:""}</div></div>`;
  }
  function renderCompare(){
    $("#cmp-body").innerHTML=baselineChart();
    const bt=$("#bl-toggle"); if(bt) bt.onclick=()=>{
      const blData=reindex(RAW), all=allBlKeys(blData);
      if(blOpen.size>=all.length && blOpen.size>0) blOpen.clear();   // collapse all
      else all.forEach(k=>blOpen.add(k));                            // expand all
      renderCompare();
    };
    // click a department/section box to open or close just that node
    $$(".bl-chart .boxwrap[data-blkey]").forEach(w=>w.onclick=(ev)=>{
      ev.stopPropagation();
      const k=w.dataset.blkey; blOpen.has(k)?blOpen.delete(k):blOpen.add(k); renderCompare();
    });
  }
  function exportCompare(){
    const {field,A,B,keys}=compareRows();
    const cell=v=>{v=(v==null?"":String(v));return /[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
    const head=[fieldLabel(field),"As-is people","To-be people","Δ people","As-is payment","To-be payment","Δ payment"];
    const rows=keys.map(k=>{const a=A.get(k),b=B.get(k);
      return [k,a?a.n:0,b?b.n:0,(b?b.n:0)-(a?a.n:0),a?a.p:0,b?b.p:0,(b?b.p:0)-(a?a.p:0)].map(cell).join(",");});
    const ta=sumPay(RAW),tb=sumPay(EMP);
    rows.push(["TOTAL",RAW.length,EMP.length,EMP.length-RAW.length,ta.n,tb.n,tb.n-ta.n].map(cell).join(","));
    download("organogram-asis-vs-tobe.csv","﻿"+[head.join(","),...rows].join("\r\n"),"text/csv;charset=utf-8");
    toast("Exported As-is vs To-be");
  }

  /* ---- settings: hierarchy editor ---- */
  function openSettings(){ renderLevels(); $("#set-overlay").classList.add("show"); }
  function renderLevels(){
    const list=$("#lvl-list");
    list.innerHTML = hierarchy.map((k,i)=>`
      <div class="lvl">
        <span class="grip">⋮⋮</span>
        <span class="ln">${esc(fieldLabel(k))}</span>
        <span class="lk">${esc(k)}</span>
        <span class="ctrls">
          <button data-up="${i}" ${i===0?"disabled":""} title="Move up">↑</button>
          <button data-down="${i}" ${i===hierarchy.length-1?"disabled":""} title="Move down">↓</button>
          <button data-remove="${i}" title="Remove">✕</button>
        </span>
      </div>`).join("") || `<p class="note">No levels — everyone shows as a flat list under the top.</p>`;
    const avail = groupableFields().filter(k=>!hierarchy.includes(k));
    $("#add-lvl-sel").innerHTML = avail.length
      ? avail.map(k=>`<option value="${esc(k)}">${esc(fieldLabel(k))}</option>`).join("")
      : `<option value="">All fields in use</option>`;
    $("#add-lvl-btn").disabled = !avail.length;
    list.querySelectorAll("[data-up]").forEach(b=>b.onclick=()=>{const i=+b.dataset.up;[hierarchy[i-1],hierarchy[i]]=[hierarchy[i],hierarchy[i-1]];applyHierarchy();});
    list.querySelectorAll("[data-down]").forEach(b=>b.onclick=()=>{const i=+b.dataset.down;[hierarchy[i+1],hierarchy[i]]=[hierarchy[i],hierarchy[i+1]];applyHierarchy();});
    list.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{hierarchy.splice(+b.dataset.remove,1);applyHierarchy();});
  }
  function applyHierarchy(){ path=[]; renderLevels(); render(); }
  $("#add-lvl-btn") && ($("#add-lvl-btn").onclick=()=>{ const v=$("#add-lvl-sel").value; if(v){hierarchy.push(v);applyHierarchy();} });

  /* ---- search ---- */
  const results=$("#results");
  $("#search").oninput=function(){
    const raw=this.value, q=norm(raw).trim();
    if(!q){results.classList.remove("show");return;}
    const hits=EMP.filter(e=>norm(e.name).includes(q)||norm(e.position).includes(q)||
      norm(e.section).includes(q)||norm(e.department).includes(q)||norm(e.emp_no).includes(q)).slice(0,40);
    if(!hits.length){results.innerHTML=`<div class="res-empty">No one matches “${esc(raw)}”.</div>`;results.classList.add("show");return;}
    results.innerHTML=hits.map(e=>`<div class="res" data-id="${e._id}">
      <div class="ravatar" style="background:${color(val(e,hierarchy[0]||"department"),42,55)}">${esc(initials(val(e,"name")))}</div>
      <div style="min-width:0"><div class="rn">${esc(val(e,"name"))}</div><div class="rp">${esc(val(e,"position"))}</div>
      <div class="rpath">${hierarchy.map(k=>esc(val(e,k))).join(" › ")||esc(val(e,"department"))}</div></div></div>`).join("");
    results.classList.add("show");
    results.querySelectorAll(".res").forEach(r=>r.onclick=()=>{
      const e=EMP.find(x=>x._id===+r.dataset.id);
      if(viewMode==="tree") setView("drill");                 // jump back to the chart to focus a person
      path = hierarchy.map(k=>({field:k,value:val(e,k)}));   // focus down to their leaf group
      results.classList.remove("show"); $("#search").value=""; render(); $(".stage").scrollTop=0;
      setTimeout(()=>{const card=document.querySelector(`.ecard[data-id="${e._id}"]`);
        if(card){card.scrollIntoView({block:"center",behavior:"smooth"});card.classList.add("hl");}},60);
    });
  };
  document.addEventListener("click",ev=>{ if(!ev.target.closest(".results")&&!ev.target.closest(".searchwrap")) results.classList.remove("show"); });

  /* ---- export ---- */
  function download(name, text, type){
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([text],{type:type||"text/plain;charset=utf-8"}));
    a.download=name; a.click(); URL.revokeObjectURL(a.href);
  }
  function exportEmployeesJS(){
    const recs=strip(EMP).map(r=>"  "+JSON.stringify(r));
    const body="// Evoke org data — edit here or use the in-app editor.\n// One record per line keeps Git diffs clean.\nwindow.EVOKE_DATA = [\n"+recs.join(",\n")+"\n];\n";
    download("employees.js", body, "text/javascript;charset=utf-8");
    committedSnapshot = serialize(EMP); try{localStorage.removeItem(LS_KEY);}catch(e){}
    refreshBanner(); toast("Exported employees.js","Replace data/employees.js and commit");
  }
  function exportCSV(){
    const cols=FIELDS.map(f=>f.label);
    const keys=FIELDS.map(f=>f.key);
    const cell=v=>{v=(v==null?"":String(v));return /[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
    const rows=strip(EMP).map(e=>keys.map(k=>cell(e[k])).join(","));
    download("employees.csv","\ufeff"+[cols.join(","),...rows].join("\r\n"),"text/csv;charset=utf-8");
    toast("Exported CSV");
  }
  function exportJSON(){ download("employees.json", JSON.stringify(strip(EMP),null,2), "application/json"); toast("Exported JSON"); }
  function exportConfig(){
    const cfg={...CFG, hierarchy:hierarchy.slice()};
    const body="window.ORG_CONFIG = "+JSON.stringify(cfg,null,2)+";\n";
    download("config.js", body, "text/javascript;charset=utf-8");
    toast("Exported config.js","Replace js/config.js and commit");
  }

  /* ---- bind editing chrome (idempotent; safe to call after a cloud login) ---- */
  let editBound=false;
  function bindEdit(){
    if(editBound) return; editBound=true;
    $("#add-btn").onclick=()=>openEditor(null);
    $("#settings-btn").onclick=openSettings;
    $("#emp-save").onclick=saveEditor;
    $("#emp-delete").onclick=deleteEditor;
    const gmv=$("#gm-move"); if(gmv) gmv.onclick=()=>doGroupMove("move");
    const gcp=$("#gm-copy"); if(gcp) gcp.onclick=()=>doGroupMove("copy");
    const mvf=$("#mv-full"); if(mvf) mvf.onclick=()=>doPersonMove("full");
    const mvd=$("#mv-dept"); if(mvd) mvd.onclick=()=>doPersonMove("dept");
    const cb=$("#changes-btn"); if(cb) cb.onclick=openLog;
    const cmpb=$("#compare-btn"); if(cmpb) cmpb.onclick=openCompare;
    const cmpx=$("#cmp-export"); if(cmpx) cmpx.onclick=exportCompare;
    const lx=$("#log-export"); if(lx) lx.onclick=exportLog;
    const lc=$("#log-clear"); if(lc) lc.onclick=()=>{
      if(!changeLog.length||!confirm("Clear the entire change log?"))return;
      changeLog=[]; saveDraft(); updateChangesBadge(); renderLog(); toast("Change log cleared");
    };
    updateChangesBadge();
  }

  /* ---- bind chrome ---- */
  function bind(){
    // export menu
    const pop=$("#export-pop");
    $("#export-btn").onclick=(e)=>{e.stopPropagation();pop.classList.toggle("show");};
    document.addEventListener("click",e=>{ if(!e.target.closest(".menu")) pop.classList.remove("show"); });
    pop.querySelectorAll("[data-exp]").forEach(b=>b.onclick=()=>{
      pop.classList.remove("show");
      ({js:exportEmployeesJS,csv:exportCSV,json:exportJSON,config:exportConfig}[b.dataset.exp]||(()=>{}))();
    });
    // banner
    const be=$("#banner-export"); if(be) be.onclick=exportEmployeesJS;
    const bd=$("#banner-discard"); if(bd) bd.onclick=()=>{
      if(!confirm("Discard local edits and return to the published data?"))return;
      try{localStorage.removeItem(LS_KEY);localStorage.removeItem(LS_LOG);}catch(e){}
      EMP=reindex(RAW); editCount=0; changeLog=[]; updateChangesBadge(); path=[]; refreshBanner(); render(); toast("Local edits discarded");
    };
    // view switcher: Chart (drill, with parent lineage) <-> Hierarchy (outline).
    // Available to everyone, including read-only viewers.
    $$("#viewseg button").forEach(b=>b.onclick=()=>{
      if(b.dataset.view!==viewMode){ setView(b.dataset.view); render(); $(".stage").scrollTop=0; }
    });
    // Chart view: blow open / collapse every branch at once
    const ce=$("#chart-expand");
    if(ce) ce.onclick=()=>{ if(viewMode!=="drill") setView("drill"); setChartExpanded(!chartExpanded); render(); $(".stage").scrollTop=0; $(".stage").scrollLeft=0; };
    // editor modal + change log (may be (re)bound after a cloud login)
    if(EDIT) bindEdit();
    $$("[data-close]").forEach(x=>x.onclick=()=>$$(".overlay").forEach(o=>o.classList.remove("show")));
    $$(".overlay").forEach(o=>o.onclick=(e)=>{ if(e.target===o) o.classList.remove("show"); });
    document.addEventListener("keydown",e=>{ if(e.key==="Escape"){$$(".overlay").forEach(o=>o.classList.remove("show"));results.classList.remove("show");} });
  }

  /* ---- toast ---- */
  let toastT;
  function toast(m,sub){
    $("#toast-msg").innerHTML=esc(m)+(sub?` <span style="color:var(--muted-dk)">· ${esc(sub)}</span>`:"");
    const t=$("#toast"); t.classList.add("show"); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),2600);
  }

  /* ---- public API for the optional cloud layer (js/cloud.js) ----
     Lets Supabase load data in, unlock editing after login, and read the
     working set out to publish. No-op surface when cloud isn't configured. */
  function setEditAllowed(on){
    const rb=document.getElementById("ro-badge"); if(rb) rb.style.display = on ? "none" : "";  // hide "View only" once signed in
    if(on && !EDIT){
      EDIT=true; document.body.classList.remove("readonly");
      // now that we can edit, pick up any local draft + change log
      try{ const d=localStorage.getItem(LS_KEY); if(d){ const a=JSON.parse(d); if(Array.isArray(a)&&a.length) EMP=reindex(a); } }catch(e){}
      try{ const l=localStorage.getItem(LS_LOG); if(l){ const a=JSON.parse(l); if(Array.isArray(a)) changeLog=a; } }catch(e){}
      bindEdit(); render(); refreshBanner();
    }else if(!on && EDIT){
      EDIT=false; document.body.classList.add("readonly"); render();
    }
  }
  /* Replace the published baseline (and the working set, unless there are
     unsaved local edits) with data loaded from the cloud. */
  function applyData(emps, cfg, opts){
    opts=opts||{};
    const wasDirty = dirty();
    if(cfg && Array.isArray(cfg.hierarchy)) hierarchy=cfg.hierarchy.slice();
    if(cfg && Array.isArray(cfg.fields)) cfg.fields.forEach(f=>{ if(f&&f.key&&!FIELDS.some(x=>x.key===f.key)) FIELDS.push(f); });
    if(cfg && Array.isArray(cfg.emptyGroups) && (opts.force || !wasDirty)) CFG.emptyGroups=cfg.emptyGroups.slice();
    if(Array.isArray(emps)){
      RAW.length=0; emps.forEach(r=>RAW.push(r));      // cloud is now the baseline
      committedSnapshot = JSON.stringify(emps);
      if(opts.force || !wasDirty) EMP=reindex(emps);   // don't clobber unsaved edits
    }
    path=[]; stats(); render(); refreshBanner();
  }
  window.ORG = {
    cloud: CLOUD,
    wantsEdit: wantEdit,
    setEditAllowed, applyData,
    isDirty: ()=>dirty(),
    currentData: ()=>strip(EMP),
    currentConfig: ()=>({...CFG, hierarchy:hierarchy.slice()}),
    markSaved: ()=>{ committedSnapshot=serialize(EMP); try{localStorage.removeItem(LS_KEY);}catch(e){} refreshBanner(); },
    toast: (m,sub)=>toast(m,sub),
    onEdit: null   // cloud.js sets this to auto-publish edits (debounced)
  };

  /* ---- go ---- */
  init(); bind(); render(); refreshBanner();
})();
