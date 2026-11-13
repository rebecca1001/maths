// MathWizz game: screens, questions, scoring, shop, battles and the teacher dashboard.
import { api, randomPin } from './api.js';
import { rowsFromPlayers, series as pSeries, chartHTML, miniHTML, cellsHTML } from './progress.js';
import { MAX_MIN, minFor, hasOwnMin, roundsToday, withClassMin, withStudentMin, daysPlayed, accuracy as accOf, correctPerMin, trend as trendOf } from './dashboard.js';
import { pilotRows, pilotHeadline, weeklyText, weekLabel, shortDay } from './pilot.js';
import { KINDS, PAID_PLANS, PLAN_NAMES, unit as cUnit, fmtNum, studentView, whenText, shortDate, lastDay, dayStr, PRESETS, PRIZES, TIMEFRAMES, niceNumber, suggestTargets } from './competitions.js';
const TIERS=[{name:'Ground',max:Infinity},{name:'Clouds',max:9},{name:'Space',max:7.5},{name:'Orbit',max:6},{name:'Station',max:4.8},{name:'Moon',max:3.8},{name:'Mars',max:3},{name:'Jupiter',max:2.3},{name:'Saturn',max:1.8},{name:'Galaxy',max:1.35}];
const TIER_COLORS=['#FF6B6F','#FF8559','#FF9A4D','#FFB23C','#FFC93C','#E8DC4F','#C9E86A','#9BE38C','#6FE39A','#4FE3B5'];
const SKINS=[
  {id:'blob',rarity:'common',name:'Cadet',cost:0},
  {id:'mint',rarity:'common',name:'Explorer',cost:150},
  {id:'ninja',rarity:'rare',name:'Shadow Pilot',cost:400},
  {id:'astro',rarity:'rare',name:'Moonwalker',cost:500},
  {id:'alien',rarity:'rare',name:'Friendly Alien',cost:600},
  {id:'dj',rarity:'epic',name:'Comet',cost:1000},
  {id:'wizard',rarity:'epic',name:'Ice Planet',cost:1250},
  {id:'solar',rarity:'epic',name:'Solar Flare',cost:1500},
  {id:'robo',rarity:'legendary',name:'Robo-Nav',cost:2500},
  {id:'royal',rarity:'legendary',name:'Galaxy Royal',cost:3500,rank:6},
  {id:'cyber',rarity:'legendary',name:'Cyber Ninja',cost:5000,rank:7},
  {id:'gcommander',rarity:'legendary',name:'Gold Commander',cost:7500,rank:9}];
const RARITY={common:{name:'Common',r1:'#B9C2D2',r2:'#6B778C'},rare:{name:'Rare',r1:'#5EC2FF',r2:'#1F5FCC'},epic:{name:'Epic',r1:'#C98BFF',r2:'#6A2FC2'},legendary:{name:'Legendary',r1:'#FFC266',r2:'#D9600F'}};

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,9);
const dayKey=t=>{const x=new Date(t);return x.getFullYear()+'-'+(x.getMonth()+1)+'-'+x.getDate()};
let ALL=[2,3,4,5,6,7,8,9,10,11,12];   // the times tables in play; set from the class settings (maxTable)

// ---------- state ----------
// S holds the logged-in student and their classmates (or, for a teacher, the selected class's students).
function newPlayerData(){return {badges:[],rockets:['classic'],rocket:'classic',skin:'blob',owned:['blob'],coins:0,facts:{},rounds:[],placed:false}}
let S={players:{},order:[],current:null,showBoard:true,muted:false};
let COMPS=[];   // the logged-in student's competitions (from student_state)
let SESSION=null;   // {token} for a logged-in student
let TEACH_TAB='students';
let CLASS=null;     // {id,name,settings} for the student's class
let TEACH=null;     // teacher mode: {info, classes, classId}
const LS='mm.local.v1';
const TAB='mm.tab.token';
// Opened from a 'reset your password' email (read now, before the sign-in library tidies the address)
const RECOVERY=/type=recovery/.test(location.hash)||new URLSearchParams(location.search).has('reset');
// When a new version of the site is published, reload open pages (only between games, never mid-round)
const myBuild=(document.querySelector('script[type=module][src*="/assets/"]')||{}).src||'';
setInterval(async()=>{
  if(!myBuild||document.hidden||G||screen==='play')return;
  const ae=document.activeElement;if(ae&&/INPUT|TEXTAREA|SELECT/.test(ae.tagName))return;
  try{const h=await (await fetch('/?v='+Date.now(),{cache:'no-store'})).text();const m=h.match(/\/assets\/index-[\w-]+\.js/);
    if(m&&!myBuild.endsWith(m[0])&&!G&&screen!=='play')location.reload()}catch(e){}
},300000); // every 5 minutes
function local(){try{return JSON.parse(localStorage.getItem(LS))||{}}catch(e){return{}}}
function setLocal(o){try{localStorage.setItem(LS,JSON.stringify({...local(),...o}))}catch(e){}}
let saveTimer=null,saving=Promise.resolve();
function save(){if(TEACH||!SESSION)return;clearTimeout(saveTimer);saveTimer=setTimeout(flushSave,700)}
function flushSave(){
  clearTimeout(saveTimer);const p=P();if(!p||!SESSION)return saving;
  const {id,name,pin,...data}=p,token=SESSION.token;
  saving=saving.then(()=>api.studentSave(token,data)).then(r=>{if(r&&r.error==='signed_out'&&SESSION&&SESSION.token===token)toLogin(true);else if(COMPS.some(c=>c.status!=='ended'))refreshComps()}).catch(()=>setTimeout(save,4000));
  return saving;
}
window.addEventListener('pagehide',()=>{if(saveTimer)flushSave()});
const P=()=>S.players[S.current];
function applySettings(st){
  st=st||{};const mx=Math.min(12,Math.max(5,+st.maxTable||12));
  ALL=Array.from({length:mx-1},(_,i)=>i+2);
  S.muted=st.sound===false;S.division=!!st.division;
  const g=st.goal;let goal=null;if(g&&Array.isArray(g.tables)){const tables=g.tables.map(Number).filter(t=>t>=2&&t<=12),rounds=Math.max(0,Math.min(50,+g.rounds||0));if(tables.length||rounds)goal={tables,rounds}}S.goal=goal;S.settings=st;
}
// Turn the server's student_state into the game's state
function applyState(st,keepMe){
  CLASS=st.class;applySettings(CLASS.settings);
  const me=keepMe&&P()&&P().id===st.me.id?P():fixPlayer({...newPlayerData(),...st.me.data,id:st.me.id,name:st.me.name});
  const players={[me.id]:me},order=[me.id];
  st.classmates.forEach(c=>{players[c.id]=fixPlayer({...newPlayerData(),...c.data,facts:{},id:c.id,name:c.name});order.push(c.id)});
  S.players=players;S.order=order;S.current=me.id;
  COMPS=Array.isArray(st.competitions)?st.competitions:[];
  SCHOOLBOARD=Array.isArray(st.school_board)?st.school_board:null;if(!SCHOOLBOARD)boardScope='class';
}

// ---------- fluency maths ----------
const med=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
const acc=f=>f.r.length?f.r.reduce((x,y)=>x+y,0)/f.r.length:0;
function level(f){
  if(!f||!f.r.length)return 0;
  const a=acc(f),m=med(f.t);
  if(m==null||a<.6||m>6000)return 1;
  if(a<.85||m>3500)return 2;
  if(m>2000)return 3;
  return 4;
}
function weakWeight(p,a,b){
  const f=p.facts[a+','+b];
  if(!f||!f.r.length)return 4;
  const m=med(f.t)??8000,hrs=(Date.now()-f.last)/36e5;
  return .5+Math.min(m/1500,4)+(1-acc(f))*5+Math.min(hrs/24,2);
}
function statusSecs(p){const r=p.rounds.filter(x=>x.c>0&&x.n>=8).slice(-3);if(!r.length)return null;const tot=r.reduce((s,x)=>s+x.c,0);return r.reduce((s,x)=>s+x.ms*x.c,0)/tot/1000}
function tierIndex(sec){if(sec==null)return -1;let i=0;TIERS.forEach((t,k)=>{if(sec<=t.max)i=k});return i}
const rate=r=>Math.round(r.c*60/(r.len||60));
// Personal best = fastest average seconds per question in a round (rounds with 5+ right count first)
function pb(p,rounds){const rs=(rounds||p.rounds).filter(r=>r.c>0&&r.ms>0&&r.n>=8);if(!rs.length)return null;return Math.min(...rs.map(r=>r.ms/1000))}
const secTxt=v=>v.toFixed(1)+' s';
function weekStart(now){const d=new Date(now||Date.now());d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d.getTime()} // Monday
function goalRounds(p){return p.rounds.filter(r=>r.d>=weekStart()).length}
function todayCount(p){const k=dayKey(Date.now());return p.rounds.filter(r=>dayKey(r.d)===k).length}
function tableScore(p,a){let tot=0,n=0;for(let b=1;b<=12;b++){const f=p.facts[a+','+b];if(f&&f.r.length){tot+=level(f);n++}}return n?tot/n:null}

// ---------- characters: futuristic space-suit heroes (neon trims, energy cores, jet boots) ----------
const OUT='#141626';
const LOOK={
  blob:  {skin:'#F2C9A0',hair:'#6B3E1F',suit:'#EEF2FA',panel:'#FF7A1A',boot:'#3A3F55',visor:'clear'},
  mint:  {skin:'#8D5A3B',hair:'#1E1E28',suit:'#E8F7F0',panel:'#22D39B',boot:'#2B3A35',visor:'clear'},
  ninja: {suit:'#232740',panel:'#FF3B5C',boot:'#12142A',visor:'dark'},
  astro: {suit:'#F4F6FB',panel:'#3D8BFF',boot:'#5A6380',visor:'gold',flag:true},
  pirate:{skin:'#D9A274',hair:'#2A1A12',suit:'#F1F2F8',panel:'#FF3B5C',boot:'#3A3F55',visor:'clear',stars:true},
  dj:    {skin:'#A86B45',hair:'#FF5FA2',suit:'#6A3FC2',panel:'#FFD447',boot:'#2B1B4E',visor:'pink',comet:true},
  wizard:{skin:'#F5D3B5',hair:'#C9CED9',suit:'#CDEBFF',panel:'#3D8BFF',boot:'#E6F4FF',visor:'clear',flake:true},
  robo:  {robot:true,suit:'#A7B1C6',panel:'#3DE0D0',boot:'#4A5266'},
  royal: {skin:'#7A4A2E',hair:'#1E1E28',suit:'#4B23A8',panel:'#FFC23C',boot:'#FFC23C',visor:'clear',crown:true,cape:'#C8343A'},
  gold:  {suit:'#FFC93C',panel:'#FF5A1A',boot:'#B07A00',visor:'dark',sparkle:true,cape:'#FF7A1A'}
};
function avatar(id,size){
  const L=LOOK[id]||LOOK.blob,o=`stroke="${OUT}" stroke-width="2.2" stroke-linejoin="round"`,N=L.panel,M=L.elite?(L.metal||'#FFE27A'):'#C9D0DE';
  const neon=(d,w)=>`<path d="${d}" fill="none" stroke="${N}" stroke-width="${(w||2)*2.6}" stroke-linecap="round" stroke-linejoin="round" opacity=".28"/><path d="${d}" fill="none" stroke="${N}" stroke-width="${w||2}" stroke-linecap="round" stroke-linejoin="round"/>`;
  let g=`<ellipse cx="50" cy="99.5" rx="26" ry="3.2" fill="${N}" opacity=".22"/><ellipse cx="50" cy="99.5" rx="18" ry="2" fill="#000" opacity=".25"/>`;
  if(L.elite){
    const G1=L.metal||'#FFE27A',G2=L.metal2||'#C98A00';
    g+=`<defs><radialGradient id="halo-${id}"><stop offset="0" stop-color="${N}" stop-opacity=".45"/><stop offset=".55" stop-color="#FFD15C" stop-opacity=".18"/><stop offset="1" stop-color="#FFD15C" stop-opacity="0"/></radialGradient><linearGradient id="wing-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${G1}"/><stop offset="1" stop-color="${G2}"/></linearGradient></defs>`;
    g+=`<circle cx="50" cy="44" r="50" fill="url(#halo-${id})"/><circle cx="50" cy="20" r="30" fill="none" stroke="${N}" stroke-width="1" opacity=".35" stroke-dasharray="3 5"/>`;
    g+=`<path d="M28 46 L2 30 L8 47 L-2 54 L10 58 L2 66 L22 64 L28 68Z M72 46 L98 30 L92 47 L102 54 L90 58 L98 66 L78 64 L72 68Z" fill="url(#wing-${id})" ${o}/>`;
    g+=neon('M26 48 L6 35 M24 56 L4 54 M24 62 L8 64 M74 48 L94 35 M76 56 L96 54 M76 62 L92 64',1);
  }
  if(L.cape)g+=`<path d="M32 44 L19 88 Q50 96 81 88 L68 44Z" fill="${L.cape}" ${o}/>`;
  // jet thrusters behind the shoulders
  if(L.elite){
    // jet pack: twin gold tanks with nozzles and flickering flames
    const fl=(x)=>`<path d="M${x-6} 77 Q${x-7} 89 ${x} 101 Q${x+7} 89 ${x+6} 77Z" fill="#FF7A1A" opacity=".9"><animate attributeName="opacity" values=".9;.55;1;.7;.9" dur=".5s" repeatCount="indefinite"/></path><path d="M${x-4} 77 Q${x-4.5} 87 ${x} 96 Q${x+4.5} 87 ${x+4} 77Z" fill="#FFD447"><animate attributeName="d" values="M${x-4} 77 Q${x-4.5} 87 ${x} 96 Q${x+4.5} 87 ${x+4} 77Z;M${x-4} 77 Q${x-4.5} 85 ${x} 92 Q${x+4.5} 85 ${x+4} 77Z;M${x-4} 77 Q${x-4.5} 87 ${x} 96 Q${x+4.5} 87 ${x+4} 77Z" dur=".35s" repeatCount="indefinite"/></path><path d="M${x-2} 77 Q${x-2} 83 ${x} 88 Q${x+2} 83 ${x+2} 77Z" fill="#FFFFFF"/>`;
    g+=fl(21)+fl(79);
    g+=`<path d="M27 44 L36 44 L36 66 L27 66Z M64 44 L73 44 L73 66 L64 66Z" fill="${L.metal2||'#C98A00'}" ${o}/>`;
    g+=`<rect x="14" y="40" width="14" height="32" rx="7" fill="url(#wing-${id})" ${o}/><rect x="72" y="40" width="14" height="32" rx="7" fill="url(#wing-${id})" ${o}/>`;
    g+=`<path d="M17 44 Q21 41.5 25 44" stroke="#FFFFFF" stroke-width="1.6" fill="none" opacity=".7" stroke-linecap="round"/><path d="M75 44 Q79 41.5 83 44" stroke="#FFFFFF" stroke-width="1.6" fill="none" opacity=".7" stroke-linecap="round"/>`;
    g+=`<path d="M14.5 52h13 M14.5 61h13 M72.5 52h13 M72.5 61h13" stroke="${OUT}" stroke-width="1.6"/>`+neon('M21 55 V58.5 M79 55 V58.5',1.8);
    g+=`<path d="M15.5 70 h11 l-1.5 7 h-8z M73.5 70 h11 l-1.5 7 h-8z" fill="#3A3F55" ${o}/>`;
  }else{
  g+=`<path d="M27 44 L17 50 L19 70 L28 66Z M73 44 L83 50 L81 70 L72 66Z" fill="${M}" ${o}/>`+neon('M20 54 L20 64M80 54 L80 64',1.8);
  g+=`<path d="M18 71 Q19.5 79 21 71Z M79 71 Q80.5 79 82 71Z" fill="${N}" opacity=".85"/>`;
  }
  // legs with knee plates and glowing jet boots
  g+=`<path d="M37 70h11v15h-11z M52 70h11v15h-11z" fill="${L.suit}" ${o}/>`;
  g+=`<path d="M36 75.5h13l-1.5 5h-10z M51 75.5h13l-1.5 5h-10z" fill="${M}" ${o}/>`;
  g+=`<path d="M33 84h16l1 9a3 3 0 0 1-3 3H35a3 3 0 0 1-3-3z M51 84h16l1 9a3 3 0 0 1-3 3H53a3 3 0 0 1-3-3z" fill="${L.boot}" ${o}/>`;
  g+=neon('M35 92.5h12M53 92.5h12',2);
  // arms: armoured segments, left relaxed, right fist-pump
  const arm=(d)=>`<path d="${d}" fill="none" stroke="${OUT}" stroke-width="12.5" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${L.suit}" stroke-width="8" stroke-linecap="round"/>`;
  g+=arm('M33 48 Q25 57 27 67')+arm('M67 48 Q80 45 81 31');
  g+=neon('M24.2 58.5 Q27 56.6 30.2 58.2M76.4 38.6 Q79.8 36.6 83.6 38.4',1.6);
  g+=`<path d="M21.5 66 h11 v5 a5.5 5.5 0 0 1 -11 0z" fill="${L.boot}" ${o}/><path d="M75.5 25 h11 v6 a5.5 5.5 0 0 1 -11 0z" fill="${L.boot}" ${o}/>`;
  // torso: tapered armour, belt, hexagon energy core
  g+=`<path d="M31 46 Q31 40 37 40 H63 Q69 40 69 46 L66.5 73 H33.5Z" fill="${L.suit}" ${o}/>`;
  g+=`<path d="M33.5 66.5h33" stroke="${OUT}" stroke-width="2.2"/>`+neon('M36 69.5h28',1.6);
  g+=`<path d="M38 42 L44 50 L56 50 L62 42" fill="none" stroke="${OUT}" stroke-width="1.6" opacity=".35"/>`;
  g+=`<path d="M50 49 L57 53 L57 61 L50 65 L43 61 L43 53Z" fill="${OUT}" stroke="${OUT}" stroke-width="2"/>`;
  g+=`<path d="M50 52 L54.5 54.6 L54.5 59.4 L50 62 L45.5 59.4 L45.5 54.6Z" fill="${N}"/><circle cx="50" cy="57" r="2.2" fill="#FFFFFF" opacity=".9"/>`;
  g+=`<circle cx="50" cy="57" r="9" fill="${N}" opacity=".16"/>`;
  if(L.elite){
    g+=neon('M39 43.5 L50 48.5 L61 43.5',1.3)+`<path d="M36 50 L37.5 64 M64 50 L62.5 64 M41 66.5 V73 M59 66.5 V73" stroke="${OUT}" stroke-width="1.2" opacity=".4"/>`;
    g+=`<path d="M35 46 Q33.5 56 35.5 65" stroke="#FFFFFF" stroke-width="1.8" fill="none" opacity=".55" stroke-linecap="round"/>`;
    g+=`<path d="M29.5 44.5 l3.2 -2 l3.2 2 M29.5 47.5 l3.2 -2 l3.2 2" stroke="${N}" stroke-width="1.3" fill="none" stroke-linecap="round"/><circle cx="67.5" cy="45" r="2.4" fill="${N}" stroke="${OUT}" stroke-width="1"/>`;
    g+=`<path d="M47 69.5 h6 l-1 3 h-4z" fill="#FFF3B0" stroke="${OUT}" stroke-width="1"/>`;
    g+=neon('M38.5 87 h9 M52.5 87 h9',1.1);
  }
  // shoulder plates
  g+=`<path d="M28 47 Q29 39 38 40 L40 46 Q34 47 31 52Z M72 47 Q71 39 62 40 L60 46 Q66 47 69 52Z" fill="${M}" ${o}/>`;
  if(L.flag)g+=`<rect x="33" y="45" width="6" height="4.2" fill="#E5484D" stroke="${OUT}" stroke-width="1"/><path d="M33 47.1h6" stroke="#FFFFFF" stroke-width="1.1"/>`;
  if(L.stars)g+=`<path d="M34 42.5l1.1 2.2 2.4.4-1.7 1.6.4 2.4-2.2-1.1-2.2 1.1.4-2.4-1.7-1.6 2.4-.4z M66 42.5l1.1 2.2 2.4.4-1.7 1.6.4 2.4-2.2-1.1-2.2 1.1.4-2.4-1.7-1.6 2.4-.4z" fill="#FFD447" stroke="${OUT}" stroke-width=".8"/>`;
  if(L.comet)g+=neon('M32 50 Q36 51 39 48',1.5);
  if(L.flake)g+=`<path d="M36 51v6M33.4 52.5l5.2 3M33.4 55.5l5.2-3" stroke="${N}" stroke-width="1.4" stroke-linecap="round"/>`;
  // neck ring
  g+=`<rect x="39" y="36.5" width="22" height="6" rx="3" fill="${M}" ${o}/>`+neon('M42 39.5h16',1.2);
  if(L.robot){
    g+=`<path d="M50 2v-9" stroke="${OUT}" stroke-width="2.2"/><circle cx="50" cy="-9" r="3" fill="${N}"/><circle cx="50" cy="-9" r="6" fill="${N}" opacity=".25"/>`;
    g+=`<path d="M30 10 Q30 2 38 2 H62 Q70 2 70 10 V30 Q70 38 62 38 H38 Q30 38 30 30Z" fill="#C3CBDA" ${o}/>`;
    g+=`<path d="M34 13 H66 V26 Q50 31 34 26Z" fill="${OUT}"/>`+neon('M39 19.5h7M54 19.5h7',3)+`<path d="M41 33h18" stroke="${OUT}" stroke-width="2" stroke-dasharray="2 2"/>`;
  }else{
    // sleek helmet with side fins and a glowing crest
    g+=`<path d="M26 18 L22 10 L28 12Z M74 18 L78 10 L72 12Z" fill="${M}" ${o}/>`;
    g+=`<path d="M50 -1 C64 -1 72 9 72 21 C72 33 63 41 50 41 C37 41 28 33 28 21 C28 9 36 -1 50 -1Z" fill="${L.suit}" ${o}/>`;
    g+=neon('M50 0 V7',2.2)+`<rect x="25" y="17" width="5" height="12" rx="2.5" fill="${L.boot}" ${o}/><rect x="70" y="17" width="5" height="12" rx="2.5" fill="${L.boot}" ${o}/>`;
    // wraparound visor
    const vpath='M32 16 Q50 9 68 16 L67 28 Q60 36 50 36 Q40 36 33 28Z';
    if(L.visor==='clear'||L.visor==='pink'){
      g+=`<path d="${vpath}" fill="#0E1650" ${o}/>`;
      g+=`<clipPath id="vc-${id}"><path d="${vpath}"/></clipPath><g clip-path="url(#vc-${id})"><ellipse cx="50" cy="27" rx="12" ry="12" fill="${L.skin}"/><path d="M38 21 Q40 12 50 12 Q60 12 62 21 Q55 17 46 18.5 Q41 19.5 38 21Z" fill="${L.hair}"/>`+
        `<ellipse cx="45.5" cy="26" rx="2.2" ry="2.9" fill="${OUT}"/><ellipse cx="54.5" cy="26" rx="2.2" ry="2.9" fill="${OUT}"/><circle cx="46.3" cy="25" r=".8" fill="#fff"/><circle cx="55.3" cy="25" r=".8" fill="#fff"/><path d="M46.5 31 Q50 34 53.5 31" stroke="${OUT}" stroke-width="1.7" fill="none" stroke-linecap="round"/></g>`;
      g+=`<path d="${vpath}" fill="${L.elite?'#FFD15C':L.visor==='pink'?'#FF8AD8':'#7FD0FF'}" fill-opacity="${L.elite?.16:L.visor==='pink'?.3:.2}"/>`;
    }else{
      const vc=L.visor==='gold'?['#FFE27A','#C98A00']:['#2A2F4A','#06070E'];
      g+=`<defs><linearGradient id="vz-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${vc[0]}"/><stop offset="1" stop-color="${vc[1]}"/></linearGradient></defs><path d="${vpath}" fill="url(#vz-${id})" ${o}/>`;
    }
    g+=neon('M35 18 Q50 12.5 65 18',1.2)+`<path d="M38 20 Q42 16 47 15.5" stroke="#FFFFFF" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/>`;
    if(L.elite)g+=`<path d="M34.5 24 h3.5 M62 24 h3.5" stroke="${N}" stroke-width=".9" stroke-linecap="round"/><circle cx="64" cy="20" r="1" fill="${N}"/>`;
  }
  if(L.crown)g+=`<path d="M38 2 L40 -11 L45.5 -3 L50 -14 L54.5 -3 L60 -11 L62 2Z" fill="#FFC23C" ${o}/><circle cx="50" cy="-3" r="2.2" fill="${N}"/>`;
  if(L.crest==='crown2')g+=`<path d="M36 3 L38 -8 L43 -2 L46 -12 L50 -5 L54 -12 L57 -2 L62 -8 L64 3Z" fill="url(#wing-${id})" ${o}/>`+`<path d="M50 -9 L52.5 -5.5 L50 -2 L47.5 -5.5Z" fill="${N}" stroke="${OUT}" stroke-width="1"/>`+neon('M38 1.5 H62',1);
  if(L.crest==='fins')g+=`<path d="M44 2 L36 -14 L47 -4Z M56 2 L64 -14 L53 -4Z" fill="url(#wing-${id})" ${o}/>`+neon('M38.5 -10 L45 -2 M61.5 -10 L55 -2',1);
  if(L.crest==='antenna')g+=`<path d="M40 2 V-8 M50 0 V-13 M60 2 V-8" stroke="${OUT}" stroke-width="2"/><circle cx="40" cy="-9" r="2.2" fill="${N}"/><circle cx="50" cy="-14" r="2.6" fill="${N}"/><circle cx="60" cy="-9" r="2.2" fill="${N}"/><circle cx="50" cy="-14" r="6" fill="${N}" opacity=".25"/>`;
  if(L.elite)g+=[[8,8,2.6],[93,18,2],[4,76,1.8],[96,82,2.4],[86,-6,1.6]].map(([x,y,r])=>`<path d="M${x} ${y-r*2}l${r*.5} ${r*1.5} ${r*1.5} ${r*.5}-${r*1.5} ${r*.5}-${r*.5} ${r*1.5}-${r*.5}-${r*1.5}-${r*1.5}-${r*.5} ${r*1.5}-${r*.5}z" fill="#FFF3B0"/>`).join('');
  if(L.sparkle)g+=`<path d="M88 4l2.5 5.5 5.5 2.5-5.5 2.5-2.5 5.5-2.5-5.5-5.5-2.5 5.5-2.5z" fill="#FFF3B0" ${o}/><path d="M12 30l1.8 4 4 1.8-4 1.8-1.8 4-1.8-4-4-1.8 4-1.8z" fill="#FFF3B0" ${o}/>`;
  return `<svg viewBox="0 -16 100 118" width="${size}" height="${Math.round(size*1.18)}" aria-hidden="true" style="display:block;overflow:visible">${g}</svg>`;
}

