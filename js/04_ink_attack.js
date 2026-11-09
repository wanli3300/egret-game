(function(root){
  'use strict';
  const clamp=n=>Math.max(0,Math.min(1,n));
  const smooth=n=>{n=clamp(n);return n*n*(3-2*n);};
  const TIMING={L:{sweep:.21,hold:.085,fade:.48,life:.84},R:{sweep:.24,hold:.10,fade:.54,life:1.10}};
  // Each strip has its own arrival and dissolve clock: the tip always disappears last.
  function opacity(age,u,kind='L',reduced=false){
    if(age<0)return 0;
    if(reduced)return smooth(age/.04)*(1-smooth((age-.18)/.24));
    const t=TIMING[kind]||TIMING.L,local=age-clamp(u)*t.sweep;
    return smooth(local/.055)*(1-smooth((local-.055-t.hold)/t.fade));
  }
  function life(kind,reduced=false){return reduced?.44:(TIMING[kind]||TIMING.L).life;}
  function create(image){
    const available=()=>!!image&&image.complete&&(image.naturalWidth||image.width)>0;
    const strips=60;
    function ribbon(g,age,kind,r,start,end,thickness,reduced){
      const iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height;
      for(let i=0;i<strips;i++){
        const u=(i+.5)/strips,alpha=opacity(age,u,kind,reduced);if(alpha<.003)continue;
        const a=start+(end-start)*u,x=Math.cos(a)*r,y=Math.sin(a)*r*.78;
        const tx=-Math.sin(a),ty=Math.cos(a)*.78;
        const width=r*(end-start)/strips*Math.hypot(tx,ty)+1.1;
        g.save();g.translate(x,y);g.rotate(Math.atan2(ty,tx));g.globalAlpha=alpha;
        g.drawImage(image,i*iw/strips,0,iw/strips,ih,-width/2,-thickness/2,width,thickness);g.restore();
      }
    }
    function blade(g,age,x0,y0,x1,y1,width,reduced){
      const iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height;
      const dx=x1-x0,dy=y1-y0,len=Math.hypot(dx,dy),step=len/strips;
      g.save();g.translate(x0,y0);g.rotate(Math.atan2(dy,dx));
      for(let i=0;i<strips;i++){
        const alpha=opacity(age,(i+.5)/strips,'R',reduced);if(alpha<.003)continue;
        g.globalAlpha=alpha*.90;
        g.drawImage(image,i*iw/strips,0,iw/strips,ih,i*step,-width/2,step+.75,width);
      }
      g.restore();
    }
    function draw(g,f,reduced=false){
      if(!available())return false;
      g.save();g.translate(f.x,f.y-17);g.rotate(f.angle);
      if(f.kind==='L'){
        g.scale(1,f.dir||1);
        ribbon(g,f.age,'L',Math.min(290,f.range)*.94,-2.35,1.08,Math.min(210,f.range*1.05),reduced);
      }else{
        const distance=f.dash?Math.hypot(f.dash.nx-f.dash.ox,f.dash.ny-f.dash.oy):120;
        const rear=-Math.min(300,distance+55),front=Math.min(220,f.range*1.05);
        blade(g,f.age,rear,46,front,-46,46,reduced);
        blade(g,reduced?f.age:f.age-.065,rear+18,-35,front-25,36,40,reduced);
        g.scale(1,-(f.dir||1));
        ribbon(g,reduced?f.age:f.age-.13,'R',Math.min(335,f.range*1.05),-2.48,1.16,Math.min(220,f.range*1.06),reduced);
      }
      g.restore();return true;
    }
    return{ready:available,draw};
  }
  const api={opacity,life,create};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{
    const image=new Image();image.decoding='async';image.src='assets/vfx-v11/crane-ink-slash.png';
    root.EgretInkAttack={...api,...create(image)};
  }
})(typeof window==='object'?window:globalThis);
