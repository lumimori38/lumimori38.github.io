(function() {
  "use strict";
  const SITE = {
    owner: "lumimori38",
    repo: "lumimori38.github.io",
    branch: "main",
    url: "https://lumimori38.github.io/"
  };
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {}
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch (e) {}
    }
  };
  let toastEl, lastTapY = null, lastTapAt = 0;
  window.addEventListener("pointerdown", e => {
    lastTapY = e.clientY;
    lastTapAt = Date.now();
  }, true);
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    const h = window.innerHeight;
    const y = lastTapY != null && Date.now() - lastTapAt < 4e3 ? Math.max(16, Math.min(h - 70, lastTapY - 64)) : Math.round(h * .2);
    toastEl.style.setProperty("--toast-y", y + "px");
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 1900);
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const t = document.createElement("textarea");
        t.value = text;
        t.style.position = "fixed";
        t.style.opacity = "0";
        document.body.appendChild(t);
        t.select();
        const ok = document.execCommand("copy");
        t.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }
  const DEFAULT_SND = {
    on: true,
    bgm: 30,
    sfx: 60
  };
  const snd = Object.assign({}, DEFAULT_SND, store.get("arcade_sound", {}));
  let ctx = null, master, bgmBus, sfxBus, bgmTimer = null, bgmPlaying = false, nextTime = 0, step = 0;
  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC;
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    bgmBus = ctx.createGain();
    sfxBus = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2400;
    lp.Q.value = .3;
    bgmBus.connect(lp);
    lp.connect(master);
    sfxBus.connect(master);
    applyVolumes();
    return ctx;
  }
  function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const on = snd.on ? 1 : 0;
    bgmBus.gain.setTargetAtTime(on * Math.pow(snd.bgm / 100, 1.6) * .55, t, .05);
    sfxBus.gain.setTargetAtTime(on * Math.pow(snd.sfx / 100, 1.3) * .9, t, .02);
  }
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  function tone(bus, {type: type = "square", freq: freq = 440, to: to = null, start: start, dur: dur = .1, vol: vol = .2, attack: attack = .004, release: release = .06}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (to) o.frequency.exponentialRampToValueAtTime(to, start + dur);
    g.gain.setValueAtTime(1e-4, start);
    g.gain.exponentialRampToValueAtTime(vol, start + attack);
    g.gain.setValueAtTime(vol, start + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(1e-4, start + dur);
    o.connect(g);
    g.connect(bus);
    o.start(start);
    o.stop(start + dur + .02);
  }
  function noise(bus, {start: start, dur: dur = .06, vol: vol = .15, cutoff: cutoff = 1200}) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    s.connect(f);
    f.connect(g);
    g.connect(bus);
    s.start(start);
  }
  const BPM = 88, STEP = 60 / BPM / 2;
  const _ = null;
  const LEAD = [ 76, _, 79, _, 76, 74, 72, _, 74, _, 76, _, 72, _, 69, _, 72, _, 74, 77, 76, _, 74, _, 74, _, 71, _, 74, 76, 79, _, 76, _, 79, _, 81, 79, 76, _, 74, _, 76, _, 72, _, 69, _, 72, _, 74, _, 77, 76, 74, _, 71, _, 74, _, 72, _, _, _ ];
  const BASS_ROOT = [ 48, 45, 41, 43, 48, 45, 41, 43 ];
  const CHORD = [ [ 60, 64, 67 ], [ 57, 60, 64 ], [ 53, 57, 60 ], [ 55, 59, 62 ], [ 60, 64, 67 ], [ 57, 60, 64 ], [ 53, 57, 60 ], [ 55, 59, 62 ] ];
  function scheduleStep(i, t) {
    const bar = Math.floor(i / 8) % 8, pos = i % 8;
    const n = LEAD[i % LEAD.length];
    if (n) tone(bgmBus, {
      type: "square",
      freq: mtof(n),
      start: t,
      dur: STEP * 1.6,
      vol: .045,
      release: .12
    });
    if (pos === 0 || pos === 4) {
      const r = BASS_ROOT[bar] + (pos === 4 ? 7 : 0);
      tone(bgmBus, {
        type: "triangle",
        freq: mtof(r),
        start: t,
        dur: STEP * 1.8,
        vol: .16,
        release: .15
      });
    }
    if (pos % 2 === 1) {
      const c = CHORD[bar];
      const m = c[(pos >> 1) % 3] + 12;
      tone(bgmBus, {
        type: "triangle",
        freq: mtof(m),
        start: t,
        dur: STEP * .7,
        vol: .035
      });
    }
    if (pos === 2 || pos === 6) noise(bgmBus, {
      start: t,
      dur: .03,
      vol: .025,
      cutoff: 5e3
    });
  }
  function bgmTick() {
    if (!ctx || ctx.state !== "running") return;
    if (nextTime < ctx.currentTime - .3) nextTime = ctx.currentTime + .05;
    while (nextTime < ctx.currentTime + .15) {
      scheduleStep(step, nextTime);
      nextTime += STEP;
      step++;
    }
  }
  function startBGM() {
    if (!ensureCtx() || !snd.on) return;
    if (bgmTimer) return;
    bgmPlaying = true;
    nextTime = ctx.currentTime + .1;
    step = 0;
    bgmTimer = setInterval(bgmTick, 30);
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    updateSoundBtn();
  }
  function stopBGM() {
    if (bgmTimer) {
      clearInterval(bgmTimer);
      bgmTimer = null;
    }
    bgmPlaying = false;
    updateSoundBtn();
  }
  const SFX = {
    click() {
      const t = ctx.currentTime;
      tone(sfxBus, {
        type: "square",
        freq: 1180,
        to: 1560,
        start: t,
        dur: .045,
        vol: .1
      });
    },
    insert() {
      const t = ctx.currentTime;
      noise(sfxBus, {
        start: t,
        dur: .05,
        vol: .35,
        cutoff: 700
      });
      noise(sfxBus, {
        start: t + .07,
        dur: .04,
        vol: .3,
        cutoff: 1500
      });
      [ 72, 76, 79, 84 ].forEach((m, i) => tone(sfxBus, {
        type: "square",
        freq: mtof(m),
        start: t + .14 + i * .055,
        dur: .07,
        vol: .11
      }));
    },
    move() {
      const t = ctx.currentTime;
      tone(sfxBus, {
        type: "triangle",
        freq: 660,
        to: 1320,
        start: t,
        dur: .09,
        vol: .16
      });
      tone(sfxBus, {
        type: "square",
        freq: 1320,
        start: t + .09,
        dur: .05,
        vol: .06
      });
    },
    ok() {
      const t = ctx.currentTime;
      [ 79, 84 ].forEach((m, i) => tone(sfxBus, {
        type: "square",
        freq: mtof(m),
        start: t + i * .07,
        dur: .08,
        vol: .1
      }));
    }
  };
  function play(name) {
    if (!snd.on) return;
    if (!ensureCtx()) return;
    if (ctx.state === "suspended") ctx.resume();
    try {
      SFX[name] && SFX[name]();
    } catch (e) {}
  }
  const UNLOCK_EVENTS = [ "pointerdown", "touchend", "click", "keydown" ];
  let unlocked = false;
  function unlock() {
    if (unlocked) return;
    if (!ensureCtx()) return;
    try {
      const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch (e) {}
    const done = () => {
      if (unlocked || ctx.state !== "running") return;
      unlocked = true;
      UNLOCK_EVENTS.forEach(ev => window.removeEventListener(ev, unlock, true));
      hideSoundHint();
      if (snd.on) {
        startBGM();
        powerOn();
      }
      document.dispatchEvent(new CustomEvent("arcade:unlocked"));
    };
    if (ctx.state === "running") done(); else ctx.resume().then(done).catch(() => {});
  }
  UNLOCK_EVENTS.forEach(ev => window.addEventListener(ev, unlock, true));
  function powerOn() {
    try {
      const t = ctx.currentTime;
      [ 60, 64, 67, 72 ].forEach((m, i) => tone(sfxBus, {
        type: "square",
        freq: mtof(m),
        start: t + i * .06,
        dur: .09,
        vol: .09
      }));
    } catch (e) {}
  }
  let hintEl = null;
  function showSoundHint() {
    if (unlocked || !snd.on || hintEl) return;
    hintEl = document.createElement("div");
    hintEl.className = "snd-hint";
    hintEl.innerHTML = '<span class="eq"><i></i><i></i><i></i></span>화면을 누르면 8비트 BGM이 켜져요';
    document.body.appendChild(hintEl);
    requestAnimationFrame(() => hintEl && hintEl.classList.add("show"));
  }
  function hideSoundHint() {
    if (!hintEl) return;
    const h = hintEl;
    hintEl = null;
    h.classList.remove("show");
    setTimeout(() => h.remove(), 300);
  }
  let rebuilding = false;
  function rebuildAudio() {
    if (rebuilding) return;
    rebuilding = true;
    try {
      if (bgmTimer) {
        clearInterval(bgmTimer);
        bgmTimer = null;
      }
      bgmPlaying = false;
      const old = ctx;
      ctx = null;
      if (old) {
        try {
          old.close();
        } catch (e) {}
      }
      ensureCtx();
      try {
        const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
      } catch (e) {}
      ctx.resume().catch(() => {});
      startBGM();
    } finally {
      rebuilding = false;
    }
  }
  function wake() {
    if (!ctx || !unlocked || !snd.on) return;
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    if (!bgmTimer) startBGM();
  }
  function wakeOnTap(e) {
    if (!ctx || !unlocked || !snd.on) return;
    if (e.type === "pointerdown" && e.pointerType !== "mouse") return;
    if (ctx.state === "running") {
      if (!bgmTimer) startBGM();
      return;
    }
    rebuildAudio();
  }
  [ "pointerdown", "touchend", "keydown" ].forEach(ev => window.addEventListener(ev, wakeOnTap, true));
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) {
      ctx.suspend().catch(() => {});
    } else wake();
  });
  window.addEventListener("pageshow", wake);
  window.addEventListener("focus", wake);
  let sndBtn, panel;
  function updateSoundBtn() {
    if (!sndBtn) return;
    const state = !snd.on ? "OFF" : bgmPlaying ? "ON" : "TAP";
    sndBtn.querySelector(".sv").textContent = state;
    sndBtn.classList.toggle("off", !snd.on);
    sndBtn.classList.toggle("wait", snd.on && !bgmPlaying);
    sndBtn.setAttribute("aria-label", "사운드 설정 (현재 " + (snd.on ? "켜짐" : "꺼짐") + ")");
  }
  function save() {
    store.set("arcade_sound", snd);
  }
  function mountSound(container) {
    if (!container) return;
    container.innerHTML = `\n    <button class="snd-btn" type="button" aria-haspopup="true" aria-expanded="false"><span class="note">♪</span><span class="sv">ON</span></button>\n    <div class="snd-panel" role="dialog" aria-label="사운드 설정" hidden>\n      <div class="sp-head"><b>SOUND</b>\n        <label class="switch"><input type="checkbox" id="sndOn"><span></span></label></div>\n      <label class="sp-row"><span>BGM</span><input type="range" min="0" max="100" step="1" id="sndBgm"><em id="sndBgmV"></em></label>\n      <label class="sp-row"><span>효과음</span><input type="range" min="0" max="100" step="1" id="sndSfx"><em id="sndSfxV"></em></label>\n      <p class="sp-note">8비트 BGM은 화면을 한 번 누르면 시작돼요.</p>\n    </div>`;
    sndBtn = container.querySelector(".snd-btn");
    panel = container.querySelector(".snd-panel");
    const on = panel.querySelector("#sndOn"), b = panel.querySelector("#sndBgm"), s = panel.querySelector("#sndSfx");
    const bv = panel.querySelector("#sndBgmV"), sv = panel.querySelector("#sndSfxV");
    const sync = () => {
      on.checked = snd.on;
      b.value = snd.bgm;
      s.value = snd.sfx;
      bv.textContent = snd.bgm;
      sv.textContent = snd.sfx;
      b.disabled = s.disabled = !snd.on;
      updateSoundBtn();
    };
    sync();
    sndBtn.addEventListener("click", e => {
      e.stopPropagation();
      const open = panel.hidden;
      panel.hidden = !open;
      sndBtn.setAttribute("aria-expanded", String(open));
      play("click");
    });
    on.addEventListener("change", () => {
      snd.on = on.checked;
      save();
      applyVolumes();
      if (snd.on) {
        unlock();
        startBGM();
        play("ok");
      } else {
        stopBGM();
        hideSoundHint();
      }
      sync();
    });
    b.addEventListener("input", () => {
      snd.bgm = +b.value;
      bv.textContent = snd.bgm;
      applyVolumes();
      save();
    });
    s.addEventListener("input", () => {
      snd.sfx = +s.value;
      sv.textContent = snd.sfx;
      applyVolumes();
      save();
    });
    s.addEventListener("change", () => play("click"));
    panel.addEventListener("click", e => e.stopPropagation());
    document.addEventListener("click", () => {
      if (!panel.hidden) {
        panel.hidden = true;
        sndBtn.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !panel.hidden) {
        panel.hidden = true;
        sndBtn.focus();
      }
    });
  }
  function navigateWithSound(a, sound, delay) {
    a.addEventListener("click", e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const href = a.getAttribute("href");
      if (!href) return;
      e.preventDefault();
      play(sound);
      a.classList.add("inserting");
      setTimeout(() => {
        if (a.target === "_blank") window.open(href, "_blank", "noopener"); else location.href = href;
        a.classList.remove("inserting");
      }, snd.on ? delay : 0);
    });
  }
  document.addEventListener("click", e => {
    const el = e.target.closest("button, .sns, .ui-link");
    if (!el || el.closest(".snd-panel") || el.classList.contains("snd-btn") || el.dataset.sfx === "none") return;
    play("click");
  }, true);
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredPrompt = e;
  });
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  function showModal(html) {
    let m = document.getElementById("arcadeModal");
    if (!m) {
      m = document.createElement("div");
      m.id = "arcadeModal";
      m.className = "modal";
      document.body.appendChild(m);
      m.addEventListener("click", e => {
        if (e.target === m || e.target.closest("[data-close]")) m.classList.remove("show");
      });
    }
    m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">${html}</div>`;
    m.classList.add("show");
    return m;
  }
  const isInApp = () => /Instagram|FBAN|FBAV|Twitter|KAKAOTALK|Line\/|NAVER\(inapp|everytimeApp/i.test(navigator.userAgent);
  const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && window.innerWidth < 900;
  function guideHTML() {
    if (isInApp()) return `<li>오른쪽 위(또는 아래) <b>⋯ 메뉴</b>를 눌러요</li><li><b>다른 브라우저로 열기</b>(Safari/Chrome)를 눌러요</li><li>열린 화면에서 <b>홈 화면에 추가</b> 버튼을 다시 눌러요</li>`;
    if (isIOS()) return `<li>Safari 아래(또는 위)의 <b>공유 버튼</b> <span class="kbd">□↑</span>을 눌러요</li><li>목록을 내려 <b>홈 화면에 추가</b>를 눌러요</li><li>오른쪽 위 <b>추가</b>를 누르면 끝!</li>`;
    return `<li>브라우저 오른쪽 위 <b>메뉴</b> <span class="kbd">⋮</span>를 눌러요</li><li><b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요</li><li>노란 게임기 아이콘이 생기면 끝!</li>`;
  }
  async function installApp() {
    if (isStandalone()) {
      toast("이미 앱으로 실행 중이에요!");
      return;
    }
    closeSheet(true);
    if (deferredPrompt && !isInApp()) {
      deferredPrompt.prompt();
      const r = await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
      if (r && r.outcome === "accepted") {
        play("ok");
        toast("홈 화면에 루미 오락실이 생겼어요!");
        store.set("arcade_installed", true);
      }
      return;
    }
    showModal(`<div class="mh">홈 화면에 추가하기</div><ol class="guide">${guideHTML()}</ol><button class="modal-ok" data-close>알겠어요</button>`);
  }
  const SHEET_KEY = "arcade_sheet_dismissed";
  let sheetEl = null;
  function closeSheet(remember) {
    if (remember) store.set(SHEET_KEY, Date.now());
    if (!sheetEl) return;
    const s = sheetEl;
    sheetEl = null;
    s.classList.remove("show");
    setTimeout(() => s.remove(), 300);
  }
  function showInstallSheet(force) {
    if (sheetEl || isStandalone() || store.get("arcade_installed", false)) return;
    if (!force) {
      if (!isMobile()) return;
      const d = store.get(SHEET_KEY, 0);
      if (d && Date.now() - d < 7 * 864e5) return;
    }
    hideSoundHint();
    sheetEl = document.createElement("div");
    sheetEl.className = "sheet";
    sheetEl.setAttribute("role", "dialog");
    sheetEl.setAttribute("aria-label", "홈 화면에 추가");
    sheetEl.innerHTML = `\n    <div class="sh-in">\n      <img src="/icon-192.png" alt="" class="sh-icon">\n      <div class="sh-txt"><b>루미 오락실, 앱처럼 쓰세요!</b><span>홈 화면에 추가하면 아이콘 한 번으로 바로 입장해요</span></div>\n      <button class="sh-x" type="button" aria-label="닫기" data-sfx="none">×</button>\n    </div>\n    <div class="sh-btns"><button class="sh-later" type="button">나중에</button><button class="sh-add" type="button">＋ 홈 화면에 추가</button></div>`;
    document.body.appendChild(sheetEl);
    sheetEl.querySelector(".sh-x").onclick = () => closeSheet(true);
    sheetEl.querySelector(".sh-later").onclick = () => closeSheet(true);
    sheetEl.querySelector(".sh-add").onclick = installApp;
    requestAnimationFrame(() => sheetEl && sheetEl.classList.add("show"));
  }
  function autoInstall(e) {
    if (!deferredPrompt || isStandalone() || isInApp()) return;
    if (e.target.closest("a, button, input, label, .snd, .modal")) return;
    const d = store.get(SHEET_KEY, 0);
    if (d && Date.now() - d < 7 * 864e5) return;
    window.removeEventListener("click", autoInstall, true);
    store.set(SHEET_KEY, Date.now());
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(r => {
      if (r && r.outcome === "accepted") {
        store.set("arcade_installed", true);
        toast("홈 화면에 추가 완료!");
      }
    }).catch(() => {});
    deferredPrompt = null;
  }
  window.addEventListener("click", autoInstall, true);
  window.addEventListener("appinstalled", () => {
    store.set("arcade_installed", true);
    closeSheet(false);
  });
  const TAGS = {
    UPDATE: {
      ko: "콘텐츠 업데이트",
      color: "#1fa863",
      icon: "arrow"
    },
    DEV: {
      ko: "개발·디자인 기록",
      color: "#1f8fd6",
      icon: "tool"
    },
    TMI: {
      ko: "운영자 TMI",
      color: "#e8417f",
      icon: "talk"
    }
  };
  const PIX = {
    star: [ "...#...", "...#...", ".#####.", "#######", ".#####.", ".##.##.", "##...##" ],
    bulb: [ "..###..", ".#####.", ".#####.", ".#####.", "..###..", "..###..", "...#..." ],
    tool: [ "....##.", "...#..#", "....###", "...##..", "..##...", ".##....", "##....." ],
    arrow: [ "...#...", "..###..", ".#####.", "#######", "..###..", "..###..", "..###.." ],
    talk: [ "#######", "#######", "#.#.#.#", "#######", "#######", ".##....", ".#....." ]
  };
  function pixIcon(name, color) {
    const g = PIX[name] || PIX.star;
    let r = "";
    g.forEach((row, y) => [ ...row ].forEach((c, x) => {
      if (c === "#") r += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }));
    return `<svg class="pix" viewBox="0 0 7 7" fill="${color || "currentColor"}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
  }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
  const safeUrl = u => {
    try {
      const x = new URL(u, location.href);
      return x.protocol === "https:" || x.protocol === "http:" ? x.href : "";
    } catch (e) {
      return "";
    }
  };
  function fmtDate(d) {
    const [y, m, dd] = String(d).split("-");
    return `${y}.${m}.${dd}`;
  }
  function sortLogs(list) {
    return [ ...list ].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.id || "").localeCompare(a.id || ""));
  }
  async function loadLogs() {
    let data = null;
    try {
      const r = await fetch("/devlog.json?t=" + Date.now(), {
        cache: "no-store"
      });
      if (r.ok) data = await r.json();
    } catch (e) {}
    if (!data) data = {
      entries: []
    };
    data.entries = sortLogs(data.entries || []);
    return data;
  }
  function flash(el, text, ms) {
    if (!el) return;
    if (el._flashT) {
      clearTimeout(el._flashT);
    } else {
      el._orig = el.innerHTML;
    }
    el.textContent = text;
    el.classList.add("flashing");
    el._flashT = setTimeout(() => {
      el.innerHTML = el._orig;
      el.classList.remove("flashing");
      el._flashT = null;
    }, ms || 1800);
  }
  const SPARK = [ "#ffd23f", "#ff4f9a", "#4fc3ff", "#9bff6b" ];
  window.addEventListener("pointerdown", e => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (e.target.closest("input, textarea, select, .modal-box")) return;
    for (let k = 0; k < 6; k++) {
      const s = document.createElement("i");
      s.className = "spark";
      const a = Math.PI * 2 * k / 6 + Math.random() * .5, r = 18 + Math.random() * 14;
      s.style.left = e.clientX - 3 + "px";
      s.style.top = e.clientY - 3 + "px";
      s.style.background = SPARK[k % SPARK.length];
      s.style.setProperty("--dx", Math.cos(a) * r + "px");
      s.style.setProperty("--dy", Math.sin(a) * r + "px");
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 520);
    }
  }, {
    passive: true
  });
  window.Arcade = {
    SITE: SITE,
    toast: toast,
    flash: flash,
    copyText: copyText,
    play: play,
    mountSound: mountSound,
    navigateWithSound: navigateWithSound,
    installApp: installApp,
    isStandalone: isStandalone,
    showModal: showModal,
    showInstallSheet: showInstallSheet,
    TAGS: TAGS,
    pixIcon: pixIcon,
    esc: esc,
    safeUrl: safeUrl,
    fmtDate: fmtDate,
    sortLogs: sortLogs,
    loadLogs: loadLogs
  };
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
})();