// ---------- shop catalogue: rockets and space pets ----------
const ROCKETS=[
  {id:'classic',rarity:'common',name:'Classic',cost:0,body:'#F4F6FB',nose:'#FF5A5F',fin:'#FF5A5F',win:'#5EC2FF',flame:'#FFB547'},
  {id:'mint',rarity:'common',name:'Mint Zoomer',cost:150,body:'#DFF7EC',nose:'#2E9E5B',fin:'#2E9E5B',win:'#5EC2FF',flame:'#FFB547'},
  {id:'night',rarity:'rare',name:'Night Flyer',cost:450,body:'#2B2F45',nose:'#5EC2FF',fin:'#5EC2FF',win:'#FFD447',flame:'#5EC2FF'},
  {id:'fire',rarity:'epic',name:'Fireball',cost:1000,body:'#FF7A1A',nose:'#C8343A',fin:'#FFD447',win:'#FFF3B0',flame:'#FF5A5F'},
  {id:'ufo',rarity:'legendary',name:'Flying Saucer',cost:2500,ufo:true,body:'#A7B1C6',win:'#6EF2C1',flame:'#6EF2C1'},
  {id:'hyperion',rarity:'legendary',name:'Hyperion X',cost:6000,rank:9,hyper:true,body:'#EEF2FA',flame:'#3DE0FF'}];
function rocketSVG(id,w){
  const R=ROCKETS.find(x=>x.id===id)||ROCKETS[0],k=OUT;w=w||26;
  if(R.hyper){const c='#3DE0FF',m='#FF3BD4',sw=1.1;
    const glow=(d,col,wd)=>`<path d="${d}" fill="none" stroke="${col}" stroke-width="${wd*2.8}" stroke-linecap="round" opacity=".3"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${wd}" stroke-linecap="round"/>`;
    const fl=(x)=>`<path d="M${x-2.2} 36 Q${x-2.4} 40.5 ${x} 46 Q${x+2.4} 40.5 ${x+2.2} 36Z" fill="${c}" opacity=".55"><animate attributeName="opacity" values=".55;.25;.7;.55" dur=".4s" repeatCount="indefinite"/></path><path d="M${x-1.3} 36 Q${x-1.4} 39.5 ${x} 43 Q${x+1.4} 39.5 ${x+1.3} 36Z" fill="#B8F4FF"><animate attributeName="d" values="M${x-1.3} 36 Q${x-1.4} 39.5 ${x} 43 Q${x+1.4} 39.5 ${x+1.3} 36Z;M${x-1.3} 36 Q${x-1.4} 38.5 ${x} 41 Q${x+1.4} 38.5 ${x+1.3} 36Z;M${x-1.3} 36 Q${x-1.4} 39.5 ${x} 43 Q${x+1.4} 39.5 ${x+1.3} 36Z" dur=".3s" repeatCount="indefinite"/></path><path d="M${x-.6} 36 Q${x} 38.5 ${x+.6} 36Z" fill="#FFFFFF"/>`;
    return `<svg viewBox="0 0 24 44" width="${w}" height="${Math.round(w*1.83)}" style="overflow:visible"><defs><linearGradient id="hxB" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9AA6BE"/><stop offset=".35" stop-color="#FFFFFF"/><stop offset=".65" stop-color="#E4E9F3"/><stop offset="1" stop-color="#8A96AE"/></linearGradient><linearGradient id="hxW" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A3157"/><stop offset="1" stop-color="#0C0F22"/></linearGradient><linearGradient id="hxC" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5A3BFF"/><stop offset=".5" stop-color="#14183A"/><stop offset="1" stop-color="#05060F"/></linearGradient></defs>
      <ellipse cx="12" cy="22" rx="13" ry="20" fill="${c}" opacity=".10"/>
      ${fl(9.3)}${fl(14.7)}
      <path d="M8.2 16 L0.6 31.5 L1.4 35 L8 31.5Z M15.8 16 L23.4 31.5 L22.6 35 L16 31.5Z" fill="url(#hxW)" stroke="${k}" stroke-width="${sw}" stroke-linejoin="round"/>
      ${glow('M7.8 18.5 L1.3 31.8 M16.2 18.5 L22.7 31.8',c,.6)}
      <path d="M3 30.5 L7.6 28.6 M21 30.5 L16.4 28.6" stroke="${m}" stroke-width=".7" stroke-linecap="round"/>
      <path d="M12 .4 C16.2 6 17.1 14 16.6 23 L16.3 34.2 H7.7 L7.4 23 C6.9 14 7.8 6 12 .4Z" fill="url(#hxB)" stroke="${k}" stroke-width="${sw}" stroke-linejoin="round"/>
      <path d="M12 .4 C13.6 2.4 14.6 4.4 15.1 6.4 H8.9 C9.4 4.4 10.4 2.4 12 .4Z" fill="#14183A" stroke="${k}" stroke-width="${sw}" stroke-linejoin="round"/>
      ${glow('M8.9 6.4 H15.1',c,.55)}
      <path d="M12 8 C14 9.6 14.6 12 14.3 14.6 L12 16.2 L9.7 14.6 C9.4 12 10 9.6 12 8Z" fill="url(#hxC)" stroke="${k}" stroke-width="${sw}" stroke-linejoin="round"/>
      <path d="M11 9.6 Q10.4 11.2 10.4 13" stroke="#FFFFFF" stroke-width=".7" fill="none" stroke-linecap="round" opacity=".85"/>
      <path d="M8.6 13 L5.8 16.6 L8.3 16.4Z M15.4 13 L18.2 16.6 L15.7 16.4Z" fill="#2A3157" stroke="${k}" stroke-width=".8" stroke-linejoin="round"/>
      ${glow('M12 18.5 V31',c,.55)}${glow('M8.6 20 L9.6 30 M15.4 20 L14.4 30',m,.45)}
      <path d="M10.2 22.6 L12 21.4 L13.8 22.6 L13.8 25 L12 26.2 L10.2 25Z" fill="#14183A" stroke="${k}" stroke-width=".6"/><circle cx="12" cy="23.8" r=".9" fill="#FFFFFF"/><circle cx="12" cy="23.8" r="2.4" fill="${c}" opacity=".35"><animate attributeName="r" values="2;2.8;2" dur="1.4s" repeatCount="indefinite"/></circle>
      <path d="M7.6 31.6 H16.4" stroke="${k}" stroke-width=".7" opacity=".5"/>
      <path d="M7.4 34 H11.2 L10.8 36.4 H7.8Z M12.8 34 H16.6 L16.2 36.4 H13.2Z" fill="#2A3157" stroke="${k}" stroke-width="${sw}" stroke-linejoin="round"/>
      ${glow('M8.1 35.6 H10.5 M13.5 35.6 H15.9',c,.5)}
    </svg>`.replace(/\n\s*/g,'');}
  if(R.ufo)return `<svg viewBox="0 0 44 44" width="${w*1.3}" height="${w*1.3}"><ellipse cx="22" cy="16" rx="9" ry="9" fill="${R.win}" fill-opacity=".7" stroke="${k}" stroke-width="1.6"/><ellipse cx="22" cy="24" rx="20" ry="7" fill="${R.body}" stroke="${k}" stroke-width="1.6"/><circle cx="12" cy="24" r="1.8" fill="#FFD447"/><circle cx="22" cy="26" r="1.8" fill="#FF5A5F"/><circle cx="32" cy="24" r="1.8" fill="#FFD447"/><g class="flame"><path d="M15 30 L22 42 L29 30Z" fill="${R.flame}" opacity=".55"/></g></svg>`;
  return `<svg viewBox="0 0 24 44" width="${w}" height="${Math.round(w*1.83)}"><path d="M12 1 C19 8 19 22 17 31 H7 C5 22 5 8 12 1Z" fill="${R.body}" stroke="${k}" stroke-width="1.6"/>${R.stripe?`<path d="M6.3 21 L17.7 18 M6.2 26 L17.4 23" stroke="${R.stripe}" stroke-width="2"/>`:''}<path d="M12 1 C15.5 4.5 17 8 17.5 11 H6.5 C7 8 8.5 4.5 12 1Z" fill="${R.nose}" stroke="${k}" stroke-width="1.6"/><circle cx="12" cy="17" r="3.4" fill="${R.win}" stroke="${k}" stroke-width="1.6"/><path d="M7 23 L2 31 V34 L7 31Z M17 23 L22 31 V34 L17 31Z" fill="${R.fin}" stroke="${k}" stroke-width="1.4" stroke-linejoin="round"/><g class="flame"><path d="M8.5 31 Q12 44 15.5 31Z" fill="${R.flame}"/><path d="M10 31 Q12 38 14 31Z" fill="#FFF8E6"/></g></svg>`;
}
// ---------- extra character looks ----------
Object.assign(LOOK,{
  alien:    {skin:'#7BE07B',hair:'#7BE07B',suit:'#2B2F45',panel:'#7BE07B',boot:'#16182A',visor:'clear'},
  solar:    {suit:'#FF8A3D',panel:'#FFE45C',boot:'#8C2E0A',visor:'gold',comet:true,sparkle:true},
  cyber:    {suit:'#141626',panel:'#3BFF9E',boot:'#0A0B14',visor:'dark',sparkle:true},
  gcommander:{skin:'#8D5A3B',hair:'#1E1E28',suit:'#FFD15C',panel:'#3DE0FF',boot:'#8A5A00',visor:'clear',elite:true,crest:'crown2',cape:'#1F2A6B'}
});
// every shelf runs Common -> Legendary, cheapest first
{const RO={common:0,rare:1,epic:2,legendary:3};[SKINS,ROCKETS].forEach(a=>a.sort((x,y)=>RO[x.rarity]-RO[y.rarity]||x.cost-y.cost))}

// ---------- navigation ----------
const SCREENS=['login','teach','intro','home','play','results','checkres','grown','school','super'];
let screen='login';
function show(id){screen=id;document.documentElement.dataset.screen=id;SCREENS.forEach(s=>$(s).hidden=s!==id);renderTop();window.scrollTo(0,0)}
function applyWorld(){document.documentElement.dataset.world='winter'} // Moon Base is the only background
function renderTop(){
  const p=P(),inGame=screen==='play';$('top').hidden=inGame;
  let right='';
  if(p&&!TEACH&&!['login','teach','grown'].includes(screen)&&!inGame) right=`<div class="top-actions"><span class="pillbtn whobtn">${avatar(p.skin,26)}<span class="whoname">${esc(p.name)}</span></span><button class="pillbtn" id="topShop" aria-label="${p.coins} stars. Open the shop"><span class="coin"></span><span class="num">${p.coins}</span></button></div>`;
  $('top').innerHTML=`<div class="brandwrap"><div class="brand">Math<span>Wizz</span></div></div>${right}`;
  const b=$('topShop');if(b)b.onclick=()=>{if(screen!=='home'){renderHome();show('home')}setTab('shop')};
}

// ---------- student login: class code, then 4-digit code ----------
const NAME_A=['Cosmic','Lunar','Solar','Stellar','Rocket','Nova','Astro','Galactic','Orbit','Comet','Turbo','Meteor','Nebula','Starry','Zippy','Super','Blazing','Electric','Shooting','Quantum'];
const NAME_B=['Fox','Falcon','Otter','Panda','Tiger','Owl','Rider','Pilot','Ranger','Explorer','Dragon','Wolf','Koala','Shark','Racer','Voyager','Penguin','Lynx','Hawk','Dolphin'];
function spaceName(){const used=new Set(Object.values(S.players).map(p=>p.name));let n,i=0;do{n=NAME_A[Math.floor(Math.random()*NAME_A.length)]+' '+NAME_B[Math.floor(Math.random()*NAME_B.length)];if(++i>60)n+=' '+(2+Math.floor(Math.random()*98))}while(used.has(n));return n}
let L=null;
function toLogin(expired,keepClass){
  if(SESSION){flushSave();if(!expired)api.studentLogout(SESSION.token);}
  SESSION=null;CLASS=null;TEACH=null;S={players:{},order:[],current:null,showBoard:true,muted:false};
  try{const mine=sessionStorage.getItem(TAB);sessionStorage.removeItem(TAB);if(!mine||local().token===mine)setLocal({token:null})}catch(e){setLocal({token:null})}
  applyWorld();openLogin(keepClass);
  if(expired)$('loginFb').textContent='Please log in again.';
}
// The address shows which side you're on, so a refresh comes back to the same place
function setAddress(teacher){try{const want=teacher?'/?teacher=1':'/';if(location.pathname+location.search!==want||location.hash)history.replaceState(null,'',want)}catch(e){}}
// Student login: find your school (remembered on this device), pick your class, type your 4-digit code.
// A class code can still be typed instead (e.g. at home from the login card).
let lastClass=null; // the class just used, so "Not you? Switch player" goes straight to the keypad
function openLogin(keepClass){setAddress(false);
  const sc=local().school||null,kc=keepClass&&lastClass;
  // Which door first: a device that already logs in with a class code (Ms Berry's class) goes straight there, as before.
  // A device that used school email goes to email. A new device asks who is logging in (TT Rock Stars style).
  const way=local().loginWay,codeDevice=way==='code'||(sc&&way!=='email');
  L={school:sc,classCode:kc?kc.code:'',className:kc?kc.name:'',entry:'',fails:0,busy:false,step:kc?'pin':codeDevice?(sc?'class':'school'):way==='email'?'email':'who'};
  $('classFb').textContent='';$('loginFb').textContent='';$('emailFb').textContent='';$('sPass').value='';$('sPass').type='password';$('sShow').textContent='Show';$('classCode').value='';$('schoolSearch').value='';$('schoolList').innerHTML='';
  $('demoHint').hidden=api.mode!=='demo';
  renderLogin();show('login');
  if(L.step==='class')loadClasses4Login();
  if(L.step==='school')setTimeout(()=>{try{$('schoolSearch').focus()}catch(e){}},50);
  if(L.step==='email')setTimeout(()=>{try{$('sEmail').focus()}catch(e){}},50);
}
function renderLogin(){
  const st=L.step;
  $('whoStep').hidden=st!=='who';$('emailStep').hidden=st!=='email';$('parentStep').hidden=st!=='parent';
  $('schoolStep').hidden=st!=='school';$('classStep').hidden=st!=='class';$('classForm').hidden=st!=='code';$('pinStep').hidden=st!=='pin';
  if(L.school)$('pickedSchool').textContent=L.school.name;
  $('loginTitle').textContent='Log in';
  $('loginSub').textContent=`${L.className||'Class '+L.classCode} · enter your 4-digit code`;
  $('dots').querySelectorAll('i').forEach((d,i)=>d.classList.toggle('on',i<L.entry.length));
}
function goStep(st){L.step=st;L.entry='';renderLogin();
  if(st==='school')setTimeout(()=>{try{$('schoolSearch').focus()}catch(e){}},30);
  if(st==='code')setTimeout(()=>{try{$('classCode').focus()}catch(e){}},30);
  if(st==='email')setTimeout(()=>{try{$('sEmail').focus()}catch(e){}},30);
  if(st==='class')loadClasses4Login();}
let schoolTimer=null;
$('schoolSearch').addEventListener('input',()=>{clearTimeout(schoolTimer);schoolTimer=setTimeout(searchSchools,250)});
async function searchSchools(){
  const q=$('schoolSearch').value.trim(),box=$('schoolList');
  if(q.length<2){box.innerHTML='';return}
  let r;try{r=await api.findSchools(q)}catch(e){r={error:'network'}}
  if($('schoolSearch').value.trim()!==q)return;
  if(!Array.isArray(r)){box.innerHTML='<p class="muted small">Could not connect. Check the internet and try again.</p>';return}
  box.innerHTML=r.length?r.map(s=>`<button class="pickbtn" data-school="${esc(s.id)}" data-name="${esc(s.name)}">${esc(s.name)}</button>`).join(''):'<p class="muted small">No school found. Check the spelling, or ask your teacher.</p>';
}
$('schoolList').addEventListener('click',e=>{const b=e.target.closest('[data-school]');if(!b)return;
  L.school={id:b.dataset.school,name:b.dataset.name};setLocal({school:L.school});goStep('class')});
async function loadClasses4Login(){
  const box=$('classList');box.innerHTML='<p class="muted small">Loading classes…</p>';
  let r;try{r=await api.schoolClasses(L.school.id)}catch(e){r={error:'network'}}
  if(!Array.isArray(r)){box.innerHTML='<p class="muted small">Could not connect. Check the internet and try again.</p>';return}
  box.innerHTML=r.length?r.map(c=>`<button class="pickbtn" data-code="${esc(c.code)}" data-name="${esc(c.name)}">${esc(c.name)}</button>`).join(''):'<p class="muted small">This school has no classes yet. Ask your teacher.</p>';
}
$('classList').addEventListener('click',e=>{const b=e.target.closest('[data-code]');if(!b)return;
  L.classCode=b.dataset.code;L.className=b.dataset.name;goStep('pin')});
// who is logging in
document.querySelector('.whogrid').addEventListener('click',e=>{const b=e.target.closest('[data-who]');if(!b)return;const w=b.dataset.who;
  if(w==='student')goStep('email');else if(w==='parent')goStep('parent');else openTeacher(w)});
$('toWho').onclick=()=>goStep('who');
$('emailBack').onclick=$('parentBack').onclick=()=>goStep('who');
$('toCodeLogin').onclick=$('whoCode').onclick=()=>{setLocal({loginWay:'code'});goStep(L.school?'class':'school')};
$('toEmailLogin').onclick=()=>{setLocal({loginWay:null});goStep('who')};
$('sShow').onclick=()=>{const i=$('sPass'),show=i.type==='password';i.type=show?'text':'password';$('sShow').textContent=show?'Hide':'Show'};
$('emailStep').addEventListener('submit',async e=>{
  e.preventDefault();if(L.busy)return;const em=$('sEmail').value.trim(),pw=$('sPass').value.trim(),fb=$('emailFb');
  if(!em.includes('@')){fb.textContent='Type your whole school email, like surname.firstname@sd54.bc.ca';$('sEmail').focus();return}
  if(!pw){fb.textContent='Type the password from your login card.';$('sPass').focus();return}
  L.busy=true;$('sGo').disabled=true;fb.textContent='';
  let r;try{r=await api.studentLoginEmail(em,pw)}catch(err){r={error:'network'}}
  L.busy=false;$('sGo').disabled=false;
  if(r&&r.token){SESSION={token:r.token};lastClass=null;setLocal({token:r.token,loginWay:'email'});try{sessionStorage.setItem(TAB,r.token)}catch(err){}$('sPass').value='';const ok=await loadStudent();if(ok)enterPlayer();return}
  const er=r&&r.error;
  fb.textContent=er==='not_an_email'?'Type your whole school email, like surname.firstname@sd54.bc.ca':er==='too_many_tries'?'Too many tries. Wait 10 minutes, or ask your teacher for your password.':er==='wrong_login'?"That email and password don't match. Check your login card, or ask your teacher.":'Could not connect. Check the internet and try again.';
  $('sPass').value='';$('sPass').focus();
});
$('changeSchool').onclick=()=>{L.school=null;setLocal({school:null});goStep('school')};
$('useCode').onclick=()=>goStep('code');
$('backToSchool').onclick=()=>goStep(L.school?'class':'school');
$('classForm').addEventListener('submit',e=>{
  e.preventDefault();const v=$('classCode').value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(v.length<4){$('classFb').textContent='Class codes are 6 letters and numbers. Ask your teacher.';return}
  L.classCode=v;L.className='';goStep('pin');
});
$('changeClass').onclick=()=>{L.classCode='';L.className='';goStep(L.school?'class':'school')};
function loginPress(d){
  if(!L||L.busy||L.step!=='pin'||!L.classCode||d==='enter')return;
  if(d==='del')L.entry=L.entry.slice(0,-1);else if(L.entry.length<4)L.entry+=d;
  renderLogin();
  if(L.entry.length===4){L.busy=true;setTimeout(loginSubmit,150)}
}
function loginFail(msg){
  L.fails++;L.entry='';L.busy=false;renderLogin();$('loginFb').textContent=msg;
  const dots=$('dots');dots.classList.remove('shake');void dots.offsetWidth;dots.classList.add('shake');
}
async function loginSubmit(){
  let r;try{r=await api.studentLogin(L.classCode,L.entry)}catch(e){r={error:'network'}}
  if(r&&r.token){SESSION={token:r.token};lastClass={code:L.classCode,name:L.className};setLocal({token:r.token,loginWay:'code'});try{sessionStorage.setItem(TAB,r.token)}catch(e){}L.busy=false;L.entry='';const ok=await loadStudent();if(ok)enterPlayer();return}
  const e=r&&r.error;
  if(e&&!['wrong_code','no_class','too_many_tries'].includes(e))console.error('Student login failed:',e);
  if(e==='no_class'){L.classCode='';L.busy=false;goStep(L.school?'class':'code');$('classFb').textContent="We couldn't find that class. Check it with your teacher.";return}
  if(e==='too_many_tries')return loginFail('Too many tries. Wait a few minutes, then try again.');
  if(e==='network'||(e&&e!=='wrong_code'))return loginFail('Could not connect. Check the internet and try again.');
  loginFail(L.fails>=3?'Not quite. Ask your teacher to check your code.':'Not quite. Try again!');
}
async function loadStudent(){
  let st;try{st=await api.studentState(SESSION.token)}catch(e){st={error:'network'}}
  if(!st||st.error){if(st&&st.error==='signed_out'){toLogin(true);return false}loginFail('Could not connect. Check the internet and try again.');return false}
  applyState(st);const p=P();checkBadges(p);return true;
}
$('resetDemo').onclick=()=>{if(api.resetDemo){api.resetDemo();location.reload()}};
function enterPlayer(){
  const p=P();applyWorld();
  if(!p.placed){$('introAvatar').innerHTML=avatar(p.skin,110);$('introTitle').textContent=`Hi ${p.name}!`;show('intro')}
  else{tab='play';renderHome();show('home')}
}
$('introGo').onclick=()=>startCheck();
$('notMe').onclick=()=>toLogin(false,true); // shared iPads: the next child switches to their own login
$('introSkip').onclick=()=>{P().placed=true;save();renderHome();show('home')};

