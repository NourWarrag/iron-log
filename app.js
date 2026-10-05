"use strict";
/* ---------- config ---------- */
const CFG = window.IRONLOG_CONFIG || {};
const CONFIGURED = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.startsWith("YOUR_") && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.startsWith("YOUR_");
const TEMPLATES = [
  {name:"Push", plate:"--p-red", ex:["Bench press","Incline dumbbell press","Overhead press","Cable fly","Triceps pushdown"]},
  {name:"Pull", plate:"--p-blue", ex:["Pull-up","Barbell row","Lat pulldown","Seated cable row","Face pull"]},
  {name:"Lower", plate:"--p-yellow", ex:["Deadlift","Romanian deadlift","Hip thrust","Lying leg curl","Calf raise"]},
  {name:"Arms & Shoulders", plate:"--p-green", ex:["Seated dumbbell press","Lateral raise","Barbell curl","Hammer curl","Overhead triceps extension"]},
];
const LIBRARY = ["Squat","Front squat","Leg press","Bulgarian split squat","Dips","Chin-up","Dumbbell bench press","Incline bench press","Rear delt fly","Shrug","Preacher curl","Skull crusher","Plank","Back extension","Good morning","T-bar row","Chest-supported row","Machine chest press","Pec deck","Leg extension","Seated leg curl","Hanging leg raise","Cable crunch","Farmer's carry"];
const PLATES = ["--p-red","--p-blue","--p-yellow","--p-green","--p-ink"];
const BIG3 = [
  {key:"Bench", re:/^(barbell |flat )?bench( press)?$/i},
  {key:"Squat", re:/^(back |barbell )?squat$/i},
  {key:"Deadlift", re:/^(conventional |barbell )?deadlift$/i},
];

/* ---------- state ---------- */
let sb=null, uid=null, email=null;
const S = {
  tab: load("tab") || "log",
  phase: "boot",            // boot | config | signin | sent | denied | ready
  members:{}, sessions:{}, active:null, saveMsg:"", saveCls:"",
  openItem:null, confirmDel:null, progEx:null, editNick:false, authMsg:"",
};

function load(k){try{return localStorage.getItem("ironlog."+k)}catch(e){return null}}
function store(k,v){try{localStorage.setItem("ironlog."+k,v)}catch(e){}}

/* ---------- helpers ---------- */
function h(tag, attrs, ...kids){
  const el=document.createElement(tag);
  if(attrs) for(const [k,v] of Object.entries(attrs)){
    if(v==null||v===false) continue;
    if(k.startsWith("on")) el.addEventListener(k.slice(2),v);
    else if(k==="class") el.className=v;
    else if(k==="value") el.value=v;
    else el.setAttribute(k,v===true?"":v);
  }
  for(const c of kids.flat()){ if(c==null||c===false) continue; el.append(c instanceof Node?c:document.createTextNode(String(c))); }
  return el;
}
const todayISO=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const fmtDate=iso=>{if(!iso)return"";const d=new Date(iso+"T12:00:00");return d.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})};
const kg=n=>n==null?"–":(Math.round(n*10)/10).toLocaleString("en-GB");
const e1rm=(w,r)=>(!w||!r)?0:(r===1?w:w*(1+r/30));
const vol=s=>(s.exercises||[]).reduce((a,e)=>a+(e.sets||[]).reduce((b,x)=>b+((x.w||0)*(x.r||0)),0),0);
const norm=s=>String(s||"").trim().toLowerCase();
const plateFor=id=>{let n=0;for(const c of id)n=(n*31+c.charCodeAt(0))>>>0;return PLATES[n%PLATES.length]};
const nickOf=id=>(S.members[id]&&S.members[id].nick)||"Someone";
const own=()=>(S.sessions[uid]||[]);
const ownDone=()=>own().filter(s=>s.finished);
const clone=o=>JSON.parse(JSON.stringify(o));
const newId=()=>(crypto.randomUUID?crypto.randomUUID():"10000000-1000-4000-8000-100000000000".replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)));
function weekStart(d=new Date()){const x=new Date(d);x.setHours(0,0,0,0);const day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);return x}
function bestSet(ex){let b=null;for(const s of ex.sets||[]){const v=e1rm(s.w,s.r);if(v&&(!b||v>b.e))b={w:s.w,r:s.r,e:v}}return b}
const fromRow=r=>({id:r.id,user_id:r.user_id,title:r.title,date:r.date,startedAt:Number(r.started_at),finished:r.finished,exercises:r.exercises||[]});

