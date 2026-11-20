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
let toastEl, lastTapY=null, lastTapAt=0;
window.addEventListener('pointerdown', e=>{ lastTapY=e.clientY; lastTapAt=Date.now(); }, true);
function toast(msg){
  if(!toastEl){ toastEl=document.createElement('div'); toastEl.className='toast'; toastEl.setAttribute('role','status'); document.body.appendChild(toastEl); }
  // 방금 누른 곳 바로 위에 띄워 시선 이동을 줄임 (없으면 화면 위쪽)
  const h=window.innerHeight;
  const y = (lastTapY!=null && Date.now()-lastTapAt<4000) ? Math.max(16, Math.min(h-70, lastTapY-64)) : Math.round(h*0.2);
  toastEl.style.setProperty('--toast-y', y+'px');
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
  if(!ctx || ctx.state!=='running') return;
  if(nextTime < ctx.currentTime - 0.3) nextTime = ctx.currentTime + 0.05;   // 멈췄다 돌아오면 밀린 음을 몰아 치지 않게
  while(nextTime < ctx.currentTime + 0.15){ scheduleStep(step, nextTime); nextTime += STEP; step++; }
}
function startBGM(){
  if(!ensureCtx() || bgmPlaying || !snd.on) return;
  if(ctx.state!=='running'){ ctx.resume().then(()=>{ if(ctx.state==='running') startBGM(); }).catch(()=>{}); return; }
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

/* ---- 화면 아무 데나 한 번 누르면 바로 사운드 시작 ----
   브라우저는 사용자의 터치 '안에서'만 소리를 허용함.
   iOS는 touchend/click에서만 허용 → 여러 이벤트에서 시도하고, 실제로 켜졌을 때만 감지를 해제 */
const UNLOCK_EVENTS=['pointerdown','touchend','click','keydown'];
let unlocked=false;
function unlock(){
  if(unlocked) return;
  if(!ensureCtx()) return;
  // iOS용: 터치 안에서 무음 버퍼를 한 번 재생해 오디오 잠금 해제
  try{ const b=ctx.createBuffer(1,1,22050), s=ctx.createBufferSource(); s.buffer=b; s.connect(ctx.destination); s.start(0); }catch(e){}
  const done=()=>{
    if(unlocked || ctx.state!=='running') return;
    unlocked=true;
    UNLOCK_EVENTS.forEach(ev=>window.removeEventListener(ev, unlock, true));
    hideSoundHint();
    if(snd.on){
      startBGM();
      powerOn();
    }
    document.dispatchEvent(new CustomEvent('arcade:unlocked'));
  };
  if(ctx.state==='running') done(); else ctx.resume().then(done).catch(()=>{});
}
UNLOCK_EVENTS.forEach(ev=>window.addEventListener(ev, unlock, true));
function powerOn(){ // 전원 켜지는 짧은 효과음 → 소리가 있다는 걸 바로 알 수 있게
  try{ const t=ctx.currentTime; [60,64,67,72].forEach((m,i)=>tone(sfxBus,{type:'square', freq:mtof(m), start:t+i*0.06, dur:0.09, vol:0.09})); }catch(e){}
}

/* ---- "누르면 소리 나요" 안내 칩 ---- */
let hintEl=null;
function showSoundHint(){
  if(unlocked || !snd.on || hintEl) return;
  hintEl=document.createElement('div'); hintEl.className='snd-hint';
  hintEl.innerHTML='<span class="eq"><i></i><i></i><i></i></span>화면을 누르면 8비트 BGM이 켜져요';
  document.body.appendChild(hintEl);
  requestAnimationFrame(()=>hintEl && hintEl.classList.add('show'));
}
function hideSoundHint(){ if(!hintEl) return; const h=hintEl; hintEl=null; h.classList.remove('show'); setTimeout(()=>h.remove(),300); }
// (안내 칩은 사용하지 않음 — 첫 탭 때 전원 효과음 + ♪ TAP 깜빡임으로 알림)

/* ---- 다른 앱 갔다 돌아왔을 때 소리 복구 ----
   휴대폰은 백그라운드에서 오디오를 '중단' 상태로 만들고, 다시 켜려면 터치가 필요할 때가 많음.
   → 돌아오면 바로 재개 시도 + 실패하면 다음 터치에서 재개, 그래도 안 되면 오디오를 새로 만듦 */
function recreateAudio(){
  try{ if(bgmTimer){ clearInterval(bgmTimer); bgmTimer=null; } bgmPlaying=false; if(ctx) ctx.close().catch(()=>{}); }catch(e){}
  ctx=null; ensureCtx();
  if(ctx){ ctx.resume().catch(()=>{}); if(snd.on) startBGM(); }
}
function wake(fromGesture){
  if(!ctx || !unlocked || !snd.on) return;
  const after=()=>{
    if(ctx.state==='running'){ nextTime=ctx.currentTime+0.05; if(!bgmPlaying) startBGM(); updateSoundBtn(); return true; }
    return false;
  };
  if(ctx.state==='running'){ after(); return; }
  ctx.resume().then(()=>{ if(!after() && fromGesture) recreateAudio(); }).catch(()=>{ if(fromGesture) recreateAudio(); });
}
function wakeOnTouch(){ wake(true); }
['pointerdown','touchend','click','keydown'].forEach(ev=>window.addEventListener(ev, wakeOnTouch, true));
document.addEventListener('visibilitychange', ()=>{
  if(!ctx) return;
  if(document.hidden){ ctx.suspend().catch(()=>{}); }
  else wake(false);
});
window.addEventListener('pageshow', ()=>wake(false));
window.addEventListener('focus', ()=>wake(false));

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
    if(snd.on){ unlock(); startBGM(); play('ok'); } else { stopBGM(); hideSoundHint(); }
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
const isInApp = () => /Instagram|FBAN|FBAV|Twitter|KAKAOTALK|Line\/|NAVER\(inapp|everytimeApp/i.test(navigator.userAgent);
const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.maxTouchPoints>1 && window.innerWidth<900);
function guideHTML(){
  if(isInApp()) return `<li>오른쪽 위(또는 아래) <b>⋯ 메뉴</b>를 눌러요</li><li><b>다른 브라우저로 열기</b>(Safari/Chrome)를 눌러요</li><li>열린 화면에서 <b>홈 화면에 추가</b> 버튼을 다시 눌러요</li>`;
  if(isIOS()) return `<li>Safari 아래(또는 위)의 <b>공유 버튼</b> <span class="kbd">□↑</span>을 눌러요</li><li>목록을 내려 <b>홈 화면에 추가</b>를 눌러요</li><li>오른쪽 위 <b>추가</b>를 누르면 끝!</li>`;
  return `<li>브라우저 오른쪽 위 <b>메뉴</b> <span class="kbd">⋮</span>를 눌러요</li><li><b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요</li><li>노란 게임기 아이콘이 생기면 끝!</li>`;
}
async function installApp(){
  if(isStandalone()){ toast('이미 앱으로 실행 중이에요!'); return; }
  closeSheet(true);
  if(deferredPrompt && !isInApp()){
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice.catch(()=>null);
    deferredPrompt=null;
    if(r && r.outcome==='accepted'){ play('ok'); toast('홈 화면에 루미 오락실이 생겼어요!'); store.set('arcade_installed', true); }
    return;
  }
  showModal(`<div class="mh">홈 화면에 추가하기</div><ol class="guide">${guideHTML()}</ol><button class="modal-ok" data-close>알겠어요</button>`);
}

/* ---- 앱처럼 쓰세요 팝업 (모바일, 처음 방문 시) ---- */
const SHEET_KEY='arcade_sheet_dismissed';
let sheetEl=null;
function closeSheet(remember){
  if(remember) store.set(SHEET_KEY, Date.now());
  if(!sheetEl) return; const s=sheetEl; sheetEl=null; s.classList.remove('show'); setTimeout(()=>s.remove(),300);
}
function showInstallSheet(force){
  if(sheetEl || isStandalone() || store.get('arcade_installed', false)) return;
  if(!force){
    if(!isMobile()) return;
    const d=store.get(SHEET_KEY, 0); if(d && Date.now()-d < 7*864e5) return;
  }
  hideSoundHint();
  sheetEl=document.createElement('div'); sheetEl.className='sheet'; sheetEl.setAttribute('role','dialog'); sheetEl.setAttribute('aria-label','홈 화면에 추가');
  sheetEl.innerHTML=`
    <div class="sh-in">
      <img src="/icon-192.png" alt="" class="sh-icon">
      <div class="sh-txt"><b>루미 오락실, 앱처럼 쓰세요!</b><span>홈 화면에 추가하면 아이콘 한 번으로 바로 입장해요</span></div>
      <button class="sh-x" type="button" aria-label="닫기" data-sfx="none">×</button>
    </div>
    <div class="sh-btns"><button class="sh-later" type="button">나중에</button><button class="sh-add" type="button">＋ 홈 화면에 추가</button></div>`;
  document.body.appendChild(sheetEl);
  sheetEl.querySelector('.sh-x').onclick=()=>closeSheet(true);
  sheetEl.querySelector('.sh-later').onclick=()=>closeSheet(true);
  sheetEl.querySelector('.sh-add').onclick=installApp;
  requestAnimationFrame(()=>sheetEl && sheetEl.classList.add('show'));
}
/* 설치 창 자동 띄우기: 브라우저가 '사용자 터치 안에서만' 허용하므로,
   첫 빈 공간 탭(링크·버튼 제외)에 맞춰 기본 설치 창을 바로 띄움. 안드로이드 Chrome 계열만 가능 */
function autoInstall(e){
  if(!deferredPrompt || isStandalone() || isInApp()) return;
  if(e.target.closest('a, button, input, label, .snd, .modal')) return;
  const d=store.get(SHEET_KEY, 0); if(d && Date.now()-d < 7*864e5) return;
  window.removeEventListener('click', autoInstall, true);
  store.set(SHEET_KEY, Date.now());               // 거절해도 7일간 다시 안 띄움
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(r=>{ if(r && r.outcome==='accepted'){ store.set('arcade_installed', true); toast('홈 화면에 추가 완료!'); } }).catch(()=>{});
  deferredPrompt=null;
}
window.addEventListener('click', autoInstall, true);
window.addEventListener('appinstalled', ()=>{ store.set('arcade_installed', true); closeSheet(false); });

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

/* ---- 비밀번호 금고: 토큰을 비밀번호로 암호화해 admin.enc.json에 보관 ----
   PBKDF2(SHA-256, 60만 회) → AES-GCM. 비밀번호 없이는 토큰을 꺼낼 수 없음 */
const u8 = b => new Uint8Array(b);
const toB64 = b => btoa(String.fromCharCode(...u8(b)));
const fromB64 = s => Uint8Array.from(atob(s), c=>c.charCodeAt(0));
async function deriveKey(pw, salt, iter){
  const base=await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:iter, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
async function sealToken(token, pw){
  const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12)), iter=600000;
  const key=await deriveKey(pw, salt, iter);
  const ct=await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, new TextEncoder().encode(token));
  return { v:1, alg:'PBKDF2-SHA256/AES-GCM', iter, salt:toB64(salt), iv:toB64(iv), ct:toB64(ct) };
}
async function openVault(v, pw){
  const key=await deriveKey(pw, fromB64(v.salt), v.iter);
  const pt=await crypto.subtle.decrypt({name:'AES-GCM', iv:fromB64(v.iv)}, key, fromB64(v.ct));
  return new TextDecoder().decode(pt);
}
async function loadVault(){
  const p=store.get('arcade_vault_pending', null);
  try{ const r=await fetch('/admin.enc.json?t='+Date.now(), {cache:'no-store'}); if(r.ok) return await r.json(); }catch(e){}
  return p; // 막 설정한 직후(깃허브 반영 전)엔 로컬 사본
}
async function saveVault(v){
  let sha;
  try{ const f=await gh(`/repos/${SITE.owner}/${SITE.repo}/contents/admin.enc.json?ref=${SITE.branch}&t=${Date.now()}`); sha=f.sha; }catch(e){ if(e.status!==404) throw e; }
  await gh(`/repos/${SITE.owner}/${SITE.repo}/contents/admin.enc.json`, { method:'PUT',
    body:JSON.stringify(Object.assign({ message:'admin: update password vault', content:b64e(JSON.stringify(v,null,2)+'\n'), branch:SITE.branch }, sha?{sha}:{})) });
  store.set('arcade_vault_pending', v);
}
async function loginWithPassword(pw, remember){
  const v=await loadVault(); if(!v) { const e=new Error('novault'); throw e; }
  let t; try{ t=await openVault(v, pw); }catch(e){ const er=new Error('badpw'); throw er; }
  await verifyToken(t); setToken(t, remember); return true;
}
async function setupPassword(token, pw, remember){
  await verifyToken(token); setToken(token, remember);
  const v=await sealToken(token, pw); await saveVault(v); return true;
}