// ---------- home ----------
// ---------- forgiving daily streak ----------
// Counts days played in a row, but weekends never break it, and one missed school day a week is
// covered by a free streak freeze. Losing a long streak is demotivating, so it is hard to lose.
const FLAME='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3-1-3 0-6 1-9.5z" fill="#FF8A1A" stroke="#C2410C" stroke-width="1.2" stroke-linejoin="round"/><path d="M12 13c1 1.2 2 2 2 3.5a2 2 0 0 1-4 0c0-1 .7-1.8 2-3.5z" fill="#FFD447"/></svg>';
const ICE='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="#3DB8FF" stroke-width="2.2" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/></svg>';
const dayStart=t=>{const d=new Date(t);d.setHours(0,0,0,0);return d.getTime()};
const weekKey=t=>{const d=new Date(dayStart(t));d.setDate(d.getDate()-((d.getDay()+6)%7));return d.getTime()};
// Days with no school in BC (2026-27): breaks and stat holidays never cost a streak. Pro-D days are covered by the weekly freeze.
const NO_SCHOOL=[['2026-11-11'],['2026-12-19','2027-01-04'],['2027-02-15'],['2027-03-13','2027-03-29'],['2027-05-24'],['2027-06-25','2027-09-07'],['2027-09-30'],['2027-10-11'],['2027-11-11']];
const ymd=t=>{const d=new Date(t);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
function isSchoolDay(t){const g=new Date(t).getDay();if(g<1||g>5)return false;const k=ymd(t);return !NO_SCHOOL.some(([a,b])=>b?k>=a&&k<=b:k===a)}
function missedSchoolDays(fromDay,toDay){let n=0;for(let t=fromDay+864e5*1.5;dayStart(t)<toDay;t+=864e5){if(isSchoolDay(t))n++}return n}
// Next school day after today, as a word for the streak message ("tomorrow", "Monday", or a date after a break)
function nextSchoolDay(now){let t=dayStart(now)+864e5*1.5;for(let i=0;i<120&&!isSchoolDay(t);i++)t+=864e5;const days=Math.round((dayStart(t)-dayStart(now))/864e5);
  return days===1?'tomorrow':days<7?new Date(t).toLocaleDateString('en-CA',{weekday:'long'}):new Date(t).toLocaleDateString('en-CA',{month:'long',day:'numeric'})}
// Streak card on the Play screen (Duolingo style): flame and day count, this week's school days, and what to do next
function streakHTML(p,now){
  now=now||Date.now();const st=streakInfo(p,now),best=(p.daily&&p.daily.best)||0,mon=weekStart(now);
  const played=new Set(p.rounds.map(r=>ymd(r.d)));
  if(p.daily&&p.daily.lastT)played.add(ymd(p.daily.lastT));
  const days=['M','T','W','T','F'].map((l,i)=>{const t=mon+i*864e5+36e5,k=ymd(t),today=k===ymd(now),off=!isSchoolDay(t),done=played.has(k);
    return `<span class="sday ${done?'done':''} ${today?'today':''} ${off&&!done?'off':''}" title="${off?'No school':''}"><i>${done?'✓':off?'–':''}</i><small>${l}</small></span>`}).join('');
  let msg;
  if(st.playedToday)msg=`Streak safe today! Come back ${nextSchoolDay(now)} to make it ${st.count+1}.`;
  else if(st.count&&!isSchoolDay(now))msg=`No school today, so your ${st.count}-day streak is safe. Playing still earns stars!`;
  else if(st.count&&st.needsFreeze)msg=`You missed a day, but your streak freeze will save it. Play today!`;
  else if(st.count)msg=`Play a round today to keep your ${st.count}-day streak going!`;
  else msg=best?`Play a round to start a new streak. Your best is ${best} days.`:'Play a round today to start a streak!';
  const lit=st.count>0&&st.playedToday;
  return `<div class="streakbox ${lit?'lit':st.count?'risk':'cold'}">
    <div class="shead"><span class="sflame">${FLAME}</span><b class="num">${st.count}</b><span class="slabel">day streak</span>${st.freeLeft&&st.count?`<span class="sfreeze" title="One missed school day each week is forgiven">${ICE} 1 freeze</span>`:''}</div>
    <div class="sweek">${days}</div>
    <p class="smsg">${msg}${best>st.count&&st.count?` <span class="muted">Best: ${best}</span>`:''}</p></div>`;
}
// Players saved before the streak existed: work it out from the rounds they have, with the same rules as bumpStreak
function streakFromRounds(rounds){
  const days=[...new Set(rounds.filter(r=>typeof r.d==='number').map(r=>dayStart(r.d)))].sort((a,b)=>a-b);const d={count:0,lastT:0,best:0};
  for(const t of days){const q={daily:{...d}},st=d.count?streakInfo(q,t+36e5):{alive:false};
    if(st.alive){d.count++;if(st.needsFreeze)d.freezeWeek=weekKey(t)}else d.count=1;d.lastT=t;d.best=Math.max(d.best,d.count)}
  return d;
}
function renderStreak(p){const b=$('streakBox');if(b)b.innerHTML=streakHTML(p)}
function streakInfo(p,now){
  const d=p.daily,today=dayStart(now||Date.now());
  if(!d||!d.lastT||!d.count)return {count:0,alive:false,playedToday:false,freeLeft:true};
  const played=d.lastT===today,missed=played?0:missedSchoolDays(d.lastT,today),freeLeft=d.freezeWeek!==weekKey(today);
  const alive=played||missed===0||(missed===1&&freeLeft);
  return {count:alive?d.count:0,alive,playedToday:played,needsFreeze:!played&&missed===1,freeLeft};
}
function bumpStreak(p){ // call once per finished round; returns {count, grew, usedFreeze}
  const today=dayStart(Date.now()),d=p.daily||(p.daily={count:0,lastT:0,best:0});
  if(d.lastT===today)return {count:d.count,grew:false};
  const st=streakInfo(p);let usedFreeze=false;
  if(st.alive&&d.count){d.count++;if(st.needsFreeze){d.freezeWeek=weekKey(today);usedFreeze=true}}else d.count=1;
  d.lastT=today;d.best=Math.max(d.best||0,d.count);return {count:d.count,grew:true,usedFreeze};
}

// ---------- stars: the one currency. Earned every game, never spent, unlock characters and rockets ----------
// Round score, out of 1000: half for speed, half for accuracy.
//  Speed:    average seconds per right answer. 1.5 s or faster = full 500, 7 s or slower = 0, straight line between.
//  Accuracy: share of answers right, squared, so mistakes cost more as they add up. 100% = 500, 90% = 405, 75% = 281.
//  Short rounds (under 8 answers) are scaled down so a couple of quick answers can't score 1000.
//  A typical round (about 3 s per answer, 90% right) scores about 770.
function scoreRound(c,n,msPer){
  if(!n||!c)return {total:0,speed:0,accuracy:0};
  const sec=msPer/1000,acc=c/n,vol=Math.min(1,n/8);
  const speed=Math.round(500*Math.max(0,Math.min(1,(7-sec)/5.5))*vol);
  const accuracy=Math.round(500*acc*acc*vol);
  return {total:speed+accuracy,speed,accuracy};
}
const gameStars=(c,n,ms)=>Math.round(scoreRound(c,n,ms).total/10);       // up to 100 per game
const roundStars=r=>r.stars!=null?r.stars:gameStars(r.c,r.n,r.ms);
const ptsSince=(p,t)=>p.wkStars!=null?p.wkStars:p.rounds.filter(r=>r.d>=t).reduce((s,r)=>s+roundStars(r),0);
function migrateStars(p){if(p.starsV2)return;p.maxCoins=Math.max(p.maxCoins||0,p.coins||0);p.coins=Math.max(p.coins||0,p.rounds.reduce((s,r)=>s+roundStars(r),0));p.starsV2=true}
const fmtN=n=>n.toLocaleString();
let SCHOOLBOARD=null,boardScope='class'; // school Top 10 (School and School Plus plans), and which board the Top 10 tab shows
function weekBoard(){const wk=weekStart();return S.order.map(id=>S.players[id]).map(q=>({p:q,s:ptsSince(q,wk)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s)}
function renderHome(){
  const p=P();applyWorld();
  $('heroAvatar').innerHTML=`<div class="herowrap">${avatar(p.skin,110)}</div>`;
  const best=pb(p);
  $('playTitle').textContent=`Ready, ${p.name}?`;
  {const wb=weekBoard(),pos=wb.findIndex(x=>x.p.id===p.id);
   // the rank is only shown inside the Top 10, so nobody sees that they are near the bottom
   $('playPts').innerHTML=`<span class="coin"></span><b class="num">${fmtN(ptsSince(p,weekStart()))}</b> this week${pos>=0&&pos<10?` · <b>#${pos+1}</b>`:''}`;
  }
  renderStreak(p);
  {const j=journeyHTML(p);$('journey').innerHTML=j.track;$('journeyMsg').innerHTML=j.msg;}
  renderMinBox(p);
  {const g=S.goal,box=$('goalBox');box.hidden=!g;
   if(g){const n=goalRounds(p),N=g.rounds,done=N&&n>=N;
     box.innerHTML=`<span class="label">This week's goal</span><div class="gline">${N?`<b class="num">${Math.min(n,N)} of ${N}</b> rounds`:''}${g.tables.length?`<span class="gt">${N?' · ':''}Practise ${g.tables.map(t=>`<span class="fchip">${t}×</span>`).join(' ')}</span>`:''}</div>${N?`<div class="gbar"><i style="width:${Math.min(100,n/N*100).toFixed(0)}%"></i></div>`:''}${done?'<span class="gdone">Goal done! ✓</span>':''}`;
     box.classList.toggle('done',!!done)}}
  $('compBox').hidden=true; // competitions are paused: the class and school Top 10 replace them
  renderBoard(p);
  syncTab();
}
// Kid's Play screen: today's minimum from the teacher
function renderMinBox(p){
  const box=$('minBox');if(!box)return;const m=minFor(S.settings,p.id);box.hidden=!m;if(!m)return;
  const n=roundsToday(p.rounds),done=n>=m;
  box.classList.toggle('done',done);
  box.innerHTML=`<span class="label">Today</span><div class="gline">${done?`<b>Done for today! ✓</b> <span class="muted">${n} round${n>1?'s':''}</span>`:`<b class="num">${n} of ${m}</b> rounds · <span>${m-n} to go</span>`}</div><div class="gbar"><i style="width:${Math.min(100,n/m*100).toFixed(0)}%"></i></div>`;
}
function renderBoard(p){
  const wk=weekStart(),mine=ptsSince(p,wk),school=boardScope==='school'&&SCHOOLBOARD;
  $('boardTitle').textContent=S.showBoard?(school?'Top 10 in your school':'Top 10 in your class'):'My stars';
  $('boardScope').hidden=!S.showBoard||!SCHOOLBOARD;
  $('boardScope').querySelectorAll('[data-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scope===boardScope)));
  if(!S.showBoard){$('board').innerHTML='';$('boardMe').textContent=`You have ${fmtN(mine)} stars this week and ${fmtN(p.coins)} in total.`;return}
  const list=school?SCHOOLBOARD.map(x=>({id:x.id,name:x.name,skin:x.skin,sub:x.class,s:x.stars})):weekBoard().map(x=>({id:x.p.id,name:x.p.name,skin:x.p.skin,s:x.s}));
  const rows=list.slice(0,10),inTop=rows.some(x=>x.id===p.id);
  $('board').classList.add('simple');
  $('board').innerHTML=rows.length?`<div class="lhead"><span></span><span></span><span>Player</span><span>Stars this week</span></div>`+rows.map((x,i)=>`<div class="lrow r${i+1} ${x.id===p.id?'me':''}"><span class="lpos num">${i+1}</span>${avatar(x.skin,40)}<span class="lnm">${esc(x.name)}${x.id===p.id?' <small>(you)</small>':''}${x.sub?`<small class="lsub">${esc(x.sub)}</small>`:''}</span><span class="lstars"><span class="coin"></span><b class="num">${fmtN(x.s)}</b></span></div>`).join(''):'<p class="muted">No games played this week yet. Be the first!</p>';
  $('boardMe').textContent=inTop?'The board starts again every Monday.':mine>0?`You have ${fmtN(mine)} stars this week. Keep playing to climb into the Top 10! The board starts again every Monday.`:'Play a round to get on the board.';
}
$('boardScope').addEventListener('click',e=>{const b=e.target.closest('[data-scope]');if(!b)return;boardScope=b.dataset.scope;renderBoard(P())});
$('start').onclick=()=>startRound();
let tab='play';
function logout(){toLogin()}
function setTab(t){
  if(t==='logout'){logout();return}
  tab=t;renderHome();window.scrollTo(0,0);
  if(t==='board')refreshClass(); // fresh Top 10, at most every 2 minutes
}
function syncTab(){
  document.querySelectorAll('.rail [role=tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
  ['play','board','badges','shop'].forEach(x=>$('tab-'+x).hidden=x!==tab);
  if(tab==='badges')renderBadges();
  if(tab==='shop')renderShop();
}
document.querySelector('.rail').addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b)setTab(b.dataset.tab)});

// ---------- question picking ----------
let G=null,q=null,input='',qStart=0,locked=false,tick=null,recent=[];
function makeQ(a,b,p){const div=S.division&&a>1&&Math.random()<.4;return div?{a,b,text:`${a*b} ÷ ${a}`,ans:b}:{a,b,text:`${a} × ${b}`,ans:a*b}}
// ---------- adaptive question picking ----------
// Goals: aim for roughly 4 right answers in 5 so it stays fun, while steadily
// working on each player's weak facts and opening up new ones in a sensible order.
//  1. Missed facts come back 3 questions later for a second go (and once more if missed again).
//  2. A "challenge share" sets how many questions are practice vs confidence. It adapts within
//     the round: 2 misses in a row -> next questions are ones they know; a hot streak -> more challenge.
//  3. Practice questions: mostly their weakest seen facts (slow, often wrong, not seen lately),
//     sometimes a brand-new fact, introduced easiest table first.
//  4. Confidence questions: facts they know, favouring ones not seen for a while (keeps them fresh).
const ORDER=[2,10,5,3,4,11,9,6,8,7,12];              // easiest -> hardest tables
const EASY_B=[1,2,5,10];
function facts(){const out=[],mx=ALL.at(-1);for(const a of ALL)for(let b=1;b<=mx;b++)out.push([a,b]);return out}
function goalBoost(x){return S.goal&&S.goal.tables.length&&Array.isArray(x)&&(S.goal.tables.includes(x[0])||S.goal.tables.includes(x[1]))?3:1}
function weighted(list,wfn){
  const w=list.map(x=>wfn(x)*goalBoost(x)),tot=w.reduce((s,v)=>s+v,0);let r=Math.random()*tot,i=0;
  while(r>w[i]&&i<list.length-1){r-=w[i];i++}return list[i];
}
function newFactWeight([a,b]){ // easier tables and easy multipliers first
  const rank=ORDER.indexOf(a);return Math.pow(.62,rank)*(EASY_B.includes(b)?2:1);
}
// Kept gentle on purpose: most questions are ones the player can get right, so they feel themselves improving.
function challengeShare(p){
  const res=G.res||[],last=res.slice(-5),acc=last.length?last.reduce((s,v)=>s+v,0)/last.length:null;
  if((G.qn||0)<=3)return 0;                                              // warm-up: start every round with easy wins
  if(G.len-(performance.now()-G.start)<10000)return 0;                   // finish strong: last 10 seconds are easy
  if(res.length>=2&&!res[res.length-1]&&!res[res.length-2])return 0;    // 2 misses: rebuild confidence
  if(G.easyRun>0)return 0;
  if(acc===null)return .25;
  if(acc>=.95&&last.length>=5)return .45;                                // flying: stretch them a little
  if(acc>=.8)return .32;
  if(acc>=.6)return .2;
  return .1;
}
// A fact the player used to find hard (missed it, or was much slower) that they now know: showing these again lets them feel the progress
function grewFact(k){if(!k||!k.r.length)return false;const was=k.r.slice(0,-3).includes(0)&&k.r.slice(-3).every(v=>v),faster=k.t.length>=3&&k.t[0]>1.4*k.t[k.t.length-1];return was||faster}
function pick(p){
  G.qn=(G.qn||0)+1;
  const key=([a,b])=>a+','+b, fresh=f=>!recent.includes(key(f));
  let f=null;
  // 1. a missed fact that is due for another go
  const di=(G.retry||[]).findIndex(r=>r.due<=G.qn&&!recent.slice(-2).includes(key(r.f)));
  if(di>=0){f=G.retry[di].f;G.retry.splice(di,1)}
  if(!f){
    const all=facts().filter(fresh);
    const known=all.filter(x=>level(p.facts[key(x)])>=3);
    const weak=all.filter(x=>{const l=level(p.facts[key(x)]);return l===1||l===2});
    const unseen=all.filter(x=>level(p.facts[key(x)])===0);
    // Only open up new facts from the easiest tables that still have unseen ones
    const hot=(G.res||[]).slice(-5).reduce((s,v)=>s+v,0)>=5;
    const openTables=ORDER.filter(t=>unseen.some(x=>x[0]===t)).slice(0,hot?3:2);
    const frontier=unseen.filter(x=>openTables.includes(x[0]));
    const challenge=!known.length||Math.random()<challengeShare(p);
    if(G.easyRun>0)G.easyRun--;
    if(challenge){
      const useNew=frontier.length&&(!weak.length||Math.random()<(known.length<20?.5:.25));
      if(useNew)f=weighted(frontier,newFactWeight);
      else if(weak.length)f=weighted(weak,x=>weakWeight(p,x[0],x[1]));
      else if(frontier.length)f=weighted(frontier,newFactWeight);
    }
    if(!f&&known.length){ // confidence: favour facts not seen for a while, a bit toward slower ones
      const warm=G.qn<=3;
      f=weighted(known,x=>{const k=p.facts[key(x)],m=med(k.t)||2000;if(warm)return 4000/m;const hrs=(Date.now()-k.last)/36e5;return 1+Math.min(hrs/24,3)+m/2500+ORDER.indexOf(x[0])*.3+(grewFact(k)?3:0)});
    }
    if(!f)f=weighted(all.length?all:facts(),newFactWeight);
  }
  recent.push(key(f));if(recent.length>4)recent.shift();
  return makeQ(f[0],f[1],p);
}
function afterAnswer(ok){
  G.res=G.res||[];G.res.push(ok?1:0);
  if(!ok)G.nextQ=null; // re-plan the next question now we know they struggled
  if(!ok){
    G.retry=G.retry||[];const k=q.a+','+q.b,tries=(G.tries=G.tries||{})[k]=(G.tries[k]||0)+1;
    if(tries<=2)G.retry.push({f:[q.a,q.b],due:G.qn+3});
    const r=G.res;if(r.length>=2&&!r[r.length-2])G.easyRun=3;             // two misses: 3 easy ones next
  }
}

// ---------- play engine ----------
const keys=['7','8','9','4','5','6','1','2','3','del','0','enter'];
const padHTML=keys.map(k=>`<button class="key${k==='del'?' del':k==='enter'?' enter':''}" data-d="${k}">${k==='del'?'Delete':k==='enter'?'Enter':k}</button>`).join('');
$('pad').innerHTML=padHTML;$('loginPad').innerHTML=padHTML;
$('pad').addEventListener('pointerdown',e=>{const k=e.target.closest('.key');if(k&&k.dataset.d){e.preventDefault();press(k.dataset.d)}});
$('loginPad').addEventListener('pointerdown',e=>{const k=e.target.closest('.key');if(k&&k.dataset.d){e.preventDefault();loginPress(k.dataset.d)}});

function beginPlay(){
  recent=[];locked=false;$('pcoins').textContent='0';
  $('combo').hidden=true;$('race').hidden=true;$('boss').hidden=true;$('boss').classList.remove('won');
  $('mark').style.top='50%';$('mark').innerHTML=rocketSVG(P().rocket);$('gl').textContent='Go!';$('score').textContent='0';
  buildTrack();setRing(1,G.mode==='round'?String(G.len/1000):'1/'+G.queue.length);G.nextQ=null;
  const round=G.mode==='round';
  show('play');next();
  clearInterval(tick);
  if(round)tick=setInterval(()=>{
    const left=Math.max(0,1-(performance.now()-G.start)/G.len);
    setRing(left,String(Math.ceil(left*G.len/1000)));$('ring').classList.toggle('low',left<.17);
    bossTick();renderGhost();
    if(left<=0&&!locked)finishRound(true);
  },100);
}
function startRound(){G={mode:'round',start:performance.now(),len:60000,c:0,n:0,ms:0,log:[],coins:0,speeds:[],trace:[],bossAt:Math.random()<.6?5+Math.floor(Math.random()*5):null,boss:null,bossPrize:0};beginPlay();raceMyBest()}
// Normal rounds: race the ghost of your own best round
function raceMyBest(){
  const p=P();let tr=p.bestTrace;
  if(!tr||!tr.length){const best=Math.max(0,...(p.rounds||[]).map(r=>r.c||0));if(!best)return;tr=Array.from({length:best},(_,i)=>Math.round((i+1)*59000/best))}
  G.opp={id:null,name:'Your best',skin:p.skin,c:0,state:'ghost'};G.ghost={trace:tr,final:tr.length};buildRace();
}
function startCheck(){
  const queue=[];for(const a of ALL){const bs=[...ALL].sort(()=>Math.random()-.5).slice(0,2);bs.forEach(b=>queue.push([a,b]))}
  queue.sort(()=>Math.random()-.5);
  G={mode:'check',queue,idx:0,c:0,n:0,ms:0,log:[],coins:0,speeds:[]};beginPlay();
}
function next(){
  if(!G)return;
  maybeStartBoss();
  const p=P();
  if(G.mode==='round'){if(performance.now()-G.start>=G.len){finishRound(true);return}q=G.nextQ||pick(p);G.nextQ=pick(p);$('nextq').textContent='Next: '+G.nextQ.text}
  else{if(G.idx>=G.queue.length){finishCheck();return}const [a,b]=G.queue[G.idx++];q={a,b,text:`${a} × ${b}`,ans:a*b};
    const nx=G.queue[G.idx];$('nextq').textContent=nx?`Next: ${nx[0]} × ${nx[1]}`:'Last one!';setRing(1-(G.idx-1)/G.queue.length,`${G.idx}/${G.queue.length}`)}
  input='';$('q').textContent=q.text;$('ans').textContent='';$('ans').className='ans';$('fb').textContent='';$('fb').className='fb';
  qStart=performance.now();
}
function record(ok,ms){
  const p=P(),k=q.a+','+q.b,f=p.facts[k]||(p.facts[k]={r:[],t:[],last:0});
  f.r.push(ok?1:0);if(f.r.length>8)f.r.shift();
  if(ok){f.t.push(Math.round(ms));if(f.t.length>5)f.t.shift()}
  f.last=Date.now();G.log.push({a:q.a,text:q.text,ans:q.ans,ok,ms});
}
const RING_C=2*Math.PI*19;
function setRing(frac,txt){const f=$('ringFg');f.style.strokeDasharray=RING_C.toFixed(1);f.style.strokeDashoffset=(RING_C*(1-Math.max(0,Math.min(1,frac)))).toFixed(1);$('ringTxt').textContent=txt}
let trackBuilt=false;
function buildTrack(){
  if(trackBuilt)return;trackBuilt=true;
  const bounds=TIERS.map((t,i)=>[i<TIERS.length-1?TIERS[i+1].max:1,Math.min(t.max,10)]);
  $('track').insertAdjacentHTML('afterbegin',TIERS.map((t,i)=>{const [lo,hi]=bounds[i],mid=(Math.log10(lo)+Math.log10(hi))/2*100;
    return `<span class="tlabel" style="top:calc(30px + (100% - 64px)*${Math.min(mid/100,.955).toFixed(3)});color:${TIER_COLORS[i]}">${t.name}</span><span class="ttick" style="top:calc(30px + (100% - 64px)*${Math.log10(hi).toFixed(3)})"></span>`}).join(''));
}
function updateGauge(){
  const s=G.speeds.slice(-5);if(!s.length)return;
  const sec=s.reduce((x,y)=>x+y,0)/s.length/1000;
  const frac=Math.min(1,Math.max(0,Math.log10(Math.max(sec,1))));
  $('mark').style.top=`calc(30px + (100% - 64px)*${frac.toFixed(3)})`;
  {const ti=tierIndex(sec);$('gl').innerHTML=`<b class="kmh">${TIERS[ti].name}</b><br>${ti<TIERS.length-1?'Next: '+TIERS[ti+1].name:'Top rank!'}`;}
}
function press(d){
  if(!G||locked)return;
  if(d==='enter'){if(input.length)check();return}
  if(d==='del')input=input.slice(0,-1);else if(input.length<4)input+=d;
  $('ans').textContent=input;
  if(d!=='del'&&input.length>=String(q.ans).length)check();
}
function check(){
  const ms=performance.now()-qStart,ok=Number(input)===q.ans;
  record(ok,ms);G.n++;if(G.mode==='round')afterAnswer(ok);G.speeds.push(ok?ms:Math.max(6000,Math.min(ms*1.5,10000)));updateGauge();
  if(ok&&G.trace)G.trace.push(performance.now()-G.start);
  if(ok){G.c++;G.ms+=ms;G.streak=(G.streak||0)+1;G.best=Math.max(G.best||0,G.streak);
    G.coins++;flyStars(1);if(G.boss)bossHit();
    SFX.right(G.streak);if(G.mode==='round'&&(G.streak===5||G.streak===10))SFX.combo();
    const cb=$('combo');cb.hidden=!(G.mode==='round'&&G.streak>=3);cb.textContent=`${G.streak} in a row`;cb.classList.toggle('hot',G.streak>=10);
    $('pcoins').textContent=liveStars();$('score').textContent=G.c;if(G.opp)renderRace();$('ans').className='ans ok';$('fb').className='fb goal';
    $('fb').textContent=G.mode==='round'&&G.streak>=3?`${G.streak} in a row!`:'Correct!';locked=true;setTimeout(()=>{locked=false;next()},140)}
  else{G.streak=0;$('combo').hidden=true;SFX.wrong();$('ans').className='ans no';$('fb').className='fb no';$('fb').textContent=(G.mode==='check'?'Good try! ':'')+`${q.text} = ${q.ans}`;locked=true;setTimeout(()=>{locked=false;next()},1300)}
}
function rankReward(t){return 10+t*5}
function liveStars(){return G.mode==='round'?gameStars(G.c,G.n,G.c?G.ms/G.c:0)+(G.bossPrize||0):G.coins}
function finishRound(keep){
  clearInterval(tick);const g=G;G=null;if(!g)return;
  const p=P();
  if(!keep||g.n===0){save();renderHome();show('home');return}
  const before=tierIndex(statusSecs(p)),prevBest=pb(p);
  const r={d:Date.now(),c:g.c,n:g.n,ms:g.c?Math.round(g.ms/g.c):0,len:60,best:g.best||0,boss:!!(g.boss&&g.boss.state==='won'),pts:0};
  const sc=scoreRound(r.c,r.n,r.ms);r.pts=sc.total;
  const base=Math.round(sc.total/10),bp=g.bossPrize||0;let rankStars=0;
  {const now=tierIndex(statusSecs({rounds:[...p.rounds,r]}));if(p.rankPaid==null)p.rankPaid=before;
   for(let t=p.rankPaid+1;t<=now;t++){if(t>=0)rankStars+=rankReward(t)}
   if(now>p.rankPaid)p.rankPaid=now}
  r.stars=base+bp+rankStars;
  if(g.trace&&g.c>((p.bestTrace||[]).length)&&g.c>=Math.max(0,...p.rounds.map(x=>x.c||0)))p.bestTrace=g.trace.slice(0,150).map(Math.round);
  p.rounds.push(r);if(p.rounds.length>60)p.rounds.shift();
  const stk=bumpStreak(p);
  const total=r.stars;p.coins+=total;p.maxCoins=Math.max(p.maxCoins||0,p.coins);save();
  const after=tierIndex(statusSecs(p)),up=after>before&&before>=0;const newBadges=checkBadges(p);save();
  $('resTitle').textContent=g.c>=20?'Brilliant round!':g.c>=10?'Nice work!':'Round over';
  $('resCorrect').textContent=g.c;
  $('resStars').textContent=total;
  $('resTier').textContent=after<0?'No rank yet':TIERS[after].name;$('resTierBox').classList.toggle('up',up);
  $('resTierNote').textContent=up?' ▲':'';
  show('results');confettiBurst();SFX.end();
  if(after>=0&&after>before)setTimeout(()=>celebrate(`<div class="ovart">${tierArt(after)}</div><span class="label">${before<0?'Your first rank':'Rank up!'}</span><h1>You reached ${TIERS[after].name}!</h1><p class="rankprize"><span class="coin"></span>+${rankReward(after)} stars</p><p class="muted">${after<TIERS.length-1?'Next stop: '+TIERS[after+1].name:'You made it to the very top!'}</p>`),900);
  if(stk.grew&&[3,5,10,15,20,30,50,100].includes(stk.count))setTimeout(()=>celebrate(`<div class="ovart bigflame">${FLAME}</div><span class="label">Streak!</span><h1>${stk.count} days in a row!</h1><p class="muted">${stk.usedFreeze?'Your streak freeze saved your streak this week. ':''}Keep coming back to grow your streak.</p>`),850);
  else if(stk.usedFreeze)setTimeout(()=>celebrate(`<div class="ovart bigflame">${ICE}</div><span class="label">Streak saved!</span><h1>Your streak freeze kicked in</h1><p class="muted">You missed a day, so your free freeze kept your ${stk.count}-day streak going. You get a new one each week.</p>`,'Phew!'),850);
  if(newBadges.length)setTimeout(()=>celebrateBadges(newBadges),after>before?950:900);
}
function finishCheck(){
  const g=G;G=null;const p=P();
  p.placed=true;p.coins+=g.coins;p.maxCoins=Math.max(p.maxCoins||0,p.coins);save();
  const byT={};g.log.forEach(x=>{(byT[x.a]=byT[x.a]||[]).push(x)});
  let strong=0,focus=[];
  $('crTables').innerHTML=ALL.map(t=>{const xs=byT[t]||[],allOk=xs.length&&xs.every(x=>x.ok),fast=allOk&&xs.every(x=>x.ms<3500);
    const cls=fast?'strong':allOk?'ok':'focus';if(fast)strong++;if(cls==='focus')focus.push(t);return `<span class="fact ${cls}">${t}×</span>`}).join('');
  $('crSummary').textContent=`You got ${g.c} out of ${g.n} right and earned ${g.coins} stars. `+(strong?`${strong} table${strong>1?'s are':' is'} already strong. `:'')+(focus.length?`We'll help you practise your ${focus.join(', ')} times tables.`:'Wow, every table looks good!');
  show('checkres');confettiBurst();SFX.end();
}
$('crGo').onclick=()=>{renderHome();show('home')};
$('quit').onclick=()=>{if(G&&G.mode==='check'){clearInterval(tick);G=null;save();renderHome();show('home')}else finishRound(false)};
$('again').onclick=()=>startRound();
$('resHome').onclick=()=>{renderHome();show('home')};
document.addEventListener('keydown',e=>{
  if(!$('helpOv').hidden){if(e.key==='Escape')closeHelp();return}
  if(screen==='login'&&L){if(L.step!=='pin'||/INPUT|TEXTAREA/.test((document.activeElement||{}).tagName||''))return; // typing in the class code box works normally
    if(/^[0-9]$/.test(e.key)){e.preventDefault();loginPress(e.key)}else if(e.key==='Backspace'){e.preventDefault();loginPress('del')}return}
  if(!G||screen!=='play')return;
  if(/^[0-9]$/.test(e.key)){e.preventDefault();press(e.key)}
  else if(e.key==='Backspace'){e.preventDefault();press('del')}
  else if(e.key==='Enter'){e.preventDefault();press('enter')}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&G&&G.mode==='round')finishRound(false)});

// ---------- shop ----------
let shopTab='skins';
const boxed=h=>`<div style="height:97px;display:grid;place-items:center">${h}</div>`;
const CATS={
  skins:  {list:SKINS,  owned:p=>p.owned,  cur:p=>p.skin,  set:(p,id)=>{p.skin=id},  pic:id=>avatar(id,84),         on:'Playing as',  use:'Play as'},
  rockets:{list:ROCKETS,owned:p=>p.rockets,cur:p=>p.rocket,set:(p,id)=>{p.rocket=id},pic:id=>boxed(rocketSVG(id,42)),on:'Flying this', use:'Fly this'},
};
function renderShop(){
  const p=P(),C=CATS[shopTab];p.maxCoins=Math.max(p.maxCoins||0,p.coins);$('shopCoins').textContent=p.coins;const ti=tierIndex(statusSecs(p));
  document.querySelectorAll('.tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===shopTab)));
  const owned=C.owned(p),cur=C.cur(p),LIST=C.list;
  $('shop').innerHTML=LIST.map((it,idx)=>{
    const has=owned.includes(it.id),on=cur===it.id,lockedRank=it.rank!=null&&ti<it.rank;
    let btn;
    if(on)btn=`<button class="btn" disabled>${C.on}</button>`;
    else if(has)btn=`<button class="btn" data-use="${it.id}">${C.use}</button>`;
    else if(lockedRank)btn=`<button class="btn" disabled>Reach ${TIERS[it.rank].name}</button>`;
    else if(p.coins<it.cost)btn='';
    else btn=`<button class="btn primary" data-buy="${it.id}"><span class="coins" style="font-size:1rem;justify-content:center"><span class="coin"></span>${fmtN(it.cost)}</span></button>`;
    const R=RARITY[it.rarity];
    // One mystery rule: Legendary items stay hidden until the player has held 60% of the price
    const revealAt=Math.ceil(it.cost*.6);
    // Legendaries stay a mystery until bought: the unboxing pop-up is the big reveal
    if(!has&&it.rarity==='legendary'){
      return `<div class="item mystery" style="--r1:${R.r1};--r2:${R.r2}"><div class="art"><div class="qmark" aria-hidden="true">?</div><span class="rib">${R.name}</span></div><b>Mystery legendary</b><span class="muted"><span class="coin"></span> ${fmtN(it.cost)} stars${it.rank!=null?' · '+TIERS[it.rank].name+'+':''}</span>${btn}</div>`;
    }
    const pic=`<div class="art">${C.pic(it.id)}<span class="rib">${R.name}</span></div>`;
    const price=has?'<span class="muted">Yours</span>':`<span class="muted"><span class="coin"></span> ${fmtN(it.cost)} stars${it.rank!=null?' · '+TIERS[it.rank].name+'+':''}</span>`;
    return `<div class="item ${on?'on':''} ${has||p.coins>=it.cost?'':'locked'}" style="--r1:${R.r1};--r2:${R.r2}">${pic}<b>${it.name}</b>${price}${btn}</div>`;
  }).join('');
  renderTop();
}
document.querySelector('.tabs').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;shopTab=b.dataset.tab;renderShop()});
$('shop').addEventListener('click',e=>{
  const p=P(),b=e.target.closest('button');if(!b)return;const C=CATS[shopTab];
  if(b.dataset.buy){const it=C.list.find(x=>x.id===b.dataset.buy);if(!it||p.coins<it.cost)return;p.coins-=it.cost;C.owned(p).push(it.id);SFX.buy();
    const R=RARITY[it.rarity],kind=shopTab==='skins'?'character':'rocket';
    celebrate(`<span class="label">New ${kind}!</span><div class="ovart unbox" style="--r1:${R.r1};--r2:${R.r2}">${C.pic(it.id)}</div><h1>${it.name}</h1><span class="rk" style="--r1:${R.r1};--r2:${R.r2}">${R.name}</span>`,'Use it!');
    setTimeout(()=>{const nb=checkBadges(p);if(nb.length){save();celebrateBadges(nb)}},50)}
  const id=b.dataset.buy||b.dataset.use;if(!id)return;
  C.set(p,id);save();applyWorld();renderShop();
});

