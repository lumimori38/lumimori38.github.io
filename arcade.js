/* =========================================================
   루미 오락실 공용 스크립트
   - 사운드(BGM·효과음, 설정 패널)
   - 토스트, 링크 복사, 홈 화면 추가(PWA)
   - DEV LOG 데이터 읽기/쓰기(관리자: GitHub 토큰)
   ========================================================= */
(function(){
'use strict';
const SITE = { owner:'lumimori38', repo:'lumimori38.github.io', branch:'main', url:'https://lumimori38.github.io/' };

/* ---------------- 저장소(로컬) ---------------- */
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} },
};

/* ---------------- 토스트 ---------------- */
let toastEl;
function toast(msg){
  if(!toastEl){ toastEl=document.createElement('div'); toastEl.className='toast'; toastEl.setAttribute('role','status'); document.body.appendChild(toastEl); }
  toastEl.textContent=msg; toastEl.classList.add('show');
  clearTimeout(toastEl._t); toastEl._t=setTimeout(()=>toastEl.classList.remove('show'),1900);
}
async function copyText(text){
  try{ await navigator.clipboard.writeText(text); return true; }
  catch(e){
    try{ const t=document.createElement('textarea'); t.value=text; t.style.position='fixed'; t.style.opacity='0'; document.body.appendChild(t); t.select(); const ok=document.execCommand('copy'); t.remove(); return ok; }
    catch(e2){ return false; }
  }
}

/* =========================================================
   사운드 엔진 (Web Audio로 직접 합성 — 외부 음원 없음)
   ========================================================= */
const DEFAULT_SND = { on:true, bgm:30, sfx:60 };
const snd = Object.assign({}, DEFAULT_SND, store.get('arcade_sound', {}));
let ctx=null, master, bgmBus, sfxBus, bgmTimer=null, bgmPlaying=false, nextTime=0, step=0;