/* ---------- boot & auth ---------- */
async function init(){
  if(!CONFIGURED||!window.supabase){S.phase="config";render();return}
  sb=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange((ev,session)=>{ if(ev==="SIGNED_IN"&&session&&session.user.id!==uid) onSession(session); if(ev==="SIGNED_OUT"){uid=null;S.phase="signin";render()} });
  const {data}=await sb.auth.getSession();
  if(data.session) await onSession(data.session); else {S.phase="signin";render()}
}
async function onSession(session){
  uid=session.user.id; email=(session.user.email||"").toLowerCase();
  const {data,error}=await sb.from("crew_emails").select("email").limit(1);
  if(error||!data||!data.length){S.phase="denied";render();return}
  S.phase="ready";
  await refresh();
  const open=own().find(s=>!s.finished);
  if(open&&!S.active) S.active=clone(open);
  render();
  sb.channel("crew").on("postgres_changes",{event:"*",schema:"public",table:"sessions"},()=>refreshSoon())
    .on("postgres_changes",{event:"*",schema:"public",table:"profiles"},()=>refreshSoon()).subscribe();
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshSoon()});
}
async function sendLink(addr){
  addr=addr.trim().toLowerCase(); if(!addr) return;
  S.authMsg="Sending…"; render();
  const {error}=await sb.auth.signInWithOtp({email:addr,options:{emailRedirectTo:location.origin+location.pathname}});
  if(error){S.authMsg="Couldn't send the link: "+error.message;render();return}
  S.phase="sent"; S.authMsg=addr; render();
}
async function signOut(){await sb.auth.signOut();uid=null;S.active=null;S.members={};S.sessions={};S.phase="signin";render()}

/* ---------- data ---------- */
let refreshTimer=null;
function refreshSoon(){clearTimeout(refreshTimer);refreshTimer=setTimeout(async()=>{await refresh();render()},400)}
async function refresh(){
  const [p,s]=await Promise.all([
    sb.from("profiles").select("id,nick,joined_at"),
    sb.from("sessions").select("id,user_id,title,date,started_at,finished,exercises").order("started_at",{ascending:false}).limit(3000),
  ]);
  if(!p.error){const m={};for(const r of p.data)m[r.id]=r;S.members=m}
  if(!s.error){const g={};for(const r of s.data)(g[r.user_id]=g[r.user_id]||[]).push(fromRow(r));S.sessions=g}
}

/* ---------- saving ---------- */
let saveTimer=null, saving=false, again=false;
function queueSave(){S.saveMsg="Saving…";S.saveCls="";paintSave();clearTimeout(saveTimer);saveTimer=setTimeout(flush,900)}
async function flush(){
  const a=S.active; if(!a||!sb||!uid) return;
  if(saving){again=true;return}
  saving=true;
  const row={id:a.id,user_id:uid,title:a.title||"Workout",date:a.date||todayISO(),started_at:a.startedAt||Date.now(),finished:!!a.finished,updated_at:new Date().toISOString(),
    exercises:a.exercises.map(e=>({name:e.name,sets:e.sets.map(s=>({w:Number.isFinite(s.w)?s.w:null,r:Number.isFinite(s.r)?s.r:null}))}))};
  const {error}=await sb.from("sessions").upsert(row);
  if(error){S.saveMsg="Not saved yet, retrying";S.saveCls="bad";setTimeout(queueSave,2500)}
  else{S.saveMsg="Saved";S.saveCls="ok";const list=S.sessions[uid]=S.sessions[uid]||[];const i=list.findIndex(x=>x.id===row.id);const v=fromRow(row);if(i>=0)list[i]=v;else list.unshift(v)}
  saving=false; paintSave();
  if(again){again=false;await flush()}
}
function paintSave(){const el=document.getElementById("save");if(el){el.textContent=S.saveMsg;el.className="save "+S.saveCls}}