// ---------- sound effects (made in the browser, no files) ----------
var AC=null;
function ac(){if(S.muted)return null;try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.state==='suspended')AC.resume();return AC}catch(e){return null}}
function tone(f,d,type,vol,at){const a=ac();if(!a)return;const t=a.currentTime+(at||0),o=a.createOscillator(),g=a.createGain();o.type=type||'sine';o.frequency.setValueAtTime(f,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol||.16,t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g);g.connect(a.destination);o.start(t);o.stop(t+d+.05)}
const SFX={
  right(streak){const f=660*Math.pow(1.05,Math.min(streak||0,12));tone(f,.11,'sine',.15);tone(f*1.5,.15,'sine',.11,.06)},
  wrong(){tone(220,.2,'triangle',.13);tone(165,.26,'triangle',.11,.08)},
  combo(){[784,988,1175,1568].forEach((f,i)=>tone(f,.12,'square',.05,i*.06))},
  end(){[523,659,784,1047].forEach((f,i)=>tone(f,.24,'triangle',.13,i*.12))},
  buy(){[880,1175,1320].forEach((f,i)=>tone(f,.14,'sine',.13,i*.07))}
};
const SPK_ON='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const SPK_OFF='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
function muteBtn(id){return `<button class="pillbtn mutebtn" id="${id}" aria-pressed="${!S.muted}" aria-label="${S.muted?'Turn sound on':'Turn sound off'}">${S.muted?SPK_OFF:SPK_ON}</button>`}
function bindMute(id){const b=$(id);if(!b)return;b.onclick=()=>{S.muted=!S.muted;b.outerHTML=muteBtn(id);bindMute(id);if(!S.muted)SFX.right(0)}}

// ---------- confetti: one simple burst ----------
function confettiBurst(){
  try{if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return}catch(e){}
  const c=document.createElement('canvas');c.className='confetti-burst';c.setAttribute('aria-hidden','true');document.body.appendChild(c);
  const dpr=Math.min(2,window.devicePixelRatio||1),W=innerWidth,H=innerHeight;c.width=W*dpr;c.height=H*dpr;
  const x=c.getContext('2d');x.scale(dpr,dpr);
  const cols=['#FF5A5F','#FFC23C','#3ACB7E','#4D8DFF','#B07CFF'],P=[];
  for(let i=0;i<70;i++){const a=Math.random()*Math.PI*2,sp=4+Math.random()*7;P.push({x:W/2,y:H*.4,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-4,r:Math.random()*3,vr:(Math.random()-.5)*.3,c:cols[i%cols.length]})}
  let t=0;
  (function frame(){
    t++;x.clearRect(0,0,W,H);x.globalAlpha=Math.max(0,Math.min(1,(120-t)/30));
    for(const p of P){p.vy+=.18;p.vx*=.97;p.vy*=.97;p.x+=p.vx;p.y+=p.vy;p.r+=p.vr;x.save();x.translate(p.x,p.y);x.rotate(p.r);x.fillStyle=p.c;x.fillRect(-4,-2.5,8,5);x.restore()}
    if(t<120)requestAnimationFrame(frame);else c.remove();
  })();
}
// ---------- grown-ups: progress dashboard ----------
let GSel=null;
// Teachers see the real name (if added) with the space name underneath
function whoHTML(p){return p.realName?`<span class="who"><b>${esc(p.realName)}</b><small>${esc(p.name)}</small></span>`:`<span class="who"><b>${esc(p.name)}</b></span>`}
function lastPlayed(p){if(!p.rounds.length)return 'Never';const d=Math.floor((Date.now()-p.rounds[p.rounds.length-1].d)/864e5);return d<=0?'Today':d===1?'Yesterday':d+' days ago'}
function spark(p){
  const rs=p.rounds.slice(-8).map(rate);if(rs.length<2)return '<span class="muted">—</span>';
  const W=84,H=26,mx=Math.max(...rs),mn=Math.min(...rs),sp=Math.max(1,mx-mn);
  const pts=rs.map((v,i)=>[(i/(rs.length-1))*(W-8)+4,H-4-((v-mn)/sp)*(H-8)]),last=pts[pts.length-1];
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Last scores: ${rs.join(', ')}"><polyline points="${pts.map(x=>x.map(n=>n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--track)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" fill="var(--accent)"/></svg>`;
}
function focusOf(p){return ALL.map(t=>({t,s:tableScore(p,t)})).filter(x=>x.s!=null&&x.s<3).sort((a,b)=>a.s-b.s).slice(0,3).map(x=>x.t)}
const LEVELS=['Not tried','Tricky','Getting there','Quick','Instant'];
function weekAcc(p,wk){const rs=p.rounds.filter(r=>r.d>=wk),n=rs.reduce((s,r)=>s+r.n,0);return n?Math.round(rs.reduce((s,r)=>s+r.c,0)/n*100):null}
// Email students: school email + password (teacher can always see it). Code students: 4-digit code, as before.
function loginCell(p){
  if(p.username)return `<span class="uname">${esc(p.username)}</span><b class="num pin">${esc(p.passcode)}</b> <button class="linkbtn" data-newpass="${p.id}">New password</button>`;
  return `<b class="num pin">${esc(p.pin||'')}</b> <button class="linkbtn" data-newpin="${p.id}">New code</button>`;
}
const minOpts=(sel,first)=>(first?[first]:[]).concat(Array.from({length:MAX_MIN+1},(_,i)=>[String(i),i?`${i} round${i>1?'s':''}`:'No minimum'])).map(([v,l])=>`<option value="${v}" ${String(sel)===v?'selected':''}>${l}</option>`).join('');
// Today column: "2 / 3 ✓" against this child's minimum
function todayCell(p,cs,now){
  const n=roundsToday(p.rounds,now),m=minFor(cs,p.id),own=hasOwnMin(cs,p.id);
  if(!m)return n?`<span class="num">${n}</span>`:'<span class="muted">—</span>';
  return `<span class="mincell ${n>=m?'ok':n?'part':'none'}" title="${own?'Own minimum':'Class minimum'}: ${m}"><b class="num">${Math.min(n,m)} / ${m}</b>${n>=m?' ✓':''}${own?'<small>own</small>':''}</span>`;
}
// Where the four cards were: one number for the class, and how many reached it today
function renderMinPanel(players,now){
  const c=curClass(),cs=c&&c.settings,m=+(cs&&cs.minRounds)||0;
  const withMin=players.filter(p=>minFor(cs,p.id)>0),done=withMin.filter(p=>roundsToday(p.rounds,now)>=minFor(cs,p.id)).length;
  const own=players.filter(p=>hasOwnMin(cs,p.id)).length;
  $('kpis').innerHTML=`<div class="minpanel">
    <label class="minset" for="minClass"><span class="label">Minimum rounds each time they play</span>
      <span class="row" style="align-items:center;gap:10px"><select id="minClass" ${viewingOther()?'disabled':''}>${minOpts(m)}</select><span class="muted small">for the whole class${own?` · ${own} student${own>1?'s have':' has'} their own number`:''}</span></span></label>
    ${withMin.length?`<div class="mintoday"><span class="label">Today</span><b class="num">${done}<small> of ${withMin.length}</small></b><span class="muted small">played their minimum</span></div>`:''}
    <p class="note" id="minMsg" aria-live="polite" style="background:none;padding:0;margin:0"></p></div>`;
}
const TREND={up:['↑','Getting faster'],down:['↓','Slower lately'],flat:['→','About the same']};
function renderGrown(){
  const now=Date.now(),players=S.order.map(id=>S.players[id]),stats=(TEACH&&TEACH.stats)||{};
  renderMinPanel(players,now);

  $('gProgress').innerHTML=chartHTML(pSeries(rowsFromPlayers(players)));
  if(!players.length){$('tbl').innerHTML='<tbody><tr><td class="muted">No students in this class yet. Add them above, then print their login cards.</td></tr></tbody>';$('gdetail').hidden=true;return}
  const rows=players.map(p=>({p}));
  if(!GSel||!S.players[GSel])GSel=players[0].id;
  const cs=curClass()&&curClass().settings;
  $('tbl').innerHTML=`<thead><tr><th>Student</th><th>Today</th><th>Last played</th><th class="r">Days (7 days)</th><th class="r">Rounds (all)</th><th class="r">Accuracy</th><th class="r">Correct / min</th><th class="r">Stars earned</th><th>Trend</th><th>Login</th></tr></thead><tbody>`+
    (rows.length?rows.map(({p})=>{
      const st=stats[p.id]||{},a=accOf(p.rounds,now),cpm=correctPerMin(p.rounds,now),tr=trendOf(p.rounds);
      return `<tr data-id="${p.id}" tabindex="0" class="${p.id===GSel?'sel':''}">
        <td><span class="stu">${avatar(p.skin,26)}${whoHTML(p)}</span></td>
        <td>${todayCell(p,cs,now)}</td>
        <td>${lastPlayed(p)}</td>
        <td class="r">${daysPlayed(p.rounds,now)}</td>
        <td class="r">${st.rounds_total!=null?st.rounds_total:p.rounds.length}</td>
        <td class="r">${a==null?'—':Math.round(a*100)+'%'}</td>
        <td class="r">${cpm==null?'—':cpm.toFixed(0)}</td>
        <td class="r">${st.stars_total!=null?fmtN(st.stars_total):'—'}</td>
        <td>${tr?`<span class="trend t-${tr}" title="${TREND[tr][1]}">${TREND[tr][0]}</span>`:'<span class="muted">—</span>'}</td>
        <td>${loginCell(p)}</td>
      </tr>`}).join(''):'')+'</tbody>';

  const p=S.players[GSel],ti=tierIndex(statusSecs(p));$('gdetail').hidden=false;
  const bars=ALL.map(t=>{const s=tableScore(p,t),lv=s==null?0:Math.min(4,Math.max(1,Math.round(s)));
    return `<span class="num" style="font-weight:800">${t}×</span><span class="tbar"><i style="width:${s==null?0:(s/4*100).toFixed(0)}%;background:var(--h${lv})"></i></span><span class="muted">${LEVELS[lv]}</span>`}).join('');
  const mx=ALL.at(-1);let hm='<div class="h">×</div>';for(let b=1;b<=mx;b++)hm+=`<div class="h">${b}</div>`;
  for(let a=1;a<=mx;a++){hm+=`<div class="h">${a}</div>`;for(let b=1;b<=mx;b++)hm+=`<div class="cell l${level(p.facts[a+','+b])}" title="${a} × ${b}"></div>`}
  const recent=p.rounds.slice(-6).reverse();
  $('gdetail').innerHTML=`
    <form class="row realrow" id="gdRealForm"><label for="gdReal">Real name</label><input id="gdReal" maxlength="80" placeholder="Only teachers see this" value="${esc(p.realName||'')}"><button class="btn" type="submit">Save</button></form>
    ${p.username?`<p class="note gdlogin">Logs in with <b>${esc(p.username)}</b> · password <b class="num">${esc(p.passcode)}</b>${p.pin?` · class code login still works (code <b class="num">${esc(p.pin)}</b>)`:''}</p>`
      :`<form class="row realrow" id="gdEmailForm"><label for="gdEmail">School email</label><input id="gdEmail" maxlength="120" autocapitalize="none" spellcheck="false" placeholder="surname.firstname@sd54.bc.ca"><button class="btn" type="submit">Add email login</button></form>`}
    ${(()=>{const cs=curClass()&&curClass().settings,cm=+(cs&&cs.minRounds)||0,own=hasOwnMin(cs,p.id),td=roundsToday(p.rounds);
      return `<form class="row realrow" id="gdMinForm"><label for="gdMin">Minimum rounds</label><select id="gdMin">${minOpts(own?String(minFor(cs,p.id)):'class',['class',`Same as class (${cm?cm+' round'+(cm>1?'s':''):'none'})`])}</select><span class="muted small">Today: ${td} round${td===1?'':'s'}</span></form>`})()}
    <div class="row" id="gdActions" style="justify-content:flex-end"><button class="btn" id="gdNewCode">Give a new code</button><button class="btn danger" id="gdRemove">Remove student</button></div>
    <p class="note" id="gdMsg" aria-live="polite" style="background:none;padding:0"></p>
    <div class="kid-head">${avatar(p.skin,56)}<div style="min-width:0"><h2>${esc(p.realName||p.name)}</h2><span class="muted">${p.realName?'Space name '+esc(p.name)+' · ':''}${ti<0?'No status yet':TIERS[ti].name+' · '+statusSecs(p).toFixed(1)+' s per answer'} · login code <b class="num">${esc(p.pin)}</b></span></div></div>
    <div class="gd-grid">
      <div class="gd-col"><span class="label">Each times table</span><div class="tbars">${bars}</div></div>
      <div class="gd-col"><span class="label">Every fact</span><div class="hm-wrap"><div class="hm" style="grid-template-columns:repeat(${mx+1},minmax(22px,1fr))">${hm}</div></div>
        <div class="legend"><span><i style="background:var(--h0)"></i>Not tried</span><span><i style="background:var(--h1)"></i>Tricky</span><span><i style="background:var(--h2)"></i>Getting there</span><span><i style="background:var(--h3)"></i>Quick</span><span><i style="background:var(--h4)"></i>Instant</span></div></div>
    </div>
    <div class="gd-col"><span class="label">Recent rounds</span>${recent.length?`<div class="rr">${recent.map(r=>`<span>${new Date(r.d).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'})}</span><span><b>${r.c}</b> <span class="muted">/ ${r.n}</span></span><span class="muted">${r.len/60} min</span><span class="muted">${r.c?(r.ms/1000).toFixed(1)+' s':'—'}</span>`).join('')}</div>`:'<p class="muted">No rounds yet.</p>'}</div>`;
}
function selectStudent(tr){GSel=tr.dataset.id;renderGrown();$('gdetail').scrollIntoView({behavior:'smooth',block:'start'})}
// whole-class minimum
$('kpis').addEventListener('change',async e=>{
  if(e.target.id!=='minClass'||viewingOther())return;const c=curClass();if(!c)return;
  c.settings=withClassMin(c.settings,e.target.value);await saveMin(c,'minMsg');
});
async function saveMin(c,msgId){
  try{await api.updateClass(c.id,{settings:c.settings});applySettings(c.settings);renderGrown();if($(msgId))$(msgId).textContent='Saved. Students see it the next time they open the game.'}
  catch(err){if($(msgId))$(msgId).textContent='Could not save: '+err.message}
}
$('tbl').addEventListener('click',async e=>{
  const nb=e.target.closest('[data-newpin]');
  const np=e.target.closest('[data-newpass]');
  if(np){const p=S.players[np.dataset.newpass];np.disabled=true;const r=await api.setStudentLogin(p.id,null);
    if(r&&r.passcode){p.passcode=r.passcode;renderGrown();if(!$('codecards').hidden)renderCodeCards();$('addMsg').textContent=`New password for ${p.realName||p.name}: ${p.passcode}`}else{np.disabled=false;alert('Could not make a new password: '+((r&&r.error)||'no reply'))}return}
  if(nb){const p=S.players[nb.dataset.newpin];nb.disabled=true;try{p.pin=await api.newPin(p.id);renderGrown();if(!$('codecards').hidden)renderCodeCards();$('addMsg').textContent=`New code for ${p.name}: ${p.pin}`}catch(err){nb.disabled=false;alert('Could not make a new code: '+err.message)}return}
  const tr=e.target.closest('tr[data-id]');if(tr)selectStudent(tr)});
$('tbl').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const tr=e.target.closest('tr[data-id]');if(tr){e.preventDefault();selectStudent(tr)}}});
$('grownBack').onclick=$('sOut').onclick=$('acctOut').onclick=async()=>{await api.teacherSignOut();setLocal({teacher:false});TEACH=null;toLogin()};

