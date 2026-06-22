/* =====================================================================
   Evoke Organogram — application logic
   No build step, no dependencies. Pure browser JS.
   ===================================================================== */
(function () {
  "use strict";

  const CFG = window.ORG_CONFIG || {};
  const RAW = (window.EVOKE_DATA || []).slice();
  const LS_KEY = "evoke_org_draft_v1";
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

  /* ---- seniority ranking (lower = more senior) ---- */
  const RANKS = [
    [0,/chairman/],[1,/chief|\bceo\b|founder|president/],
    [2,/director|head of|\bhead\b|board|senior general manager|\bsgm\b/],
    [4,/deputy general manager|\bdgm\b/],[3,/general manager|\bgm\b|zonal head|regional head/],
    [5,/senior manager/],[7,/deputy manager|assistant manager|\bam\b|asst/],
    [6,/manager/],[8,/\blead\b|qualifier/],[9,/senior /],
    [10,/executive|engineer|officer|advisor|consultant|architect|analyst|specialist|coordinator|designer|relationship/],
    [11,/supervisor/],[12,/technician|operator|draftsman|visualizer|controller/],
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
    refreshBanner();
  }
  function refreshBanner(){
    const b=$("#banner"); if(!b) return;
    b.classList.toggle("show", dirty());
  }

  /* ---- aggregation against current path ---- */
  function matchesPath(e){ return path.every((p)=> val(e,p.field) === p.value ); }
  function scoped(){ return EMP.filter(matchesPath); }
  function currentField(){ return hierarchy[path.length]; }   // undefined => leaf
  function groupsAt(field, list){
    const m=new Map();
    for(const e of list){ const k=val(e,field); m.set(k,(m.get(k)||0)+1); }
    return [...m.entries()].sort((a,b)=>b[1]-a[1]);
  }
  function leadOf(list){ return list.slice().sort(bySeniority)[0]; }
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
          reassign(id, topField, name);};
      }
      box.appendChild(el);
    }
  }

  /* ---- node markup ---- */
  function apexNode(){
    const t=topPerson()||{};
    const topField=hierarchy[0];
    const units = topField? groupsAt(topField,EMP).length : 0;
    return `<div class="node apex">
      <div class="role-eyebrow">${esc(val(t,"position"))}</div>
      <div class="nm">${esc(val(t,"name"))}</div>
      <div class="sub">${esc(val(t,"department"))} · ${esc(val(t,"company"))}</div>
      <div class="hc">▦ ${EMP.length.toLocaleString()} employees${topField?` · ${units} ${esc(fieldLabel(topField).toLowerCase())}s`:""}</div>
    </div>`;
  }
  function parentHeader(){
    const last=path[path.length-1];
    return `<div class="node">
      <div class="role-eyebrow">${esc(fieldLabel(last.field))}</div>
      <div class="nm">${esc(last.value)}</div>
      <div class="hc">▦ ${scoped().length.toLocaleString()} people</div>
    </div>`;
  }
  function groupBox(field,name,count,lead,isLeafParent){
    return `<div class="box" data-name="${esc(name)}">
      <div class="swatch" style="background:${color(name)}"></div>
      <div class="bname">${esc(name)}</div>
      ${lead?`<div class="lead">${isLeafParent?"Senior":"Lead"}: <b>${esc(lead.name)}</b><span>${esc(lead.position)}</span></div>`:""}
      <div class="foot"><div class="cnt">${count} <span>${count===1?"person":"people"}</span></div><div class="go">open ›</div></div>
    </div>`;
  }
  function childrenRow(arr){
    const cls="children"+(arr.length===1?" single":"");
    return `<div class="${cls}">${arr.map(b=>`<div class="child">${b}</div>`).join("")}</div>`;
  }

  function empCard(e,isLead){
    const drag = EDIT? " draggable" : "";
    const chips = CHIPS.map(k=>`<span class="chip">${esc(val(e,k))}</span>`).join("");
    let actions="";
    if(EDIT){
      const last = path[path.length-1];
      const moveField = last ? last.field : hierarchy[hierarchy.length-1];
      let move="";
      if(moveField){
        const opts = groupsAt(moveField,EMP).map(([v])=>v).filter(v=>v!==val(e,moveField))
          .map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
        move=`<select data-id="${e._id}" data-field="${esc(moveField)}" title="Move to another ${esc(fieldLabel(moveField))}">
          <option value="">Move ${esc(fieldLabel(moveField))}…</option>${opts}</select>`;
      }
      actions=`<div class="ec-actions">${move}<button class="iconbtn" data-edit="${e._id}">Edit</button></div>`;
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

  /* ---- main render ---- */
  function render(){
    stats(); renderCrumbs(); renderSidebar();
    const tree=$("#tree");
    const field=currentField();
    const list=scoped();
    if(path.length===0 && hierarchy.length===0){
      // no hierarchy configured -> everyone as leaves
      tree.innerHTML = apexNode()+`<div class="down"></div>`+
        `<div class="grouphdr">All people · senior first</div>`+
        `<div class="emps">${list.slice().sort(bySeniority).map((e,i)=>empCard(e,false)).join("")}</div>`;
      wireCards(); return;
    }
    if(field){ // group level
      const isLeafParent = (path.length === hierarchy.length-1);
      const groups = groupsAt(field, list);
      const boxes = groups.map(([name,ct])=>{
        const sub = list.filter(e=>val(e,field)===name);
        return groupBox(field,name,ct,leadOf(sub),isLeafParent);
      });
      const head = path.length===0 ? apexNode() : parentHeader();
      tree.innerHTML = head+`<div class="down"></div>`+childrenRow(boxes);
      wireBoxes(field); adjustBar();
    } else { // leaf: employees
      const people=list.slice().sort(bySeniority);
      tree.innerHTML = parentHeader()+`<div class="down"></div>`+
        `<div class="grouphdr">People · senior first</div>`+
        `<div class="emps">${people.map((e,i)=>empCard(e,i===0&&people.length>1)).join("")}</div>`;
      wireCards();
    }
  }

  function adjustBar(){
    const row=$(".children"); if(!row||row.classList.contains("single"))return;
    const kids=row.querySelectorAll(".child"); if(kids.length<2)return;
    const rB=row.getBoundingClientRect();
    const f=kids[0].getBoundingClientRect(), l=kids[kids.length-1].getBoundingClientRect();
    row.style.setProperty("--l",((f.left+f.width/2)-rB.left)+"px");
    row.style.setProperty("--r",(rB.right-(l.left+l.width/2))+"px");
  }
  window.addEventListener("resize",()=>{ if(currentField()) adjustBar(); });

  /* ---- wiring ---- */
  function wireBoxes(field){
    $$(".box").forEach(b=>{
      const name=b.dataset.name;
      b.onclick=()=>{ path=path.concat([{field,value:name}]); render(); $(".stage").scrollTop=0; };
    });
  }
  function wireCards(){
    if(!EDIT) return;
    $$(".ecard.draggable").forEach(c=>{
      const id=+c.dataset.id;
      c.ondragstart=(ev)=>{ev.dataTransfer.setData("text/plain",id);ev.dataTransfer.effectAllowed="move";c.classList.add("dragging");};
      c.ondragend=()=>c.classList.remove("dragging");
    });
    $$(".ecard select").forEach(sel=>{
      sel.onchange=()=>{ if(sel.value) reassign(+sel.dataset.id, sel.dataset.field, sel.value); };
    });
    $$("[data-edit]").forEach(btn=>btn.onclick=()=>openEditor(+btn.dataset.edit));
  }

  /* ---- reassign (set a field's value) ---- */
  function reassign(id, field, value){
    const e=EMP.find(x=>x._id===id); if(!e||val(e,field)===value)return;
    const from=val(e,field); e[field]=value; editCount++;
    saveDraft(); toast(`${e.name}: ${fieldLabel(field)} → ${value}`,`was ${from}`); render();
    const u=document.querySelector(`.unit[data-name="${cssEsc(value)}"]`);
    if(u){u.classList.remove("flash");void u.offsetWidth;u.classList.add("flash");}
    const bx=document.querySelector(`.box[data-name="${cssEsc(value)}"]`);
    if(bx){bx.classList.remove("flash");void bx.offsetWidth;bx.classList.add("flash");}
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
      EMP.push({...data,_id:nextId}); editCount++;
      toast(`Added ${data.name}`);
    } else {
      const e=EMP.find(x=>x._id===editingId);
      Object.assign(e,data); editCount++;
      toast(`Saved ${data.name}`);
    }
    $("#emp-overlay").classList.remove("show");
    saveDraft(); render();
  }
  function deleteEditor(){
    if(editingId==null) return;
    const e=EMP.find(x=>x._id===editingId);
    if(!confirm(`Remove ${e.name} from the organisation?`)) return;
    EMP=EMP.filter(x=>x._id!==editingId); editCount++;
    $("#emp-overlay").classList.remove("show");
    saveDraft(); render(); toast(`Removed ${e.name}`);
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
      try{localStorage.removeItem(LS_KEY);}catch(e){}
      EMP=reindex(RAW); editCount=0; path=[]; refreshBanner(); render(); toast("Local edits discarded");
    };
    // editor modal
    if(EDIT){
      $("#add-btn").onclick=()=>openEditor(null);
      $("#settings-btn").onclick=openSettings;
      $("#emp-save").onclick=saveEditor;
      $("#emp-delete").onclick=deleteEditor;
    }
    $$("[data-close]").forEach(x=>x.onclick=()=>{$("#emp-overlay").classList.remove("show");$("#set-overlay").classList.remove("show");});
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
