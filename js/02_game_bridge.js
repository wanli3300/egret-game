
/* Only new input adapters; all combat, upgrades, saves and artwork are original. */
window.EgretGameBridge = (() => {
  let move = [0,0], moveAt = 0, active = false, facing = 0, inputMode = 'none';
  const canAct = () => state === 'play' && !_transitionBusy && !document.hidden && slowmoT <= 0 && !pendingClear;
  const stop = () => { move = [0,0]; player.vx = 0; player.vy = 0; };
  const directionAngle = direction => {
    if(!Array.isArray(direction)||direction.length!==2||!direction.every(Number.isFinite)||Math.hypot(...direction)<0.01)return null;
    return Math.atan2(direction[1],direction[0]);
  };
  const setMode = (mode, value) => {
    if(!value && inputMode !== mode)return;
    inputMode = value ? mode : 'none'; active = !!value;
    facing = player.facing; stop();
  };
  return {
    getState: () => state,
    isPaused: () => state === 'result' && pausedNow,
    isTransitioning: () => _transitionBusy,
    setGestureActive: value => setMode('gesture', value),
    setGamepadActive: value => setMode('gamepad', value),
    isActive: () => active,
    isGestureActive: () => inputMode === 'gesture',
    getInputSource: () => inputMode,
    setMove: (value, brake) => { move = value.slice(); moveAt = performance.now(); if(active&&(brake||Math.hypot(...move)<0.01))stop(); },
    getMove: () => { if(active&&canAct()&&performance.now()-moveAt<220)return move; if(active)stop(); return [0,0]; },
    getFacing: () => { if(!active)return null; if(player.atkT<=0&&Math.hypot(...move)>0.1&&performance.now()-moveAt<220)facing=Math.atan2(move[1],move[0]); return facing; },
    attack: direction => { const angle=directionAngle(direction);if(active&&canAct()&&angle!==null){facing=angle;player.facing=angle;triggerAttack();} },
    dash: direction => { const angle=directionAngle(direction);if(active&&canAct()&&angle!==null){facing=angle;player.facing=angle;tryDash([Math.cos(angle),Math.sin(angle)]);} },
    gamepadMouseAction: (button, direction) => {
      const angle=directionAngle(direction);
      if(inputMode!=='gamepad'||!canAct()||angle===null||(button!==0&&button!==2))return;
      facing=angle;player.facing=angle;
      // Match the original mousedown listeners in their original order.
      triggerAttack();
      if(button===2)tryDash([Math.cos(angle),Math.sin(angle)]);
    },
    gamepadBack: () => {
      if(_transitionBusy||document.hidden)return false;
      stop();
      if(state==='play'){handleAct('pause');return true;}
      if(state==='result'){handleAct(pausedNow?'resume':'sel');return true;}
      if(state==='select'){handleAct('home');return true;}
      return false;
    },
    pause: () => { stop(); if(state === 'play'){ for(const k in keys)keys[k]=false;handleActInner('pause'); } },
    togglePause: () => { stop(); if(_transitionBusy)return; if(state === 'play')handleAct('pause');else if(state === 'result'&&pausedNow)handleAct('resume'); }
  };
})();