// ---------- celebration pop-ups (rank ups, new badges, shop unboxing) ----------
const ovQueue=[];
function celebrate(html,btn,onOk,later){ovQueue.push({html,btn,onOk,later});if(ovQueue.length===1)showOv()}
function showOv(){
  const it=ovQueue[0];if(!it){$('overlay').hidden=true;return}
  const card=$('ovcard');card.innerHTML=it.html+`<button class="go ovbtn" id="ovOk">${it.btn||'Awesome!'}</button>`+(it.later?`<button class="btn ovlater" id="ovLater" style="width:100%">${it.later}</button>`:'');
  $('overlay').hidden=false;card.classList.remove('flip');void card.offsetWidth;card.classList.add('flip');
  confettiBurst();SFX.combo();
  const b=$('ovOk');try{b.focus()}catch(e){}
  const close=()=>{ovQueue.shift();$('overlay').hidden=true;setTimeout(showOv,180)};
  b.onclick=()=>{close();if(it.onOk)setTimeout(it.onOk,200)};
  const l=$('ovLater');if(l)l.onclick=close;
}
const TIER_ART=['#6DB57A','#DCE8F7','#2A2F6B','#5EC2FF','#C3CBDA','#E6EBF3','#D9784E','#E8B98F','#E8C27A','#C79BFF'];
function tierArt(i){
  const c=TIER_ART[i]||'#5EC2FF',k='#1B1D2E';
  let extra='';
  if(i===1)extra=`<ellipse cx="44" cy="62" rx="20" ry="11" fill="#FFFFFF" stroke="${k}" stroke-width="2"/><ellipse cx="62" cy="56" rx="18" ry="13" fill="#FFFFFF" stroke="${k}" stroke-width="2"/>`;
  if(i===4)extra=`<rect x="22" y="54" width="20" height="12" fill="#3F6FD1" stroke="#fff" stroke-width="1.5"/><rect x="78" y="54" width="20" height="12" fill="#3F6FD1" stroke="#fff" stroke-width="1.5"/><path d="M42 60h36" stroke="#DCE3EE" stroke-width="3"/>`;
  if(i===5)extra=`<circle cx="50" cy="50" r="5" fill="#C3CBDA"/><circle cx="70" cy="68" r="4" fill="#C3CBDA"/><circle cx="64" cy="44" r="3" fill="#C3CBDA"/>`;
  if(i===7)extra=`<path d="M34 50 Q60 46 86 50M32 62 Q60 58 88 62M36 74 Q60 70 84 74" stroke="#C4572F" stroke-width="3" fill="none" opacity=".6"/>`;
  if(i===8)extra=`<ellipse cx="60" cy="62" rx="44" ry="11" fill="none" stroke="#FFE6B0" stroke-width="5"/>`;
  if(i===9)extra=`<path d="M60 60 C72 50 90 54 92 62 M60 60 C48 70 30 66 28 58 M60 60 C68 72 84 74 94 70 M60 60 C52 48 36 46 26 50" stroke="#FFFFFF" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  const body=i===9?`<circle cx="60" cy="60" r="10" fill="#FFF8E6"/>`:`<circle cx="60" cy="60" r="${i===0?34:30}" fill="${c}" stroke="${k}" stroke-width="2.5"/>`;
  return `<svg viewBox="0 0 120 120" width="130" height="130" aria-hidden="true"><circle cx="60" cy="60" r="56" fill="${c}" opacity=".18"/><circle cx="18" cy="22" r="2" fill="#FFD447"/><circle cx="100" cy="30" r="2.5" fill="#FFD447"/><circle cx="96" cy="100" r="1.8" fill="#FFD447"/>${i===9?`<ellipse cx="60" cy="60" rx="46" ry="22" fill="${c}" opacity=".5"/>`:''}${body}${extra}</svg>`;
}

// ---------- badges ----------
function shopCount(p){return Math.max(0,(p.owned||[]).length-1)+Math.max(0,(p.rockets||[]).length-1)}
function knowsTable(p,t){for(let b=1;b<=12;b++)if(level(p.facts[t+','+b])<3)return false;return true}
const totalRight=p=>p.rounds.reduce((t,r)=>t+r.c,0);
const BADGES=[
  {id:'first',  name:'First round',  desc:'Finish your first round',       mark:'1',  test:p=>p.rounds.length>=1},
  {id:'r10',    name:'Regular',      desc:'Finish 10 rounds',              mark:'10', test:p=>p.rounds.length>=10},
  {id:'perfect',name:'Perfect round',desc:'10 or more right, no mistakes', mark:'★',  test:p=>p.rounds.some(r=>r.c>=10&&r.c===r.n)},
  {id:'combo10',name:'On fire',      desc:'Get 10 right in a row',         mark:'10', test:p=>p.rounds.some(r=>(r.best||0)>=10)},
  {id:'speedy', name:'Speedy',       desc:'Under 2 seconds per question',  mark:'2s', test:p=>p.rounds.some(r=>r.n>=8&&r.c>0&&r.ms<2000)},
  {id:'century',name:'Century',      desc:'100 right answers in total',    mark:'100',test:p=>totalRight(p)>=100},
  {id:'shop1',  name:'Shopper',      desc:'Buy something in the shop',     mark:'1',  test:p=>shopCount(p)>=1},
  {id:'moonland',name:'Moon landing',desc:'Reach the Moon rank',           mark:'☾',  test:p=>tierIndex(statusSecs(p))>=5},
  {id:'boss',   name:'Boss beater',  desc:'Defeat an alien boss',          mark:'!',  test:p=>p.rounds.some(r=>r.boss)},
  {id:'streak5',name:'Streak star',   desc:'Play 5 days in a row',          mark:'5',  test:p=>((p.daily&&p.daily.best)||0)>=5},
  {id:'master', name:'Times tables master',desc:'Know every times table quickly',mark:'12×',test:p=>ALL.every(t=>knowsTable(p,t))}
];
function checkBadges(p){
  if(!p.badges){p.badges=BADGES.filter(b=>b.test(p)).map(b=>b.id);return []} // existing players: award quietly once
  const fresh=BADGES.filter(b=>!p.badges.includes(b.id)&&b.test(p));fresh.forEach(b=>p.badges.push(b.id));return fresh;
}
// ---------- colourful badge art ----------
const BSTYLE={
  first:   {c:['#FF8A3D','#E0461A'],shape:'circle',icon:'rocket'},
  r10:     {c:['#4DD4FF','#1F7FD9'],shape:'burst', icon:'text'},
  r50:     {c:['#B57BFF','#6A2FD0'],shape:'burst', icon:'text'},
  perfect: {c:['#FFE45C','#E0A21A'],shape:'star',  icon:'star'},
  combo10: {c:['#FF7A45','#D92B2B'],shape:'circle',icon:'flame'},
  speedy:  {c:['#5CF0C8','#12A98A'],shape:'circle',icon:'bolt'},
  day3:    {c:['#FFB347','#E86A10'],shape:'burst', icon:'sun'},
  day7:    {c:['#FF6FB5','#C2207A'],shape:'burst', icon:'sun'},
  shop1:   {c:['#7CE38B','#22A04A'],shape:'circle',icon:'bag'},
  shop10:  {c:['#6FE3FF','#2563EB'],shape:'hex',   icon:'gem'},
  boss:    {c:['#9BF26B','#3E9E1E'],shape:'shield',icon:'alien'},
  century: {c:['#FFD15C','#C27A00'],shape:'burst', icon:'text'},
  moonland:{c:['#C9D6FF','#5B6BC9'],shape:'circle',icon:'moon'},
  master:  {c:['#FFE45C','#C27A00'],shape:'star',  icon:'text'},
  streak5: {c:['#FFB347','#E86A10'],shape:'burst', icon:'sun'}
};
const MHUES=['#FF5A5F','#FF8A3D','#FFC23C','#7CD44A','#22C3A6','#3DB8FF','#4D7BFF','#8A5CFF','#C45CFF','#FF5CC8','#FF6F91'];
function bstyle(b){if(BSTYLE[b.id])return BSTYLE[b.id];const i=ALL.indexOf(+String(b.id).slice(1));const h=MHUES[(i<0?0:i)%MHUES.length];return {c:[h,h],shape:'hex',icon:'text',mix:true}}
function medal(b,on,size){
  size=size||64;const st=bstyle(b),uid='md'+b.id+(on?1:0);
  let c1=st.c[0],c2=st.c[1];
  if(st.mix){c1=`color-mix(in srgb,${c1} 70%,#fff)`;c2=`color-mix(in srgb,${c2} 75%,#000)`}
  const ink='#FFFFFF',edge='rgba(20,22,38,.55)';
  const cx=32,cy=42;
  const poly=(n,r1,r2,rot)=>{let d='';for(let i=0;i<n*2;i++){const r=i%2?r2:r1,a=Math.PI*i/n+(rot||0);d+=(i?'L':'M')+(cx+r*Math.sin(a)).toFixed(1)+' '+(cy-r*Math.cos(a)).toFixed(1)}return d+'Z'};
  const outer={circle:`M${cx} ${cy-25}a25 25 0 1 0 .01 0Z`,burst:poly(12,27,22),star:poly(5,30,17),hex:poly(3,27,27,Math.PI/6).replace(/./,'M'),shield:`M${cx} ${cy-26} L${cx+23} ${cy-18} V${cy+2} Q${cx+22} ${cy+20} ${cx} ${cy+28} Q${cx-22} ${cy+20} ${cx-23} ${cy+2} V${cy-18}Z`}[st.shape];
  const hex6=(r)=>{let d='';for(let i=0;i<6;i++){const a=Math.PI/3*i;d+=(i?'L':'M')+(cx+r*Math.cos(a)).toFixed(1)+' '+(cy+r*Math.sin(a)).toFixed(1)}return d+'Z'};
  const outerD=st.shape==='hex'?hex6(27):outer;
  const innerD=st.shape==='hex'?hex6(21):st.shape==='shield'?`M${cx} ${cy-20} L${cx+17} ${cy-14} V${cy+1} Q${cx+16} ${cy+15} ${cx} ${cy+21} Q${cx-16} ${cy+15} ${cx-17} ${cy+1} V${cy-14}Z`:st.shape==='star'?poly(5,22,12):`M${cx} ${cy-19}a19 19 0 1 0 .01 0Z`;
  const I=`fill="${ink}" stroke="${edge}" stroke-width="1.6" stroke-linejoin="round"`;
  const icons={
    rocket:`<path d="M32 27 C38 32 38 42 36.5 49 H27.5 C26 42 26 32 32 27Z" ${I}/><path d="M27.5 43 L23 50 L27.5 49Z M36.5 43 L41 50 L36.5 49Z" ${I}/><circle cx="32" cy="38" r="2.6" fill="${c2}"/><path d="M29.5 50 Q32 57 34.5 50Z" fill="${'#FFD447'}"/>`,
    star:`<path d="${poly(5,13,6)}" ${I}/>`,
    flame:`<path d="M32 27 c2 6 9 9 9 17 a9 9 0 0 1 -18 0 c0 -4 2 -6 4 -8 0 3 1.5 4.5 3 4.5 -1.5 -5 0 -9 2 -13.5z" ${I}/><path d="M32 43 c1.5 2 3 3 3 5 a3 3 0 0 1 -6 0 c0 -1.5 1 -2.6 3 -5z" fill="${'#FFD447'}"/>`,
    bolt:`<path d="M35 27 L25 44 H31 L28.5 57 L39.5 38 H33Z" ${I}/>`,
    sun:`<circle cx="32" cy="42" r="7.5" ${I}/>`+[0,1,2,3,4,5,6,7].map(i=>{const a=i*Math.PI/4;return `<path d="M${(32+11*Math.cos(a)).toFixed(1)} ${(42+11*Math.sin(a)).toFixed(1)} L${(32+15*Math.cos(a)).toFixed(1)} ${(42+15*Math.sin(a)).toFixed(1)}" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`}).join('')+`<text x="32" y="45.5" text-anchor="middle" font-family="Fredoka,Arial,sans-serif" font-weight="700" font-size="10" fill="${c2}">${b.mark}</text>`,
    bag:`<path d="M27 36 Q27 29 32 29 Q37 29 37 36" fill="none" stroke="${ink}" stroke-width="2.6"/><path d="M23 35 H41 L39.5 55 H24.5Z" ${I}/><path d="${poly(5,4.5,2,0).replace(/(\d+\.\d) (\d+\.\d)/g,(m,x,y)=>(+x).toFixed(1)+' '+(+y+3).toFixed(1))}" fill="${c2}"/>`,
    gem:`<path d="M24 36 L28 30 H36 L40 36 L32 54Z" ${I}/><path d="M24 36 H40 M28 30 L30.5 36 L32 54 L33.5 36 L36 30" fill="none" stroke="${edge}" stroke-width="1.1"/>`,
    alien:`<path d="M32 28 C42 28 44 36 42 42 C40 50 35 55 32 55 C29 55 24 50 22 42 C20 36 22 28 32 28Z" ${I}/><path d="M25 40 Q28 38 30.5 43 Q27 45 25 40Z M39 40 Q36 38 33.5 43 Q37 45 39 40Z" fill="${'#141626'}"/>`,
    moon:`<path d="M36 28 A14 14 0 1 0 44 50 A11 11 0 1 1 36 28Z" ${I}/><path d="M24 45 V31" stroke="${ink}" stroke-width="1.8"/><path d="M24 31 H31 L29 34 L31 37 H24Z" fill="${'#FF5A5F'}" stroke="${edge}" stroke-width="1"/>`,
    text:`<text x="32" y="${b.mark.length>2?47:49}" text-anchor="middle" font-family="Fredoka,Arial,sans-serif" font-weight="800" font-size="${b.mark.length>2?14:b.mark.length>1?17:21}" fill="${ink}" stroke="${edge}" stroke-width="2.2" paint-order="stroke">${b.mark}</text>`
  };
  const ribA=c1,ribB=c2;
  return `<svg viewBox="0 0 64 74" width="${size}" height="${Math.round(size*1.16)}" aria-hidden="true" style="overflow:visible"><defs><linearGradient id="${uid}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient><linearGradient id="${uid}r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".9"/><stop offset=".5" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient></defs>
    ${on?`<circle cx="32" cy="42" r="31" fill="${c1}" opacity=".22"/>`:''}
    <path d="M19 0h11l4 19H23z" fill="${ribA}"/><path d="M45 0H34l-4 19h11z" fill="${ribB}"/><path d="M24.5 0 L28 17 M39.5 0 L36 17" stroke="#FFFFFF" stroke-width="1.4" opacity=".5"/>
    <path d="${outerD}" fill="${c2}" stroke="${edge}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="${innerD}" fill="url(#${uid}g)" stroke="#FFFFFF" stroke-opacity=".7" stroke-width="1.6" stroke-linejoin="round"/>
    ${icons[st.icon]||icons.text}
    <path d="${innerD}" fill="url(#${uid}r)" opacity="${on?.45:.3}"/>
    ${on?`<path d="M52 16l1.6 3.6 3.6 1.6-3.6 1.6-1.6 3.6-1.6-3.6-3.6-1.6 3.6-1.6z" fill="#FFFFFF"/><path d="M10 54l1.1 2.4 2.4 1.1-2.4 1.1-1.1 2.4-1.1-2.4-2.4-1.1 2.4-1.1z" fill="#FFFFFF" opacity=".9"/>`:`<circle cx="49" cy="61" r="7.5" fill="#8A94A8" stroke="#FFFFFF" stroke-width="1.6"/><rect x="45.5" y="60" width="7" height="5.5" rx="1.2" fill="#FFFFFF"/><path d="M46.8 60 V58.2 a2.2 2.2 0 0 1 4.4 0 V60" fill="none" stroke="#FFFFFF" stroke-width="1.4"/>`}
  </svg>`.replace(/\n\s*/g,'');
}
const BPROG={streak5:p=>[(p.daily&&p.daily.best)||0,5],r10:p=>[p.rounds.length,10],century:p=>[totalRight(p),100],master:p=>[ALL.filter(t=>knowsTable(p,t)).length,ALL.length]};
function renderBadges(){
  const p=P();checkBadges(p);const n=p.badges.length;
  $('badgeCount').textContent=`${n} of ${BADGES.length} earned`;
  $('badgeGrid').innerHTML=BADGES.map(b=>{const on=p.badges.includes(b.id),st=bstyle(b);
    let prog='';if(!on&&BPROG[b.id]){const [c,m]=BPROG[b.id](p);prog=`<span class="bprog" aria-label="${Math.min(c,m)} of ${m}"><i style="width:${Math.round(Math.min(1,c/m)*100)}%;background:${st.c[1]}"></i></span><span class="bnum num">${Math.min(c,m)} / ${m}</span>`}
    return `<div class="badge ${on?'on':''}" style="--bc:${st.c[0]};--bc2:${st.c[1]}">${medal(b,on,64)}<b>${b.name}</b><span class="muted">${b.desc}</span>${prog}</div>`}).join('');
}
function celebrateBadges(list){
  list.slice(0,3).forEach(b=>celebrate(`<div class="ovart">${medal(b,true,110)}</div><span class="label">New badge!</span><h1>${b.name}</h1><p class="muted">${b.desc}</p>`));
  if(list.length>3)celebrate(`<span class="label">And more!</span><h1>+${list.length-3} more badge${list.length-3===1?'':'s'}</h1><p class="muted">See them all in the Badges tab.</p>`);
}

// ---------- teachers: sign in, school setup, classes and students ----------
const closeHelp=()=>{$('helpOv').hidden=true;$('loginHelp').focus()};
$('loginHelp').onclick=()=>{$('helpOv').hidden=false;$('helpClose').focus()};
$('helpClose').onclick=closeHelp;
$('helpOv').addEventListener('click',e=>{if(e.target.id==='helpOv')closeHelp()});
$('tBack').onclick=()=>{openLogin();goStep('who')};
async function openTeacher(who){setAddress(true);
  const pr=who==='principal';$('tTitle').textContent=pr?'Principals':'Teachers';$('tRoleNote').hidden=!pr;
  $('tFb').textContent='';$('tSetupFb').textContent='';
  let info=null;try{info=await api.teacherSession()}catch(e){info=null}
  if(!info){$('tSignIn').hidden=false;$('tSetup').hidden=true;show('teach');return}
  if(!info.teacher){$('tSignIn').hidden=true;$('tSetup').hidden=false;show('teach');return}
  TEACH={info,classes:[],classId:local().teacherClass||null,super:false};setLocal({teacher:true});
  try{TEACH.super=!!(await api.isSuperAdmin())}catch(e){TEACH.super=false}
  if(TEACH.super){try{TEACH.schools=await api.listSchools()}catch(e){TEACH.schools=[]}
    const saved=local().ownerSchool;if(saved&&TEACH.schools.some(x=>x.id===saved))TEACH.viewSchool=saved}
  await loadClasses();show('grown');
}
// Sign-in messages: green for progress and info, red for problems
function say(id,text,good){const el=$(id);el.textContent=text;el.className='fb '+(good?'ok':'no')}
// Supabase's sign-in errors, in plain words for teachers
function authMsg(e){
  if(/already registered|already been registered|already exists/i.test(e))return 'That email already has an account. Tap Sign in at the top instead.';
  if(/invalid login|invalid credentials/i.test(e))return 'Wrong email or password. New here? Tap Create account at the top.';
  if(/not confirmed/i.test(e))return 'This account has not been confirmed yet. Email footiejack2021@gmail.com and we will sort it out.';
  if(/invalid.*email|email.*invalid|valid email/i.test(e))return 'That email address does not look right. Check it and try again.';
  if(/password.*(short|least|weak)|weak password/i.test(e))return 'Choose a password with at least 8 characters.';
  if(/rate limit|too many|seconds/i.test(e))return 'Too many tries. Wait a minute, then try again.';
  if(/fetch|network/i.test(e))return 'Could not connect. Check the internet and try again.';
  return e;
}
let tMode='signin';
function setTMode(m){tMode=m;document.querySelectorAll('[data-tmode]').forEach(b=>{b.classList.toggle('on',b.dataset.tmode===m);b.setAttribute('aria-selected',b.dataset.tmode===m)});
  $('tForgot').hidden=m==='create';
  $('tSubmit').textContent=m==='create'?'Create account':'Sign in';$('tPass').autocomplete=m==='create'?'new-password':'current-password';$('tPassHint').hidden=m!=='create';$('tFb').textContent=''}
document.querySelectorAll('[data-tmode]').forEach(b=>b.onclick=()=>setTMode(b.dataset.tmode));
$('tForgot').onclick=async()=>{
  const email=$('tEmail').value.trim();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){say('tFb','Type your email above first, then tap Forgot password.');$('tEmail').focus();return}
  say('tFb','Sending…',true);const r=await api.teacherResetPassword(email);
  if(r.error){say('tFb',/rate|seconds|too many/i.test(r.error)?'Please wait a minute before asking for another email.':"We couldn't send the email. Ask your school's MathWizz admin to set a new password for you (School page).");return}
  say('tFb',`If ${email} has an account, we've emailed it a link to choose a new password. Check your junk folder too. No email? Your school's MathWizz admin can set a new password for you.`,true);
};
$('tReset').addEventListener('submit',async e=>{
  e.preventDefault();const pw=$('tNewPass').value;
  if(pw.length<8){say('tResetFb','Use at least 8 characters.');return}
  say('tResetFb','Saving…',true);const r=await api.teacherSetPassword(pw);
  if(r.error){say('tResetFb',r.error==='expired'?'This link has expired or was already used. Go back and tap Forgot password again.':r.error);return}
  $('tReset').hidden=true;$('tNewPass').value='';say('tFb','Password changed.',true);openTeacher();
});
$('tSignIn').addEventListener('submit',async e=>{
  e.preventDefault();const email=$('tEmail').value.trim(),pw=$('tPass').value;
  if(tMode==='create'){
    if(!email||pw.length<8){say('tFb','Enter your school email and a password of at least 8 characters.');return}
    say('tFb','Creating your account…',true);
    const r=await api.teacherSignUp(email,pw);
    if(r.error){say('tFb',authMsg(r.error));return}
    if(r.needsConfirm){setTMode('signin');say('tFb','Check your email and tap the link to confirm your account, then sign in here.',true);return}
    openTeacher();return;
  }
  say('tFb','Signing in…',true);
  const r=await api.teacherSignIn(email,pw);
  if(r.error){say('tFb',authMsg(r.error));return}
  openTeacher();
});
document.querySelectorAll('input[name="tMode"]').forEach(r=>r.onchange=()=>{const j=document.querySelector('input[name="tMode"]:checked').value==='join';$('tJoinRow').hidden=!j;$('tSchoolNameRow').hidden=j});
$('tSetup').addEventListener('submit',async e=>{
  e.preventDefault();const name=$('tName').value.trim(),join=document.querySelector('input[name="tMode"]:checked').value==='join';
  if(!name){$('tSetupFb').textContent='Add your name.';return}
  const r=join?await api.joinSchool($('tJoinCode').value.trim(),name):await api.createSchool($('tSchoolName').value.trim(),name);
  if(r&&r.error){$('tSetupFb').textContent=/not found/.test(r.error)?'We could not find that school code.':r.error;return}
  openTeacher();
});
$('tSetupOut').onclick=async()=>{await api.teacherSignOut();openTeacher()};
const isAdmin=()=>TEACH&&TEACH.info.teacher&&TEACH.info.teacher.role==='admin';
const myId=()=>TEACH&&TEACH.info.teacher&&TEACH.info.teacher.id;
// The owner can open any school's teacher view (read-only). Every list is fetched for one school.
const ownSchool=()=>TEACH&&TEACH.info.teacher&&TEACH.info.teacher.school&&TEACH.info.teacher.school.id;
const viewSchool=()=>(TEACH&&TEACH.viewSchool)||ownSchool();
const viewingOther=()=>!!(TEACH&&TEACH.super&&TEACH.viewSchool&&TEACH.viewSchool!==ownSchool());
// Teachers see their own classes; admins see every class in the school
function visibleClasses(){return isAdmin()||viewingOther()?TEACH.all:TEACH.all.filter(c=>c.teacher_id===myId())}
async function loadClasses(){
  const sid=viewSchool();TEACH.all=await api.listClasses(sid);
  if(isAdmin()||viewingOther()){try{TEACH.teachers=await api.listTeachers(sid)}catch(e){TEACH.teachers=[]}}
  if(!visibleClasses().length){
    if(viewingOther()){TEACH.classes=[];TEACH.classId=null;renderOwnerEmpty();return}
    TEACH.all.push(await api.createClass('My class'))}
  TEACH.classes=visibleClasses();
  if(!TEACH.classes.some(c=>c.id===TEACH.classId))TEACH.classId=(TEACH.classes.find(c=>c.teacher_id===myId())||TEACH.classes[0]).id;
  await loadClassStudents();
}
function curClass(){return TEACH&&(TEACH.classes||[]).find(c=>c.id===TEACH.classId)}
const teacherName=id=>{const t=(TEACH.teachers||[]).find(x=>x.id===id);return t?t.name:id===myId()?TEACH.info.teacher.name:'No teacher'};
async function loadClassStudents(){
  const c=curClass();setLocal({teacherClass:c.id});applySettings(c.settings);
  const [list,cs]=await Promise.all([api.listStudents(c.id),api.classStats(c.id).catch(()=>null)]);
  TEACH.stats={};if(cs&&Array.isArray(cs.students))cs.students.forEach(x=>{TEACH.stats[x.id]=x});
  S={players:{},order:[],current:null,showBoard:true,muted:true,goal:S.goal};
  list.forEach(st=>{S.players[st.id]=fixPlayer({...newPlayerData(),...st.data,id:st.id,name:st.name,pin:st.pin,username:st.username||'',passcode:st.passcode||'',realName:st.real_name||''});S.order.push(st.id)});
  sortStudents();GSel=null;renderTeacherBar();renderGrown();renderGTab();if(!$('codecards').hidden)renderCodeCards();
}
function sortStudents(){S.order.sort((a,b)=>{const A=S.players[a],B=S.players[b];return (!A.realName)-(!B.realName)||(A.realName||'').localeCompare(B.realName||'')})}
function renderSchoolPicker(){
  const w=$('gSchoolWrap'),other=viewingOther();$('grown').classList.toggle('viewonly',other);
  if(other&&['goal','settings','comp'].includes(TEACH_TAB))TEACH_TAB='students';
  w.hidden=!TEACH.super||!(TEACH.schools||[]).length;if(w.hidden)return;
  $('gSchool').innerHTML=TEACH.schools.map(x=>`<option value="${x.id}" ${x.id===viewSchool()?'selected':''}>${esc(x.name)}${x.id===ownSchool()?' (yours)':''}</option>`).join('');
}
function renderOwnerEmpty(){
  renderSchoolPicker();const vs=(TEACH.schools||[]).find(x=>x.id===viewSchool());
  $('gWho').textContent=`Owner view · ${vs?vs.name:'School'} · view only`;$('gTitle').textContent='No classes yet';$('gClass').innerHTML='';$('gCode').textContent='—';
  $('kpis').innerHTML='';$('gProgress').innerHTML='';$('tbl').innerHTML='<tbody><tr><td class="muted">This school has no classes yet.</td></tr></tbody>';$('gdetail').hidden=true;
  $('gSchoolBtn').hidden=true;show('grown');
}
$('gSchool').onchange=async()=>{TEACH.viewSchool=$('gSchool').value===ownSchool()?null:$('gSchool').value;setLocal({ownerSchool:TEACH.viewSchool});TEACH.classId=null;TEACH_TAB='students';await loadClasses()};
function renderTeacherBar(){
  const c=curClass(),t=TEACH.info.teacher,me=myId();
  const opt=x=>`<option value="${x.id}" ${x.id===c.id?'selected':''}>${esc(x.name)}${isAdmin()&&x.teacher_id!==me?' ('+esc(teacherName(x.teacher_id))+')':''}</option>`;
  const mine=TEACH.classes.filter(x=>x.teacher_id===me),others=TEACH.classes.filter(x=>x.teacher_id!==me);
  $('gClass').innerHTML=isAdmin()&&others.length?`<optgroup label="My classes">${mine.map(opt).join('')}</optgroup><optgroup label="Other classes">${others.map(opt).join('')}</optgroup>`:TEACH.classes.map(opt).join('');
  $('gCode').textContent=c.code;$('gTitle').textContent=c.name;
  const other=viewingOther(),vs=(TEACH.schools||[]).find(x=>x.id===viewSchool());
  $('gWho').textContent=other?`Owner view · ${vs?vs.name:'School'} · view only`:t?`${t.name}${t.school?' · '+t.school.name:''}`:'';
  $('gSchoolBtn').hidden=!isAdmin()||other;$('gSuperBtn').hidden=!TEACH.super;
  renderSchoolPicker();
  $('addMsg').textContent='';
}
$('gClass').onchange=async()=>{TEACH.classId=$('gClass').value;await loadClassStudents()};
$('gNewClass').onclick=async()=>{
  const name=prompt('Name for the new class (for example "Grade 5 Ravens")');if(!name||!name.trim())return;
  const c=await api.createClass(name.trim().slice(0,80));TEACH.all.push(c);TEACH.classes=visibleClasses();TEACH.classId=c.id;await loadClassStudents();
};
// ----- tabs -----
$('gTabs').addEventListener('click',e=>{const b=e.target.closest('[data-gtab]');if(!b)return;TEACH_TAB=b.dataset.gtab;renderGTab()});
function renderGTab(){
  document.querySelectorAll('#gTabs [data-gtab]').forEach(b=>{b.classList.toggle('on',b.dataset.gtab===TEACH_TAB);b.setAttribute('aria-selected',b.dataset.gtab===TEACH_TAB)});
  document.querySelectorAll('#grown [data-gpane]').forEach(p=>p.hidden=p.dataset.gpane!==TEACH_TAB);
  if(TEACH_TAB==='goal')renderGoal();else if(TEACH_TAB==='help')renderHelp();else if(TEACH_TAB==='comp')renderComp();else if(TEACH_TAB==='settings')renderSettings();
}
// ----- weekly goal -----
let goalDraft=null;
function renderGoal(){
  const c=curClass(),g=(c.settings||{}).goal||{tables:[],rounds:5};
  if(!goalDraft||goalDraft.cid!==c.id)goalDraft={cid:c.id,tables:[...(g.tables||[])],rounds:g.rounds||5};
  const players=S.order.map(id=>S.players[id]),set=(c.settings||{}).goal;
  const N=set&&set.rounds||0,done=players.filter(p=>N&&goalRounds(p)>=N).length;
  $('goalCard').innerHTML=`<h2>This week's goal</h2>
    <p class="muted small">Choose times tables to focus on and how many rounds each student should play this week (Monday to Sunday). Students see the goal on their home screen and get more questions from these tables. It starts again every Monday.</p>
    <span class="label">Focus tables</span>
    <div class="tchips">${ALL.map(t=>`<button class="tchip ${goalDraft.tables.includes(t)?'on':''}" data-gt="${t}">${t}×</button>`).join('')}</div>
    <span class="label">Rounds this week</span>
    <div class="tchips">${[3,5,7,10].map(n=>`<button class="tchip ${goalDraft.rounds===n?'on':''}" data-gr="${n}">${n}</button>`).join('')}</div>
    <div class="row"><button class="btn primary" id="goalSave">${set?'Update goal':'Set goal'}</button>${set?'<button class="btn" id="goalClear">Clear goal</button>':''}</div>
    <p class="note" id="goalMsg" aria-live="polite"></p>
    ${set?`<hr><div class="spread"><h3>Progress this week</h3><b>${done} of ${players.length} done</b></div>
    <div class="glist">${players.map(p=>{const n=goalRounds(p),ok=n>=N;return `<div class="gitem ${ok?'ok':''}">${avatar(p.skin,28)}<span class="gname">${whoHTML(p)}</span><span class="gbar"><i style="width:${Math.min(100,n/N*100).toFixed(0)}%"></i></span><span class="gnum num">${Math.min(n,N)}/${N}${ok?' ✓':''}</span></div>`}).join('')||'<p class="muted">No students yet.</p>'}</div>`:''}`;
}
$('goalCard').addEventListener('click',async e=>{
  const t=e.target.closest('[data-gt]'),r=e.target.closest('[data-gr]');
  if(t){const n=+t.dataset.gt,i=goalDraft.tables.indexOf(n);i>=0?goalDraft.tables.splice(i,1):goalDraft.tables.push(n);goalDraft.tables.sort((a,b)=>a-b);renderGoal();return}
  if(r){goalDraft.rounds=+r.dataset.gr;renderGoal();return}
  const c=curClass();
  if(e.target.closest('#goalSave')){c.settings={...c.settings,goal:{tables:goalDraft.tables,rounds:goalDraft.rounds}};await api.updateClass(c.id,{settings:c.settings});applySettings(c.settings);renderGoal();$('goalMsg').textContent='Saved. Students will see it next time they open the game.';return}
  if(e.target.closest('#goalClear')){const st={...c.settings};delete st.goal;c.settings=st;goalDraft=null;await api.updateClass(c.id,{settings:st});applySettings(st);renderGoal();return}
});
// ----- needs help -----
function trickyFacts(p,n){
  return Object.entries(p.facts).map(([k,f])=>{const miss=f.r.filter(x=>!x).length/Math.max(1,f.r.length),m=med(f.t)||9000;return {k,miss,m,lv:level(f)}})
    .filter(x=>x.lv>0&&x.lv<=2&&ALL.includes(+x.k.split(',')[0])).sort((a,b)=>b.miss-a.miss||b.m-a.m).slice(0,n).map(x=>x.k.replace(',',' × '));
}
function renderHelp(){
  const ws=weekStart(),wk=Date.now()-7*864e5,players=S.order.map(id=>S.players[id]);
  const idle=players.filter(p=>!p.rounds.some(r=>r.d>=ws));
  const hard=players.map(p=>({p,acc:weekAcc(p,wk),f:trickyFacts(p,3)})).filter(x=>(x.acc!=null&&x.acc<80)||x.f.length>=3).sort((a,b)=>(a.acc??100)-(b.acc??100));
  const tally={};players.forEach(p=>Object.entries(p.facts).forEach(([k,f])=>{if(!ALL.includes(+k.split(',')[0]))return;const t=tally[k]||(tally[k]={miss:0,n:0});t.miss+=f.r.filter(x=>!x).length;t.n+=f.r.length}));
  const classTricky=Object.entries(tally).filter(([,t])=>t.miss>0).sort((a,b)=>b[1].miss/b[1].n-a[1].miss/a[1].n||b[1].miss-a[1].miss).slice(0,10);
  $('helpBox').innerHTML=`
    <div class="card"><div class="spread"><h2>Haven't played this week</h2><b>${idle.length} of ${players.length}</b></div>
      ${idle.length?`<div class="glist">${idle.map(p=>`<div class="gitem">${avatar(p.skin,28)}<span class="gname">${whoHTML(p)}</span><span class="muted">Last played: ${lastPlayed(p)}</span></div>`).join('')}</div>`:'<p class="muted">Everyone has played this week. 🎉</p>'}</div>
    <div class="card"><h2>Finding it hard</h2><p class="muted small">Students under 80% right this week, or with several facts they keep missing.</p>
      ${hard.length?`<div class="glist">${hard.map(x=>`<div class="gitem">${avatar(x.p.skin,28)}<span class="gname">${whoHTML(x.p)}</span><span class="muted">${x.acc==null?'No rounds this week':x.acc+'% right'}</span><span>${x.f.map(f=>`<span class="fchip">${f}</span>`).join(' ')}</span></div>`).join('')}</div>`:'<p class="muted">Nobody is struggling right now.</p>'}</div>
    <div class="card"><h2>Class's trickiest facts</h2><p class="muted small">The facts this class gets wrong most often. Good ones to teach together.</p>
      ${classTricky.length?`<div class="tchips">${classTricky.map(([k,t])=>`<span class="fchip big">${k.replace(',',' × ')} <small>${Math.round(t.miss/t.n*100)}% wrong</small></span>`).join('')}</div>`:'<p class="muted">Not enough answers yet.</p>'}</div>`;
}
// ----- competitions (School and School Plus plans) -----
// Teachers make class competitions; school admins can also make school-wide ones. Teachers provide the prizes.
const COMP_ERR={needs_plan:'Competitions come with the School and School Plus plans.',not_your_class:'You can only make competitions for your own classes.',not_admin:'Only school admins can make school-wide competitions.',
  bad_class:'Pick a class first.',bad_target:'Enter a target number.',no_prize:'Enter the prize.',bad_dates:'Check the dates: the end must be after the start, at most 120 days later, and not in the past.',
  too_many:'Your school has 20 competitions running. End one first.',bad_kind:'Pick a type of competition.',bad_measure:'Pick stars or correct answers.',not_allowed:'Only the teacher who made it, or a school admin, can change it.',not_found:'That competition is gone.'};