/* ---------- actions ---------- */
async function setNick(nick){
  nick=nick.trim().slice(0,24); if(!nick) return;
  const {error}=await sb.from("profiles").upsert({id:uid,nick});
  if(!error){S.members[uid]=Object.assign({},S.members[uid],{id:uid,nick});S.editNick=false}
  render();
}
function lastFor(title){return ownDone().find(s=>norm(s.title)===norm(title))}
function lastSetsFor(name, exceptId){
  for(const s of ownDone()){ if(s.id===exceptId) continue;
    const e=(s.exercises||[]).find(x=>norm(x.name)===norm(name));
    if(e&&e.sets&&e.sets.length) return {date:s.date,sets:e.sets};
  }
  return null;
}
function start(title, tplEx){
  const prev=lastFor(title);
  const exercises = prev
    ? prev.exercises.map(e=>({name:e.name,sets:e.sets.map(s=>({w:s.w,r:s.r}))}))
    : (tplEx||[]).map(n=>{const l=lastSetsFor(n);return {name:n,sets:l?l.sets.map(s=>({w:s.w,r:s.r})):[{w:null,r:null}]}});
  S.active={id:newId(),title,date:todayISO(),startedAt:Date.now(),finished:false,exercises};
  S.saveMsg=prev?"Prefilled from "+fmtDate(prev.date):""; S.saveCls="";
  render(); queueSave(); window.scrollTo({top:0});
}
async function finish(){
  if(!S.active) return;
  S.active.exercises=S.active.exercises.map(e=>({name:e.name,sets:e.sets.filter(s=>s.w||s.r)})).filter(e=>e.sets.length);
  S.active.finished=true;
  clearTimeout(saveTimer); await flush();
  if(S.saveCls==="bad"){S.active.finished=false;render();return}
  S.active=null; S.saveMsg=""; render();
}
async function discard(){
  const a=S.active; S.active=null; S.confirmDel=null; clearTimeout(saveTimer);
  S.sessions[uid]=own().filter(x=>x.id!==a.id); render();
  await sb.from("sessions").delete().eq("id",a.id);
}
async function delSession(id){
  S.confirmDel=null; S.openItem=null;
  S.sessions[uid]=own().filter(x=>x.id!==id); render();
  await sb.from("sessions").delete().eq("id",id);
}
function editSession(s){S.active=clone(s);S.saveMsg="Editing "+fmtDate(s.date);S.saveCls="";S.openItem=null;S.tab="log";render();window.scrollTo({top:0})}

