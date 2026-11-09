/* Live menu magnifier: samples the existing video lettering, never changes media. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EgretHomeMenuFX = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function proximity(point, rect, radius = 42) {
    if (!point || radius <= 0) return 0;
    const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
    const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
    const t = Math.min(1, Math.hypot(dx, dy) / radius);
    return 1 - t * t * (3 - 2 * t);
  }
  function mount({ stage, buttons, isActive, getSource, reducedMotion }) {
    const doc = stage.ownerDocument;
    stage.insertAdjacentHTML('beforeend', `<svg id="homeInkFilters" width="0" height="0" aria-hidden="true"><defs>
      <filter id="homeInkLetterFilter" x="-30%" y="-50%" width="160%" height="200%" color-interpolation-filters="sRGB">
        <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  10 -8 -4 0 0" result="letters"/>
        <feTurbulence id="homeInkNoise" type="fractalNoise" baseFrequency=".018 .045" numOctaves="2" seed="18" result="grain"/>
        <feColorMatrix in="grain" type="matrix" values=".22 0 0 0 .23  0 .15 0 0 .075  0 0 .09 0 .035  0 0 0 .45 0" result="wash"/>
        <feComposite in="wash" in2="letters" operator="in" result="inkFlow"/>
        <feBlend in="letters" in2="inkFlow" mode="screen"/>
      </filter></defs></svg>`);
    const noise = doc.getElementById('homeInkNoise');
    let point = null, frame = null, last = 0, lastPaint = -Infinity, failed = false;
    const entries = buttons.map(button => {
      const surface = doc.createElement('span'); surface.className = 'homeInkSurface'; surface.setAttribute('aria-hidden','true');
      const paper = doc.createElement('canvas'), letters = doc.createElement('canvas');
      paper.className = 'homeInkPaper'; letters.className = 'homeInkLetters';
      surface.append(paper, letters); button.appendChild(surface);
      return {button, paper, letters, paperCtx:paper.getContext('2d'), letterCtx:letters.getContext('2d'), amount:0};
    });
    function sample(entry, source, stageRect) {
      const r = entry.button.getBoundingClientRect();
      const x=(r.left-stageRect.left)*1280/stageRect.width, y=(r.top-stageRect.top)*659.039/stageRect.height;
      const width=r.width*1280/stageRect.width+20, height=r.height*659.039/stageRect.height+16;
      const sw=source.videoWidth||source.naturalWidth, sh=source.videoHeight||source.naturalHeight;
      if (!sw || !sh || !entry.paperCtx || !entry.letterCtx) return false;
      // Only drawImage is used: file:// video does not need readable pixel access.
      const w=Math.ceil(width*2), h=Math.ceil(height*2);
      if (entry.paper.width!==w||entry.paper.height!==h) {
        entry.paper.width=entry.letters.width=w; entry.paper.height=entry.letters.height=h;
      }
      for (const ctx of [entry.paperCtx,entry.letterCtx]) {
        ctx.clearRect(0,0,w,h);
        ctx.drawImage(source,(x-10)/1280*sw,(y-8)/659.039*sh,width/1280*sw,height/659.039*sh,0,0,w,h);
      }
      entry.button.classList.add('ink-sampled');
      return true;
    }
    function paint(now) {
      frame=null;
      if (!isActive()||doc.hidden) { reset();return; }
      const dt=Math.min(.06,Math.max(0,(now-(last||now))/1000));last=now;
      const sr=stage.getBoundingClientRect();
      const logicalPoint=point?{x:(point.x-sr.left)*1280/sr.width,y:(point.y-sr.top)*659.039/sr.height}:null;
      let closest=null, best=0;
      for(const entry of entries){
        const r=entry.button.getBoundingClientRect();
        const score=proximity(logicalPoint,{left:(r.left-sr.left)*1280/sr.width,right:(r.right-sr.left)*1280/sr.width,top:(r.top-sr.top)*659.039/sr.height,bottom:(r.bottom-sr.top)*659.039/sr.height});
        if(score>best){best=score;closest=entry;}
      }
      const source=getSource(), shouldPaint=now-lastPaint>=1000/30;
      let lit=false;
      for(const entry of entries){
        const focus=entry.button.classList.contains('gamepadFocused')||entry.button.matches(':focus-visible');
        const target=closest?(entry===closest?best:0):(focus?1:0);
        entry.amount+=(target-entry.amount)*(1-Math.exp(-dt*14));
        if(Math.abs(entry.amount-target)<.001)entry.amount=target;
        entry.button.style.setProperty('--home-proximity',entry.amount.toFixed(4));
        entry.button.style.setProperty('--home-scale',String(1+(reducedMotion.matches?0:.052)*entry.amount));
        lit ||= entry.amount>.015;
        if(source&&shouldPaint&&!failed)try{sample(entry,source,sr);}catch(_){failed=true;entry.button.classList.remove('ink-sampled');}
      }
      if(shouldPaint){
        if(lit&&!reducedMotion.matches){const t=now*.001;noise.setAttribute('baseFrequency',(.018+Math.sin(t*.8)*.003).toFixed(4)+' '+(.045+Math.cos(t*.6)*.006).toFixed(4));}
        lastPaint=now;
      }
      frame=requestAnimationFrame(paint);
    }
    function reset(){last=0;for(const entry of entries){entry.amount=0;entry.button.style.setProperty('--home-proximity','0');entry.button.style.setProperty('--home-scale','1');entry.button.classList.remove('ink-sampled');}}
    function sync(){
      if(isActive()&&!doc.hidden){if(frame===null){lastPaint=-Infinity;frame=requestAnimationFrame(paint);}}
      else {if(frame!==null)cancelAnimationFrame(frame);frame=null;reset();}
    }
    const move=event=>{if(event.pointerType!=='touch')point={x:event.clientX,y:event.clientY};};
    const leave=()=>{point=null;};
    const focus=event=>{if(event.target?.classList?.contains('gamepadFocused'))point=null;};
    stage.addEventListener('pointermove',move,{passive:true});stage.addEventListener('pointerleave',leave);
    stage.addEventListener('keydown',leave,true);stage.addEventListener('focusin',focus);
    doc.addEventListener('visibilitychange',sync);sync();
    return {sync,destroy(){if(frame!==null)cancelAnimationFrame(frame);frame=null;stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerleave',leave);stage.removeEventListener('keydown',leave,true);stage.removeEventListener('focusin',focus);doc.removeEventListener('visibilitychange',sync);reset();doc.getElementById('homeInkFilters')?.remove();for(const e of entries)e.paper.parentElement?.remove();}};
  }
  return {proximity,mount};
});