let CMP={list:null,plan:null,draft:null,msg:'',busy:false};
const TROPHY='<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';
function compDraft(){
  const today=dayStr(Date.now()),later=dayStr(Date.now()+29*864e5);
  if(!CMP.draft)CMP.draft={kind:'top_player',measure:'stars',target:'',title:'',prize:'',start:today,end:later};
  if(!isAdmin()&&KINDS[CMP.draft.kind].scope==='school')CMP.draft.kind='top_player';
  return CMP.draft;
}
async function loadComps(){
  if(isAdmin()){try{const n=await api.countStudents(ownSchool());CMP.schoolKids=Object.values(n||{}).reduce((a,b)=>a+b,0)}catch(e){CMP.schoolKids=0}}
  try{const r=await api.competitionsList();if(r&&!r.error){CMP.list=r.competitions||[];CMP.plan=r.plan||'free'}else{CMP.list=[];CMP.plan=CMP.plan||'free';CMP.msg='Could not load competitions: '+((r&&r.error)||'no reply')}}
  catch(e){CMP.list=[];CMP.msg='Could not load competitions: '+e.message}
}
async function renderComp(reload){
  if(reload||CMP.list==null||CMP.cid!==TEACH.classId){CMP.cid=TEACH.classId;$('compPane').innerHTML='<div class="card"><p class="muted">Loading…</p></div>';await loadComps()}
  if(TEACH_TAB!=='comp')return;
  const paid=PAID_PLANS.includes(CMP.plan),c=curClass(),d=compDraft(),k=KINDS[d.kind];
  const kinds=Object.entries(KINDS).filter(([,x])=>x.scope==='class'||isAdmin());
  const form=paid?`<div class="card"><h2>New competition</h2>
    <p class="muted small">Pick what students compete for, and the prize. You or your school provide the prize and hand it out; MathWizz shows students how close they are.</p>
    <form class="compform" id="compForm">
      <span class="label">Quick start</span>
      <div class="presets">${PRESETS.filter(x=>KINDS[x.kind].scope==='class'||isAdmin()).map(x=>`<button type="button" class="preset ${d.preset===x.id?'on':''}" data-cpreset="${x.id}"><b>${x.label}</b><small>${x.blurb}</small></button>`).join('')}</div>
      <p class="note">Pick one to fill in everything below, then change anything you like.</p>
      <span class="label">Who competes</span>
      <div class="kindgrid" role="radiogroup" aria-label="Type of competition">${kinds.map(([id,x])=>`<button type="button" role="radio" aria-checked="${d.kind===id}" class="kindbtn ${d.kind===id?'on':''}" data-ckind="${id}"><b>${x.label}</b><small>${x.scope==='class'?esc(c.name):'Whole school'} · ${x.blurb}</small></button>`).join('')}</div>
      <span class="label">What counts</span>
      <div class="tchips" role="radiogroup" aria-label="What counts">${[['stars','Stars'],['correct','Correct answers']].map(([m,l])=>`<button type="button" role="radio" aria-checked="${d.measure===m}" class="tchip ${d.measure===m?'on':''}" data-cmeasure="${m}">${l}</button>`).join('')}</div>
      <p class="note">${d.measure==='stars'?'A round earns up to 100 stars, so faster, more accurate players earn more.':'Correct answers reward effort: every right answer counts, however fast.'}</p>
      <div class="frow">
        ${k.target?`<label>Target (${cUnit(d.measure,2)} in total)<input id="cTarget" type="number" min="1" max="10000000" inputmode="numeric" value="${esc(d.target)}" placeholder="${d.kind==='class_target'?(d.measure==='stars'?'e.g. 20000':'e.g. 5000'):(d.measure==='stars'?'e.g. 100000':'e.g. 25000')}" required></label>`:''}
        <label>Prize<input id="cPrize" maxlength="200" value="${esc(d.prize)}" placeholder="${k.scope==='class'?'e.g. $20 gift card':'e.g. Pizza party for the winning class'}" required></label>
        <label>Name (optional)<input id="cTitle" maxlength="80" value="${esc(d.title)}" placeholder="${k.label}"></label>
      </div>
      ${k.target?`<div class="qrow"><span class="qlabel">Suggested targets</span><div class="tchips">${compTargets(d).map(t=>`<button type="button" class="tchip ${String(d.target)===String(t.value)?'on':''}" data-ctarget="${t.value}" title="About ${t.rounds} rounds per student per school day">${t.label}: ${fmtNum(t.value)}</button>`).join('')||'<span class="note">Pick dates to see suggestions.</span>'}</div></div>`:''}
      <div class="qrow"><span class="qlabel">Prize ideas</span><div class="tchips">${(k.scope==='class'&&d.kind==='top_player'?PRIZES.class:PRIZES.team).map(z=>`<button type="button" class="tchip ${d.prize===z?'on':''}" data-cprize="${esc(z)}">${esc(z)}</button>`).join('')}</div></div>
      <div class="frow">
        <label>Starts<input id="cStart" type="date" value="${esc(d.start)}" required></label>
        <label>Ends (last day)<input id="cEnd" type="date" value="${esc(d.end)}" required></label>
      </div>
      <div class="qrow"><span class="qlabel">How long</span><div class="tchips">${TIMEFRAMES.map(t=>{const [a,b]=t.range(new Date());return `<button type="button" class="tchip ${d.start===a&&d.end===b?'on':''}" data-ctime="${t.id}">${t.label}</button>`}).join('')}</div></div>
      <div class="row"><button class="btn primary" type="submit" ${CMP.busy?'disabled':''}>Start competition</button></div>
      <p class="note" id="compMsg" aria-live="polite">${esc(CMP.msg)}</p>
    </form></div>`
  :`<div class="card lockcard"><h2>Competitions</h2>
    <p>Run class and school competitions with a prize you provide, for example a gift card for the student with the most stars this month, or a pizza party when the whole school reaches a goal. Students see how close they are on their home screen.</p>
    <p><b>Competitions come with the School and School Plus plans.</b> Your school is on the ${PLAN_NAMES[CMP.plan]||'Free'} plan. To upgrade, email <a href="mailto:mathwizzapp@gmail.com?subject=MathWizz%20School%20plan">mathwizzapp@gmail.com</a> or reply to Jack.</p>
    ${CMP.msg?`<p class="note">${esc(CMP.msg)}</p>`:''}</div>`;
  const list=CMP.list||[],running=list.filter(x=>x.status!=='ended'),done=list.filter(x=>x.status==='ended');
  const listHTML=list.length?`${running.length?`<div class="card"><h2>Running and coming up</h2><div class="clist">${running.map(compItemHTML).join('')}</div></div>`:''}
    ${done.length?`<div class="card"><h2>Finished</h2><div class="clist">${done.map(compItemHTML).join('')}</div></div>`:''}`
    :(paid?'<div class="card"><p class="muted">No competitions yet. Start one above.</p></div>':'');
  $('compPane').innerHTML=form+listHTML;
}
function compItemHTML(x){
  const u=n=>cUnit(x.measure,n),me=myId();
  const canEdit=isAdmin()||x.created_by===me;
  const who=x.scope==='school'?'Whole school':esc(x.class_name||'Class');
  const tag=x.status==='active'?'<span class="ctag live">Running</span>':x.status==='upcoming'?'<span class="ctag">Coming up</span>':`<span class="ctag ended">Finished${x.ended_early?' early':''}</span>`;
  let body='';
  if(x.status==='upcoming')body=`<p class="muted small">Students see it on their home screen from a week before it starts.</p>`;
  else if(x.kind==='top_player'){
    const st=(x.standings||[]).slice(0,10);
    body=st.length&&st[0].v>0?`<table class="cstand"><tbody>${st.map((r,i)=>`<tr><td class="num">${i+1}</td><td>${r.real_name?`<b>${esc(r.real_name)}</b> <small class="muted">${esc(r.name)}</small>`:esc(r.name)}</td><td class="r num">${fmtNum(r.v)} ${u(r.v)}</td></tr>`).join('')}</tbody></table>${(x.standings||[]).length>10?`<p class="note">Top 10 of ${x.players} students shown.</p>`:''}`
      :'<p class="muted small">No rounds played yet.</p>';
    if(x.status==='ended'&&st[0]&&st[0].v>0)body=`<p><b>Winner: ${esc(st[0].real_name||st[0].name)}</b>${st[0].real_name?` (${esc(st[0].name)})`:''} with ${fmtNum(st[0].v)} ${u(st[0].v)}.</p>`+body;
  }else if(x.kind==='class_target'||x.kind==='school_target'){
    const pct=Math.min(100,x.total/x.target*100);
    body=`<div class="spread"><b>${fmtNum(x.total)} of ${fmtNum(x.target)} ${u(x.target)}</b><span>${x.reached?'Goal reached ✓':Math.floor(pct)+'%'}</span></div><span class="gbar"><i style="width:${pct.toFixed(0)}%"></i></span>`;
    if(x.kind==='school_target'&&(x.classes||[]).length)body+=`<table class="cstand"><tbody>${x.classes.map(cl=>`<tr><td>${esc(cl.name)}</td><td class="r num">${fmtNum(cl.v)} ${u(cl.v)}</td></tr>`).join('')}</tbody></table>`;
  }else if(x.kind==='class_race'){
    const cls=x.classes||[];
    body=cls.length?`<table class="cstand"><thead><tr><th>#</th><th>Class</th><th class="r">Per student</th><th class="r">Total</th></tr></thead><tbody>${cls.map((cl,i)=>`<tr><td class="num">${i+1}</td><td>${esc(cl.name)}</td><td class="r num">${fmtNum(cl.per)}</td><td class="r num">${fmtNum(cl.v)}</td></tr>`).join('')}</tbody></table>`:'<p class="muted small">No rounds played yet.</p>';
    if(x.status==='ended'&&cls[0])body=`<p><b>Winner: ${esc(cls[0].name)}</b> with ${fmtNum(cls[0].per)} ${u(2)} per student.</p>`+body;
  }
  return `<div class="citem"><div class="ctop"><div><h3>${esc(x.title)}</h3><div class="ctags">${tag}<span class="ctag">${KINDS[x.kind].label}</span><span class="ctag">${who}</span><span class="ctag">${x.measure==='correct'?'Correct answers':'Stars'}</span></div></div>
    ${canEdit?`<div class="row">${x.status!=='ended'?`<button class="btn" data-cend="${x.id}">End now</button>`:''}<button class="linkbtn danger" data-cdel="${x.id}">Delete</button></div>`:''}</div>
    <p class="small"><b>Prize:</b> ${esc(x.prize)} · ${shortDate(new Date(x.starts_at))} to ${shortDate(lastDay(x))} · ${whenText(x)}</p>${body}</div>`;
}
// Suggested goal targets, sized to the class (or the whole school) and the dates
function compTargets(d){
  const kids=d.kind==='school_target'?(CMP.schoolKids||S.order.length):S.order.length;
  return suggestTargets(d.measure,kids,d.start,d.end);
}
function applyPreset(id){
  const x=PRESETS.find(p=>p.id===id);if(!x)return;const d=compDraft(),t=TIMEFRAMES.find(f=>f.id===x.time);
  const [a,b]=t.range(new Date());
  Object.assign(d,{preset:x.id,kind:x.kind,measure:x.measure,prize:x.prize,title:x.label,start:a,end:b,target:''});
  if(x.perStudent){const kids=x.kind==='school_target'?(CMP.schoolKids||S.order.length):S.order.length;d.target=String(niceNumber(x.perStudent*Math.max(1,kids)))}
}
function readCompForm(){const d=compDraft();[['cTarget','target'],['cPrize','prize'],['cTitle','title'],['cStart','start'],['cEnd','end']].forEach(([id,key])=>{const el=$(id);if(el)d[key]=el.value})}
$('compPane').addEventListener('input',()=>readCompForm());
$('compPane').addEventListener('click',async e=>{
  const kb=e.target.closest('[data-ckind]'),mb=e.target.closest('[data-cmeasure]'),eb=e.target.closest('[data-cend]'),db=e.target.closest('[data-cdel]');
  const pb=e.target.closest('[data-cpreset]'),zb=e.target.closest('[data-cprize]'),tb=e.target.closest('[data-ctime]'),gb=e.target.closest('[data-ctarget]');
  if(pb){readCompForm();applyPreset(pb.dataset.cpreset);CMP.msg='';renderComp();return}
  if(zb){readCompForm();compDraft().prize=zb.dataset.cprize;renderComp();return}
  if(tb){readCompForm();const t=TIMEFRAMES.find(f=>f.id===tb.dataset.ctime),[a,b]=t.range(new Date()),d=compDraft();d.start=a;d.end=b;renderComp();return}
  if(gb){readCompForm();compDraft().target=gb.dataset.ctarget;renderComp();return}
  if(kb){readCompForm();const d=compDraft();d.kind=kb.dataset.ckind;d.preset=null;d.target='';CMP.msg='';renderComp();return}
  if(mb){readCompForm();compDraft().measure=mb.dataset.cmeasure;renderComp();return}
  if(eb||db){
    const x=(CMP.list||[]).find(c=>c.id===(eb||db).dataset[eb?'cend':'cdel']);if(!x)return;
    if(!confirm(eb?`End "${x.title}" now? The results so far are kept and students see it as finished.`:`Delete "${x.title}"? Students will no longer see it.`))return;
    const r=await api.competitionEnd(x.id,!!db);CMP.msg=r&&r.error?(COMP_ERR[r.error]||r.error):eb?`"${x.title}" has ended.`:`"${x.title}" was deleted.`;
    await renderComp(true);return;
  }
});
$('compPane').addEventListener('submit',async e=>{
  if(e.target.id!=='compForm')return;e.preventDefault();readCompForm();
  const d=compDraft(),k=KINDS[d.kind];CMP.busy=true;
  const r=await api.competitionCreate({kind:d.kind,measure:d.measure,class_id:k.scope==='class'?TEACH.classId:null,target:k.target?d.target:null,title:d.title,prize:d.prize,starts_on:d.start,ends_on:d.end});
  CMP.busy=false;
  if(!r||r.error){CMP.msg=COMP_ERR[r&&r.error]||('Could not start it: '+((r&&r.error)||'no reply'));renderComp();return}
  CMP.msg=`"${r.title}" ${r.status==='upcoming'?'is set up. Students will see it a week before it starts.':'has started. Students see it on their home screen.'}`;
  CMP.draft=null;await renderComp(true);
});
// ----- settings -----
function renderSettings(){
  const c=curClass(),st=c.settings||{};
  $('setName').value=c.name;$('setMax').value=String(st.maxTable||12);$('setDiv').checked=!!st.division;$('setSound').checked=st.sound!==false;
  $('setTeacherRow').hidden=!isAdmin();
  if(isAdmin())$('setTeacher').innerHTML=`<option value="">No teacher</option>`+(TEACH.teachers||[]).map(t=>`<option value="${t.id}" ${t.id===c.teacher_id?'selected':''}>${esc(t.name)}</option>`).join('');
  $('setMsg').textContent='';$('acctEmail').textContent=TEACH.info.email||'';$('acctMsg').textContent='';
}
async function saveSettings(){
  const c=curClass();c.settings={...c.settings,maxTable:+$('setMax').value,division:$('setDiv').checked,sound:$('setSound').checked,battles:false};
  await api.updateClass(c.id,{settings:c.settings});applySettings(c.settings);$('setMsg').textContent='Saved.';
}
['setMax','setDiv','setSound'].forEach(id=>$(id).onchange=saveSettings);
$('setName').onchange=async()=>{const c=curClass(),n=$('setName').value.trim().slice(0,80);if(!n)return;c.name=n;await api.updateClass(c.id,{name:n});renderTeacherBar();$('setMsg').textContent='Saved.'};
$('setTeacher').onchange=async()=>{const c=curClass(),tid=$('setTeacher').value||null;c.teacher_id=tid;await api.updateClass(c.id,{teacher_id:tid});renderTeacherBar();$('setMsg').textContent=`Saved. ${tid?teacherName(tid)+' can now see this class.':''}`};
$('gArchive').onclick=async()=>{
  const c=curClass();if(!confirm(`Archive ${c.name}? Students in it can no longer log in. Archived classes are deleted after 12 months.`))return;
  await api.updateClass(c.id,{archived_at:new Date().toISOString()});TEACH.classId=null;TEACH_TAB='students';await loadClasses();
};
// ----- students: add many at once, login cards -----
function renderCodeCards(){
  const code=TEACH?curClass().code:'';
  $('codecards').innerHTML=S.order.map(id=>{const p=S.players[id];return `<div class="codecard">${avatar(p.skin,44)}<div>${p.realName?`<span class="cfor">${esc(p.realName)}</span>`:''}<b>${esc(p.name)}</b><span>School <b>${esc(((TEACH&&TEACH.info.teacher&&TEACH.info.teacher.school)||{}).name||'')}</b></span><span>Class <b>${esc(TEACH?curClass().name:'')}</b></span>${p.username?`<span>School email <b>${esc(p.username)}</b></span><span>Password <b class="num">${esc(p.passcode)}</b></span><span class="small muted">mathwizz.co · Student</span>`:`<span>My code <b class="num">${esc(p.pin)}</b></span><span class="small muted">Class code ${esc(code)}</span>`}</div></div>`}).join('')||'<p class="muted">No students yet.</p>';
}
$('addStudent').onclick=async()=>{
  const lines=[...new Set($('addNames').value.split(/\r?\n/).map(x=>x.trim().slice(0,80)).filter(Boolean))].slice(0,60);
  if(!lines.length){$('addMsg').textContent="Paste at least one school email first, one per line.";$('addNames').focus();return}
  const emails=lines.filter(x=>x.includes('@')),real=lines.filter(x=>!x.includes('@'));
  const btn=$('addStudent');btn.disabled=true;$('addMsg').textContent=`Adding ${lines.length} student${lines.length>1?'s':''}…`;
  const used=[],nextName=()=>{let nm;do{nm=spaceName()}while(used.includes(nm));used.push(nm);return nm};
  const add=st=>{S.players[st.id]=fixPlayer({...newPlayerData(),...st.data,id:st.id,name:st.name,pin:st.pin,username:st.username||'',passcode:st.passcode||'',realName:st.real_name||''});S.order.push(st.id)};
  const msgs=[];let n=0;
  try{
    if(emails.length){
      const r=await api.addEmailStudents(TEACH.classId,emails.map(email=>({email,name:nextName()})));
      if(!r||r.error)throw new Error((r&&r.error)||'no reply');
      r.added.forEach(add);n+=r.added.length;
      const bad=r.skipped.filter(x=>x.why==='not_an_email').map(x=>x.email),dup=r.skipped.filter(x=>x.why==='already_added').map(x=>x.email);
      if(bad.length)msgs.push(`Not school emails, so not added: ${bad.join(', ')}.`);
      if(dup.length)msgs.push(`Already on MathWizz: ${dup.join(', ')}.`);
    }
    if(real.length){
      const names=real.map(()=>nextName()),list=await api.addStudents(TEACH.classId,names,real);
      list.forEach((st,i)=>add({...st,real_name:st.real_name||real[i]}));n+=list.length;
    }
    sortStudents();renderGrown();if(!$('codecards').hidden)renderCodeCards();
    $('addMsg').textContent=[n?`Added ${n} student${n>1?'s':''}. Tap Print login cards to hand out their passwords.`:'',...msgs].filter(Boolean).join(' ');
    $('addNames').value='';
  }catch(e){$('addMsg').textContent='Could not add students: '+e.message}
  btn.disabled=false;
};
$('gdetail').addEventListener('change',async e=>{
  if(e.target.id!=='gdMin'||viewingOther())return;const c=curClass(),p=S.players[GSel];if(!c||!p)return;
  c.settings=withStudentMin(c.settings,p.id,e.target.value==='class'?null:e.target.value);await saveMin(c,'gdMsg');
});
$('gdetail').addEventListener('submit',async e=>{
  if(e.target.closest('#gdEmailForm')){e.preventDefault();const p=S.players[GSel];if(!p)return;
    const r=await api.setStudentLogin(p.id,$('gdEmail').value);
    if(r&&r.ok){p.username=r.username;p.passcode=r.passcode;renderGrown();$('gdMsg').textContent=`${p.realName||p.name} can now log in with ${r.username} and password ${r.passcode}. Their 4-digit code still works too.`}
    else $('gdMsg').textContent=r&&r.error==='already_added'?'That email is already on MathWizz.':r&&r.error==='not_an_email'?'Type the whole school email, like surname.firstname@sd54.bc.ca.':'Could not save: '+((r&&r.error)||'no reply');
    return}
  if(!e.target.closest('#gdRealForm'))return;e.preventDefault();
  const p=S.players[GSel];if(!p)return;const v=$('gdReal').value.trim().slice(0,80);
  try{await api.setRealName(p.id,v);p.realName=v;sortStudents();renderGrown();$('gdMsg').textContent=v?`Saved: ${p.name} is ${v}.`:'Real name removed.'}
  catch(err){$('gdMsg').textContent='Could not save: '+err.message}
});
$('showCards').onclick=()=>{renderCodeCards();$('codecards').hidden=false;setTimeout(()=>window.print(),300)};
$('gdetail').addEventListener('click',async e=>{
  const p=S.players[GSel];if(!p)return;const box=$('gdActions');
  if(e.target.closest('#gdNewCode')){p.pin=await api.newPin(p.id);renderGrown();if(!$('codecards').hidden)renderCodeCards();$('gdMsg').textContent=`New code for ${p.name}: ${p.pin}`;return}
  if(e.target.closest('#gdRemove')){box.innerHTML=`<span style="font-weight:700">Remove ${esc(p.realName||p.name)} and all their progress?</span><button class="btn danger" id="gdYes">Remove</button><button class="btn" id="gdNo">Keep</button>`;return}
  if(e.target.closest('#gdNo')){renderGrown();return}
  if(e.target.closest('#gdYes')){await api.removeStudent(p.id);delete S.players[p.id];S.order=S.order.filter(x=>x!==p.id);GSel=null;renderGrown();if(!$('codecards').hidden)renderCodeCards();return}
});