/* ---------- views ---------- */
function render(){
  const app=document.getElementById("app"); app.replaceChildren();
  app.append(header());
  const tabsEl=document.getElementById("tabs");
  tabsEl.hidden=S.phase!=="ready";
  if(S.phase==="boot") app.append(h("div",{class:"panel empty"},"Loading your log…"));
  else if(S.phase==="config") app.append(h("div",{class:"notice"},"This copy isn't connected to a database yet. Add your Supabase URL and anon key to config.js (see README)."));
  else if(S.phase==="signin"||S.phase==="sent") app.append(signinView());
  else if(S.phase==="denied") app.append(h("div",{class:"panel stack"},h("h2",null,"Not on the crew list"),
    h("div",null,"You're signed in as ",h("b",null,email),", but this email hasn't been added yet. Ask the crew admin to add it, then reload."),
    h("button",{onclick:signOut},"Sign out")));
  else if(S.tab==="log") app.append(...logView());
  else if(S.tab==="progress") app.append(...progressView());
  else app.append(...crewView());
  if(S.phase==="ready") tabs();
}
function header(){
  const me=uid&&S.members[uid];
  return h("header",{class:"top"},
    h("div",null,h("h1",null,"Iron Log"),h("div",{class:"sub"},me?("Lifting as "+me.nick):"Workout log for the crew")),
    h("div",{class:"status"},new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})));
}
function tabs(){
  const t=document.getElementById("tabs"); t.replaceChildren();
  for(const [k,l] of [["log","Log"],["progress","Progress"],["crew","Crew"]])
    t.append(h("button",{"aria-current":S.tab===k?"page":null,onclick:()=>{S.tab=k;store("tab",k);render();window.scrollTo({top:0})}},l));
}
function signinView(){
  if(S.phase==="sent") return h("section",{class:"panel stack"},h("h2",null,"Check your email"),
    h("div",null,"We sent a sign-in link to ",h("b",null,S.authMsg),". Open it on this device to log in."),
    h("button",{class:"ghost",onclick:()=>{S.phase="signin";S.authMsg="";render()}},"Use a different email"));
  const inp=h("input",{id:"email",type:"email",class:"grow",placeholder:"you@example.com",autocomplete:"email"});
  const go=()=>sendLink(inp.value);
  inp.addEventListener("keydown",e=>{if(e.key==="Enter")go()});
  return h("section",{class:"panel stack"},h("h2",null,"Sign in"),
    h("div",{class:"muted small"},"Enter your email and we'll send you a one-tap login link. No password."),
    h("div",{class:"row"},inp,h("button",{class:"primary",onclick:go},"Send link")),
    S.authMsg?h("div",{class:"small"},S.authMsg):null);
}
function nickForm(){
  const inp=h("input",{id:"nick",class:"grow",placeholder:"e.g. Nour",maxlength:"24",value:(S.members[uid]&&S.members[uid].nick)||""});
  const go=()=>setNick(inp.value);
  inp.addEventListener("keydown",e=>{if(e.key==="Enter")go()});
  return h("div",{class:"panel stack"},
    h("h2",null,S.members[uid]?"Change your name":"Join the crew"),
    h("div",{class:"muted small"},"This is the name your friends see on the leaderboard."),
    h("div",{class:"row"},inp,h("button",{class:"primary",onclick:go},"Save")),
    S.members[uid]?h("button",{class:"ghost",onclick:()=>{S.editNick=false;render()}},"Cancel"):null);
}