function ensureCtx(){
  if(ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if(!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
  bgmBus = ctx.createGain(); sfxBus = ctx.createGain();
  // BGM은 부드럽게: 저역통과 필터로 날카로운 고음을 깎음
  const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=2400; lp.Q.value=0.3;
  bgmBus.connect(lp); lp.connect(master);
  sfxBus.connect(master);
  applyVolumes();
  return ctx;
}
function applyVolumes(){
  if(!ctx) return;
  const t=ctx.currentTime;
  const on = snd.on ? 1 : 0;
  bgmBus.gain.setTargetAtTime(on * Math.pow(snd.bgm/100, 1.6) * 0.55, t, 0.05);
  sfxBus.gain.setTargetAtTime(on * Math.pow(snd.sfx/100, 1.3) * 0.9, t, 0.02);
}
const mtof = m => 440*Math.pow(2,(m-69)/12);

function tone(bus, {type='square', freq=440, to=null, start, dur=0.1, vol=0.2, attack=0.004, release=0.06}){
  const o=ctx.createOscillator(), g=ctx.createGain();
  o.type=type; o.frequency.setValueAtTime(freq, start);
  if(to) o.frequency.exponentialRampToValueAtTime(to, start+dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start+attack);
  g.gain.setValueAtTime(vol, start+Math.max(attack, dur-release));
  g.gain.exponentialRampToValueAtTime(0.0001, start+dur);
  o.connect(g); g.connect(bus); o.start(start); o.stop(start+dur+0.02);
}
function noise(bus, {start, dur=0.06, vol=0.15, cutoff=1200}){
  const len=Math.max(1, Math.floor(ctx.sampleRate*dur));
  const buf=ctx.createBuffer(1, len, ctx.sampleRate), d=buf.getChannelData(0);
  for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
  const s=ctx.createBufferSource(); s.buffer=buf;
  const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=cutoff;
  const g=ctx.createGain(); g.gain.value=vol;
  s.connect(f); f.connect(g); g.connect(bus); s.start(start);
}

/* ---- BGM: 느긋한 8비트 루프 (C–Am–F–G, 8마디) ---- */
const BPM=88, STEP=60/BPM/2;           // 8분음표 단위
const _=null;
const LEAD=[
  76,_,79,_,76,74,72,_,   74,_,76,_,72,_,69,_,
  72,_,74,77,76,_,74,_,   74,_,71,_,74,76,79,_,
  76,_,79,_,81,79,76,_,   74,_,76,_,72,_,69,_,
  72,_,74,_,77,76,74,_,   71,_,74,_,72,_,_,_,
];
const BASS_ROOT=[48,45,41,43, 48,45,41,43];   // 마디별 근음
const CHORD=[[60,64,67],[57,60,64],[53,57,60],[55,59,62],[60,64,67],[57,60,64],[53,57,60],[55,59,62]];

function scheduleStep(i, t){
  const bar=Math.floor(i/8)%8, pos=i%8;
  const n=LEAD[i%LEAD.length];
  if(n) tone(bgmBus,{type:'square', freq:mtof(n), start:t, dur:STEP*1.6, vol:0.045, release:0.12});
  if(pos===0||pos===4){ // 베이스: 1·3박
    const r=BASS_ROOT[bar] + (pos===4?7:0);
    tone(bgmBus,{type:'triangle', freq:mtof(r), start:t, dur:STEP*1.8, vol:0.16, release:0.15});
  }
  if(pos%2===1){ // 아주 작은 아르페지오(분위기용)
    const c=CHORD[bar]; const m=c[(pos>>1)%3]+12;
    tone(bgmBus,{type:'triangle', freq:mtof(m), start:t, dur:STEP*0.7, vol:0.035});
  }
  if(pos===2||pos===6) noise(bgmBus,{start:t, dur:0.03, vol:0.025, cutoff:5000}); // 아주 작은 하이햇
}
function bgmTick(){
  if(!ctx) return;
  while(nextTime < ctx.currentTime + 0.15){ scheduleStep(step, nextTime); nextTime += STEP; step++; }
}
function startBGM(){
  if(!ensureCtx() || bgmPlaying || !snd.on) return;
  if(ctx.state==='suspended') ctx.resume();
  bgmPlaying=true; nextTime=ctx.currentTime+0.1; step=0;
  bgmTimer=setInterval(bgmTick, 30);
  updateSoundBtn();
}
function stopBGM(){ if(bgmTimer){ clearInterval(bgmTimer); bgmTimer=null; } bgmPlaying=false; updateSoundBtn(); }

/* ---- 효과음 ---- */
const SFX = {
  click(){ const t=ctx.currentTime; tone(sfxBus,{type:'square', freq:1180, to:1560, start:t, dur:0.045, vol:0.10}); },
  insert(){ // 카트리지 장착: 찰칵 + 전원 켜지는 상승음
    const t=ctx.currentTime;
    noise(sfxBus,{start:t, dur:0.05, vol:0.35, cutoff:700});
    noise(sfxBus,{start:t+0.07, dur:0.04, vol:0.3, cutoff:1500});
    [72,76,79,84].forEach((m,i)=>tone(sfxBus,{type:'square', freq:mtof(m), start:t+0.14+i*0.055, dur:0.07, vol:0.11}));
  },
  move(){ // 화면 전환: 짧은 전자음
    const t=ctx.currentTime;
    tone(sfxBus,{type:'triangle', freq:660, to:1320, start:t, dur:0.09, vol:0.16});
    tone(sfxBus,{type:'square', freq:1320, start:t+0.09, dur:0.05, vol:0.06});
  },
  ok(){ const t=ctx.currentTime; [79,84].forEach((m,i)=>tone(sfxBus,{type:'square', freq:mtof(m), start:t+i*0.07, dur:0.08, vol:0.1})); },
};
function play(name){
  if(!snd.on) return;
  if(!ensureCtx()) return;
  if(ctx.state==='suspended') ctx.resume();
  try{ SFX[name] && SFX[name](); }catch(e){}
}

/* ---- 첫 터치 때 BGM 시작 (브라우저 자동재생 정책) ---- */
function unlock(){
  ensureCtx();
  if(ctx && ctx.state==='suspended') ctx.resume();
  if(snd.on) startBGM();
  window.removeEventListener('pointerdown', unlock, true);
  window.removeEventListener('keydown', unlock, true);
}
window.addEventListener('pointerdown', unlock, true);
window.addEventListener('keydown', unlock, true);
// 시도는 해봄 (이미 상호작용이 허용된 브라우저에서는 바로 재생)
window.addEventListener('load', ()=>{ try{ ensureCtx(); if(ctx && ctx.state==='running' && snd.on) startBGM(); }catch(e){} });
document.addEventListener('visibilitychange', ()=>{
  if(!ctx) return;
  if(document.hidden) ctx.suspend(); else if(snd.on) ctx.resume();
});

/* ---- 사운드 설정 패널 ---- */
let sndBtn, panel;
function updateSoundBtn(){
  if(!sndBtn) return;
  const state = !snd.on ? 'OFF' : (bgmPlaying ? 'ON' : 'TAP');
  sndBtn.querySelector('.sv').textContent = state;
  sndBtn.classList.toggle('off', !snd.on);
  sndBtn.classList.toggle('wait', snd.on && !bgmPlaying);
  sndBtn.setAttribute('aria-label', '사운드 설정 (현재 '+(snd.on?'켜짐':'꺼짐')+')');
}
function save(){ store.set('arcade_sound', snd); }
function mountSound(container){
  if(!container) return;
  container.innerHTML = `
    <button class="snd-btn" type="button" aria-haspopup="true" aria-expanded="false"><span class="note">♪</span><span class="sv">ON</span></button>
    <div class="snd-panel" role="dialog" aria-label="사운드 설정" hidden>
      <div class="sp-head"><b>SOUND</b>
        <label class="switch"><input type="checkbox" id="sndOn"><span></span></label></div>
      <label class="sp-row"><span>BGM</span><input type="range" min="0" max="100" step="1" id="sndBgm"><em id="sndBgmV"></em></label>
      <label class="sp-row"><span>효과음</span><input type="range" min="0" max="100" step="1" id="sndSfx"><em id="sndSfxV"></em></label>
      <p class="sp-note">8비트 BGM은 화면을 한 번 누르면 시작돼요.</p>
    </div>`;
  sndBtn = container.querySelector('.snd-btn'); panel = container.querySelector('.snd-panel');
  const on=panel.querySelector('#sndOn'), b=panel.querySelector('#sndBgm'), s=panel.querySelector('#sndSfx');
  const bv=panel.querySelector('#sndBgmV'), sv=panel.querySelector('#sndSfxV');
  const sync=()=>{ on.checked=snd.on; b.value=snd.bgm; s.value=snd.sfx; bv.textContent=snd.bgm; sv.textContent=snd.sfx; b.disabled=s.disabled=!snd.on; updateSoundBtn(); };
  sync();
  sndBtn.addEventListener('click', e=>{
    e.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open; sndBtn.setAttribute('aria-expanded', String(open));
    play('click');
  });
  on.addEventListener('change', ()=>{
    snd.on = on.checked; save(); applyVolumes();
    if(snd.on){ startBGM(); play('ok'); } else stopBGM();
    sync();
  });
  b.addEventListener('input', ()=>{ snd.bgm=+b.value; bv.textContent=snd.bgm; applyVolumes(); save(); });
  s.addEventListener('input', ()=>{ snd.sfx=+s.value; sv.textContent=snd.sfx; applyVolumes(); save(); });
  s.addEventListener('change', ()=>play('click'));
  panel.addEventListener('click', e=>e.stopPropagation());
  document.addEventListener('click', ()=>{ if(!panel.hidden){ panel.hidden=true; sndBtn.setAttribute('aria-expanded','false'); } });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !panel.hidden){ panel.hidden=true; sndBtn.focus(); } });
}