// ----- your account: change password -----
$('acctPassForm').addEventListener('submit',async e=>{
  e.preventDefault();const pw=$('acctPass').value;
  if(pw.length<8){$('acctMsg').textContent='Use at least 8 characters.';return}
  $('acctMsg').textContent='Saving…';const r=await api.teacherSetPassword(pw);
  $('acctMsg').textContent=r&&r.error?'Could not change it: '+r.error:'Password changed. Use it next time you sign in.';if(!(r&&r.error))$('acctPass').value='';
});
// ----- your account: delete -----
$('acctDelete').onclick=async()=>{
  const ans=prompt('This cannot be undone. Type DELETE to delete your account.');
  if(ans==null)return;if(ans.trim().toUpperCase()!=='DELETE'){$('acctMsg').textContent='Not deleted. Type DELETE (in capitals) to confirm.';return}
  $('acctMsg').textContent='Deleting…';
  let r;try{r=await api.deleteMyAccount()}catch(e){r={error:e.message}}
  if(!r||r.error){$('acctMsg').textContent=r&&r.error==='last_admin'?'You are the only admin. Make another teacher an admin on the School page first.':'Could not delete: '+((r&&r.error)||'no reply');return}
  setLocal({teacher:false,teacherClass:null});TEACH=null;
  toLogin();setTimeout(()=>{$('loginFb').textContent=r.school_deleted?'Your account, school and its data were deleted.':'Your account was deleted.'},50);
};
// ----- download class data (CSV) -----
function csvCell(v){v=v==null?'':String(v);if(/^[=+\-@\t\r]/.test(v))v="'"+v;return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v} // also stops spreadsheet formulas
if($('exportCsv'))$('exportCsv').onclick=()=>{
  const c=curClass(),ws=weekStart(),wk=Date.now()-7*864e5;
  const head=['Real name','Space name','Login code','Rank','Seconds per answer','Rounds (all)','Rounds this week','Accuracy this week (%)','Last played','Needs practice','Stars (total)',...ALL.map(t=>t+'x table')];
  const rows=S.order.map(id=>{const p=S.players[id],ti=tierIndex(statusSecs(p)),wa=weekAcc(p,wk);
    return [p.realName||'',p.name,p.pin,ti<0?'New':TIERS[ti].name,ti<0?'':statusSecs(p).toFixed(1),p.rounds.length,p.rounds.filter(r=>r.d>=ws).length,wa==null?'':wa,
      p.rounds.length?new Date(p.rounds[p.rounds.length-1].d).toLocaleDateString('en-CA'):'',focusOf(p).map(t=>t+'x').join(' '),p.coins||0,
      ...ALL.map(t=>{const sc=tableScore(p,t);return LEVELS[sc==null?0:Math.min(4,Math.max(1,Math.round(sc)))]})]});
  const csv='﻿'+[head,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  a.download=`${c.name.replace(/[^\w\- ]+/g,'').trim()||'class'} - MathWizz - ${new Date().toLocaleDateString('en-CA')}.csv`;
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);
  $('addMsg').textContent=`Downloaded ${rows.length} students. The file opens in Excel, Numbers or Google Sheets.`;
};

// ---------- school page (admins) ----------
$('gSchoolBtn').onclick=()=>openSchool();
$('sBack').onclick=async()=>{TEACH.viewSchool=null;TEACH.classes=visibleClasses();await loadClassStudents();show('grown')};
async function openSchool(){
  show('school');$('sClassMsg').textContent='';$('sTeachMsg').textContent='';
  try{[TEACH.teachers,TEACH.all,TEACH.counts]=await Promise.all([api.listTeachers(ownSchool()),api.listClasses(ownSchool()),api.countStudents(ownSchool())])}catch(e){$('sClassMsg').textContent='Could not load the school: '+e.message}
  TEACH.progress=null;renderSchool();
  try{const r=await api.schoolProgress();TEACH.progress=r&&r.rows?r.rows:(r&&r.error)||'none'}catch(e){TEACH.progress='none'}
  renderSchoolProgress();
}
// School curve plus one line per class (every class in the school, for admins)
function renderSchoolProgress(){
  const rows=TEACH.progress;
  if(rows==null){$('sProgress').innerHTML='<p class="muted">Loading…</p>';$('sProgTbl').innerHTML='';return}
  if(!Array.isArray(rows)){$('sProgress').innerHTML='<p class="muted">Could not load progress just now. Try again in a minute.</p>';$('sProgTbl').innerHTML='';return}
  $('sProgress').innerHTML=chartHTML(pSeries(rows));
  $('sProgTbl').innerHTML=`<thead><tr><th>Class</th><th>Trend</th><th class="r">Correct per round</th><th class="r">Seconds per answer</th></tr></thead><tbody>`+
    TEACH.all.map(c=>{const sr=pSeries(rows.filter(r=>r.class_id===c.id)),[a,b]=cellsHTML(sr);
      return `<tr><td><b>${esc(c.name)}</b></td><td>${miniHTML(sr)}</td>${a}${b}</tr>`}).join('')+'</tbody>';
}
function renderSchool(){
  const t=TEACH.info.teacher,sc=t.school||{},ts=TEACH.teachers||[],me=myId();
  $('sName').textContent=sc.name||'My school';$('sNameInput').value=sc.name||'';
  const tOpts=sel=>`<option value="">No teacher</option>`+ts.map(x=>`<option value="${x.id}" ${x.id===sel?'selected':''}>${esc(x.name)}</option>`).join('');
  $('sClasses').innerHTML=`<thead><tr><th>Class</th><th>Teacher</th><th class="r">Students</th><th>Class code</th><th></th></tr></thead><tbody>`+
    TEACH.all.map(c=>`<tr><td><b>${esc(c.name)}</b></td><td><select data-ct="${c.id}" aria-label="Teacher for ${esc(c.name)}">${tOpts(c.teacher_id)}</select></td><td class="r">${(TEACH.counts||{})[c.id]||0}</td><td><b class="num">${esc(c.code)}</b></td><td><button class="btn" data-open="${c.id}">Open</button></td></tr>`).join('')+'</tbody>';
  $('sClassTeacher').innerHTML=ts.map(x=>`<option value="${x.id}" ${x.id===me?'selected':''}>${esc(x.name)}</option>`).join('');
  const nClasses=id=>TEACH.all.filter(c=>c.teacher_id===id).length,admins=ts.filter(x=>x.role==='admin').length;
  $('sTeachers').innerHTML=`<thead><tr><th>Name</th><th>Email</th><th>Role</th><th class="r">Classes</th><th></th></tr></thead><tbody>`+
    ts.map(x=>`<tr><td><b>${esc(x.name)}</b>${x.id===me?' <small class="muted">(you)</small>':''}</td><td>${esc(x.email||'')}</td>
      <td><select data-role="${x.id}" aria-label="Role for ${esc(x.name)}" ${x.id===me&&admins<2?'disabled title="A school needs at least one admin"':''}><option value="teacher" ${x.role==='teacher'?'selected':''}>Teacher</option><option value="admin" ${x.role==='admin'?'selected':''}>Admin</option></select></td>
      <td class="r">${nClasses(x.id)}</td><td class="nowrap">${x.id===me?'':`<button class="linkbtn" data-pw="${x.id}">Set password</button> <button class="linkbtn danger" data-rm="${x.id}">Remove</button>`}</td></tr>`).join('')+'</tbody>';
  $('sInvite').value=`Hi! Our class uses MathWizz for times tables.\n1. Go to ${location.origin}/?teacher=1\n2. Create an account with your school email\n3. Choose "Join my school" and enter the school code: ${sc.join_code||''}`;
}
$('sClasses').addEventListener('change',async e=>{
  const s=e.target.closest('[data-ct]');if(!s)return;const c=TEACH.all.find(x=>x.id===s.dataset.ct),tid=s.value||null;
  try{await api.updateClass(c.id,{teacher_id:tid});c.teacher_id=tid;$('sClassMsg').textContent=`${c.name}: ${tid?teacherName(tid):'no teacher'}.`}catch(err){$('sClassMsg').textContent='Could not save: '+err.message}
  renderSchool();
});
$('sClasses').addEventListener('click',async e=>{
  const b=e.target.closest('[data-open]');if(!b)return;
  TEACH.classes=TEACH.all;TEACH.classId=b.dataset.open;TEACH_TAB='students';await loadClassStudents();show('grown');
});
$('sAddClass').addEventListener('submit',async e=>{
  e.preventDefault();const name=$('sClassName').value.trim().slice(0,80);if(!name)return;
  try{const c=await api.createClass(name,$('sClassTeacher').value||null);TEACH.all.push(c);$('sClassName').value='';$('sClassMsg').textContent=`Added ${c.name} (class code ${c.code}).`;renderSchool()}
  catch(err){$('sClassMsg').textContent='Could not add the class: '+err.message}
});
$('sTeachers').addEventListener('change',async e=>{
  const s=e.target.closest('[data-role]');if(!s)return;const r=await api.setTeacherRole(s.dataset.role,s.value);
  if(r&&r.error){$('sTeachMsg').textContent=r.error==='last_admin'?'The school needs at least one admin.':'Could not change the role: '+r.error}
  else{const t=TEACH.teachers.find(x=>x.id===s.dataset.role);t.role=s.value;$('sTeachMsg').textContent=`${t.name} is now ${s.value==='admin'?'an admin':'a teacher'}.`;
    if(t.id===myId()&&s.value!=='admin'){TEACH.info.teacher.role='teacher';$('sBack').click();return}}
  renderSchool();
});
$('sTeachers').addEventListener('click',async e=>{
  const pb=e.target.closest('[data-pw]');
  if(pb){const t=TEACH.teachers.find(x=>x.id===pb.dataset.pw);
    const pw=prompt(`New password for ${t.name} (at least 8 characters). Tell them it, and they can change it in Settings.`);if(pw==null)return;
    if(pw.length<8){$('sTeachMsg').textContent='Passwords need at least 8 characters.';return}
    const r=await api.adminSetPassword(t.id,pw);
    $('sTeachMsg').textContent=r&&r.error?'Could not set it: '+r.error:`Done. ${t.name} can now sign in with the new password and change it in Settings.`;return}
  const b=e.target.closest('[data-rm]');if(!b)return;const t=TEACH.teachers.find(x=>x.id===b.dataset.rm);
  if(!confirm(`Remove ${t.name} from the school? Their classes and students stay, and you can give the classes to another teacher.`))return;
  const r=await api.removeTeacher(t.id);if(r&&r.error){$('sTeachMsg').textContent='Could not remove: '+r.error;return}
  TEACH.teachers=TEACH.teachers.filter(x=>x.id!==t.id);TEACH.all.forEach(c=>{if(c.teacher_id===t.id)c.teacher_id=null});
  $('sTeachMsg').textContent=`Removed ${t.name}. Tip: tap New school code so they can't join again with the old one.`;renderSchool();
});
$('sCopy').onclick=async()=>{try{await navigator.clipboard.writeText($('sInvite').value);$('sCopy').textContent='Copied!'}catch(e){$('sInvite').select()}setTimeout(()=>$('sCopy').textContent='Copy message',1500)};
$('sNewCode').onclick=async()=>{if(!confirm('Make a new school code? The old one will stop working.'))return;const r=await api.newJoinCode();if(r&&r.join_code){TEACH.info.teacher.school.join_code=r.join_code;renderSchool();$('sTeachMsg').textContent='New school code made.'}};
$('sRename').addEventListener('submit',async e=>{e.preventDefault();const n=$('sNameInput').value.trim().slice(0,120);if(n.length<2)return;const sc=TEACH.info.teacher.school;await api.renameSchool(sc.id,n);sc.name=n;renderSchool();renderTeacherBar()});

// ---------- owner view: every school, class and student (the database only answers the owner) ----------
let X=null;
$('gSuperBtn').onclick=()=>openSuper();
$('xBack').onclick=()=>show('grown');
$('xRefresh').onclick=()=>openSuper();
async function openSuper(){
  show('super');$('xMsg').textContent='Loading…';
  let r;const pg=api.superProgress().then(x=>x&&Array.isArray(x.rows)?x.rows:null).catch(()=>null);
  try{r=await api.superOverview()}catch(e){$('xMsg').textContent='Could not load: '+e.message;return}
  if(!r||r.error){$('xMsg').textContent=r&&r.error==='not_allowed'?'This page is only for the MathWizz owner.':'Could not load: '+(r&&r.error);$('gSuperBtn').hidden=true;return}
  X=r;$('xMsg').textContent='';$('xUpdated').textContent='Updated '+new Date(r.now).toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'});
  try{$('xHideDemo').checked=!!local().xHideDemo}catch(e){}
  XP=await pg;fillSuperFilters();renderSuper();renderPilots(true);
}
// ----- owner: pilot scorecards -----
let XPL={list:null,msg:''};
const PSTATE={met:'Met',missed:'Not met',progress:'Not yet',waiting:'No data yet'};
async function renderPilots(reload){
  if(reload||XPL.list==null){$('xPilots').innerHTML='<p class="muted">Loading…</p>';
    try{const r=await api.superPilots();XPL.list=r&&!r.error?r.pilots||[]:[];if(r&&r.error)XPL.msg='Could not load pilots: '+r.error}catch(e){XPL.list=[];XPL.msg='Could not load pilots: '+e.message}}
  const pick=$('xSchool').value,classes=(X&&X.classes||[]).filter(c=>!c.archived_at&&(!pick||c.school_id===pick)),school=id=>((X.schools||[]).find(s=>s.id===id)||{}).name||'';
  const inPick=p=>!pick||((X.classes||[]).find(c=>c.id===p.class_id)||{}).school_id===pick;
  const today=dayStr(Date.now()),end=dayStr(Date.now()+25*864e5);
  const form=`<form class="pform" id="xPilotForm">
    <label>Class<select id="xpClass" required>${classes.map(c=>`<option value="${c.id}">${esc(school(c.school_id))} · ${esc(c.name)}</option>`).join('')}</select></label>
    <label>Starts<input id="xpStart" type="date" value="${today}" required></label>
    <label>Ends (last day)<input id="xpEnd" type="date" value="${end}" required></label>
    <label>Baseline<select id="xpBase"><option value="14">2 weeks before</option><option value="7">1 week before</option><option value="28">4 weeks before</option></select></label>
    <label class="wide">Notes<input id="xpNotes" maxlength="1000" placeholder="e.g. Ms Berry's class; decision meeting week of 14 Dec"></label>
    <button class="btn primary" type="submit">Add pilot</button></form>`;
  const cards=(XPL.list||[]).filter(inPick).map(p=>{
    const sc=p.score,h=pilotHeadline(sc),rows=pilotRows(sc);
    const weeks=(sc.usage.weeks||[]).map(w=>`<span class="pweek ${w.state==='future'?'future':w.met?'met':w.state==='now'?'progress':'missed'}" title="Week ${w.i+1}: ${w.active} of ${w.students} students played 3+ days">W${w.i+1} ${w.state==='future'?'–':w.pct+'%'}</span>`).join('');
    return `<div class="pilot" data-pid="${p.id}">
      <div class="ctop"><div><h3>${esc(p.school_name)} · ${esc(p.class_name)}</h3>
        <p class="small muted">${shortDay(p.starts_on)} to ${shortDay(p.ends_on)} · ${weekLabel(p)} · ${sc.students} students${p.notes?` · ${esc(p.notes)}`:''}</p></div>
        <span class="pbadge ${h.state}">${esc(h.text)}</span></div>
      <ol class="plist">${rows.map(r=>`<li><div class="pl"><b>${r.label}</b><span class="small muted">Target: ${esc(r.target)}</span><span class="small">${esc(r.detail)}</span></div>
        <div class="pr"><b class="num">${esc(r.value)}</b><span class="pstate ${r.state}">${PSTATE[r.state]}</span></div></li>`).join('')}</ol>
      <div class="pweeks" aria-label="Regular use by week">${weeks}</div>
      <div class="row prow"><label class="pbonus"><input type="checkbox" data-pbonus ${sc.bonus?'checked':''}> Bonus: another teacher asked to join</label>
        <button class="btn" data-pcopy>Copy Friday update</button><button class="linkbtn danger" data-pdel>Delete</button></div>
    </div>`}).join('');
  $('xPilots').innerHTML=`${XPL.msg?`<p class="note" aria-live="polite">${esc(XPL.msg)}</p>`:''}${cards||'<p class="muted small">No pilots yet. Add one below.</p>'}
    <details class="pnew" ${cards?'':'open'}><summary>Add a pilot</summary>${classes.length?form:'<p class="muted">No classes yet.</p>'}</details>`;
}
$('xPilots').addEventListener('submit',async e=>{
  if(e.target.id!=='xPilotForm')return;e.preventDefault();
  const r=await api.superPilotSave({class_id:$('xpClass').value,starts_on:$('xpStart').value,ends_on:$('xpEnd').value,baseline_days:+$('xpBase').value,notes:$('xpNotes').value.trim()});
  XPL.msg=r&&r.ok?'Pilot added.':'Could not add the pilot: '+({bad_dates:'check the dates (the end must be after the start, at most 120 days)',bad_class:'pick a class'}[r&&r.error]||(r&&r.error)||'no reply');
  renderPilots(true);
});
$('xPilots').addEventListener('change',async e=>{
  const cb=e.target.closest('[data-pbonus]');if(!cb)return;const p=XPL.list.find(x=>x.id===cb.closest('[data-pid]').dataset.pid);
  const r=await api.superPilotSave({id:p.id,class_id:p.class_id,starts_on:p.starts_on,ends_on:p.ends_on,baseline_days:p.baseline_days,bonus:cb.checked});
  XPL.msg=r&&r.ok?'':'Could not save: '+((r&&r.error)||'no reply');renderPilots(true);
});
$('xPilots').addEventListener('click',async e=>{
  const card=e.target.closest('[data-pid]');if(!card)return;const p=XPL.list.find(x=>x.id===card.dataset.pid);
  if(e.target.closest('[data-pcopy]')){
    const text=weeklyText(p);
    try{await navigator.clipboard.writeText(text);XPL.msg='Friday update copied. Paste it into your email.'}
    catch(err){XPL.msg='';renderPilots();const ta=document.createElement('textarea');ta.className='pcopy';ta.readOnly=true;ta.value=text;ta.rows=10;card.appendChild(ta);ta.select();return}
    renderPilots();return;
  }
  if(e.target.closest('[data-pdel]')){
    if(!confirm(`Delete the pilot for ${p.class_name}? The class and its rounds are not affected.`))return;
    const r=await api.superPilotDelete(p.id);XPL.msg=r&&r.ok?'Pilot deleted.':'Could not delete it.';renderPilots(true);
  }
});

let XP=null;
// Progress curve for whatever the filters select (a class, a school, or every school), plus a line for each school and class
function renderSuperProgress(){
  if(!XP){$('xProgress').innerHTML='<p class="muted">Progress data is not available yet.</p>';$('xProgTbl').innerHTML='';return}
  const sc=$('xSchool').value,cl=$('xClass').value,cls=id=>X.classes.find(c=>c.id===id)||{};
  const inScope=r=>cl?r.class_id===cl:sc?cls(r.class_id).school_id===sc:true;
  $('xProgTitle').textContent=cl?'Progress: '+(cls(cl).name||'class'):sc?'Progress: '+((X.schools.find(s=>s.id===sc)||{}).name||'school'):'Progress: all schools together';
  $('xProgress').innerHTML=chartHTML(pSeries(XP.filter(inScope)));
  const out=[];
  X.schools.filter(s=>!sc||s.id===sc).forEach(s=>{
    const ss=pSeries(XP.filter(r=>cls(r.class_id).school_id===s.id)),[a,b]=cellsHTML(ss);
    out.push(`<tr class="xschoolrow"><td><b>${esc(s.name)}</b></td><td>${miniHTML(ss)}</td>${a}${b}</tr>`);
    X.classes.filter(c=>c.school_id===s.id&&!c.archived_at).forEach(c=>{const cs=pSeries(XP.filter(r=>r.class_id===c.id)),[ca,cb]=cellsHTML(cs);
      out.push(`<tr><td class="xclassrow">${esc(c.name)}</td><td>${miniHTML(cs)}</td>${ca}${cb}</tr>`)});
  });
  $('xProgTbl').innerHTML=`<thead><tr><th>School / class</th><th>Trend</th><th class="r">Correct per round</th><th class="r">Seconds per answer</th></tr></thead><tbody>`+out.join('')+'</tbody>';
}
const XDAY=864e5;
const xTime=v=>v==null?null:typeof v==='number'?v:Date.parse(v);
function xAgo(t){if(!t)return'Never';const d=Math.floor((X.now-t)/XDAY);if(d<=0)return'Today';if(d===1)return'Yesterday';if(d<31)return d+' days ago';return new Date(t).toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'})}
function xLastActive(s){return Math.max(xTime(s.last_round)||0,xTime(s.last_seen_at)||0,xTime(s.last_login_at)||0)||null}
function xStatus(s){if(!s.rounds)return'never';const d=(X.now-xTime(s.last_round))/XDAY;return d<=7?'active':d<=30?'slipping':'inactive'}
const XLABEL={active:'Active',slipping:'Slipping',inactive:'Inactive',never:'Never played'};
// Monday-start week number relative to this week (0 = this week, -1 = last week …)
function xMonday(d){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-((x.getDay()+6)%7));return x}
function xWeek(dayStr){const [y,m,d]=dayStr.split('-').map(Number);return Math.round((xMonday(new Date(y,m-1,d))-xMonday(new Date(X.now)))/(7*XDAY))}
function xStudents(){const hide=$('xHideDemo').checked,sc=$('xSchool').value;
  return X.students.filter(s=>!(hide&&s.demo)&&(!sc||(X.classes.find(c=>c.id===s.class_id)||{}).school_id===sc))}