function logView(){
  const out=[];
  if(!S.members[uid]){out.push(nickForm());return out}
  out.push(S.active?activeView():startView());
  out.push(...historyBlock());
  return out;
}
function startView(){
  const grid=h("div",{class:"tpl"});
  for(const t of TEMPLATES){
    const prev=lastFor(t.name);
    grid.append(h("button",{style:"--plate:var("+t.plate+")",onclick:()=>start(t.name,t.ex)},
      h("b",null,t.name),h("span",null,prev?"Last: "+fmtDate(prev.date)+" · repeats it":t.ex.length+" starter exercises")));
  }
  const seen=new Set(TEMPLATES.map(t=>norm(t.name))); const customs=[];
  for(const s of ownDone()){const k=norm(s.title);if(!seen.has(k)){seen.add(k);customs.push(s.title)}}
  const nameIn=h("input",{id:"custom-title",class:"grow",placeholder:"Name a custom workout"});
  const go=()=>{const v=nameIn.value.trim();if(v)start(v,[])};
  nameIn.addEventListener("keydown",e=>{if(e.key==="Enter")go()});
  return h("section",{class:"panel stack"},
    h("div",{class:"row between"},h("h2",null,"Start a workout"),h("span",{class:"label"},"Weights in kg")),
    grid,
    customs.length?h("div",{class:"row wrap"},customs.slice(0,6).map(c=>h("button",{class:"chip",onclick:()=>start(c,[])},c))):null,
    h("div",{class:"row"},nameIn,h("button",{onclick:go},"Start")));
}
function activeView(){
  const a=S.active;
  const title=h("input",{id:"w-title",class:"title-in",value:a.title,"aria-label":"Workout name"});
  title.addEventListener("input",()=>{a.title=title.value;queueSave()});
  const date=h("input",{id:"w-date",type:"date",value:a.date,"aria-label":"Date"});
  date.addEventListener("change",()=>{a.date=date.value||todayISO();queueSave()});
  const list=h("div",null);
  a.exercises.forEach((e,i)=>list.append(exerciseBlock(e,i)));
  if(!a.exercises.length) list.append(h("div",{class:"empty"},"Add your first exercise below."));
  const names=new Set([...TEMPLATES.flatMap(t=>t.ex),...LIBRARY]); for(const s of own()) for(const e of s.exercises||[]) names.add(e.name);
  const dl=h("datalist",{id:"ex-names"},[...names].sort().map(n=>h("option",{value:n})));
  const addIn=h("input",{id:"add-ex",class:"grow",list:"ex-names",placeholder:"Add exercise"});
  const add=()=>{const n=addIn.value.trim();if(!n)return;const l=lastSetsFor(n,a.id);a.exercises.push({name:n,sets:l?l.sets.map(s=>({w:s.w,r:s.r})):[{w:null,r:null}]});queueSave();render();const f=document.getElementById("add-ex");if(f)f.focus()};
  addIn.addEventListener("keydown",ev=>{if(ev.key==="Enter")add()});
  const del = S.confirmDel==="active"
    ? h("div",{class:"confirm"},"Delete this workout?",h("button",{class:"danger",onclick:discard},"Delete"),h("button",{class:"ghost",onclick:()=>{S.confirmDel=null;render()}},"Keep"))
    : h("button",{class:"ghost",onclick:()=>{S.confirmDel="active";render()}},"Delete workout");
  return h("section",{class:"panel stack"},
    h("div",{class:"row between"},h("span",{class:"label"},a.finished?"Editing workout":"Workout in progress"),h("span",{id:"save",class:"save "+S.saveCls},S.saveMsg)),
    title, h("div",{class:"row"},date),
    list,
    h("div",{class:"row"},addIn,h("button",{onclick:add},"Add")),dl,
    h("button",{class:"primary",onclick:finish},a.finished?"Done editing":"Finish workout"),
    del);
}
function exerciseBlock(e,i){
  const a=S.active;
  const last=lastSetsFor(e.name,a.id);
  const sets=h("div",{class:"stack tight"});
  e.sets.forEach((s,j)=>{
    const w=h("input",{id:`w-${i}-${j}`,type:"number",inputmode:"decimal",step:"0.5",min:"0",placeholder:"kg",value:s.w??"","aria-label":`Set ${j+1} weight in kg`});
    const r=h("input",{id:`r-${i}-${j}`,type:"number",inputmode:"numeric",step:"1",min:"0",placeholder:"reps",value:s.r??"","aria-label":`Set ${j+1} reps`});
    w.addEventListener("input",()=>{s.w=w.value===""?null:parseFloat(w.value);queueSave()});
    r.addEventListener("input",()=>{s.r=r.value===""?null:parseInt(r.value,10);queueSave()});
    sets.append(h("div",{class:"set"},h("span",{class:"n"},j+1),w,h("span",{class:"x"},"×"),r,
      h("button",{class:"del","aria-label":`Remove set ${j+1}`,onclick:()=>{e.sets.splice(j,1);if(!e.sets.length)a.exercises.splice(i,1);queueSave();render()}},"✕")));
  });
  const dup=(inc)=>{const p=e.sets[e.sets.length-1]||{w:null,r:null};e.sets.push({w:p.w!=null?p.w+inc:null,r:p.r});queueSave();render()};
  return h("div",{class:"ex"},
    h("div",{class:"ex-head"},h("span",{class:"ex-name"},e.name),
      h("button",{class:"ghost small",onclick:()=>{a.exercises.splice(i,1);queueSave();render()}},"Remove")),
    last?h("div",{class:"last num"},"Last "+fmtDate(last.date)+": "+last.sets.filter(s=>s.w||s.r).map(s=>kg(s.w)+"×"+(s.r??"–")).join(", ")):null,
    h("div",{class:"set-head"},h("span"),h("span",{class:"label"},"kg"),h("span"),h("span",{class:"label"},"reps"),h("span")),
    sets,
    h("div",{class:"row wrap"},h("button",{class:"chip",onclick:()=>dup(0)},"+ Set"),h("button",{class:"chip",onclick:()=>dup(2.5)},"+ Set +2.5 kg")));
}
function historyBlock(){
  const done=ownDone();
  const list=h("div",{class:"list"});
  if(!done.length) list.append(h("div",{class:"empty"},"Finished workouts land here. Start one above, then hit Finish."));
  for(const s of done.slice(0,30)){
    const open=S.openItem===s.id;
    const item=h("div",{class:"item"},
      h("button",{class:"ghost plain","aria-expanded":open?"true":"false",onclick:()=>{S.openItem=open?null:s.id;S.confirmDel=null;render()}},
        h("div",{class:"item-main"},h("b",null,s.title),h("span",{class:"muted small num"},fmtDate(s.date))),
        h("div",{class:"muted small num"},(s.exercises||[]).length+" exercises · "+kg(vol(s))+" kg volume")));
    if(open){
      for(const e of s.exercises||[]) item.append(h("div",{class:"small num"},h("b",null,e.name+": "),e.sets.map(x=>kg(x.w)+"×"+(x.r??"–")).join(", ")));
      item.append(S.confirmDel===s.id
        ? h("div",{class:"confirm"},"Delete this workout?",h("button",{class:"danger",onclick:()=>delSession(s.id)},"Delete"),h("button",{class:"ghost",onclick:()=>{S.confirmDel=null;render()}},"Keep"))
        : h("div",{class:"row"},h("button",{class:"chip",disabled:!!S.active,onclick:()=>editSession(s)},"Edit"),h("button",{class:"ghost",onclick:()=>{S.confirmDel=s.id;render()}},"Delete")));
    }
    list.append(item);
  }
  return [h("section",{class:"panel stack"},h("div",{class:"row between"},h("h2",null,"History"),h("span",{class:"label num"},done.length+" workouts")),list)];
}

