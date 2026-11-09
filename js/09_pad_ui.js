(function () {
  'use strict';
  const bridge = window.EgretGameBridge;
  if (!bridge || !window.EgretGamepadCore || !window.EgretGamepadNavigation) return;
  const engine = new window.EgretGamepadCore.GamepadEngine();
  const stage = document.getElementById('wrap');
  stage.insertAdjacentHTML('beforeend', `
    <button id="gamepadLaunch" aria-label="打开手柄设置">手柄设置 · 方向 / A / B</button>
    <div id="gamepadBadge" hidden role="status"></div>
    <section id="gamepadPanel" hidden role="dialog" aria-modal="true" aria-labelledby="gamepadTitle">
      <div class="gamepadSheet">
        <button id="gamepadClose" class="gestureClose" aria-label="关闭手柄设置">×</button>
        <div class="gestureEyebrow">GAMEPAD / 完整手柄 V5</div>
        <h2 id="gamepadTitle">摇杆御剑，四向逐浪</h2>
        <p class="gamepadIntro">十字键或左摇杆自由移动、选择页面；A 确认，B 返回。无需摄像头。</p>
        <label class="gamepadDeviceLabel">当前外设 <select id="gamepadDevice" aria-label="选择手柄"></select></label>
        <div class="gamepadKeys" aria-label="手柄按键实时状态">
          <div><span id="gamepadUp">↑</span><b>向上移动</b></div>
          <div><span id="gamepadDown">↓</span><b>向下移动</b></div>
          <div><span id="gamepadLeft">←</span><b>向左移动</b></div>
          <div><span id="gamepadRight">→</span><b>向右移动</b></div>
          <div><span id="gamepadX">X</span><b>原鼠标左键攻击</b></div>
          <div><span id="gamepadY">Y</span><b>原鼠标右键攻击</b></div>
          <div><span id="gamepadA">A</span><b>确认选择</b></div>
          <div><span id="gamepadB">B</span><b>返回 / 取消</b></div>
        </div>
        <div class="gamepadStickRow"><div class="gamepadStick"><span id="gamepadStickDot"></span></div><small>左摇杆实时方向 · 轻推慢走，推满全速<br>回中停步，支持斜向；右摇杆不接入。</small></div>
        <p class="gamepadHelp">攻击沿最近移动方向，X、Y 按下一次攻击一次。页面中方向键或左摇杆切换高亮项，A 确认、B 返回；战斗中 B 暂停。选卡时 B 仅取消指向，不会放弃强化。</p>
        <p id="gamepadStatus" role="status" aria-live="polite">按手柄任意键，让浏览器识别已连接外设。</p>
        <p id="gamepadMapping"></p>
        <div class="gamepadActions">
          <button id="gamepadEnable" class="gestureBtn">启用手柄</button>
          <button id="gamepadDisable" class="gestureBtn secondary">关闭手柄</button>
          <button id="gamepadRebind" class="gestureBtn secondary">重新绑定按键</button>
          <button id="gamepadReset" class="gestureBtn secondary">恢复 Xbox 默认</button>
          <button id="gamepadDone" class="gestureBtn secondary">返回游戏</button>
        </div>
        <p class="gamepadFootnote">菜单、选关、选卡和设置均支持手柄。断连或切出窗口会暂停战斗；重新接入后松开所有操作键并让左摇杆回中。启用手柄会关闭摄像头，关闭手柄恢复键鼠。</p>
      </div>
    </section>`);
  const $ = id => document.getElementById(id);
  const panel = $('gamepadPanel'), badge = $('gamepadBadge');
  const navigation = new window.EgretGamepadNavigation.Navigation({ document, root: stage });
  const defaults = { up: 12, down: 13, left: 14, right: 15, leftClick: 2, rightClick: 3, confirm: 0, cancel: 1 };
  const actions = ['up', 'down', 'left', 'right', 'leftClick', 'rightClick', 'confirm', 'cancel'];
  const labels = ['上', '下', '左', '右', 'X（左侧）', 'Y（上方）', 'A（下方）', 'B（右侧）'];
  const pressed = button => !!button && (button.pressed === true || Number(button.value) > 0.5);
  const read = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} };
  let enabled = read('egret_gamepad_enabled_v1') !== '0';
  let focused = document.hasFocus ? document.hasFocus() : true;
  let selectedIndex = null, activeKey = null, currentPad = null, bindings = { ...defaults };
  let customBinding = false, deviceSignature = '', frame = null, returnFocus = null;
  let learn = null, lastState = null, lastStatus = '', lastUiKey = null, navigationCanceled = false, gestureSession = false;
  const keyFor = pad => 'egret_gamepad_binding_v1:' + pad.id;
  function validBindings(value) {
    return value && actions.every(key => Number.isInteger(value[key]) && value[key] >= 0 && value[key] < 64) && new Set(actions.map(key => value[key])).size === actions.length;
  }
  function status(text) { if (lastStatus !== text) { $('gamepadStatus').textContent = text; lastStatus = text; } }
  function facing() {
    const angle = bridge.getFacing();
    return Number.isFinite(angle) ? [Math.cos(angle), Math.sin(angle)] : [1, 0];
  }
  const hitHaptics=window.EgretCombatFeedback.createHaptics();
  function clear() {
    hitHaptics.stop();
    if (bridge.getInputSource() === 'gamepad') bridge.setMove([0, 0], true);
    engine.reset(facing());
    navigation.clear(); lastUiKey = null; navigationCanceled = false;
  }
  function disengage(pause) {
    clear();
    if (pause && bridge.getInputSource() === 'gamepad' && bridge.getState() === 'play') bridge.pause();
    bridge.setGamepadActive(false);
  }
  function stop() {
    enabled = false; learn = null; write('egret_gamepad_enabled_v1', '0');
    disengage(false); badge.hidden = true;
    panel.hidden = true;
  }
  function loadBindings(pad) {
    let saved;
    try { saved = JSON.parse(read(keyFor(pad))); } catch (_) {}
    const legacy = saved && Object.keys(saved).length === 4 && ['up','down','leftClick','rightClick'].every(key => Number.isInteger(saved[key]));
    const migrated = legacy ? { ...defaults, ...saved } : saved;
    customBinding = validBindings(migrated);
    bindings = customBinding ? migrated : { ...defaults };
    engine.reset(facing());
  }
  function showMapping() {
    $('gamepadMapping').textContent = '当前映射：↑ '+bindings.up+' / ↓ '+bindings.down+' / ← '+bindings.left+' / → '+bindings.right+' / X '+bindings.leftClick+' / Y '+bindings.rightClick+' / A '+bindings.confirm+' / B '+bindings.cancel;
  }
  function openPanel() {
    returnFocus = document.activeElement;
    window.EgretGestureControls?.stop();
    window.EgretGestureControls?.close();
    gestureSession = false;
    if (bridge.getState() === 'play') bridge.pause();
    clear(); panel.hidden = false; $('gamepadDone').focus();
  }
  function closePanel() {
    panel.hidden = true; learn = null; clear();
    (returnFocus && returnFocus.isConnected ? returnFocus : $('gamepadLaunch')).focus();
  }
  function enable() {
    window.EgretGestureControls?.stop();
    window.EgretGestureControls?.close();
    gestureSession = false; enabled = true; write('egret_gamepad_enabled_v1', '1'); clear();
  }
  function renderDevices(pads) {
    const signature = JSON.stringify(pads.map(pad => [pad.index, pad.id]));
    if (signature === deviceSignature) return;
    deviceSignature = signature;
    const select = $('gamepadDevice'); select.replaceChildren();
    if (!pads.length) {
      const option = document.createElement('option'); option.textContent = '等待手柄 · 请按任意键'; option.value = ''; select.appendChild(option);
    }
    for (const pad of pads) {
      const option = document.createElement('option'); option.value = String(pad.index); option.textContent = pad.id;
      select.appendChild(option);
    }
  }
  function capture(pad) {
    const cancelDown = pressed(pad.buttons[bindings.cancel]);
    if ((pad.mapping === 'standard' || customBinding) && cancelDown && !learn.cancelHeld && learn.step !== actions.indexOf('cancel')) {
      learn = null; clear(); status('已取消重新绑定，保留原配置。'); return;
    }
    learn.cancelHeld = cancelDown;
    const down = pad.buttons.reduce((list, button, i) => { if (pressed(button)) list.push(i); return list; }, []);
    if (learn.waitRelease) { if (!down.length) learn.waitRelease = false; return; }
    if (down.length !== 1) return;
    const button = down[0];
    if (learn.values.includes(button)) { status('这个键已经绑定，请先松开，再按' + labels[learn.step] + '。'); learn.waitRelease = true; return; }
    learn.values.push(button); learn.step++; learn.waitRelease = true;
    if (learn.step === actions.length) {
      bindings = Object.fromEntries(actions.map((action, i) => [action, learn.values[i]]));
      customBinding = true; write(keyFor(pad), JSON.stringify(bindings)); learn = null; clear(); showMapping();
      status('八个操作键已绑定。松开按键，左摇杆回中后返回游戏。');
    } else status('已记录。请松开，再按' + labels[learn.step] + '。');
  }
  function uiScope() {
    const gesturePanel = $('gesturePanel');
    if (!panel.hidden) return panel;
    if (gesturePanel && !gesturePanel.hidden) return gesturePanel;
    if (bridge.getState() === 'card') return $('cardLayer') || stage;
    if ($('overlay')?.classList.contains('active')) return $('overlay');
    return window.EgretUI?.getScope?.() || stage;
  }
  function managedUI(scope) {
    const ui = window.EgretUI;
    return ui?.getScope?.() === scope ? ui : null;
  }
  function focusScope(scope, followPreferred) {
    const preferred = managedUI(scope)?.preferred?.() || (scope === stage ? '#btnStart,.lvCard.now,.lvCard:not(.locked)' : '.upCard,button,select');
    if (followPreferred) {
      navigation.clear();
      if (typeof preferred !== 'string') preferred.focus?.({ preventScroll: true });
    }
    navigation.setScope(scope, preferred);
  }
  function cancelUI(scope) {
    if (learn) { learn = null; clear(); status('已取消重新绑定，保留原配置。'); return; }
    if (!panel.hidden) { closePanel(); return; }
    if (scope.id === 'gesturePanel') { window.EgretGestureControls?.close(); clear(); return; }
    if (bridge.getState() === 'card') { navigation.clear(); navigationCanceled = true; return; }
    const ui = managedUI(scope);
    if (ui?.back && ui.back() !== false) { clear(); return; }
    if ($('screen-saves')?.classList.contains('active')) { $('btnSavesBack')?.click(); clear(); return; }
    if (bridge.getState() === 'menu' && scope.id === 'overlay') { scope.querySelector('button')?.click(); clear(); return; }
    if (!bridge.gamepadBack?.()) { navigation.clear(); navigationCanceled = true; }
  }
  function tick(nowMs) {
    frame = requestAnimationFrame(tick);
    let pads;
    try { pads = Array.from(navigator.getGamepads()).filter(pad => pad && pad.connected !== false); }
    catch (_) { disengage(true); status('浏览器无法读取手柄。请在 Chrome / Edge 中打开游戏后重试。'); return; }
    renderDevices(pads);
    const pad = pads.find(pad => pad.index === selectedIndex) || pads.find(pad => /3537|xbox|xinput/i.test(pad.id)) || pads.find(pad => pad.mapping === 'standard') || pads[0] || null;
    const nextKey = pad ? pad.index + ':' + pad.id : null;
    if (nextKey !== activeKey) {
      if (activeKey !== null) disengage(true);
      activeKey = nextKey; currentPad = pad; learn = null;
      if (pad) loadBindings(pad);
      showMapping();
    }
    currentPad = pad;
    if (pad) $('gamepadDevice').value = String(pad.index);
    $('gamepadEnable').disabled = enabled;
    $('gamepadDisable').disabled = !enabled;
    $('gamepadRebind').disabled = !pad;
    $('gamepadReset').disabled = !pad;
    const mappingOK = !!pad && (pad.mapping === 'standard' || customBinding);
    const gesturePanelOpen = !!$('gesturePanel') && !$('gesturePanel').hidden;
    if (bridge.getInputSource() === 'gesture') gestureSession = true;
    else if (!gesturePanelOpen) gestureSession = false;
    if (enabled && mappingOK && !gestureSession && !gesturePanelOpen) {
      if (bridge.getInputSource() !== 'gamepad') {
        window.EgretGestureControls?.stop();
        bridge.setGamepadActive(true); engine.reset(facing());
      }
    } else if (bridge.getInputSource() === 'gamepad') disengage(!pad);
    const state = bridge.getState();
    if (state !== lastState) { clear(); lastState = state; }
    const scope = uiScope(), inUI = state !== 'play' || scope !== stage || !panel.hidden || gesturePanelOpen;
    const uiKey = inUI ? state + ':' + scope.id + ':' + (document.querySelector('.screen.active')?.id || '') : null;
    if (uiKey !== lastUiKey) { engine.reset(facing()); navigation.clear(); navigationCanceled = false; lastUiKey = uiKey; }
    const allowed = mappingOK && !document.hidden && focused && !bridge.isTransitioning() && !window.EgretUI?.isLocked?.() && (inUI ? (enabled || !panel.hidden || gesturePanelOpen) : (enabled && !gestureSession));
    const out = engine.process(pad, { allowed: allowed && !learn, bindings, context: inUI ? 'ui' : 'play', nowMs });
    if (bridge.getInputSource() === 'gamepad') {
      bridge.setMove(out.move, Math.hypot(...out.move) < 0.001);
      if (!inUI) {
        if (out.cancel) bridge.gamepadBack?.();
        else {
          if (out.leftClick) bridge.gamepadMouseAction(0, out.direction);
          if (out.rightClick) bridge.gamepadMouseAction(2, out.direction);
        }
      }
    }
    if (inUI && allowed && !learn) {
      if (!navigationCanceled) focusScope(scope);
      if (out.cancel) cancelUI(scope);
      else if (out.confirm) {
        if (navigationCanceled) { navigationCanceled = false; focusScope(scope); }
        else navigation.confirm();
      } else if (out.nav[0] || out.nav[1]) {
        navigationCanceled = false;
        if (managedUI(scope)?.navigate?.(out.nav) === true) focusScope(uiScope(), true);
        else { focusScope(scope); navigation.move(out.nav); }
      }
    } else if (!inUI || !allowed) navigation.clear();
    const sx = Number(pad?.axes?.[0]) || 0, sy = Number(pad?.axes?.[1]) || 0;
    $('gamepadStickDot').style.transform = 'translate('+Math.round(Math.max(-1,Math.min(1,sx))*17)+'px,'+Math.round(Math.max(-1,Math.min(1,sy))*17)+'px)';
    for (const [key, id] of [['up','gamepadUp'],['down','gamepadDown'],['left','gamepadLeft'],['right','gamepadRight'],['leftClick','gamepadX'],['rightClick','gamepadY'],['confirm','gamepadA'],['cancel','gamepadB']]) {
      $(id).classList.toggle('pressed', !!pad && pressed(pad.buttons[bindings[key]]));
    }
    badge.hidden = !enabled;
    const text = !pad ? '手柄待连接 · 按任意键识别' : !mappingOK ? '请在手柄设置中重新绑定按键' : inUI ? '方向键 / 左摇杆选择 · A 确认 · B 返回' : '方向键 / 左摇杆移动 · X / Y 攻击 · B 暂停';
    if (badge.textContent !== text) badge.textContent = text;
    if (learn && pad) capture(pad);
    else if (!pad) status('按手柄任意键，让浏览器识别已连接外设。');
    else if (!mappingOK) status('此设备未提供标准布局，请点击「重新绑定按键」。');
    else if (!enabled) status('手柄已识别。点击「启用手柄」；A 确认设置，B 返回。');
    else status(out.ready ? '手柄已就绪。四向移动 / 选择，A 确认，B 返回，X / Y 攻击。' : '手柄已连接。请松开操作键并让左摇杆回中，避免误触。');
  }
  $('gamepadLaunch').onclick = openPanel;
  $('gamepadClose').onclick = $('gamepadDone').onclick = closePanel;
  $('gamepadEnable').onclick = enable;
  $('gamepadDisable').onclick = () => { stop(); panel.hidden = false; status('手柄已关闭，已恢复键鼠操作。'); };
  $('gamepadDevice').onchange = () => { selectedIndex = Number($('gamepadDevice').value); activeKey = null; disengage(true); learn = null; if (currentPad) loadBindings(currentPad); };
  $('gamepadRebind').onclick = () => { clear(); learn = { step: 0, values: [], waitRelease: true }; status('先松开所有手柄按键，然后按上方向键。'); };
  $('gamepadReset').onclick = () => { if (!currentPad) return; bindings = { ...defaults }; customBinding = currentPad.mapping !== 'standard'; write(keyFor(currentPad), JSON.stringify(bindings)); learn = null; clear(); showMapping(); status('已恢复 Xbox 默认：四向、X、Y、A、B。'); };
  panel.addEventListener('click', event => { if (event.target === panel) closePanel(); });
  window.addEventListener('keydown', event => {
    if (panel.hidden) return;
    if (event.key === 'Escape' || event.key === ' ') { event.stopImmediatePropagation(); if (event.key === 'Escape') { event.preventDefault(); closePanel(); } }
    if (event.key === 'Tab') {
      const controls = [...panel.querySelectorAll('button,select')].filter(element => !element.disabled && !element.hidden);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  window.addEventListener('blur', () => { focused = false; clear(); if (enabled && bridge.getInputSource() === 'gamepad' && bridge.getState() === 'play') bridge.pause(); });
  window.addEventListener('focus', () => { focused = true; clear(); });
  document.addEventListener('visibilitychange', () => { clear(); if (document.hidden && enabled && bridge.getInputSource() === 'gamepad' && bridge.getState() === 'play') bridge.pause(); });
  window.addEventListener('pagehide', () => { cancelAnimationFrame(frame); frame = null; disengage(false); });
  window.addEventListener('pageshow', () => {
    if (frame !== null || typeof navigator.getGamepads !== 'function') return;
    focused = document.hasFocus ? document.hasFocus() : true;
    clear(); frame = requestAnimationFrame(tick);
  });
  window.EgretGamepadControls = { pulseHit: critical => hitHaptics.hit(currentPad,Date.now(),enabled && focused && !document.hidden && panel.hidden && bridge.getInputSource()==='gamepad' && bridge.getState()==='play' && !bridge.isTransitioning(),critical), stop, suspendForGesture: () => { gestureSession = true; disengage(false); } };
  showMapping();
  if (typeof navigator.getGamepads === 'function') frame = requestAnimationFrame(tick);
  else { enabled = false; $('gamepadEnable').disabled = true; status('此浏览器不支持手柄。请使用 Chrome / Edge 打开游戏。'); }
})();