/* 누른 글자를 잠깐 바꿔서 결과를 보여줌 (겹치는 알림 대신) */
function flash(el, text, ms){
  if(!el) return;
  if(el._flashT){ clearTimeout(el._flashT); } else { el._orig = el.innerHTML; }
  el.textContent = text; el.classList.add('flashing');
  el._flashT = setTimeout(()=>{ el.innerHTML = el._orig; el.classList.remove('flashing'); el._flashT = null; }, ms||1800);
}

/* 탭한 자리에 픽셀 반짝이 */
const SPARK=['#ffd23f','#ff4f9a','#4fc3ff','#9bff6b'];
window.addEventListener('pointerdown', e=>{
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if(e.target.closest('input, textarea, select, .modal-box')) return;
  for(let k=0;k<6;k++){
    const s=document.createElement('i'); s.className='spark';
    const a=(Math.PI*2*k/6)+Math.random()*.5, r=18+Math.random()*14;
    s.style.left=(e.clientX-3)+'px'; s.style.top=(e.clientY-3)+'px';
    s.style.background=SPARK[k%SPARK.length];
    s.style.setProperty('--dx', Math.cos(a)*r+'px'); s.style.setProperty('--dy', Math.sin(a)*r+'px');
    document.body.appendChild(s); setTimeout(()=>s.remove(), 520);
  }
}, {passive:true});

/* ---------------- 공개 API ---------------- */
window.Arcade = {
  SITE, toast, flash, copyText, play, audioState:()=>({state:ctx&&ctx.state, playing:bgmPlaying, _suspend:()=>ctx&&ctx.suspend()}), mountSound, navigateWithSound, installApp, isStandalone, showModal, showInstallSheet,
  TAGS, pixIcon, esc, safeUrl, fmtDate, loadLogs,
  admin:{ getToken, setToken, clearToken, verifyToken, writeRemote, loadVault, loginWithPassword, setupPassword },
};

/* 서비스워커 (홈 화면 앱용) */
if('serviceWorker' in navigator && location.protocol==='https:'){
  window.addEventListener('load', ()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
})();