function fillSuperFilters(){
  let sc=$('xSchool').value;if(!sc){try{sc=local().xSchool||''}catch(e){sc=''}}
  $('xSchool').innerHTML='<option value="">All schools</option>'+X.schools.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('xSchool').value=X.schools.some(s=>s.id===sc)?sc:'';fillSuperClasses();
}
function fillSuperClasses(){
  const sc=$('xSchool').value,cl=$('xClass').value,cs=X.classes.filter(c=>!sc||c.school_id===sc);
  $('xClass').innerHTML='<option value="">All classes</option>'+cs.map(c=>`<option value="${c.id}">${esc(c.name)}${sc?'':' · '+esc((X.schools.find(s=>s.id===c.school_id)||{}).name||'')}</option>`).join('');
  $('xClass').value=cs.some(c=>c.id===cl)?cl:'';
}
function renderSuper(){
  const st=xStudents(),played=st.filter(s=>s.rounds>0),pct=(a,b)=>b?Math.round(a/b*100)+'%':'–';
  const act7=played.filter(s=>xStatus(s)==='active').length,act30=played.filter(s=>xStatus(s)!=='inactive').length;
  const back=played.filter(s=>(s.days||[]).length>=2).length;
  const sc=$('xSchool').value,school=X.schools.find(s=>s.id===sc);
  const allClasses=X.classes.filter(c=>!sc||c.school_id===sc),liveClasses=allClasses.filter(c=>!c.archived_at),teachers=X.teachers.filter(t=>!sc||t.school_id===sc);
  $('xAllBtn').hidden=!sc;$('xH1').textContent=school?school.name:'All schools';
  const tile=(n,l,sub)=>`<div class="xtile"><b>${n}</b><span>${l}</span>${sub?`<small>${sub}</small>`:''}</div>`;
  $('xTiles').innerHTML=(school?tile(PLAN_NAMES[school.plan||'free'],'Plan',teachers.length+' teacher'+(teachers.length===1?'':'s')):tile(X.schools.length,'Schools',teachers.length+' teachers'))+tile(liveClasses.length,'Classes',allClasses.length-liveClasses.length?(allClasses.length-liveClasses.length)+' archived':'')
    +tile(st.length,'Students',pct(played.length,st.length)+' have played')+tile(act7,'Active this week',pct(act7,played.length)+' of players')
    +tile(act30,'Active last 30 days',pct(act30,played.length)+' of players')+tile(pct(back,played.length),'Came back',back+' played on 2+ days');
  // weekly active, last 8 weeks
  const weeks=[...Array(8)].map((_,i)=>i-7),wk={};weeks.forEach(w=>wk[w]=0);
  st.forEach(s=>{const seen=new Set((s.days||[]).map(xWeek));seen.forEach(w=>{if(w in wk)wk[w]++})});
  const top=Math.max(1,...weeks.map(w=>wk[w])),mon=xMonday(new Date(X.now));
  $('xWeekly').innerHTML=weeks.map(w=>{const d=new Date(mon);d.setDate(d.getDate()+w*7);
    return `<div class="xbar" title="Week of ${d.toLocaleDateString('en-CA',{month:'short',day:'numeric'})}: ${wk[w]} students"><b>${wk[w]}</b><i style="height:${Math.round(wk[w]/top*120)}px"></i><span>${w===0?'This wk':d.toLocaleDateString('en-CA',{month:'short',day:'numeric'})}</span></div>`}).join('');
  // cohorts by first week played
  const coh={};played.forEach(s=>{const ws=[...new Set((s.days||[]).map(xWeek))];if(!ws.length)return;const f=Math.min(...ws);if(f<-7)return;(coh[f]=coh[f]||[]).push(new Set(ws))});
  const ks=Object.keys(coh).map(Number).sort((a,b)=>a-b);
  $('xCohort').innerHTML=ks.length?`<thead><tr><th>First played</th><th class="r">Students</th>${[1,2,3,4].map(n=>`<th class="r">+${n} wk</th>`).join('')}</tr></thead><tbody>`+ks.map(f=>{
      const g=coh[f],d=new Date(mon);d.setDate(d.getDate()+f*7);
      return `<tr><td>Week of ${d.toLocaleDateString('en-CA',{month:'short',day:'numeric'})}</td><td class="r">${g.length}</td>${[1,2,3,4].map(n=>{if(f+n>0)return'<td></td>';const p=Math.round(g.filter(x=>x.has(f+n)).length/g.length*100);
        return `<td class="c" style="background:color-mix(in srgb,var(--accent) ${Math.round(p*.55)}%,transparent)">${p}%</td>`}).join('')}</tr>`}).join('')+'</tbody>'
    :'<tbody><tr><td class="muted">No rounds played in the last 8 weeks yet.</td></tr></tbody>';
  // schools
  const inSchool=id=>st.filter(s=>{const c=X.classes.find(x=>x.id===s.class_id);return c&&c.school_id===id});
  const lastOf=list=>Math.max(0,...list.map(xLastActive).filter(Boolean))||null;
  $('xSchools').innerHTML=`<thead><tr><th>School</th><th>Plan</th><th class="r">Teachers</th><th class="r">Classes</th><th class="r">Students</th><th class="r">Active 7 days</th><th>Last activity</th><th>Admins</th></tr></thead><tbody>`+
    X.schools.filter(x=>!$('xSchool').value||x.id===$('xSchool').value).map(sc=>{const ss=inSchool(sc.id),ts=X.teachers.filter(t=>t.school_id===sc.id);
      return `<tr data-xs="${sc.id}" title="View this school"><td><b>${esc(sc.name)}</b></td><td><select data-xplan="${sc.id}" aria-label="Plan for ${esc(sc.name)}">${Object.entries(PLAN_NAMES).map(([k,v])=>`<option value="${k}" ${(sc.plan||'free')===k?'selected':''}>${v}</option>`).join('')}</select></td><td class="r">${ts.length}</td><td class="r">${X.classes.filter(c=>c.school_id===sc.id&&!c.archived_at).length}</td><td class="r">${ss.length}</td><td class="r">${ss.filter(s=>xStatus(s)==='active').length}</td><td>${xAgo(lastOf(ss))}</td><td>${ts.filter(t=>t.role==='admin').map(t=>esc(t.name)+(t.email?` <small class="muted">${esc(t.email)}</small>`:'')).join('<br>')}</td></tr>`}).join('')+'</tbody>';
  $('xSchoolsTitle').textContent=sc?'School':'Schools';
  // teachers of the chosen school
  $('xTeachCard').hidden=!sc;
  if(sc)$('xTeachers').innerHTML=`<thead><tr><th>Teacher</th><th>Email</th><th>Role</th><th class="r">Classes</th><th>Joined</th></tr></thead><tbody>`+
    (teachers.length?teachers.map(t=>`<tr><td><b>${esc(t.name||'')}</b></td><td>${esc(t.email||'')}</td><td>${t.role==='admin'?'Admin':'Teacher'}</td><td class="r">${X.classes.filter(c=>c.teacher_id===t.id&&!c.archived_at).length}</td><td>${xAgo(xTime(t.created_at))}</td></tr>`).join('')
      :'<tr><td colspan="5" class="muted">No teachers yet.</td></tr>')+'</tbody>';
  // classes
  $('xClasses').innerHTML=`<thead><tr><th>Class</th><th>School</th><th>Teacher</th><th>Code</th><th class="r">Students</th><th class="r">Played</th><th class="r">Active 7 days</th><th>Last activity</th></tr></thead><tbody>`+
    X.classes.filter(c=>!sc||c.school_id===sc).map(c=>{const ss=st.filter(s=>s.class_id===c.id),t=X.teachers.find(x=>x.id===c.teacher_id);
      return `<tr data-xc="${c.id}" title="Show this class's students"><td><b>${esc(c.name)}</b>${c.archived_at?' <small class="muted">archived</small>':''}</td><td>${esc((X.schools.find(s=>s.id===c.school_id)||{}).name||'')}</td><td>${t?esc(t.name):'<span class="muted">None</span>'}</td><td class="num">${esc(c.code)}</td><td class="r">${ss.length}</td><td class="r">${ss.filter(s=>s.rounds>0).length}</td><td class="r">${ss.filter(s=>xStatus(s)==='active').length}</td><td>${xAgo(lastOf(ss))}</td></tr>`}).join('')+'</tbody>';
  renderSuperProgress();renderSuperStudents();
}
function renderSuperStudents(){
  const sc=$('xSchool').value,cl=$('xClass').value,stf=$('xStatus').value,q=$('xSearch').value.trim().toLowerCase();
  const cls=id=>X.classes.find(c=>c.id===id)||{},sch=id=>X.schools.find(s=>s.id===id)||{};
  const list=xStudents().filter(s=>{const c=cls(s.class_id);return(!sc||c.school_id===sc)&&(!cl||s.class_id===cl)&&(!stf||xStatus(s)===stf)&&(!q||(s.name+' '+(s.real_name||'')).toLowerCase().includes(q))})
    .sort((a,b)=>(xLastActive(b)||0)-(xLastActive(a)||0));
  $('xCount').textContent=`${list.length} student${list.length===1?'':'s'}`;
  const shown=list.slice(0,500);
  $('xStudents').innerHTML=`<thead><tr><th>Student</th><th>Real name</th><th>School · class</th><th>Last login</th><th>Last played</th><th class="r">Rounds</th><th class="r">Days played</th><th class="r">Minutes</th><th class="r">Stars</th><th>Status</th></tr></thead><tbody>`+
    (shown.length?shown.map(s=>{const c=cls(s.class_id),k=xStatus(s);
      return `<tr><td><b>${esc(s.name)}</b>${s.demo?'<span class="xdemo">demo</span>':''}</td><td>${esc(s.real_name||'')}</td><td>${esc(sch(c.school_id).name||'')} · ${esc(c.name||'')}</td><td>${xAgo(xTime(s.last_login_at))}</td><td>${xAgo(xTime(s.last_round))}</td><td class="r">${s.rounds||0}</td><td class="r">${(s.days||[]).length}</td><td class="r">${s.mins||0}</td><td class="r">${s.stars||0}</td><td><span class="xpill ${k}">${XLABEL[k]}</span></td></tr>`}).join('')
      :'<tr><td colspan="10" class="muted">No students match.</td></tr>')+'</tbody>'+(list.length>500?`<caption class="muted small">Showing the 500 most recently active.</caption>`:'');
}
$('xHideDemo').onchange=()=>{setLocal({xHideDemo:$('xHideDemo').checked});renderSuper()};
function xPickSchool(id){$('xSchool').value=id;try{setLocal({xSchool:id})}catch(e){}fillSuperClasses();renderSuper();renderPilots();}
$('xSchool').onchange=()=>xPickSchool($('xSchool').value);
$('xAllBtn').onclick=()=>xPickSchool('');
['xClass','xStatus'].forEach(id=>$(id).onchange=renderSuperStudents);
$('xSearch').oninput=renderSuperStudents;
$('xSchools').addEventListener('change',async e=>{
  const sel=e.target.closest('[data-xplan]');if(!sel)return;const sc=X.schools.find(x=>x.id===sel.dataset.xplan),was=sc.plan||'free';
  const r=await api.superSetPlan(sc.id,sel.value);
  if(!r||r.error){sel.value=was;$('xMsg').textContent='Could not change the plan: '+((r&&r.error)||'no reply');return}
  sc.plan=sel.value;$('xMsg').textContent=`${sc.name} is now on the ${PLAN_NAMES[sc.plan]} plan.`;
});
$('xSchools').addEventListener('click',e=>{if(e.target.closest('select'))return;const r=e.target.closest('[data-xs]');if(!r||$('xSchool').value===r.dataset.xs)return;xPickSchool(r.dataset.xs);$('super').scrollIntoView({behavior:'smooth',block:'start'})});
$('xClasses').addEventListener('click',e=>{const r=e.target.closest('[data-xc]');if(!r)return;const c=X.classes.find(x=>x.id===r.dataset.xc);if($('xSchool').value!==c.school_id)xPickSchool(c.school_id);$('xClass').value=c.id;renderSuper();$('xStudents').scrollIntoView({behavior:'smooth',block:'start'})});

// ---------- stars fly into the counter ----------
function flyStars(n){
  const from=$('ans').getBoundingClientRect(),to=$('pcoins').getBoundingClientRect();
  for(let i=0;i<n;i++){
    const st=document.createElement('span');st.className='flystar';st.setAttribute('aria-hidden','true');
    const x0=from.left+from.width/2-11+(i-(n-1)/2)*26,y0=from.top+from.height/2-11;
    st.style.left=x0+'px';st.style.top=y0+'px';document.body.appendChild(st);
    const dx=to.left+to.width/2-11-x0,dy=to.top+to.height/2-11-y0;
    setTimeout(()=>{st.style.transform=`translate(${dx}px,${dy}px) scale(.55) rotate(200deg)`;st.style.opacity='.9'},20+i*90);
    setTimeout(()=>{st.remove();const c=$('pcoins');c.parentElement.classList.remove('bump');void c.offsetWidth;c.parentElement.classList.add('bump')},640+i*90);
  }
}

// ---------- boss battles ----------
const BOSSES=[{name:'Zorg the Zapper',body:'#8A5FD0'},{name:'Blorbo',body:'#3ACB7E'},{name:'Captain Cosmo-Crab',body:'#FF6B6F'},{name:'Glitch Bot',body:'#5EC2FF'}];
function bossSVG(b){const k=OUT,o=`stroke="${k}" stroke-width="2.4" stroke-linejoin="round"`;
  return `<svg viewBox="0 0 60 56" width="58" height="54" aria-hidden="true"><path d="M14 14 L10 2 L20 10Z M46 14 L50 2 L40 10Z" fill="#FFD447" ${o}/><path d="M6 50 Q2 20 30 10 Q58 20 54 50 Q30 56 6 50Z" fill="${b.body}" ${o}/><circle cx="30" cy="28" r="10" fill="#FFFFFF" ${o}/><circle cx="31" cy="29" r="4.5" fill="${k}"/><circle cx="32.5" cy="27.5" r="1.4" fill="#fff"/><path d="M22 42 Q30 37 38 42" stroke="${k}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M24 42 v3M29 40.5 v3.5M34 41 v3" stroke="#FFFFFF" stroke-width="2"/></svg>`}
function maybeStartBoss(){
  if(!G||G.mode!=='round'||G.boss||G.bossAt==null||G.n!==G.bossAt)return;
  if(G.len-(performance.now()-G.start)<24000)return; // not enough time left
  const b=BOSSES[Math.floor(Math.random()*BOSSES.length)];
  G.boss={...b,hp:8,max:8,until:performance.now()+22000,state:'on'};
  $('bossArt').innerHTML=bossSVG(b);$('bossName').textContent=`${b.name} appeared!`;renderBoss();$('boss').hidden=false;
  SFX.wrong();setTimeout(()=>SFX.combo(),200);
}
function renderBoss(){
  const B=G&&G.boss;if(!B)return;
  $('bossHp').style.width=(B.hp/B.max*100)+'%';
  $('bossInfo').textContent=B.state==='on'?`Hit it ${B.hp} more time${B.hp===1?'':'s'} · ${Math.max(0,Math.ceil((B.until-performance.now())/1000))} s`:B.state==='won'?'Boss defeated! +25 stars':'The boss got away…';
}
function bossHit(){
  const B=G&&G.boss;if(!B||B.state!=='on')return;
  B.hp--;const a=$('bossArt');a.classList.remove('hit');void a.offsetWidth;a.classList.add('hit');tone(140,.12,'square',.08);
  if(B.hp<=0){B.state='won';G.coins+=25;G.bossPrize=25;$('pcoins').textContent=liveStars();flyStars(5);SFX.end();$('boss').classList.add('won');setTimeout(()=>{if(G&&G.boss===B)$('boss').hidden=true},2200)}
  renderBoss();
}
function bossTick(){
  const B=G&&G.boss;if(!B||B.state!=='on')return;
  if(performance.now()>B.until){B.state='lost';renderBoss();setTimeout(()=>{if(G&&G.boss===B)$('boss').hidden=true},2000)}else renderBoss();
}

// ---------- race track: in every round you race the ghost of your own best round ----------
function setGhost(sc){G.ghost={trace:sc.trace,final:sc.c};G.opp.state='ghost';G.opp.c=0}
function buildRace(){
  const me=P(),o=G.opp;
  $('race').innerHTML=[['me',me.skin,'You'],['opp',o.skin,esc(o.name)]].map(([k,sk,label])=>
    `<div class="lane ${k}"><span class="lname">${label}<em id="race_${k}_tag"></em></span><div class="lrun"><i class="lfill" id="race_${k}_fill"></i><span class="lav" id="race_${k}_av">${avatar(sk,30)}</span><span class="lfin"></span></div><b class="num" id="race_${k}_c">0</b></div>`).join('');
  $('race').hidden=false;renderRace();
}
function renderGhost(){
  if(!G||!G.opp||!G.ghost)return;
  const v=G.ghost.trace.filter(t=>t<=performance.now()-G.start).length;
  if(v!==G.opp.c){G.opp.c=v;renderRace();const a=$('race_opp_av');if(a){a.classList.remove('bump');void a.offsetWidth;a.classList.add('bump')}}
}
function renderRace(){
  if(!G||!G.opp||$('race').hidden)return;
  const o=G.opp,top=Math.max(G.c,o.c,G.ghost?G.ghost.final:0);
  const goal=Math.max(30,Math.ceil((top+3)/10)*10);
  const put=(k,c)=>{const f=Math.min(1,c/goal);$('race_'+k+'_av').style.left=`calc((100% - 34px) * ${f.toFixed(3)})`;$('race_'+k+'_fill').style.width=`calc((100% - 34px) * ${f.toFixed(3)} + 17px)`;$('race_'+k+'_c').textContent=c};
  put('me',G.c);put('opp',o.c);
  const t=$('race_opp_tag');t.textContent='Ghost';t.className='rtag ghost';
  $('race').querySelector('.lane.me').classList.toggle('lead',G.c>o.c);
  $('race').querySelector('.lane.opp').classList.toggle('lead',o.c>G.c);
}
// Refresh classmates' week totals for the Top 10 (only when the Top 10 is opened, at most every 2 minutes)
let classPulled=0;
async function refreshClass(force){
  if(!SESSION||TEACH||(!force&&Date.now()-classPulled<120000))return;classPulled=Date.now();
  let st;try{st=await api.studentState(SESSION.token)}catch(e){return}
  if(!st||st.error){if(st&&st.error==='signed_out')toLogin(true);return}
  if(!SESSION||!P()||P().id!==st.me.id)return;
  applyState(st,true);if(screen==='home')renderHome();
}

// ---------- student home: competition cards ----------
function renderCompBox(){
  const box=$('compBox');if(!box)return;
  const order={active:0,upcoming:1,ended:2},list=COMPS.slice().sort((a,b)=>order[a.status]-order[b.status]).slice(0,3);
  box.hidden=!list.length;if(!list.length){box.innerHTML='';return}
  box.innerHTML=list.map(c=>{const v=studentView(c);
    return `<div class="ccard ${v.win?'win':''}"><span class="chead">${TROPHY}${esc(v.title===v.kindLabel?(c.scope==='school'?'School competition':'Class competition'):v.kindLabel)}</span><b class="ctitle">${esc(v.title)}</b>
      ${v.main?`<span class="cmain">${esc(v.main)}</span>`:''}${v.pct!=null?`<span class="gbar" role="img" aria-label="${Math.round(v.pct)}% of the way"><i style="width:${v.pct.toFixed(0)}%"></i></span>`:''}
      ${v.sub?`<span class="csub">${esc(v.sub)}</span>`:''}<span class="cfoot"><span><b>Prize:</b> ${esc(v.prize)}</span><span>${esc(v.when)}</span></span></div>`}).join('');
}
// Fresh competition numbers after playing (at most every 30 seconds)
let compsPulled=0;
async function refreshComps(){
  if(!SESSION||TEACH||Date.now()-compsPulled<30000)return;compsPulled=Date.now();
  let st;try{st=await api.studentState(SESSION.token)}catch(e){return}
  if(!st||st.error||!SESSION||!P()||P().id!==st.me.id)return;
  COMPS=Array.isArray(st.competitions)?st.competitions:[];
  SCHOOLBOARD=Array.isArray(st.school_board)?st.school_board:SCHOOLBOARD;
  if(screen==='home'&&tab==='board')renderBoard(P());
}
// ---------- Play page: rocket journey strip ----------
// Vertical journey: Galaxy at the top, Ground at the bottom, the player's rocket parked at their rank.
function journeyHTML(p){
  const ti=tierIndex(statusSecs(p)),n=TIERS.length;
  let stops='';
  for(let i=n-1;i>=0;i--){
    const cls=i<ti?'past':i===ti?'here':i===ti+1||(ti<0&&i===0)?'next':'future';
    stops+=`<div class="vjstop ${cls}"><span class="vjplanet">${tierArt(i)}${cls==='past'?'<span class="vjcheck">✓</span>':''}</span><span class="vjname">${TIERS[i].name}</span>${cls==='here'?`<span class="vjrocket">${rocketSVG(p.rocket,18)}</span>`:''}${cls==='next'?'<span class="vjtag">Next!</span>':''}</div>`;
  }
  const fill=ti<=0?0:ti/(n-1)*100;
  let msg;
  if(ti<0)msg='Play a round to launch your rocket!';
  else if(ti>=n-1)msg='You made it to the <b>Galaxy</b>! Keep going to stay on top.';
  else msg=`You're at <b>${TIERS[ti].name}</b>. Answer faster to fly to <b>${TIERS[ti+1].name}</b>!`;
  return {track:`<div class="vjtrack" aria-hidden="true"><span class="vjline"></span><span class="vjfill" style="height:${fill.toFixed(1)}%"></span></div>${stops}`,msg};
}
// Saved data comes from the student's own device, so never trust its shape: wrong types become safe defaults instead of crashing the game.
function fixPlayer(p){
  const arr=(v,d)=>Array.isArray(v)?v:d;
  p.rockets=arr(p.rockets,['classic']);p.rocket=p.rocket||'classic';p.owned=arr(p.owned,['blob']);
  const facts={};if(p.facts&&typeof p.facts==='object'&&!Array.isArray(p.facts))for(const [k,f] of Object.entries(p.facts))if(f&&Array.isArray(f.r)&&Array.isArray(f.t))facts[k]=f;
  p.facts=facts;p.rounds=arr(p.rounds,[]).filter(r=>r&&typeof r==='object');
  p.badges=arr(p.badges,[]).filter(b=>b!=='duelwin');delete p.seenBattles;migrateStars(p);
  if((!p.daily||!p.daily.lastT)&&p.rounds.length)p.daily=streakFromRounds(p.rounds);return p}

// ---------- boot ----------
export async function boot(){
  const q=new URLSearchParams(location.search);
  if(RECOVERY){setTimeout(()=>{try{history.replaceState(null,'',location.pathname)}catch(e){}},1500);
    ['tSignIn','tSetup'].forEach(id=>$(id).hidden=true);$('tReset').hidden=false;show('teach');return}
  if(q.get('teacher')||location.hash.includes('access_token')){
    setTimeout(()=>{if(TEACH||screen==='teach')setAddress(true)},1500); // tidy the address bar after the email link
    openTeacher();return}
  let t=null;try{t=sessionStorage.getItem(TAB)}catch(e){}
  t=t||local().token; // this tab's student first, so several tabs can stay logged in as different students
  if(t){SESSION={token:t};const ok=await loadStudent();if(ok){enterPlayer();return}}
  // The plain address is always the student side (teachers use /?teacher=1, which a refresh keeps),
  // so a shared classroom computer never opens a teacher's dashboard for a student.
  openLogin();
}

// Test-only access to the game's pure logic and state. Not used by the app itself.
export const __test = {
  level, weakWeight, statusSecs, tierIndex, pb, tableScore, weekStart, dayKey, dayStart, weekKey, missedSchoolDays,
  streakInfo, bumpStreak, isSchoolDay, streakFromRounds, streakHTML, nextSchoolDay, scoreRound, gameStars, roundStars, ptsSince, migrateStars, fixPlayer, newPlayerData,
  applySettings, applyState, csvCell, esc, med, acc, pick, makeQ, afterAnswer, challengeShare, facts, grewFact, newFactWeight,
  checkBadges, BADGES, record, knowsTable, focusOf, weekAcc, trickyFacts, goalBoost, spaceName, TIERS, ORDER,
  renderCompBox, renderMinBox, setComps(v) { COMPS = v; }, renderBoard, setBoardScope(v) { boardScope = v; },
  get S() { return S; }, get ALL() { return ALL; }, get G() { return G; },
  rowsFromPlayers, pSeries,
  setG(v) { G = v; }, setQ(v) { q = v; }, resetRecent() { recent = []; },
};
