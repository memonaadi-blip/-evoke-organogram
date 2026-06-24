/* =====================================================================
   Evoke Organogram — application logic
   No build step, no dependencies. Pure browser JS.
   ===================================================================== */
(function () {
  "use strict";

  const CFG = window.ORG_CONFIG || {};
  const RAW = (window.EVOKE_DATA || []).slice();
  const LS_KEY = "evoke_org_draft_v1";
  const LS_LOG = "evoke_org_log_v1";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));

  /* ---- editing gate: read-only unless allowed AND (editByDefault or ?edit=1) ---- */
  const params = new URLSearchParams(location.search);
  const wantsEdit = params.get("edit") === "1" || params.get("edit") === "true";
  const EDIT = !!CFG.allowEditing && (!!CFG.editByDefault || wantsEdit);
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
  const money = (n)=> "Rs " + Math.round(numv(n)).toLocaleString();
  function moneyShort(n){ n=Math.round(numv(n)); const a=Math.abs(n);
    if(a>=1e6) return "Rs "+(n/1e6).toFixed(1)+"M"; if(a>=1e3) return "Rs "+(n/1e3).toFixed(0)+"K";
    return "Rs "+n.toLocaleString(); }
  function fmtDate(s){ if(!s) return "—"; const d=new Date(s); return isNaN(d)? String(s)
    : d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); }
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

  function init(){
    EMP = reindex(RAW);
    committedSnapshot = serialize(EMP);
    if (EDIT){
      try{
        const d = localStorage.getItem(LS_KEY);
        if (d){ const arr = JSON.parse(d); if(Array.isArray(arr)&&arr.length){ EMP = reindex(arr); } }
      }catch(e){}
      try{
        const l = localStorage.getItem(LS_LOG);
        if (l){ const arr = JSON.parse(l); if(Array.isArray(arr)) changeLog = arr; }
      }catch(e){}
    }
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
    refreshBanner();
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
    const units = topField ? groupsAt(topField, EMP).length : 0;
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
    const units = groupsAt(topField, EMP);
    $("#side-total").textContent = units.length;
    const box=$("#unitlist"); box.innerHTML="";
    const activeTop = path[0] ? path[0].value : null;
    for(const [name,ct] of units){
      const el=document.createElement("div");
      el.className="unit"+(name===activeTop?" active":"");
      el.dataset.name=name;
      el.innerHTML=`<span class="sw" style="background:${color(name)}"></span>
        <span class="nm" title="${esc(name)}">${esc(name)}</span><span class="ct">${ct}</span>`;
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
    const units = topField? groupsAt(topField,EMP).length : 0;
    const s=sumPay(EMP);
    return `<div class="node apex">
      <div class="role-eyebrow">${esc(CFG.orgName||"Organisation")}</div>
      <div class="nm">CHAIRMAN</div>
      <div class="hc">▦ ${EMP.length.toLocaleString()} employees${topField?` · ${units} ${esc(fieldLabel(topField).toLowerCase())}s`:""}</div>
      ${ROLLUPS.length?`<div class="hc money">Σ ${moneyShort(s.n)} payment · ${moneyShort(s.g)} gross</div>`:""}
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
      <div class="hc">▦ ${sub.length.toLocaleString()} people</div>
      ${ROLLUPS.length?`<div class="hc money">Σ ${moneyShort(s.n)} payment · ${moneyShort(s.g)} gross</div>`:""}
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
        <button class="bx-move" title="Move / copy this ${esc(fieldLabel(field))}">↪</button>
        <button class="bx-del" title="Delete this ${esc(fieldLabel(field))}">✕</button>
      </div>`:""}
      <div class="swatch" style="background:${color(name)}"></div>
      <div class="bname">${esc(name)}</div>
      ${lead?`<div class="lead">${isLeafParent?"Senior":"Lead"}: <b>${esc(lead.name)}</b><span>${esc(lead.position)}</span></div>`:""}
      ${tot&&ROLLUPS.length?`<div class="boxpay"><b>${moneyShort(tot.n)}</b><span>payment · ${moneyShort(tot.g)} gross</span></div>`:""}
      <div class="foot"><div class="cnt">${count} <span>${count===1?"person":"people"}</span></div><div class="go">open ›</div></div>
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
      let move="";
      if(hierarchy.length){
        // options are filled lazily on first open (keeps big people lists fast)
        move=`<select class="movesel" data-id="${e._id}" data-empty="1" title="Move this person to another node"><option value="">Move to…</option></select>`;
      }
      const leadBtn=`<button class="iconbtn lead-btn${e.is_lead?" on":""}" data-lead="${e._id}" title="${e.is_lead?"Remove Lead":"Make Lead of this group"}">${e.is_lead?"★ Lead":"☆ Lead"}</button>`;
      actions=`<div class="ec-actions">${move}${leadBtn}<button class="iconbtn" data-edit="${e._id}">Edit</button></div>`;
    }
    return `<div class="ecard${isLead?" lead":""}${drag?" draggable":""}"${drag?' draggable="true"':""} data-id="${e._id}">
      <span class="ec-id">#${esc(val(e,"emp_no"))}</span>
      <div class="top">
        <div class="av" style="background:${color(val(e,hierarchy[0]||"department"),42,55)}">${esc(initials(val(e,"name")))}</div>
        <div style="min-width:0">
          <div class="ec-name">${esc(val(e,"name"))}${isLead?'<span class="leadtag">Lead</span>':""}</div>
          <div class="ec-pos">${esc(val(e,"position"))}</div>
        </div>
      </div>
      <div class="ec-meta">${chips}</div>
      ${ROLLUPS.length?`<div class="ec-pay">
        <span class="ecp"><label>Joined</label>${esc(fmtDate(e.doj))}</span>
        <span class="ecp"><label>Gross</label>${e.gross?esc(money(e.gross)):"—"}</span>
        <span class="ecp"><label>Payment</label>${e.net?esc(money(e.net)):"—"}</span>
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
        ${lead?`<span class="tlead">${esc(leafParent?"Senior":fieldLabel(field)+" lead")}: <b>${esc(lead.name)}</b></span>`:""}
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

  /* ---- main render ---- */
  function render(){
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
        `<div class="grouphdr">All people · senior first</div>`+
        `<div class="emps">${list.slice().sort(bySeniority).map((e,i)=>empCard(e,false)).join("")}</div>`;
      wireSpine(); wireCards(); return;
    }
    // lineageSpine() = apex + every ancestor down to the current node, so the
    // parent chain is always visible (Chairman › Facilities Mgmt › Fleet › …)
    const plan = planLevel(path.length, list);   // skip redundant single-group levels
    if(plan.field){ // group level
      const f = plan.field;
      const isLeafParent = (plan.depth === hierarchy.length-1);
      const groups = groupsAt(f, list);
      const boxes = groups.map(([name,ct])=>{
        const sub = list.filter(e=>val(e,f)===name);
        return groupBox(f,name,ct,leadOf(sub),isLeafParent,sumPay(sub),true);
      });
      tree.innerHTML = lineageSpine()+`<div class="down"></div>`+childrenRow(boxes);
      wireSpine(); wireBoxes(f, plan.skipped); adjustBar();
    } else { // leaf: employees
      const {arr,lead}=peopleSorted(list);
      tree.innerHTML = lineageSpine()+`<div class="down"></div>`+
        `<div class="grouphdr">People · senior first</div>`+
        `<div class="emps">${arr.map(e=>empCard(e, arr.length>1 && e===lead)).join("")}</div>`;
      wireSpine(); wireCards();
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
    $$(".ecard select.movesel").forEach(sel=>{
      const fill=()=>{ if(sel.dataset.empty){ sel.insertAdjacentHTML("beforeend", moveOptionsHTML()); delete sel.dataset.empty; } };
      sel.addEventListener("mousedown",fill);
      sel.addEventListener("focus",fill);
      sel.onchange=async ()=>{
        if(!sel.value) return;
        const id=+sel.dataset.id, tp=parsePathKey(sel.value), e=EMP.find(x=>x._id===id);
        const top=fieldLabel(hierarchy[0]);
        const dest=tp.map(x=>x.value).join(" › ");
        sel.value="";
        const c=await choose(`Move ${e.name}`,
          `Move to <b>${esc(dest)}</b>. Apply the move to…`,
          [{label:`Whole hierarchy`, kind:"primary", value:"full"},
           {label:`Just the ${esc(top)}`, kind:"subtle", value:"dept"}]);
        if(c==="full") moveToNode(id, tp);
        else if(c==="dept") moveToNode(id, [tp[0]], {fixDeeper:false});
      };
    });
    $$("[data-lead]").forEach(btn=>btn.onclick=()=>setLead(+btn.dataset.lead));
    $$("[data-edit]").forEach(btn=>btn.onclick=()=>openEditor(+btn.dataset.edit));
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
    render();
    const bx=document.querySelector(`.box[data-name="${cssEsc(targetPath[targetPath.length-1].value)}"]`);
    if(bx){bx.classList.remove("flash");void bx.offsetWidth;bx.classList.add("flash");}
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
  function openGroupMove(field, name, skipped){
    const {people}=groupPeople(field,name,skipped);
    const topField=hierarchy[0];
    const targets=groupsAt(topField,EMP).map(([v])=>v).filter(v=>v!==name &&
      !people.every(p=>val(p,topField)===v));   // exclude the current parent value
    $("#gm-title").textContent=`Move ${fieldLabel(field)}: ${name}`;
    $("#gm-msg").innerHTML=`<b>${people.length}</b> people. Choose the ${esc(fieldLabel(topField))} to move them under, then Move (relocate) or Copy (duplicate).`;
    $("#gm-target").innerHTML=targets.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
    $("#gm-overlay").dataset.field=field; $("#gm-overlay").dataset.name=name;
    $("#gm-overlay").dataset.skipped=JSON.stringify(skipped||[]);
    $("#gm-overlay").classList.add("show");
  }
  function doGroupMove(mode){
    const ov=$("#gm-overlay"), field=ov.dataset.field, name=ov.dataset.name;
    const skipped=JSON.parse(ov.dataset.skipped||"[]");
    const target=$("#gm-target").value; const topField=hierarchy[0];
    if(!target){ ov.classList.remove("show"); return; }
    const {people}=groupPeople(field,name,skipped);
    if(mode==="copy"){
      let nextId=EMP.reduce((m,e)=>Math.max(m,e._id),-1);
      people.forEach(src=>{ const {_id,...r}=src; r[topField]=target; EMP.push({...r,_id:++nextId}); });
      logChange("Copy", {emp_no:"—",name:`${name} (${people.length})`}, [{field:fieldLabel(field),from:name,to:target+" › "+name}]);
      toast(`Copied ${people.length} people of ${name} → ${target}`);
    } else {
      people.forEach(e=>{ e[topField]=target; });
      logChange("Move", {emp_no:"—",name:`${name} (${people.length})`}, [{field:fieldLabel(topField),from:"(group)",to:target}]);
      toast(`Moved ${people.length} people of ${name} → ${target}`);
    }
    editCount++; ov.classList.remove("show"); saveDraft(); render();
  }
  /* ---- delete a whole group (department / section) ---- */
  async function deleteGroup(field, name, skipped){
    const {people}=groupPeople(field,name,skipped);
    const c=await choose(`Delete ${fieldLabel(field)}: ${name}`,
      `This removes the <b>${people.length}</b> people in <b>${esc(name)}</b> from the organisation. This cannot be undone except via Discard.`,
      [{label:`Delete ${people.length} people`, kind:"danger", value:"del"}]);
    if(c!=="del") return;
    const ids=new Set(people.map(p=>p._id));
    EMP=EMP.filter(e=>!ids.has(e._id)); editCount++;
    logChange("Remove", {emp_no:"—",name:`${name} (${people.length})`}, [{field:fieldLabel(field)+" deleted",from:name,to:"—"}]);
    // step out if we were inside the deleted group
    path=path.filter((p,i)=>!(p.field===field&&p.value===name));
    saveDraft(); render(); toast(`Deleted ${name} (${people.length} people)`);
  }

  /* ---- employee editor / add ---- */
  let editingId=null;
  function openEditor(id){
    editingId=id;
    const e = id==null ? {} : EMP.find(x=>x._id===id) || {};
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
  function renderCompare(){
    const {field,A,B,keys}=compareRows();
    const dcell=(d,money)=>{ const cls=d>0?"up":d<0?"down":""; const s=d>0?"+":"";
      return `<td class="cmpd ${cls}">${d? s+(money?moneyShort(d):d) : "—"}</td>`; };
    const rows=keys.map(k=>{
      const a=A.get(k), b=B.get(k);
      const tag=!a?' <span class="cmp-tag add">new</span>':(!b?' <span class="cmp-tag rem">removed</span>':"");
      return `<tr class="${!a?"cmp-add":(!b?"cmp-rem":"")}">
        <td>${esc(k)}${tag}</td>
        <td>${a?a.n:0}</td><td>${b?b.n:0}</td>${dcell((b?b.n:0)-(a?a.n:0),false)}
        <td>${a?moneyShort(a.p):"—"}</td><td>${b?moneyShort(b.p):"—"}</td>${dcell((b?b.p:0)-(a?a.p:0),true)}
      </tr>`;
    }).join("");
    const ta=sumPay(RAW), tb=sumPay(EMP);
    const totals=`<tr class="cmp-total">
      <td>TOTAL</td><td>${RAW.length}</td><td>${EMP.length}</td>${dcell(EMP.length-RAW.length,false)}
      <td>${moneyShort(ta.n)}</td><td>${moneyShort(tb.n)}</td>${dcell(tb.n-ta.n,true)}</tr>`;
    $("#cmp-body").innerHTML=`<p class="note" style="margin-top:0">Baseline (<b>As-is</b>) is the published data; <b>To-be</b> is your current working set, compared by ${esc(fieldLabel(field))}.</p>
      <div class="lg-wrap"><table class="lg cmp">
      <thead><tr><th>${esc(fieldLabel(field))}</th><th>As-is ppl</th><th>To-be ppl</th><th>Δ</th>
        <th>As-is pay</th><th>To-be pay</th><th>Δ pay</th></tr></thead>
      <tbody>${rows}${totals}</tbody></table></div>`;
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
    // editor modal + change log
    if(EDIT){
      $("#add-btn").onclick=()=>openEditor(null);
      $("#settings-btn").onclick=openSettings;
      $("#emp-save").onclick=saveEditor;
      $("#emp-delete").onclick=deleteEditor;
      const gmv=$("#gm-move"); if(gmv) gmv.onclick=()=>doGroupMove("move");
      const gcp=$("#gm-copy"); if(gcp) gcp.onclick=()=>doGroupMove("copy");
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

  /* ---- go ---- */
  init(); bind(); render(); refreshBanner();
})();
