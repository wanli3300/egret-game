/* V6: presentation and navigation only. Combat and card effects remain original. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), root = $('wrap');
  const art = 'assets/ui-v6/';
  const originalSetScreen = setScreen, originalShowOverlay = showOverlay;
  const originalCloseCards = closeCardPicker, originalPickCard = pickCard;
  const originalRefresh = refreshCards, originalNightSync = syncNightControls;
  let ready = false, view = 'menu', selectedSave = 0, selectedLevel = 1;
  let saveEntries = [], transitionTimer, switchTimer, introFrame;
  let fadeStarted = false, idlePlaying = false, downloading = false;
  let homeFX = null;
  const legacy = document.createElement('div');
  legacy.id = 'legacyHome'; legacy.hidden = true; legacy.inert = true;
  // Keep old adapter anchors alive without exposing obsolete home controls.
  while ($('screen-menu').firstChild) legacy.appendChild($('screen-menu').firstChild);
  $('screen-menu').appendChild(legacy);
  root.classList.add('ink-edition');
  const height = 1280 * 900 / 1748;
  fitStage = () => root.style.setProperty('--fit', Math.min(innerWidth / 1280, innerHeight / height));
  addEventListener('resize', fitStage); fitStage();
  // Stop the superseded home canvas effects; the supplied videos own this scene.
  drawHomeScene = drawHomeArrival = drawHomeSword = beginHomeArrival = () => {};
  root.insertAdjacentHTML('afterbegin', `<div id="cinema" aria-hidden="true">
    <video id="homeIdle" muted playsinline preload="auto" loop><source src="${art}idle.mp4" type="video/mp4"></video>
    <video id="homeIntro" muted playsinline preload="auto" autoplay><source src="${art}intro.mp4" type="video/mp4"></video>
  </div>`);
  const intro = $('homeIntro'), idle = $('homeIdle');
  function finishStartup() {
    document.documentElement.classList.remove('egret-booting');
    root.removeAttribute('inert');
  }
  function afterPresentedFrame(video, callback) {
    let done=false, videoFrame=null, paintFrame=null, guard=null;
    // Watchdog: rVFC/rAF can stall (occluded or throttled window); never block the menu on it.
    guard=setTimeout(()=>{if(done||video.error)return;done=true;cleanup();callback();},3000);
    const finish=()=>{
      if(done||video.readyState<2||video.error)return;
      done=true;cleanup();callback();
    };
    const cleanup=()=>{
      video.removeEventListener('loadeddata',queue);
      if(guard!==null){clearTimeout(guard);guard=null;}
      if(videoFrame!==null)video.cancelVideoFrameCallback?.(videoFrame);
      if(paintFrame!==null)cancelAnimationFrame(paintFrame);
    };
    const queue=()=>{
      if(done||video.readyState<2||video.error)return;
      if(video.requestVideoFrameCallback)videoFrame=video.requestVideoFrameCallback(finish);
      // HAVE_CURRENT_DATA plus two paint turns also covers a fully occluded video.
      paintFrame=requestAnimationFrame(()=>{paintFrame=requestAnimationFrame(finish);});
    };
    video.addEventListener('loadeddata',queue,{once:true});queue();
    return ()=>{done=true;cleanup();};
  }
  const cancelIntroReveal=afterPresentedFrame(intro,finishStartup);
  let cancelIdleReveal=null;
  $('screen-menu').insertAdjacentHTML('beforeend', '<nav id="homeActions" aria-label="主菜单"></nav><p id="cinemaStatus" role="status" hidden></p>');
  const start = $('btnStart'); start.className = 'homeHotspot'; start.innerHTML = '<span class="sr-only">开始游戏</span>'; start.disabled = true;
  $('homeActions').appendChild(start);
  $('homeActions').insertAdjacentHTML('beforeend', '<button id="btnSettings" class="homeHotspot" aria-label="设置" disabled><span class="sr-only">设置</span></button>');

  function heading(screen, title, reference) {
    screen.insertAdjacentHTML('afterbegin', `<button class="ink-back" aria-label="返回">← 返回</button><h1 class="ink-heading ref-${reference}"><span class="sr-only">${title}</span></h1><div class="ink-rule heading-rule" aria-hidden="true"><span>❖</span></div>`);
  }
  const saves = $('screen-saves'), levels = $('screen-select');
  saves.replaceChildren(); levels.replaceChildren();
  saves.classList.add('ink-page'); levels.classList.add('ink-page');
  heading(saves, '选择存档', 2); heading(levels, '选择关卡', 3);
  saves.insertAdjacentHTML('beforeend', `<div class="ink-content"><button id="savePrev" class="ink-chevron prev" aria-label="上一个存档">⌃</button><div id="saveCarousel" class="ink-carousel" aria-label="存档列表"></div><button id="saveNext" class="ink-chevron next" aria-label="下一个存档">⌄</button><p id="saveMessage" role="status" class="ink-message"></p></div>`);
  levels.insertAdjacentHTML('beforeend', `<div class="ink-content"><button id="levelPrev" class="ink-chevron prev" aria-label="上一关">⌃</button><div id="levelCarousel" class="ink-carousel" aria-label="关卡列表"></div><button id="levelNext" class="ink-chevron next" aria-label="下一关">⌄</button><button id="enterLevel" class="ink-enter">进入关卡 →</button></div>`);
  root.insertAdjacentHTML('beforeend', `<section id="screen-settings" class="screen ink-page" aria-label="设置"><div class="ink-settings">
    <div class="setting-row"><span>深色模式</span><button id="settingDark" class="ink-toggle" role="switch" aria-label="深色模式" aria-checked="false"></button></div>
    <div class="setting-row"><span>体感模式</span><button id="settingGesture" class="ink-toggle" role="switch" aria-label="体感模式" aria-checked="false"></button></div>
    <div class="setting-row"><span>游戏音量</span><button id="settingSound" class="ink-toggle" role="switch" aria-label="游戏音量" aria-checked="true"></button></div>
    <div class="setting-row"><label for="settingVolume">音量设置</label><input id="settingVolume" type="range" min="0" max="100" step="5" aria-label="音量设置"><output id="settingPercent" for="settingVolume"></output></div>
    <div class="setting-row"><span>下载游戏包</span><button id="settingDownload" class="ink-download" aria-label="下载游戏包">⬇</button></div>
    <div class="setting-row exit-row"><button id="settingQuit">退出游戏</button><button id="settingGamepad" class="ink-small">手柄设置</button></div>
    <p id="settingsMessage" role="status" class="ink-message"></p>
  </div></section><div id="inkCurtain" aria-hidden="true"></div>`);
  heading($('screen-settings'), '设置', 4);
  const titleFor = {menu:'白鹭击浪',saves:'选择存档',select:'选择关卡',settings:'设置'};
  const homePoster=new Image();homePoster.src=art+'reference-1.png';
  homeFX=window.EgretHomeMenuFX?.mount({stage:root,buttons:[start,$('btnSettings')],
    isActive:()=>ready&&view==='menu'&&!_transitionBusy,
    getSource:()=>idlePlaying&&idle.readyState>=2?idle:intro.readyState>=2?intro:homePoster.complete?homePoster:null,
    reducedMotion});

  function setReady() {
    if (ready) return;
    ready = true; start.disabled = false; $('btnSettings').disabled = false;
    root.classList.add('home-ready'); $('cinemaStatus').hidden = true;
    homeFX?.sync();
  }
  function playIdle() {
    if (fadeStarted) return;
    const begin = () => {
      if (fadeStarted) return;
      fadeStarted = true; idlePlaying = true; setReady();
      if (idle.readyState < 2) root.classList.add('video-fallback');
      root.classList.add('idle-running');
      finishStartup();
      setTimeout(() => { intro.pause(); intro.removeAttribute('autoplay'); }, 420);
    };
    if(cancelIdleReveal)cancelIdleReveal();
    cancelIdleReveal=afterPresentedFrame(idle,begin);
    withTimeout(idle.play(), 3000).catch(() => {
      cancelIdleReveal?.();
      fadeStarted = false;
      // Keep the clear intro frame / poster and working menu if autoplay fails.
      if(intro.readyState<2||intro.currentTime<9.85)root.classList.add('video-fallback');
      $('cinemaStatus').textContent = '轻触画面 / 空格 / K / 手柄A 继续'; $('cinemaStatus').hidden = false; setReady();finishStartup();
    });
  }
  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('play-timeout')), ms))]);
  }
  function videoFailed() {
    root.classList.add('video-fallback'); $('cinemaStatus').hidden = true; setReady(); finishStartup();
  }
  // Dedicated recovery: restart whichever home video should be running; fall back to the poster if it cannot.
  function resume() {
    if (!view || document.hidden) return;
    if (!intro.paused || !idle.paused) return;
    if (fadeStarted) { withTimeout(idle.play(), 3000).catch(videoFailed); return; }
    if (intro.error || intro.ended || (Number.isFinite(intro.duration) && intro.currentTime >= intro.duration - .36)) { playIdle(); return; }
    withTimeout(intro.play(), 3000).catch(() => playIdle());
  }
  function skipOrResume() {
    if (!fadeStarted && !intro.paused) playIdle(); else resume();
    if (!ready) { setReady(); finishStartup(); }
  }
  function watchIntro() {
    if (intro.currentTime >= 9.85) setReady();
    if (Number.isFinite(intro.duration) && intro.currentTime >= intro.duration - .36) playIdle();
    if (!fadeStarted) {
      if (intro.requestVideoFrameCallback) introFrame = intro.requestVideoFrameCallback(watchIntro);
      else introFrame = requestAnimationFrame(watchIntro);
    }
  }
  intro.addEventListener('timeupdate', () => { if (intro.currentTime >= 9.85) setReady(); });
  intro.addEventListener('playing', () => { $('cinemaStatus').hidden=true; });
  intro.addEventListener('playing', watchIntro, {once:true});
  intro.addEventListener('ended', playIdle);
  intro.addEventListener('error', playIdle);
  idle.addEventListener('error', () => { setReady(); root.classList.add('video-fallback');finishStartup(); });
  // Missing video files (404) fire 'error' on <source>, not on <video>: fall back to the poster immediately.
  intro.querySelector('source')?.addEventListener('error', () => { root.classList.add('video-fallback'); setReady(); finishStartup(); $('cinemaStatus').hidden = true; });
  idle.querySelector('source')?.addEventListener('error', () => { root.classList.add('video-fallback'); setReady(); finishStartup(); });
  intro.play().catch(error => {
    if(error?.name==='AbortError')return;
    $('cinemaStatus').textContent = '轻触画面 / 空格 / K / 手柄A 继续'; $('cinemaStatus').hidden = false;
    finishStartup();
  });
  const startupWatchdog = setTimeout(() => { if (intro.readyState < 2) playIdle(); else if (intro.paused && idle.paused) resume(); }, 8000);
  // Ready watchdog: if the intro has not visibly advanced after 4s (play() pending/stalled), unlock the menu.
  const readyWatchdog = setTimeout(() => { if (ready || !view) return; if (intro.paused || intro.currentTime < .1) { setReady(); finishStartup(); root.classList.add('video-fallback'); $('cinemaStatus').textContent = '轻触画面 / 空格 / K / 手柄A 继续'; $('cinemaStatus').hidden = false; } }, 4000);
  root.addEventListener('pointerdown', () => { if (!ready) skipOrResume(); else if (intro.paused && idle.paused) resume(); }, {passive:true});
  // Gamepad A / Start also resume a stalled home animation (rising edge only).
  { let prev = false;
    const poll = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let down = false;
      for (const pad of pads) if (pad && (pad.buttons[0]?.pressed || pad.buttons[9]?.pressed)) down = true;
      if (down && !prev && view) { if (!ready) skipOrResume(); else if (intro.paused && idle.paused) resume(); }
      prev = down; requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll); }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { intro.pause(); idle.pause(); }
    else if (view) (fadeStarted ? idle : intro).play().catch(resume);
  });

  function syncPresentation() {
    root.dataset.inkView = view || 'game';
    $('cinema').classList.toggle('cinema-hidden', !view);
    if (!view) { intro.pause(); idle.pause(); }
    else if (!document.hidden) (fadeStarted ? idle : intro).play().catch(resume);
    if (view === 'settings') syncSettings();
    homeFX?.sync();
  }
  setScreen = function(id) {
    if (id === 'settings') {
      ['menu','select','saves'].forEach(name => $('screen-' + name).classList.remove('active'));
    } else originalSetScreen(id);
    $('screen-settings').classList.toggle('active', id === 'settings');
    view = id || null;
    if (id) { $('hud').classList.remove('show'); document.title = id==='menu'?'白鹭击浪':titleFor[id] + ' · 白鹭击浪'; }
    else document.title='白鹭击浪 · '+LEVEL_NAMES[selectedLevel-1];
    syncPresentation();
  };
  function preferred() {
    if (view === 'menu') return start;
    if (view === 'settings') return $('settingDark');
    return document.querySelector('#screen-' + view + ' .carousel-item.selected');
  }
  function focusView() {
    const target = preferred() || document.querySelector('#screen-' + view + ' button') || $('btnPause');
    target?.focus({preventScroll:true});
  }
  // Pages always enter from the right and leave toward the right, including Back.
  playPageTransition = function(callback, reverse = false) {
    if (_transitionBusy) return;
    transitionLock(true); root.classList.toggle('ink-reverse', reverse); root.classList.add('ink-leaving');
    homeFX?.sync();
    clearTimeout(switchTimer); clearTimeout(transitionTimer);
    let switched = false;
    const change = () => { if (switched) return; switched = true; try { callback?.(); } finally { root.classList.remove('ink-leaving'); root.classList.add('ink-entering'); } };
    const finish = () => {
      try { change(); } finally { root.classList.remove('ink-leaving','ink-entering','ink-reverse'); transitionLock(false); focusView();homeFX?.sync(); }
    };
    if (reducedMotion.matches) { finish(); return; }
    switchTimer = setTimeout(change, 290);
    transitionTimer = setTimeout(finish, 710);
  };

  function getSaves() {
    const list = loadSaveList();
    saveEntries = Object.keys(list).map(name => ({name, data:list[name]}));
    // Preserve every legacy save, including custom names; append empty slots.
    for (let i = saveEntries.length; i < Math.max(3, saveEntries.length + (saveEntries.length >= 3 ? 1 : 0)); i++) {
      saveEntries.push({name:'存档' + (['一','二','三','四','五','六'][i] || (i+1)), data:null});
      if (saveEntries.length >= 3) break;
    }
    selectedSave = Math.max(0, Math.min(saveEntries.length-1, selectedSave));
  }
  const escape = value => escapeHtml(String(value));
  function carouselItem(item, index, selected, subtitle, kind) {
    return `<button type="button" class="carousel-item ${selected?'selected':''}" data-index="${index}" aria-current="${selected?'true':'false'}" aria-label="${escape(item)}，${escape(subtitle)}${selected?'，再次确认进入':''}"><span class="selection-seal" aria-hidden="true"></span><strong>${escape(item)}</strong><small>${escape(subtitle)}</small></button>`;
  }
  function renderSaves() {
    const indices = [selectedSave-1, selectedSave, selectedSave+1];
    $('saveCarousel').innerHTML = indices.map((i, position) => {
      if (i<0 || i>=saveEntries.length) return '<div class="carousel-empty" aria-hidden="true"></div>';
      const entry = saveEntries[i];
      const subtitle = entry.data ? '已有存档' : '空存档 · 确认新建';
      return carouselItem(entry.name, i, position===1, subtitle, 'save');
    }).join('');
    $('savePrev').disabled = selectedSave===0; $('saveNext').disabled = selectedSave===saveEntries.length-1;
    $('saveMessage').textContent = '';
  }
  function openSaveView() {
    state = 'menu'; hideOverlay(); getSaves();
    let lastName = ''; try { lastName=localStorage.getItem('egret_lastSave')||''; } catch(_) {}
    selectedSave = Math.max(0, saveEntries.findIndex(entry=>entry.name===lastName));
    setScreen('saves'); renderSaves();
  }
  function chooseSave() {
    const entry = saveEntries[selectedSave]; if (!entry) return;
    playPageTransition(() => {
      if (entry.data) {
        // Reset baseline first: a legacy save can omit optional stats.
        resetGrowth(); buffStack={}; applySave(entry.data);
        currentLevel = Math.max(1,Math.min(MAX_LEVEL,entry.data.lv||1));
      } else {
        resetGrowth(); buffStack={}; unlockedLevel=1; currentLevel=1; saveProgress();
        let name = entry.name; const used = loadSaveList(); let suffix = 1;
        while (used[name]) name=entry.name+'（'+(++suffix)+'）';
        saveGame(name); entry.name=name; entry.data=loadSaveList()[name];
      }
      selectedLevel = Math.min(unlockedLevel, Math.max(1,currentLevel));
      state='select'; setScreen('select'); buildLevels();
    });
  }
  function moveSave(delta) {
    const next = Math.max(0,Math.min(saveEntries.length-1,selectedSave+delta));
    if (next===selectedSave) return;
    selectedSave=next; renderSaves(); animateCarousel($('saveCarousel'),delta);
  }
  function animateCarousel(node, direction) {
    if (!reducedMotion.matches) node.animate([{opacity:.4,transform:'translateY('+(direction>0?12:-12)+'px)'},{opacity:1,transform:'translateY(0)'}],{duration:230,easing:'cubic-bezier(.2,.7,.2,1)'});
  }
  buildLevels = function() {
    selectedLevel = Math.max(1,Math.min(MAX_LEVEL,selectedLevel));
    $('levelCarousel').innerHTML = [selectedLevel-1,selectedLevel,selectedLevel+1].map((level,position) => {
      if (level<1||level>MAX_LEVEL) return '<div class="carousel-empty" aria-hidden="true"></div>';
      const status = level>unlockedLevel?'未解锁':level<unlockedLevel?'已通关':'待挑战';
      return carouselItem(LEVEL_NAMES[level-1],level,position===1,String(level).padStart(2,'0')+' / 12　'+status,'level');
    }).join('');
    const chosen = $('levelCarousel').querySelector('.selected');
    if(chosen) chosen.style.setProperty('--landscape',`url("${LEVEL_BGS[selectedLevel-1]}")`);
    $('levelPrev').disabled=selectedLevel===1; $('levelNext').disabled=selectedLevel===MAX_LEVEL;
    $('enterLevel').disabled=selectedLevel>unlockedLevel;
    $('enterLevel').textContent=selectedLevel>unlockedLevel?'尚未解锁':'进入关卡 →';
  };
  function moveLevel(delta) {
    const next=Math.max(1,Math.min(MAX_LEVEL,selectedLevel+delta));
    if(next===selectedLevel)return;
    selectedLevel=next; buildLevels(); animateCarousel($('levelCarousel'),delta);
  }
  function enterLevel() {
    if (selectedLevel>unlockedLevel) return;
    playPageTransition(()=> {hideOverlay();setScreen(null);state='play';resetGame(selectedLevel);});
  }
  function back() {
    if (_transitionBusy || !ready) return true;
    if (view==='settings') playPageTransition(()=>setScreen('menu'),true);
    else if(view==='select') playPageTransition(openSaveView,true);
    else if(view==='saves') playPageTransition(()=>{state='menu';setScreen('menu');},true);
    else return false;
    return true;
  }
  function navigate(direction) {
    if (!['select','saves'].includes(view)) return false;
    // Keep action/back buttons in spatial navigation; carousel rows own up/down.
    const active=document.activeElement;
    if (!active?.classList.contains('carousel-item') && active!==document.body) return false;
    if (!direction[1]) return false;
    view==='saves'?moveSave(Math.sign(direction[1])):moveLevel(Math.sign(direction[1]));
    return true;
  }
  window.EgretUI = {isLocked:()=>!ready||_transitionBusy,getScope:()=>view?$('screen-'+view):null,back,navigate,preferred};
  start.onclick=()=>{if(ready)playPageTransition(openSaveView);};
  $('btnSettings').onclick=()=>{if(ready)playPageTransition(()=>{state='menu';setScreen('settings');});};
  saves.querySelector('.ink-back').onclick=levels.querySelector('.ink-back').onclick=$('screen-settings').querySelector('.ink-back').onclick=back;
  $('savePrev').onclick=()=>moveSave(-1); $('saveNext').onclick=()=>moveSave(1);
  $('levelPrev').onclick=()=>moveLevel(-1); $('levelNext').onclick=()=>moveLevel(1);
  $('saveCarousel').onclick=event=>{const button=event.target.closest('[data-index]');if(!button)return;const index=+button.dataset.index;if(index===selectedSave)chooseSave();else {moveSave(index-selectedSave);focusView();}};
  $('levelCarousel').onclick=event=>{const button=event.target.closest('[data-index]');if(!button)return;const index=+button.dataset.index;if(index===selectedLevel)enterLevel();else {moveLevel(index-selectedLevel);focusView();}};
  $('enterLevel').onclick=enterLevel;
  for(const [node,move] of [[saves,moveSave],[levels,moveLevel]]) {
    let lastWheel=0;
    node.addEventListener('wheel',event=>{event.preventDefault();if(_transitionBusy||performance.now()-lastWheel<180)return;lastWheel=performance.now();move(Math.sign(event.deltaY));},{passive:false});
  }
  addEventListener('keydown',event=>{
    if (!$('gamepadPanel').hidden||!$('gesturePanel').hidden) return;
    const isK = event.key==='k'||event.key==='K';
    if (!ready) {
      if(['Enter',' ','Escape','ArrowUp','ArrowDown'].includes(event.key)||isK){event.preventDefault();event.stopImmediatePropagation();}
      if (event.repeat) return;
      if (event.key==='Escape') playIdle(); else if (event.key==='Enter'||event.key===' '||isK) skipOrResume();
      return;
    }
    if (view && isK) {event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)resume();return;}
    if (view && event.key==='Escape') {event.preventDefault();event.stopImmediatePropagation();back();return;}
    if (view && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
      const direction = event.key==='ArrowUp'?[0,-1]:event.key==='ArrowDown'?[0,1]:event.key==='ArrowLeft'?[-1,0]:[1,0];
      if(navigate(direction)) {event.preventDefault();event.stopImmediatePropagation();focusView();}
      else if(view==='menu') {event.preventDefault();(document.activeElement===start?$('btnSettings'):start).focus();}
    }
  },true);
  function syncSettings() {
    $('settingDark').setAttribute('aria-checked',String(darkMapMode));
    $('settingGesture').setAttribute('aria-checked',String(window.EgretGameBridge.isGestureActive()));
    $('settingSound').setAttribute('aria-checked',String(bgmOn));
    $('settingVolume').value=Math.round(bgmVol*100); $('settingPercent').value=Math.round(bgmVol*100)+'%';
  }
  syncNightControls=function(){originalNightSync();syncSettings();};
  $('settingDark').onclick=()=>setDarkMapMode(!darkMapMode);
  $('settingGesture').onclick=()=>{
    if(window.EgretGameBridge.isGestureActive()){window.EgretGestureControls.stop();syncSettings();}
    else $('btnSense').click();
  };
  $('settingSound').onclick=()=>{setBgmOn(!bgmOn);syncSettings();};
  $('settingVolume').oninput=event=>{setBgmVol(+event.target.value/100);syncSettings();syncPauseAudio();};
  $('settingGamepad').onclick=()=>$('gamepadLaunch').click();
  $('settingQuit').onclick=()=>{ autoSave(); window.EgretGestureControls?.stop(); window.EgretGamepadControls?.stop(); playPageTransition(()=>{setScreen('menu');showOverlay({tag:'再会',title:'白鹭归巢',sub:'进度已保存，期待与你再会',buttons:[{label:'返回主页',act:'farewell-back',primary:true}]});});};
  $('settingDownload').onclick=async()=>{
    if(downloading)return;downloading=true;$('settingDownload').disabled=true;$('settingsMessage').textContent='正在准备完整游戏包…';
    try {if(location.protocol==='file:')throw new Error('local');
      const response=await fetch('download/manifest.json');if(!response.ok)throw new Error('下载不可用');
      const manifest=await response.json(),parts=[];
      for(let i=0;i<manifest.parts.length;i++){const part=await fetch('download/'+manifest.parts[i]);if(!part.ok)throw new Error('下载中断');parts.push(await part.blob());$('settingsMessage').textContent='正在准备完整游戏包… '+Math.round((i+1)/manifest.parts.length*100)+'%';}
      const url=URL.createObjectURL(new Blob(parts,{type:'application/zip'})),link=document.createElement('a');link.href=url;link.download='白鹭击浪_安装包.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);$('settingsMessage').textContent='完整游戏包已下载，解压后启动游戏。';
    }catch(_){if(location.protocol==='file:'){const link=document.createElement('a');link.href='白鹭击浪_安装包.zip';link.download='白鹭击浪_安装包.zip';link.click();$('settingsMessage').textContent='请打开游戏目录中的安装包。';}else $('settingsMessage').textContent='下载暂未完成，请稍后重试。';}
    finally{downloading=false;$('settingDownload').disabled=false;}
  };
  // Pause/result content remains generated by the original actions.
  const overlay=$('overlay'), panel=document.createElement('div');panel.id='inkPausePanel';
  while(overlay.firstChild)panel.appendChild(overlay.firstChild);overlay.appendChild(panel);
  showOverlay=function(options){originalShowOverlay(options);overlay.classList.toggle('ink-pause',!!options.isPause);
    if(options.isPause){$('ovTag').textContent='已暂停';overlay.style.setProperty('--pause-map',`url("${LEVEL_BGS[currentLevel-1]}")`);syncPauseAudio();}
  };
  function syncPauseAudio(){
    if($('volRange'))$('volRange').value=Math.round(bgmVol*100);
    if($('btnBgmToggle'))$('btnBgmToggle').textContent=bgmOn?'关闭音乐':'开启音乐';
  }
  const oldBuildAudio=buildAudioPanel;
  buildAudioPanel=function(){oldBuildAudio();syncPauseAudio();};
  // Cards retain original weighted draws, descriptions, stack counts and lock.
  const oldRenderCards=renderCardChoices;
  renderCardChoices=function(){oldRenderCards();document.querySelectorAll('.upCard').forEach((card,i)=>{
    const rarity=cardChoices[i]?.rare||'普通';
    const aura=document.createElement('span');aura.className='rarityAura';aura.setAttribute('aria-hidden','true');
    const count=rarity==='史诗'?8:rarity==='稀有'?6:4;
    for(let n=0;n<count;n++){
      const ember=document.createElement('i');ember.className='rarityEmber';
      ember.style.setProperty('--ember-x',String(4+(n*37)%92)+'%');
      ember.style.setProperty('--ember-delay',String(-n*.39)+'s');
      aura.appendChild(ember);
    }
    card.appendChild(aura);
    card.setAttribute('role','button');card.tabIndex=0;card.style.setProperty('--card-index',i);
    card.setAttribute('aria-label',card.textContent.replace(/\s+/g,' '));
    card.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();card.click();}};
  });};
  const oldOpenCards=openCardPicker;
  openCardPicker=function(after){oldOpenCards(after);$('cardSub').textContent='选一张强化，继续迎战';};
  function cardExit(action){if(state!=='card'||_cardLock||_transitionBusy)return;playPageTransition(action);}
  pickCard=function(card){cardExit(()=>originalPickCard(card));};
  closeCardPicker=function(){cardExit(originalCloseCards);};
  // Original pick calls closeCardPicker while the lock is held; allow that internal closure.
  closeCardPicker=function(){if(state!=='card')return;if(_cardLock){originalCloseCards();return;}cardExit(originalCloseCards);};
  refreshCards=function(){if(state!=='card'||_transitionBusy||cardRefreshes<=0)return;originalRefresh();animateCarousel($('cardRow'),1);};
  // Restore focus/settings state when a camera or controller dialog closes.
  const dialogObserver=new MutationObserver(()=>{if(view==='settings')syncSettings();});
  dialogObserver.observe($('gesturePanel'),{attributes:true,attributeFilter:['hidden']});
  // Return-to-select from gameplay should select the chapter actually in play.
  const oldRunAction=runAction;
  runAction=function(action){if(action==='sel')selectedLevel=currentLevel;oldRunAction(action);};
  document.querySelector('.gestureEyebrow').textContent='体感设置';
  document.querySelector('#gamepadPanel .gestureEyebrow')?.replaceChildren(document.createTextNode('手柄设置'));
  setScreen('menu');syncSettings();
  addEventListener('pagehide',()=>{clearTimeout(startupWatchdog);clearTimeout(readyWatchdog);clearTimeout(switchTimer);clearTimeout(transitionTimer);cancelIntroReveal();cancelIdleReveal?.();dialogObserver.disconnect();homeFX?.destroy();});
})();