function progressView(){
  const done=ownDone().slice().reverse();
  const byEx={};
  for(const s of done) for(const e of s.exercises||[]){const b=bestSet(e);if(!b)continue;const k=norm(e.name);(byEx[k]=byEx[k]||{name:e.name,pts:[]}).pts.push({date:s.date,...b})}
  const keys=Object.keys(byEx).sort((a,b)=>byEx[b].pts.length-byEx[a].pts.length);
  const ws=weekStart().getTime();
  const thisWeek=done.filter(s=>new Date(s.date+"T12:00:00").getTime()>=ws);
  const out=[];
  out.push(h("section",{class:"panel stack"},h("h2",null,"This week"),
    h("div",{class:"stats"},stat("Workouts",thisWeek.length),stat("Volume kg",kg(thisWeek.reduce((a,s)=>a+vol(s),0))),stat("All time",done.length))));
  if(!keys.length){out.push(h("section",{class:"panel empty"},"Log a couple of workouts and your strength trend for each lift shows up here."));return out}
  if(!S.progEx||!byEx[S.progEx]) S.progEx=keys.find(k=>BIG3.some(b=>b.re.test(k)))||keys[0];
  const sel=h("select",{id:"prog-ex","aria-label":"Exercise"},keys.map(k=>h("option",{value:k,selected:k===S.progEx?"":null},byEx[k].name)));
  sel.addEventListener("change",()=>{S.progEx=sel.value;render()});
  const d=byEx[S.progEx];
  const best=d.pts.reduce((a,p)=>p.e>a.e?p:a,d.pts[0]);
  const heaviest=d.pts.reduce((a,p)=>p.w>a.w?p:a,d.pts[0]);
  out.push(h("section",{class:"panel stack"},
    h("div",{class:"row between wrap"},h("h2",null,"Lift trend"),sel),
    h("div",{class:"stats"},stat("Est. 1RM",kg(best.e)),stat("Heaviest",kg(heaviest.w)+" × "+heaviest.r),stat("Sessions",d.pts.length)),
    chart(d.pts),
    h("div",{class:"muted small"},"Estimated 1RM uses the Epley formula on your best set each session (weight × (1 + reps/30)).")));
  const tb=h("tbody");
  for(const k of keys.slice(0,12)){const p=byEx[k].pts.reduce((a,x)=>x.e>a.e?x:a,byEx[k].pts[0]);tb.append(h("tr",null,h("td",null,byEx[k].name),h("td",null,kg(p.w)+"×"+p.r),h("td",null,kg(p.e))))}
  out.push(h("section",{class:"panel stack"},h("h2",null,"Personal bests"),
    h("div",{class:"tablewrap"},h("table",{class:"board"},h("thead",null,h("tr",null,h("th",null,"Exercise"),h("th",null,"Best set"),h("th",null,"e1RM"))),tb))));
  return out;
}
function stat(l,v){return h("div",{class:"stat"},h("div",{class:"label"},l),h("div",{class:"v num"},v))}
function chart(pts){
  const NS="http://www.w3.org/2000/svg", W=340,H=180,L=36,R=14,T=14,B=26;
  const svg=document.createElementNS(NS,"svg"); svg.setAttribute("viewBox",`0 0 ${W} ${H}`); svg.setAttribute("class","chart"); svg.setAttribute("role","img"); svg.setAttribute("aria-label","Estimated 1RM over time");
  const mk=(t,a)=>{const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);svg.append(e);return e};
  if(pts.length<2){mk("text",{x:W/2,y:H/2,"text-anchor":"middle",fill:"var(--muted)","font-size":"12"}).textContent="One more session and the trend line appears.";return svg}
  const ys=pts.map(p=>p.e); let lo=Math.min(...ys),hi=Math.max(...ys); if(hi-lo<5){lo-=2.5;hi+=2.5} const pad=(hi-lo)*.12; lo=Math.max(0,lo-pad);hi+=pad;
  const ts=pts.map(p=>new Date(p.date+"T12:00:00").getTime()); const t0=Math.min(...ts),t1=Math.max(...ts);
  const X=t=>L+(t1===t0?0.5:(t-t0)/(t1-t0))*(W-L-R), Y=v=>T+(1-(v-lo)/(hi-lo))*(H-T-B);
  for(let i=0;i<=3;i++){const v=lo+(hi-lo)*i/3;mk("line",{x1:L,x2:W-R,y1:Y(v),y2:Y(v),stroke:"var(--line)","stroke-width":"1"});mk("text",{x:L-6,y:Y(v)+4,"text-anchor":"end",fill:"var(--muted)","font-size":"10"}).textContent=Math.round(v)}
  const line=pts.map((p,i)=>`${i?"L":"M"}${X(ts[i]).toFixed(1)},${Y(p.e).toFixed(1)}`).join("");
  mk("path",{d:line+`L${X(ts[ts.length-1]).toFixed(1)},${H-B}L${X(ts[0]).toFixed(1)},${H-B}Z`,fill:"var(--accent-soft)",stroke:"none"});
  mk("path",{d:line,fill:"none",stroke:"var(--accent)","stroke-width":"2.5","stroke-linejoin":"round"});
  pts.forEach((p,i)=>mk("circle",{cx:X(ts[i]),cy:Y(p.e),r:i===pts.length-1?5:2.5,fill:i===pts.length-1?"var(--accent)":"var(--surface)",stroke:"var(--accent)","stroke-width":"1.5"}));
  mk("text",{x:L,y:H-6,fill:"var(--muted)","font-size":"10"}).textContent=fmtDate(pts[0].date);
  mk("text",{x:W-R,y:H-6,"text-anchor":"end",fill:"var(--muted)","font-size":"10"}).textContent=fmtDate(pts[pts.length-1].date);
  return svg;
}

