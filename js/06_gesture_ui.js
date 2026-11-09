(function () {
  'use strict';
  const bridge = window.EgretGameBridge;
  if (!bridge || !window.EgretGestureCore) return;
  const version = '0.4.1675469240';
  const primaryCDN = `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${version}/`;
  const fallbackCDN = `https://unpkg.com/@mediapipe/hands@${version}/`;
  let modelCDN = primaryCDN;
  const engine = new window.EgretGestureCore.GestureEngine();
  const stage = document.getElementById('wrap');
  stage.insertAdjacentHTML('beforeend', `
    <button id="gestureLaunch" hidden aria-label="打开体感设置">体感设置 · 摄像头</button>
    <div id="gestureBadge" hidden role="status"></div>
    <div id="gestureCursor" hidden aria-hidden="true"></div>
    <div id="gestureMovePad" hidden aria-hidden="true"><div class="gestureMoveRing"><span id="gestureMoveDot"></span></div><small>左掌轻移 · 回中停步</small><small>握拳松开可换位置</small></div>
    <section id="gesturePanel" hidden role="dialog" aria-modal="true" aria-labelledby="gestureTitle">
      <div class="gestureSheet">
        <button class="gestureClose" id="gestureClose" aria-label="关闭体感设置">×</button>
        <div class="gestureEyebrow">MOTION CONTROL / 轻触跟手 V3</div>
        <h2 id="gestureTitle">以手御剑，逐浪而行</h2>
        <p class="gestureIntro">左掌轻移，右手短挥。朝向由手势决定，鼠标不参与体感战斗。</p>
        <div class="gestureGrid">
          <div>
            <ul class="gestureRules">
              <li><span class="gestureKey">左手</span><div><b>轻移即走 · 回中即停</b><small>放松手掌，小幅移动即可行走。握拳刹车，松开立即以新位置为中心；左下圆盘显示方向。</small></div></li>
              <li><span class="gestureKey">右手</span><div><b>小幅短挥，直接出刀</b><small>自然停稳后向外短挥。收手停稳即可续刀，不必找准旧中心；不用先握拳。</small></div></li>
              <li><span class="gestureKey">捏合</span><div><b>拇指 + 食指捏合 → 闪击</b><small>沿左手移动方向闪击；停步时沿最近攻击方向。捏合期间不挥砍。</small></div></li>
              <li><span class="gestureKey">选卡</span><div><b>指向卡片 · 捏合停留确认</b><small>右手指向并捏合 0.6 秒。暂停可用空格、Esc 或原暂停按钮。</small></div></li>
            </ul>
            <label class="gestureSetting">移动灵敏度 <select id="gestureSensitivity"><option value="0.8">舒缓</option><option value="1" selected>标准</option><option value="1.25">灵敏</option></select></label>
            <label class="gestureSetting"><input id="gesturePauseWithHands" type="checkbox">双掌高举暂停（可选，默认关闭）</label>
          </div>
          <div>
            <div id="gesturePreview"><video id="gestureVideo" autoplay muted playsinline></video><canvas id="gestureSkeleton" width="320" height="240"></canvas><canvas id="gestureThree" width="320" height="240" hidden></canvas><div id="gesturePreviewNote">摄像头尚未开启<br>双手放入画面，保持光线充足</div></div>
            <div class="gestureTrack"><span id="gestureLeft">○ 左手</span><span id="gestureRight">○ 右手</span><span id="gestureFPS">待机</span></div>
            <p id="gestureStatus" role="status" aria-live="polite">点击「开启摄像头」后，允许浏览器使用摄像头。</p>
            <p class="gesturePrivacy">摄像头画面只在此设备识别，不上传或录制。首次加载手势模型需要联网。<br>体感开启时独立控制战斗；关闭后恢复键鼠并释放摄像头。</p>
          </div>
        </div>
        <div class="gestureActions"><button class="gestureBtn" id="gestureEnable">开启摄像头</button><button class="gestureBtn secondary" id="gestureCalibrate" disabled>重新校准</button><button class="gestureBtn secondary" id="gestureDone">返回游戏</button><button class="gestureBtn secondary" id="gestureStop" hidden>关闭体感</button></div>
      </div>
    </section>`);
  const $ = id => document.getElementById(id);
  const panel = $('gesturePanel'), video = $('gestureVideo');
  const context = $('gestureSkeleton').getContext('2d');
  const chains = [[0,1,2,3,4],[0,5,6,7,8],[5,9,10,11,12],[9,13,14,15,16],[13,17,18,19,20],[0,17]];
  let enabled = false, starting = false, stream = null, detector = null;
  let timer = null, frameCallback = null, watchdog = null, session = 0, lastResults = 0, lastUI = 0, lastState = null;
  let output = null, uiTarget = null, dwellStart = 0, pinchConsumed = true, uiBlockedUntil = 0;
  let returnFocus = null, skeleton3D = null, lastHands = [], lostPaused = false, hiddenPaused = false;
  let averageMs = 40, previousVideoTime = -1, lastWasPaused = false, resultTimes = [];
  const trackedPalms=new Map();
  const clearInput = () => { bridge.setMove([0,0]); $('gestureCursor').hidden = true; $('gestureMovePad').hidden = true; clearTarget(); };
  const setStatus = text => { $('gestureStatus').textContent = text; };
  const setBadge = text => { $('gestureBadge').textContent = text; };
  function clearTarget() { if (uiTarget) uiTarget.classList.remove('gestureHover'); uiTarget = null; dwellStart = 0; $('gestureCursor').style.setProperty('--dwell','0%'); }
  function openPanel() {
    window.EgretGamepadControls?.suspendForGesture?.();
    returnFocus = document.activeElement;
    if (bridge.getState() === 'play') bridge.pause();
    clearInput(); engine.reset(); panel.hidden = false; $('gestureEnable').focus();
  }
  function closePanel() {
    panel.hidden = true; clearInput(); engine.reset(); pinchConsumed = true; uiBlockedUntil = performance.now()+700;
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    else $('btnSense').focus();
  }
  $('btnSense').onclick = openPanel;
  $('gestureLaunch').onclick = openPanel;
  $('gestureClose').onclick = $('gestureDone').onclick = closePanel;
  panel.addEventListener('click', event => { if (event.target === panel) closePanel(); });
  window.addEventListener('keydown', event => {
    if (panel.hidden) return;
    if (event.key === 'Escape' || event.key === ' ') {
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); closePanel(); }
    }
    if (event.key === 'Tab') {
      const controls = [...panel.querySelectorAll('button,select')].filter(el=>!el.disabled&&!el.hidden);
      const first=controls[0], end=controls.at(-1);
      if (event.shiftKey && document.activeElement===first) {event.preventDefault();end.focus();}
      else if (!event.shiftKey && document.activeElement===end) {event.preventDefault();first.focus();}
    }
  }, true);
  async function ensureMediaPipe() {
    const readyUntil=performance.now()+9000;
    while (!window.Hands && performance.now()<readyUntil && !window.__egretMediaPipeLoadFailed) await new Promise(r=>setTimeout(r,80));
    if (window.Hands) return;
    modelCDN=fallbackCDN;
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const timeout=setTimeout(()=>{script.remove();reject(new Error('手势库加载超时，请检查网络后重试。'));},12000);
      script.src=fallbackCDN+'hands.js'; script.crossOrigin='anonymous';
      script.onload=()=>{clearTimeout(timeout);resolve();};
      script.onerror=()=>{clearTimeout(timeout);reject(new Error('手势库无法加载，请检查网络后重试。'));};
      document.head.appendChild(script);
    });
    if (!window.Hands) throw new Error('MediaPipe 未能初始化，请重试。');
  }
  function errorMessage(error) {
    if (error.name==='NotAllowedError'||error.name==='SecurityError') return '摄像头权限未开启。请在地址栏允许摄像头，再点击重试。';
    if (error.name==='NotFoundError') return '没有找到摄像头。请连接摄像头后重试。';
    if (error.name==='NotReadableError'||error.name==='AbortError') return '摄像头被其他应用占用或已断开，请检查后重试。';
    return error.message && /[\u4e00-\u9fff]/.test(error.message) ? error.message : '手势模型加载失败，请检查网络后重试。';
  }
  async function start() {
    if (enabled || starting) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setStatus('请通过 HTTPS 或本机 localhost 打开游戏，再使用摄像头。'); return;
    }
    starting=true; const token=++session;
    $('gestureEnable').disabled=true; $('gestureEnable').textContent='正在连接…';
    setStatus('正在请求摄像头权限并加载模型…');
    let pendingStream=null, pendingDetector=null;
    try {
      // Ask from the user's button action, then load the model without blocking the game loop.
      pendingStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:30}},audio:false});
      if(token!==session){pendingStream.getTracks().forEach(t=>t.stop());return;}
      stream=pendingStream; video.srcObject=stream; await video.play();
      stream.getVideoTracks()[0].addEventListener('ended',()=>{if(token===session){stop();setStatus('摄像头已断开，可重新连接后重试。');}});
      await ensureMediaPipe();
      if(token!==session)return;
      pendingDetector=new window.Hands({locateFile:file=>modelCDN+file});
      detector=pendingDetector;
      detector.setOptions({maxNumHands:2,modelComplexity:0,minDetectionConfidence:0.6,minTrackingConfidence:0.55,selfieMode:false});
      detector.onResults(results=>{if(token===session&&enabled)onResults(results);});
      setStatus('正在加载手部模型，首次连接可能需要稍等…');
      await Promise.race([detector.initialize(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('模型加载超时，请检查网络后重试。')),25000))]);
      if(token!==session)return;
      enabled=true; starting=false; lastResults=performance.now(); lastState=null; previousVideoTime=-1; resultTimes=[];trackedPalms.clear();
      engine.calibrate(); lostPaused=false; bridge.setGestureActive(true);
      $('gestureEnable').disabled=true; $('gestureEnable').textContent='体感已开启';
      $('gestureCalibrate').disabled=false; $('gestureStop').hidden=false;
      $('gestureLaunch').hidden=false; $('gestureBadge').hidden=false; $('gesturePreviewNote').hidden=true;
      setStatus('请双手自然放在舒适位置，左掌停稳完成校准；右手停稳准备短挥。');
      setBadge('体感已连接 · 等待左手校准');
      loadThreePreview();
      watchdog=setInterval(()=>{
        if(!enabled)return;
        const elapsed=performance.now()-lastResults;
        if(elapsed>220)bridge.setMove([0,0]);
        if(elapsed>1000){clearInput();autoPause('识别暂停 · 已自动暂停，请检查摄像头');}
      },120);
      schedule(token,0);
    } catch(error) {
      if(token!==session){pendingStream?.getTracks().forEach(t=>t.stop());return;}
      stop(); setStatus(errorMessage(error)); $('gestureEnable').textContent='重试连接';
    }
  }
  function stop() {
    const wasRunning=enabled;
    ++session; enabled=false; starting=false; clearTimeout(timer); clearInterval(watchdog);
    if(frameCallback!==null){video.cancelVideoFrameCallback?.(frameCallback);frameCallback=null;}
    if(wasRunning&&bridge.getState()==='play')bridge.pause();
    clearInput();bridge.setGestureActive(false);engine.reset();lastHands=[];trackedPalms.clear();renderSkeleton([]);
    stream?.getTracks().forEach(track=>track.stop()); stream=null; video.srcObject=null;
    const oldDetector=detector;detector=null;
    if(oldDetector)Promise.resolve(oldDetector.close()).catch(()=>{});
    skeleton3D?.render([]);
    $('gestureEnable').disabled=false;$('gestureEnable').textContent='开启摄像头';
    $('gestureCalibrate').disabled=true;$('gestureStop').hidden=true;$('gestureBadge').hidden=true;
    $('gesturePreviewNote').hidden=false;$('gestureLeft').textContent='○ 左手';$('gestureRight').textContent='○ 右手';
    $('gestureLeft').className=$('gestureRight').className='';$('gestureFPS').textContent='待机';
    setStatus('体感已关闭，摄像头已释放。键盘和鼠标可继续游戏。');
  }
  function schedule(token,delay) {
    if(!enabled||token!==session)return;
    // The camera's frame callback removes timer drift and duplicate-frame work.
    if(video.requestVideoFrameCallback&&!document.hidden&&video.readyState>=2){
      frameCallback=video.requestVideoFrameCallback(()=>{frameCallback=null;infer(token);});
    }else timer=setTimeout(()=>infer(token),delay);
  }
  async function infer(token) {
    if(!enabled||token!==session)return;
    if(document.hidden){schedule(token,100);return;}
    if(video.readyState<2||video.currentTime===previousVideoTime){schedule(token,4);return;}
    previousVideoTime=video.currentTime;
    const began=performance.now();
    try {await detector.send({image:video});}
    catch(error){if(token===session){stop();setStatus(errorMessage(error));}return;}
    if(!enabled||token!==session)return;
    averageMs=averageMs*.88+(performance.now()-began)*.12;
    // One inference at a time; aim for the camera's 30 Hz without a queue.
    schedule(token,Math.max(0,33-(performance.now()-began)));
  }
  function autoPause(message) {
    bridge.setMove([0,0]);
    if(bridge.getState()==='play'){bridge.pause();lostPaused=true;}
    setBadge(message);
  }
  function onResults(results) {
    const now=performance.now();lastResults=now;
    resultTimes.push(now);resultTimes=resultTimes.filter(time=>now-time<=1000);
    const hands=[];
    (results.multiHandLandmarks||[]).forEach((landmarks,i)=>{
      const handed=results.multiHandedness?.[i];
      if(!handed||handed.score<.55)return;
      // Camera pixels are unmirrored. MediaPipe assumes mirrored input: swap its labels,
      // then mirror x once to match the selfie preview and intuitive screen movement.
      const landmarksMirrored=landmarks.map(p=>({x:1-p.x,y:p.y,z:p.z}));
      let side=handed.label==='Right'?'Left':'Right';
      // Keep a briefly ambiguous label with the same physical palm.
      if(handed.score<.8){
        const palm=landmarksMirrored[9];
        const candidates=[...trackedPalms.entries()].filter(([,previous])=>now-previous.at<200).map(([side,previous])=>({side,d:Math.hypot(previous.landmarks[9].x-palm.x,previous.landmarks[9].y-palm.y)})).sort((a,b)=>a.d-b.d);
        if(candidates[0]?.d<.12&&!hands.some(h=>h.side===candidates[0].side))side=candidates[0].side;
      }
      hands.push({side,landmarks:landmarksMirrored});
    });
    for(const hand of hands)trackedPalms.set(hand.side,{landmarks:hand.landmarks,at:now});
    lastHands=hands;
    const state=bridge.getState();
    if(state!==lastState){
      clearInput();
      // Keep the raised-palms latch through a real pause/resume pair.
      const pausePair=(lastState==='play'&&state==='result'&&bridge.isPaused())||(lastState==='result'&&state==='play'&&lastWasPaused);
      if(!pausePair)engine.reset();
      pinchConsumed=true;uiBlockedUntil=now+500;lastState=state;
    }
    lastWasPaused=bridge.isPaused();
    output=engine.process(hands,now,{state:panel.hidden?state:'settings',paused:bridge.isPaused(),sensitivity:Number($('gestureSensitivity').value),pauseGesture:!!$('gesturePauseWithHands').checked});
    if(panel.hidden&&!document.hidden&&!bridge.isTransitioning()){
      bridge.setMove(output.move,output.brake||(!output.leftVisible&&!output.leftTrackingGrace));
      $('gestureMovePad').hidden=state!=='play';
      $('gestureMoveDot').style.transform='translate('+Math.round(output.move[0]*28)+'px,'+Math.round(output.move[1]*28)+'px)';
      if(output.pause){bridge.togglePause();clearInput();lostPaused=false;uiBlockedUntil=now+800;}
      else if(state==='play'){
        lostPaused=false;
        if(output.dash)bridge.dash(output.dashDirection);
        else if(output.attack)bridge.attack(output.attackDirection);
      }
      if(state==='play'&&!output.leftVisible&&!output.rightVisible){
        if(!onResults.noHandSince)onResults.noHandSince=now;
        if(now-onResults.noHandSince>900)autoPause('双手离开画面 · 已自动暂停');
      } else onResults.noHandSince=0;
      if(state!=='play')navigateUI(output,now);
      else $('gestureCursor').hidden=true;
    }else{bridge.setMove([0,0]);clearTarget();$('gestureCursor').hidden=true;}
    if(now-lastUI>110){
      lastUI=now;if(!panel.hidden)renderSkeleton(hands);
      for(const side of ['Left','Right']){const found=output[side.toLowerCase()+'Visible'];$("gesture"+side).textContent=(found?'● ':'○ ')+(side==='Left'?'左手':'右手');$("gesture"+side).className=found?'found':'';}
      const measuredHz=resultTimes.length>1?Math.round((resultTimes.length-1)*1000/(now-resultTimes[0])):0;
      $('gestureFPS').textContent=measuredHz+' Hz · '+Math.round(averageMs)+' ms';
      if(!output.calibrated){setStatus('左掌自然展开并停稳 · 校准 '+Math.round(output.calibrationProgress*100)+'%');setBadge('体感已连接 · 左掌停稳校准');}
      else {
        setStatus(panel.hidden?'左掌校准完成。右手'+(output.rightReady?'已就绪，可小幅短挥。':'请收手放松停稳，准备下一刀。'):'左掌校准完成。返回游戏后，右手自然停稳即可准备短挥。');
        if(!lostPaused)setBadge(output.leftVisible||output.rightVisible?'轻移即走 · '+(output.swipeState==='returning'?'收手停稳续刀':output.rightReady?'小幅短挥出刀':'右手停稳准备')+' · 捏合闪击':'等待双手入镜');
      }
    }
  }
  function navigateUI(result,now) {
    if(!result.cursor||!result.rightVisible||now<uiBlockedUntil){clearTarget();$('gestureCursor').hidden=true;return;}
    const point=result.cursor;
    const x=point.x*1280,y=point.y*640;
    const cursor=$('gestureCursor');cursor.hidden=false;cursor.style.left=x+'px';cursor.style.top=y+'px';
    const rect=stage.getBoundingClientRect();
    const element=document.elementFromPoint(rect.left+point.x*rect.width,rect.top+point.y*rect.height);
    const target=element?.closest('button,.upCard,.lvCard');
    const allowed=target&&stage.contains(target)&&!target.disabled&&!target.classList.contains('locked')&&!['btnDownload','btnExport','btnQuit','btnNewSave'].includes(target.id);
    if(!allowed){clearTarget();if(!result.pinch)pinchConsumed=false;return;}
    if(target!==uiTarget){clearTarget();uiTarget=target;target.classList.add('gestureHover');}
    if(!result.pinch){dwellStart=0;pinchConsumed=false;cursor.style.setProperty('--dwell','0%');return;}
    if(pinchConsumed)return;
    if(!dwellStart)dwellStart=now;
    cursor.style.setProperty('--dwell',Math.min(100,(now-dwellStart)/600*100)+'%');
    if(now-dwellStart>=600){pinchConsumed=true;uiBlockedUntil=now+700;const chosen=uiTarget;clearTarget();chosen.click();}
  }
  function renderSkeleton(hands) {
    context.clearRect(0,0,320,240);
    if(skeleton3D){skeleton3D.render(hands);return;}
    for(const hand of hands){
      context.strokeStyle=hand.side==='Left'?'#97e6d3':'#e6c895';context.lineWidth=1.4;
      for(const chain of chains){context.beginPath();chain.forEach((index,i)=>{const p=hand.landmarks[index];if(i)context.lineTo(p.x*320,p.y*240);else context.moveTo(p.x*320,p.y*240);});context.stroke();}
      context.fillStyle=context.strokeStyle;for(const p of hand.landmarks){context.beginPath();context.arc(p.x*320,p.y*240,2,0,Math.PI*2);context.fill();}
    }
  }
  async function loadThreePreview() {
    if(skeleton3D)return;
    try {
      const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
      if(!enabled)return;
      const canvas=$('gestureThree');
      const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false,powerPreference:'low-power'});
      renderer.setPixelRatio(1);renderer.setSize(320,240,false);renderer.setClearColor(0x000000,0);
      const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(0,320,240,0,.1,1000);camera.position.z=500;
      const pairs=chains.flatMap(chain=>chain.slice(1).map((id,i)=>[chain[i],id]));
      const layers=['Left','Right'].map((side,i)=>{
        const data=new Float32Array(pairs.length*6),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data,3));
        const line=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:i?0xe6c895:0x97e6d3,transparent:true,opacity:.95}));line.frustumCulled=false;scene.add(line);
        const pointGeometry=new THREE.BufferGeometry();pointGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(63),3));
        const points=new THREE.Points(pointGeometry,new THREE.PointsMaterial({color:i?0xe6c895:0x97e6d3,size:3,sizeAttenuation:false}));points.frustumCulled=false;scene.add(points);
        return {side,line,points};
      });
      skeleton3D={render(hands){
        for(const layer of layers){const hand=hands.find(h=>h.side===layer.side);layer.line.visible=layer.points.visible=!!hand;if(!hand)continue;
          const segments=layer.line.geometry.attributes.position,points=layer.points.geometry.attributes.position;
          const write=(attribute,i,p)=>attribute.setXYZ(i,p.x*320,(1-p.y)*240,-p.z*180);
          pairs.flat().forEach((id,i)=>write(segments,i,hand.landmarks[id]));hand.landmarks.forEach((p,i)=>write(points,i,p));segments.needsUpdate=points.needsUpdate=true;
        }renderer.render(scene,camera);
      }};
      canvas.hidden=false;$('gestureSkeleton').hidden=true;
      canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();skeleton3D=null;canvas.hidden=true;$('gestureSkeleton').hidden=false;});
      renderSkeleton(lastHands);
    }catch(_){/* 2D overlay already provides identical feedback if WebGL/CDN is unavailable. */}
  }
  $('gestureEnable').onclick=start;
  $('gestureStop').onclick=stop;
  $('gestureCalibrate').onclick=()=>{engine.calibrate();clearInput();lostPaused=false;setStatus('请在舒适位置自然展开左掌并停稳，重新校准。');};
  document.addEventListener('visibilitychange',()=>{
    clearInput();engine.reset();
    if(document.hidden&&enabled&&bridge.getState()==='play'){bridge.pause();hiddenPaused=true;}
    else if(!document.hidden&&hiddenPaused){setBadge('已自动暂停 · 准备好后继续');hiddenPaused=false;}
  });
  window.addEventListener('blur',()=>{if(enabled){clearInput();engine.reset();if(bridge.getState()==='play')bridge.pause();}});
  window.addEventListener('pagehide',stop);
  window.EgretGestureControls = { stop, close: closePanel };
  // Keep the original download affordance useful: inline only our local extension;
  // the original art/music remain embedded and MediaPipe keeps its regular script tag.
  $('btnDownload').onclick=async()=>{
    try {
      let main,assets;
      if(location.protocol==='file:'||!document.querySelector('script[src="gesture-core.js"]')){
        const root=document.documentElement.cloneNode(true);
        for(const id of ['gestureLaunch','gestureBadge','gestureCursor','gesturePanel','gestureMovePad','gamepadLaunch','gamepadBadge','gamepadPanel'])root.querySelector('#'+id)?.remove();
        for(const item of root.querySelectorAll('.gamepadFocused,.gestureHover'))item.classList.remove('gamepadFocused','gestureHover');
        root.querySelector('#wrap')?.removeAttribute('style');
        root.querySelector('#menuHero')?.removeAttribute('src');
        main='<!DOCTYPE html>\n'+root.outerHTML;
      }else{
        main=await fetch(location.href).then(r=>{if(!r.ok)throw new Error();return r.text();});
        const files=['gesture.css','gamepad.css','gesture-core.js','gesture-controller.js','gamepad-core.js','gamepad-navigation.js','gamepad-controller.js'];
        assets=await Promise.all(files.map(async file=>{const r=await fetch(file);if(!r.ok)throw new Error();return {file,text:await r.text()};}));
      }
      if(assets){
        for(const {file,text} of assets){
          if(file.endsWith('.css'))main=main.replace('<link rel="stylesheet" href="'+file+'">',()=>'<style>'+text+'</style>');
          else main=main.replace('<script src="'+file+'"><\/script>',()=>'<script>'+text.replace(/<\/script/gi,'<\\/script')+'<\/script>');
        }
      }
      const url=URL.createObjectURL(new Blob([main],{type:'text/html;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='白鹭击浪_手柄版.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
      document.getElementById('senseNote').textContent='已下载含手柄与体感的游戏。手柄和原素材可离线使用，摄像头识别首次加载需要联网。';
    }catch(_){document.getElementById('senseNote').textContent='下载未完成，请使用交付的完整游戏包。';}
  };
})();