/* ---- 사운드 붙은 이동 ---- */
function navigateWithSound(a, sound, delay){
  a.addEventListener('click', e=>{
    if(e.defaultPrevented || e.button!==0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href=a.getAttribute('href'); if(!href) return;
    e.preventDefault(); play(sound);
    a.classList.add('inserting');
    setTimeout(()=>{ if(a.target==='_blank') window.open(href,'_blank','noopener'); else location.href=href; a.classList.remove('inserting'); }, snd.on ? delay : 0);
  });
}
// 일반 버튼 클릭음 (data-sfx="none"이면 제외)
document.addEventListener('click', e=>{
  const el=e.target.closest('button, .sns, .ui-link');
  if(!el || el.closest('.snd-panel') || el.classList.contains('snd-btn') || el.dataset.sfx==='none') return;
  play('click');
}, true);

/* =========================================================
   홈 화면 추가 (PWA)
   ========================================================= */
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredPrompt=e; });
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
function showModal(html){
  let m=document.getElementById('arcadeModal');
  if(!m){ m=document.createElement('div'); m.id='arcadeModal'; m.className='modal'; document.body.appendChild(m);
    m.addEventListener('click', e=>{ if(e.target===m || e.target.closest('[data-close]')) m.classList.remove('show'); }); }
  m.innerHTML=`<div class="modal-box" role="dialog" aria-modal="true">${html}</div>`;
  m.classList.add('show');
  return m;
}
async function installApp(){
  if(isStandalone()){ toast('이미 홈 화면에서 실행 중이에요!'); return; }
  if(deferredPrompt){
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice.catch(()=>null);
    deferredPrompt=null;
    if(r && r.outcome==='accepted'){ play('ok'); toast('홈 화면에 루미 오락실이 생겼어요!'); }
    return;
  }
  const ios = isIOS();
  showModal(`
    <div class="mh">홈 화면에 추가하기</div>
    <ol class="guide">
      ${ios
        ? `<li>Safari 아래(또는 위)의 <b>공유 버튼</b> <span class="kbd">□↑</span>을 눌러요</li><li>목록에서 <b>홈 화면에 추가</b>를 눌러요</li><li>오른쪽 위 <b>추가</b>를 누르면 끝!</li>`
        : `<li>브라우저 오른쪽 위 <b>메뉴</b> <span class="kbd">⋮</span>를 눌러요</li><li><b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요</li><li>노란 게임기 아이콘이 생기면 끝!</li>`}
    </ol>
    <button class="modal-ok" data-close>알겠어요</button>`);
}