function crewView(){
  const out=[];
  if(!S.members[uid]||S.editNick) out.push(nickForm());
  const ids=Object.keys(S.members);
  if(!ids.length){out.push(h("section",{class:"panel empty"},"Nobody has joined yet. Send your friends the link; each person signs in, sets a name and logs their own workouts."));return out}
  const ws=weekStart().getTime();
  const rows=ids.map(id=>{
    const done=(S.sessions[id]||[]).filter(s=>s.finished);
    const wk=done.filter(s=>new Date(s.date+"T12:00:00").getTime()>=ws);
    const big={};
    for(const b of BIG3){let m=0;for(const s of done)for(const e of s.exercises||[])if(b.re.test(norm(e.name))){const x=bestSet(e);if(x&&x.e>m)m=x.e}big[b.key]=m}
    return {id,wk:wk.length,wv:wk.reduce((a,s)=>a+vol(s),0),big,total:BIG3.reduce((a,b)=>a+big[b.key],0),done};
  });
  const who=id=>h("span",{class:"who"},h("span",{class:"disc",style:"--plate:var("+plateFor(id)+")"}),h("span",null,nickOf(id)+(id===uid?" (you)":"")));
  const max={};for(const b of BIG3)max[b.key]=Math.max(...rows.map(r=>r.big[b.key]));
  const tb=h("tbody");
  rows.slice().sort((a,b)=>b.total-a.total).forEach(r=>tb.append(h("tr",null,h("td",null,who(r.id)),
    ...BIG3.map(b=>h("td",{class:r.big[b.key]&&r.big[b.key]===max[b.key]?"top":null},r.big[b.key]?kg(Math.round(r.big[b.key]*2)/2):"–")),
    h("td",null,r.total?kg(Math.round(r.total)):"–"))));
  out.push(h("section",{class:"panel stack"},h("div",{class:"row between"},h("h2",null,"Big three"),h("span",{class:"label"},"est. 1RM kg")),
    h("div",{class:"tablewrap"},h("table",{class:"board"},h("thead",null,h("tr",null,h("th",null,"Lifter"),...BIG3.map(b=>h("th",null,b.key)),h("th",null,"Total"))),tb))));
  const tw=h("tbody");
  rows.slice().sort((a,b)=>b.wk-a.wk||b.wv-a.wv).forEach(r=>tw.append(h("tr",null,h("td",null,who(r.id)),h("td",null,r.wk),h("td",null,kg(Math.round(r.wv))))));
  out.push(h("section",{class:"panel stack"},h("h2",null,"This week"),
    h("div",{class:"tablewrap"},h("table",{class:"board"},h("thead",null,h("tr",null,h("th",null,"Lifter"),h("th",null,"Workouts"),h("th",null,"Volume kg"))),tw))));
  const feed=rows.flatMap(r=>r.done.map(s=>({...s,who:r.id}))).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||b.startedAt-a.startedAt).slice(0,15);
  const fl=h("div",{class:"list"});
  if(!feed.length) fl.append(h("div",{class:"empty"},"No finished workouts yet."));
  for(const s of feed){
    const tops=(s.exercises||[]).map(e=>({n:e.name,b:bestSet(e)})).filter(x=>x.b).sort((a,b)=>b.b.e-a.b.e).slice(0,2);
    fl.append(h("div",{class:"item"},h("div",{class:"item-main"},who(s.who),h("span",{class:"muted small num"},fmtDate(s.date))),
      h("div",{class:"small"},h("b",null,s.title)," · ",h("span",{class:"num"},tops.map(t=>t.n+" "+kg(t.b.w)+"×"+t.b.r).join(", ")||"no sets"))));
  }
  out.push(h("section",{class:"panel stack"},h("h2",null,"Recent"),fl));
  out.push(h("div",{class:"row wrap"},
    (S.members[uid]&&!S.editNick)?h("button",{class:"ghost",onclick:()=>{S.editNick=true;render();window.scrollTo({top:0})}},"Change my name"):null,
    h("button",{class:"ghost",onclick:signOut},"Sign out")));
  return out;
}

render();
init();
