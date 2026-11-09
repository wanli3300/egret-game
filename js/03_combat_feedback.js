(function(root){
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number(n)||0));
  // Resolve control once per window. Repeated hits refresh slow, never stack its strength.
  function hit(e,player,angle){
    e.hitRedT=.3;
    const boss=!!e.isBoss, walking=e.state==='walk';
    if(walking && !(e.controlCooldown>0)){
      const distance=32*(1+clamp(player.knockbackBonus,0,1))*(boss?.28:1);
      e.knockX=Math.cos(angle)*distance;e.knockY=Math.sin(angle)*distance;e.knockT=.14;
      e.hitStun=boss?.035:.11;e.controlCooldown=boss?.85:.5;
    }
    const slow=clamp(player.hitSlow,0,.35);
    if(slow>0){e.hitSlow=slow*(boss?.4:1);e.hitSlowT=boss?.7:1.2;}
  }
  function tick(e,dt,w,h,visualDt=dt){
    e.hitRedT=Math.max(0,(e.hitRedT||0)-visualDt);
    e.controlCooldown=Math.max(0,(e.controlCooldown||0)-dt);
    e.hitSlowT=Math.max(0,(e.hitSlowT||0)-dt);
    const stunned=(e.hitStun||0)>0 && e.state==='walk';
    e.hitStun=Math.max(0,(e.hitStun||0)-dt);
    if(e.knockT>0){
      const step=Math.min(dt,e.knockT)/.14;
      e.x=clamp(e.x+(e.knockX||0)*step,-60,w+60);
      e.y=clamp(e.y+(e.knockY||0)*step,-60,h+60);
      e.knockT=Math.max(0,e.knockT-dt);
    }
    return stunned;
  }
  function speed(e,globalSlow){
    const baseline=e.isBoss?Math.max(.65,globalSlow):globalSlow;
    return Math.max(e.isBoss?.55:.35,baseline*(1-(e.hitSlowT>0?e.hitSlow||0:0)));
  }
  function createHaptics(){
    let next=0,actuator=null;
    return {
      hit(pad,now,allowed,critical){
        if(!allowed||!pad||pad.connected===false||now<next)return false;
        const a=pad.vibrationActuator||pad.hapticActuators?.[0];if(!a)return false;
        try{
          let result;
          if(typeof a.playEffect==='function')result=a.playEffect('dual-rumble',{startDelay:0,duration:critical?65:48,weakMagnitude:critical?.23:.16,strongMagnitude:.07});
          else if(typeof a.pulse==='function')result=a.pulse(.16,48);
          else return false;
          next=now+85;actuator=a;Promise.resolve(result).catch(()=>{});return true;
        }catch(_){return false;}
      },
      stop(){next=0;try{Promise.resolve(actuator?.reset?.()).catch(()=>{});}catch(_){}actuator=null;}
    };
  }
  const tintCache=new WeakMap();
  function redSprite(image){
    if(!image)return image;if(tintCache.has(image))return tintCache.get(image);
    const c=document.createElement('canvas');c.width=image.naturalWidth||image.width;c.height=image.naturalHeight||image.height;
    const g=c.getContext('2d');g.drawImage(image,0,0);g.globalCompositeOperation='source-in';g.fillStyle='#cf342e';g.fillRect(0,0,c.width,c.height);tintCache.set(image,c);return c;
  }
  function feather(g,x,y,size,angle,color){
    g.save();g.translate(x,y);g.rotate(angle);g.fillStyle=color;g.strokeStyle='rgba(36,47,48,.6)';g.lineWidth=.65;
    g.beginPath();g.moveTo(-size*3,0);g.bezierCurveTo(-size,-size*1.5,size*2,-size,size*3,0);g.bezierCurveTo(size,size*.7,-size,size*.8,-size*3,0);g.fill();
    g.beginPath();g.moveTo(-size*3,0);g.lineTo(size*2.7,0);g.stroke();g.restore();
  }
  const api={hit,tick,speed,createHaptics,redSprite,feather};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EgretCombatFeedback=api;
})(typeof window==='object'?window:globalThis);