/* =========================================================
   DEV LOG
   ========================================================= */
const TAGS = {
  MAKING:{ ko:'제작 비하인드',      color:'#e8417f', icon:'star'  },
  IDEA:  { ko:'아이디어 메모',      color:'#8a5cf6', icon:'bulb'  },
  DEV:   { ko:'개발·디자인 기록',   color:'#1f8fd6', icon:'tool'  },
  UPDATE:{ ko:'콘텐츠 업데이트',    color:'#1fa863', icon:'arrow' },
};
// 7x7 픽셀 아이콘
const PIX = {
  star: ['...#...','...#...','.#####.','#######','.#####.','.##.##.','##...##'],
  bulb: ['..###..','.#####.','.#####.','.#####.','..###..','..###..','...#...'],
  tool: ['....##.','...#..#','....###','...##..','..##...','.##....','##.....'],
  arrow:['...#...','..###..','.#####.','#######','..###..','..###..','..###..'],
};
function pixIcon(name, color){
  const g=PIX[name]||PIX.star; let r='';
  g.forEach((row,y)=>[...row].forEach((c,x)=>{ if(c==='#') r+=`<rect x="${x}" y="${y}" width="1" height="1"/>`; }));
  return `<svg class="pix" viewBox="0 0 7 7" fill="${color||'currentColor'}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = u => { try{ const x=new URL(u, location.href); return (x.protocol==='https:'||x.protocol==='http:') ? x.href : ''; }catch(e){ return ''; } };
function fmtDate(d){ const [y,m,dd]=String(d).split('-'); return `${y}.${m}.${dd}`; }
function sortLogs(list){ return [...list].sort((a,b)=> (b.date||'').localeCompare(a.date||'') || (b.id||'').localeCompare(a.id||'')); }

const PENDING_KEY='devlog_pending';
async function loadLogs(){
  let data=null;
  try{ const r=await fetch('devlog.json?t='+Date.now(), {cache:'no-store'}); if(r.ok) data=await r.json(); }catch(e){}
  if(!data) data={ updatedAt:'', entries:[] };
  // 방금 관리자 화면에서 저장한 내용은 깃허브 반영(약 1분) 전까지 로컬 사본을 우선 사용
  const p=store.get(PENDING_KEY, null);
  if(p && p.data && p.data.updatedAt > (data.updatedAt||'') && Date.now()-p.savedAt < 10*60*1000) data=p.data;
  data.entries = sortLogs(data.entries||[]);
  return data;
}

/* ---- 관리자: GitHub 토큰으로 devlog.json 직접 커밋 ---- */
const TOKEN_KEY='arcade_admin_token';
function getToken(){ try{ return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ''; }catch(e){ return ''; } }
function setToken(t, remember){ try{ sessionStorage.setItem(TOKEN_KEY,t); if(remember) localStorage.setItem(TOKEN_KEY,t); }catch(e){} }
function clearToken(){ try{ sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); }catch(e){} }
async function gh(path, opts={}){
  const r=await fetch('https://api.github.com'+path, Object.assign({}, opts, {
    headers:Object.assign({ 'Accept':'application/vnd.github+json', 'Authorization':'Bearer '+getToken(), 'X-GitHub-Api-Version':'2022-11-28' }, opts.headers||{}),
  }));
  if(!r.ok){ const t=await r.text().catch(()=> ''); const err=new Error('GitHub '+r.status); err.status=r.status; err.body=t; throw err; }
  return r.status===204 ? null : r.json();
}
async function verifyToken(t){
  const prev=getToken(); setToken(t,false);
  try{
    const u=await gh('/user');
    if(!u || String(u.login).toLowerCase()!==SITE.owner){ throw new Error('owner'); }
    return true;
  }catch(e){ if(prev) setToken(prev,false); else clearToken(); throw e; }
}
const b64e = s => btoa(unescape(encodeURIComponent(s)));
const b64d = s => decodeURIComponent(escape(atob(s.replace(/\n/g,''))));
async function readRemote(){
  const f=await gh(`/repos/${SITE.owner}/${SITE.repo}/contents/devlog.json?ref=${SITE.branch}&t=${Date.now()}`);
  return { sha:f.sha, data:JSON.parse(b64d(f.content)) };
}
async function writeRemote(mutate, message){
  const { sha, data } = await readRemote();          // 항상 최신본을 받아서 수정 → 덮어쓰기 방지
  data.entries = data.entries || [];
  mutate(data);
  data.updatedAt = new Date().toISOString();
  data.entries = sortLogs(data.entries);
  await gh(`/repos/${SITE.owner}/${SITE.repo}/contents/devlog.json`, {
    method:'PUT',
    body:JSON.stringify({ message, content:b64e(JSON.stringify(data, null, 2)+'\n'), sha, branch:SITE.branch }),
  });
  store.set(PENDING_KEY, { savedAt:Date.now(), data });
  return data;
}

/* ---------------- 공개 API ---------------- */
window.Arcade = {
  SITE, toast, copyText, play, mountSound, navigateWithSound, installApp, isStandalone, showModal,
  TAGS, pixIcon, esc, safeUrl, fmtDate, loadLogs,
  admin:{ getToken, setToken, clearToken, verifyToken, writeRemote },
};

/* 서비스워커 (홈 화면 앱용) */
if('serviceWorker' in navigator && location.protocol==='https:'){
  window.addEventListener('load', ()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
})();
