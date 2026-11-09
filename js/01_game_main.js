
/* =====================================================
   第1步：底层战斗逻辑
   设计原则：输入抽象成 moveVec(x,y) 和 triggerAttack()，
   现在由键盘/鼠标驱动，以后摄像头接入只需替换这两个入口。
   ===================================================== */
const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');
ctx.imageSmoothingEnabled = true;    // 人形立绘缩放需要平滑
const W = cvs.width, H = cvs.height;

/* ---------- 舞台自适应：逻辑 1280×640 等比放大铺满窗口 ---------- */
const stage = document.getElementById('wrap');
function fitStage(){
  try {
    const s = Math.min(innerWidth / W, innerHeight / H);
    stage.style.setProperty('--fit', s);
  } catch(e){}
}
addEventListener('resize', fitStage);
fitStage();

/* ---------- 属性面板（以后升级卡片改这里） ---------- */
const player = {
  x: W/2, y: H/2, r: 22,
  speed: 340,              // 像素/秒
  hp: 100, hpMax: 100,
  mp: 100, mpMax: 100,
  mpRegen: 20,             // 每秒回蓝
  atk: 34,                 // 单次伤害
  atkRange: 155,           // 挥砍判定半径
  facing: 0,               // 面朝方向（弧度）——砍击跟随这个方向
  moving: false, animT: 0, // 移动状态与动画计时
  vx: 0, vy: 0,            // 速度（用于加速度平滑）
  spd01: 0, lean: 0, bob: 0, // 速度归一化 / 倾斜 / 起伏
  idleT: 0,                // 待机跳动计时
  atkT: 0, atkKind: 'L',   // 攻击帧动画计时 / 本次的攻击类型（L 左键攻击，R 右键斩击）
  mpCost: 12,              // 当前挥砍蓝耗（升级卡会改）
  hpRegen: 0,              // 每秒回血（升级获得）
  crit: 0,                 // 暴击概率
  critMul: 2.6,            // 暴击倍率
  comboBoost: 0,           // 连击伤害加成
  lifesteal: 0,            // 击杀回血
  dashT: 0,                // 冲刺计时（视觉用）
  atkT: 0,                 // 斩击帧动画计时（视觉用）
};

/* 主角：人形白鹭剑士（待机立绘 / 8帧跑步 / 8帧斩击）与倭寇敌人 */
function mkImg(d){ const i = new Image(); i.src = d; return i; }
/* 圆角矩形路径（笔触条 / 印章底用；兼容无 ctx.roundRect 的环境） */
function inkRR(g, x, y, w, h, r){
  if (w <= 0 || h <= 0) return;
  r = Math.min(r, h/2, w/2);
  g.beginPath();
  g.moveTo(x+r, y);
  g.lineTo(x+w-r, y); g.quadraticCurveTo(x+w, y, x+w, y+r);
  g.lineTo(x+w, y+h-r); g.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  g.lineTo(x+r, y+h); g.quadraticCurveTo(x, y+h, x, y+h-r);
  g.lineTo(x, y+r); g.quadraticCurveTo(x, y, x+r, y);
  g.closePath();
}
/* 十六进制色 → rgba（Boss 光晕用） */
function hexA(hex, a){
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}
/* ★ 受击白闪：预生成纯白版精灵（替代每帧 brightness(2.1) GPU 滤镜——部分显卡驱动上滤镜会崩渲染进程）
   懒生成 + 缓存，每个颜色 8 帧只算一次 */
const wokouWhiteCache = {};
function wokouWhiteOf(skin, fi){
  const key = skin + '_' + fi;
  if (wokouWhiteCache[key]) return wokouWhiteCache[key];
  const fr = wokouWalk[skin]; if (!fr) return null;
  const im = fr[fi]; if (!im || !im.complete || !im.naturalWidth) return null;
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(restoredEnemyOf(skin,fi)||im, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  wokouWhiteCache[key] = c;
  return c;
}
/* ===== 新主角：白鹭少年剑士（水彩/像素混合风）=====
   idle 3帧待机 · run 8帧移动 · atkL 8帧左键攻击 · atkR 8帧右键斩击 · back 4帧剑回空中
   全部帧统一画布与锚点：脚基线在 80% 高、脚部质心在水平中点 → 绘制代码无需按帧修正 */
const birdIdle = [mkImg('assets/embedded/a000.webp'),mkImg('assets/embedded/a001.webp'),mkImg('assets/embedded/a002.webp')];   // 待机
const birdRun = [mkImg('assets/embedded/a003.webp'),mkImg('assets/embedded/a004.webp'),mkImg('assets/embedded/a005.webp'),mkImg('assets/embedded/a006.webp'),mkImg('assets/embedded/a007.webp'),mkImg('assets/embedded/a008.webp'),mkImg('assets/embedded/a009.webp'),mkImg('assets/embedded/a010.webp')];   // 移动
const heroAtkL = [mkImg('assets/embedded/a011.webp'),mkImg('assets/embedded/a012.webp'),mkImg('assets/embedded/a013.webp'),mkImg('assets/embedded/a014.webp'),mkImg('assets/embedded/a015.webp'),mkImg('assets/embedded/a016.webp'),mkImg('assets/embedded/a017.webp'),mkImg('assets/embedded/a018.webp')];   // 左键攻击
const heroAtkR = [mkImg('assets/embedded/a019.webp'),mkImg('assets/embedded/a020.webp'),mkImg('assets/embedded/a021.webp'),mkImg('assets/embedded/a022.webp'),mkImg('assets/embedded/a023.webp'),mkImg('assets/embedded/a024.webp'),mkImg('assets/embedded/a025.webp'),mkImg('assets/embedded/a026.webp')];   // 右键斩击
const swordBack = [mkImg('assets/embedded/a027.webp'),mkImg('assets/embedded/a028.webp'),mkImg('assets/embedded/a029.webp'),mkImg('assets/embedded/a030.webp')];   // 剑回空中
const HERO_SCALE = 0.37;              // 源帧→显示（统一画布 360px 宽）
const ATK_L_DUR = 0.34;               // 左键攻击 8 帧总时长
const ATK_R_DUR = 0.36;               // 右键斩击 8 帧总时长
const SWORD_BACK_DUR = 0.34;          // 斩击后剑回空中 4 帧时长
const ATK_ANIM_DUR = ATK_L_DUR;       // 兼容旧引用
const wokouImgs = [mkImg('assets/embedded/a031.png'),mkImg('assets/embedded/a032.png'),mkImg('assets/embedded/a033.png'),mkImg('assets/embedded/a034.png'),mkImg('assets/embedded/a035.png')];
const wokouWalk = [
[mkImg('assets/embedded/a036.png'),mkImg('assets/embedded/a037.png'),mkImg('assets/embedded/a038.png'),mkImg('assets/embedded/a039.png'),mkImg('assets/embedded/a040.png'),mkImg('assets/embedded/a041.png'),mkImg('assets/embedded/a042.png'),mkImg('assets/embedded/a043.png')],
[mkImg('assets/embedded/a044.png'),mkImg('assets/embedded/a045.png'),mkImg('assets/embedded/a046.png'),mkImg('assets/embedded/a047.png'),mkImg('assets/embedded/a048.png'),mkImg('assets/embedded/a049.png'),mkImg('assets/embedded/a050.png'),mkImg('assets/embedded/a051.png')],
[mkImg('assets/embedded/a052.png'),mkImg('assets/embedded/a053.png'),mkImg('assets/embedded/a054.png'),mkImg('assets/embedded/a055.png'),mkImg('assets/embedded/a056.png'),mkImg('assets/embedded/a057.png'),mkImg('assets/embedded/a058.png'),mkImg('assets/embedded/a059.png')],
[mkImg('assets/embedded/a060.png'),mkImg('assets/embedded/a061.png'),mkImg('assets/embedded/a062.png'),mkImg('assets/embedded/a063.png'),mkImg('assets/embedded/a064.png'),mkImg('assets/embedded/a065.png'),mkImg('assets/embedded/a066.png'),mkImg('assets/embedded/a067.png')],
[mkImg('assets/embedded/a068.png'),mkImg('assets/embedded/a069.png'),mkImg('assets/embedded/a070.png'),mkImg('assets/embedded/a071.png'),mkImg('assets/embedded/a072.png'),mkImg('assets/embedded/a073.png'),mkImg('assets/embedded/a074.png'),mkImg('assets/embedded/a075.png')]
];

const BIRD_W = 64;                                   // 显示宽度（32px 源图 ×2 整数倍缩放，细节不变）
const SECTOR_HALF = 0.85;                             // 判定扇形半角（≈49°，与刀光扫动范围一致）
const MP_COST_BASE = 12;   // 每次挥砍基础耗蓝（实际用 player.mpCost）
let MP_COST = MP_COST_BASE;
const COMBO_TIME = 2.0;    // 连击保持时间

/* ---------- 输入层（摄像头以后替换这里） ---------- */
const keys = {};
addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  /* ★ 屏蔽浏览器快捷键：战斗中一直按着 WASD，误碰 Ctrl 会触发 Ctrl+S"保存网页" / Ctrl+O"打开文件"
     / Ctrl+P 打印 / Ctrl+F 查找等系统对话框，打断战斗 */
  if (e.ctrlKey || e.metaKey){
    const k = (e.key || '').toLowerCase();
    if (k === 's' || k === 'p' || k === 'o' || k === 'f' || k === 'g' ||
        k === 'd' || k === 'u' || k === 'r') e.preventDefault();
  }
});
addEventListener('keyup',   e => keys[e.key.toLowerCase()] = false);
function getMoveVec(){
  if (window.EgretGameBridge && window.EgretGameBridge.isActive()) return window.EgretGameBridge.getMove();          // 返回单位化移动向量
  let x = (keys['d']||keys['arrowright']?1:0) - (keys['a']||keys['arrowleft']?1:0);
  let y = (keys['s']||keys['arrowdown']?1:0) - (keys['w']||keys['arrowup']?1:0);
  const len = Math.hypot(x,y);
  return len ? [x/len, y/len] : [0,0];
}
let mouse = {x:W/2, y:H/2, sx:W/2, sy:H/2};
cvs.addEventListener('mousemove', e => {
  const rc = cvs.getBoundingClientRect();
  mouse.sx = (e.clientX-rc.left) * W/rc.width;
  mouse.sy = (e.clientY-rc.top)  * H/rc.height;
  mouse.x = mouse.sx + BailuWorld.cam.x; mouse.y = mouse.sy + BailuWorld.cam.y;   // world coordinates
});
cvs.addEventListener('mousedown', () => { if (!window.EgretGameBridge || !window.EgretGameBridge.isActive()) triggerAttack(); });

/* ---------- 闪击：鼠标右键朝鼠标方向瞬移 3 羊身 + 顺发斩击 ---------- */
let DASH_DIST = 220;         // ≈3只羊身位
const DASH_COST = 30;        // 闪击耗蓝
let DASH_WIDTH = 70;         // 闪击路径伤害半宽（升级卡可加）
let enemySlowMul = 1;        // 敌人减速倍率（升级卡可改）
let afterimages = [];        // 残影 {x,y,flip,t,dur}
let lastTap = {};            // 双击计时

/* 无敌帧：闪击过程全程无敌 + 落点额外 0.3s */
let invulnT = 0;             // 剩余无敌时间（秒）
const DASH_END_INVULN = 0.3; // 落点追加无敌时长

cvs.addEventListener('mousedown', e => {
  if (window.EgretGameBridge && window.EgretGameBridge.isActive()) return;
  if (e.button === 2){                          // 右键：闪击
    const dx = mouse.x - player.x, dy = mouse.y - player.y;
    const len = Math.hypot(dx, dy) || 1;
    tryDash([dx/len, dy/len]);                  // 朝鼠标方向闪
  }
});
cvs.addEventListener('contextmenu', e => e.preventDefault());   // 屏蔽右键菜单

function tryDash([dx,dy]){
  if (player.mp < DASH_COST){
    floatText(player.x, player.y - 55, '蓝不够！', '#4a6fa5');
    return;
  }
  player.mp -= DASH_COST;
  const ang = Math.atan2(dy, dx);
  player.facing = ang;                       // 闪击方向 = 斩击方向
  let nx = player.x + dx*DASH_DIST, ny = player.y + dy*DASH_DIST;
  if (BailuWorld.active()) [nx, ny] = BailuWorld.along(player.x, player.y, nx, ny, 12);   // stop at the lane edge
  else { nx = Math.max(40, Math.min(W-40, nx)); ny = Math.max(40, Math.min(H-40, ny)); }
  const ox = player.x, oy = player.y;        // 闪击起点（算路径伤害用）
  prepareDashVfx(ox,oy,nx,ny,ang);

  /* ★ 无敌帧：闪击过程（0.12s 冲刺）与落点 0.3s 全程免伤 */
  const dashDur = 0.12;
  invulnT = Math.max(invulnT, dashDur + DASH_END_INVULN);
  player.dashT = dashDur;                    // 冲刺激活（用于视觉拖尾）

  /* 路径伤害：闪击路线两侧 DASH_WIDTH 内的敌人全部吃一刀 */
  const segLen2 = (nx-ox)**2 + (ny-oy)**2 || 1;
  for (const e of enemies){
    if (e.dead) continue;
    // 敌人中心到闪击路径线段的最短距离
    let t = ((e.x-ox)*(nx-ox) + (e.y-oy)*(ny-oy)) / segLen2;
    t = Math.max(0, Math.min(1, t));
    const px = ox + (nx-ox)*t, py = oy + (ny-oy)*t;
    if (Math.hypot(e.x-px, e.y-py) < DASH_WIDTH + e.r){
      const r = rollDamage(); hitEnemy(e, r.dmg, r.isCrit);
    }
  }

  /* 路径残影：3 只渐隐羊 */
  for (let i = 1; i <= 3; i++){
    const p = i/4;
    afterimages.push({
      x: player.x + (nx-player.x)*p, y: player.y + (ny-player.y)*p,
      flip: Math.cos(ang) > 0, t: 0.35, dur: 0.35
    });
  }
  /* 路径斩光由新的连续刀光承载，原残影保持。 */
  player.x = nx; player.y = ny;
  doSlash(0, 'R');                           // 闪击附带的一刀不另扣蓝（30已含），播斩击+剑回动画
}

/* ---------- 战斗：挥砍 ---------- */
let slashFx = [];            // {x,y,angle,dir,t,dur}
let slashParts = [];         // 刀光拖尾粒子 {x,y,vx,vy,t,dur,r,color}
let combo = 0, comboTimer = 0;
const SLASH_DUR = 0.12;      // 挥砍动画时长（越小越快）
const SWEEP_SPAN = 1.7;      // 刀光扫过的弧度跨度（±0.85，与判定扇形一致）

function triggerAttack(){
  if (player.mp < player.mpCost){                 // 没蓝：砍不动 + 提示
    floatText(player.x, player.y - 55, '蓝不够！', '#4a6fa5');
    return;
  }
  doSlash(player.mpCost);
}
/* 单次伤害 = 基础攻击 × (连击加成) × (暴击) */
function rollDamage(){
  let dmg = player.atk;
  if (player.comboBoost > 0 && combo >= 5) dmg *= (1 + player.comboBoost);
  let isCrit = false;
  if (player.crit > 0 && Math.random() < player.crit){ dmg *= player.critMul; isCrit = true; }
  return { dmg, isCrit };
}
function doSlash(cost, kind){
  player.mp -= cost;
  combo++; comboTimer = COMBO_TIME;

  const ang = player.facing;                 // 砍向当前面朝方向（以后=右手拇指指向）
  const dir = (combo % 2 === 0) ? 1 : -1;   // 左右交替扫
  slashFx.push({x:player.x, y:player.y, angle:ang, dir, t:SLASH_DUR, dur:SLASH_DUR});
  /* ★ 攻击帧动画：左键=攻击8帧；右键=斩击8帧+剑回空中4帧 */
  player.atkKind = (kind === 'R') ? 'R' : 'L';
  player.atkDir = dir;                       // sword arc direction (visual)
  player.atkT = (kind === 'R') ? (ATK_R_DUR + SWORD_BACK_DUR) : ATK_L_DUR;
  beginAttackVfx(kind,ang,dir);
  // 新浪刃与动作逐帧同步。
  // 范围判定：以面朝方向为主的扇形
  for (const e of enemies){
    const dx=e.x-player.x, dy=e.y-player.y, d=Math.hypot(dx,dy);
    if (d < player.atkRange + e.r){
      const da = Math.abs(normalizeAngle(Math.atan2(dy,dx) - ang));
      if (da < SECTOR_HALF){ const r = rollDamage(); hitEnemy(e, r.dmg, r.isCrit); }
    }
  }
}
function normalizeAngle(a){ while(a>Math.PI)a-=2*Math.PI; while(a<-Math.PI)a+=2*Math.PI; return a; }
function hitEnemy(e, dmg, isCrit, playerHit = true){
  if (playerHit) BailuSprites.onHit(isCrit);   // visual hit-stop + 2-4px shake (real hit events only)
  if (!e || e.dead || !(dmg > 0)) return;
  /* ★ 紫色隐身期间减伤 50% */
  const stealthy = e.stealthT > 0;
  if (stealthy) dmg *= 0.5;
  e.hp -= dmg; e.hitRedT = 0.3;
  const a = Math.atan2(e.y-player.y, e.x-player.x);
  if (playerHit){
    EgretCombatFeedback.hit(e,player,a);
    window.EgretGamepadControls?.pulseHit(isCrit);
  }
  /* 伤害飘字：暴击更大更亮；隐身减伤用灰色 */
  floatText(e.x, e.y - e.r*2.2, (isCrit ? '暴击 ' : '') + Math.round(dmg),
            stealthy ? '#7a5aa8' : (isCrit ? '#e07b1f' : '#2a2a28'));
  emitImpactVfx(e,a,isCrit);
  if (e.hp <= 0 && !e.dead){
    e.dead = true; kills++; spawnDebris(e);
    if (e.isBoss){                                  // Boss 击杀反馈
      floatText(e.x, e.y - e.r*2.4, 'BOSS 击 破', '#e07b1f');
      bgmPlay('main');                              // ★ BOSS 倒下：切回主曲
      for (let i = 0; i < 10; i++) spawnDebris({x:e.x+(Math.random()-0.5)*60, y:e.y+(Math.random()-0.5)*60, r:e.r});
    }
    if (player.lifesteal > 0){                     // 掠食：击杀回血
      player.hp = Math.min(player.hpMax, player.hp + player.lifesteal);
      floatText(player.x, player.y - 40, '+' + player.lifesteal, '#3f8a4a');
    }
    /* ★ 通关最后一击：慢动作定格（最后一波的最后一只怪） */
    checkFinalBlow();
  }
}
/* 判断是否触发"最后一击"慢动作（★ 每一波的最后一只怪都触发，之后才弹升级卡） */
function checkFinalBlow(){
  const alive = enemies.filter(x => !x.dead).length;
  if (wave >= 1 && kills >= waveTarget && alive === 0 && slowmoT <= 0){
    slowmoT = SLOWMO_DUR; pendingClear = true;
    floatText(player.x, player.y - 90, '最 后 一 击', '#e07b1f');
  }
}

/* ---------- 敌人类型表（颜色 = 技能） ----------
   蓝 普通 / 绿 蓄力冲刺 / 红 自爆 / 紫 隐身 / 黄 三连斩
   每关会挑一个颜色作为 Boss（强化版）。 */
const ENEMY_TYPES = {
  blue:   { name:'浪人',   color:'#4a6fa5', hpMul:1.00, spdMul:1.00, dmgMul:1.00,
            trait:'普通近战' },
  green:  { name:'突刺',   color:'#3f8a4a', hpMul:1.05, spdMul:0.86, dmgMul:1.00,
            /* 蓄力 1s → 感叹号 + 距离线 → 短距冲刺 */
            skill:'charge', chargeT:1.0, dashDist:190, dashWidth:34, dashDmg:14,
            cdMin:3.2, cdMax:4.6, triggerRange:330 },
  red:    { name:'爆火',   color:'#b03a2e', hpMul:0.92, spdMul:1.06, dmgMul:1.00,
            /* 靠近后定身 1s → 小范围自爆（可波及友军） */
            skill:'boom', fuseT:1.0, boomR:78, boomDmg:22, triggerRange:96,
            cdMin:0, cdMax:0 },
  purple: { name:'幽影',   color:'#7a5aa8', hpMul:0.95, spdMul:1.02, dmgMul:0.90,
            /* 每 3s 隐身 5s（可见度 50%，且减伤 50%） */
            skill:'stealth', stealthEvery:3.0, stealthT:5.0, stealthAlpha:0.5 },
  yellow: { name:'连斩',   color:'#c9962a', hpMul:1.08, spdMul:0.92, dmgMul:1.00,
            /* 每 5s CD：向前三次突进斩（每段前冲一小段距离 + 扇形斩） */
            skill:'triple', tripleCD:5.0, tripleRange:130, tripleArc:0.85,
            tripleDmg:20, tripleGap:0.2, lungeStep:86, triggerRange:200 },
};
const SKIN_ORDER = ['blue','red','green','purple','yellow'];   // 与 wokouWalk 数组顺序对应（已核对 base64 指纹）
/* 每关指定 Boss 颜色（循环分配，12关各不相同且均衡） */
const BOSS_BY_LEVEL = ['blue','green','red','purple','yellow',
                       'red','green','blue','yellow','purple',
                       'green','yellow'];
let enemies = [], debris = [], floatTexts = [];
let enemyZones = [];       // 敌人技能预警区 {x,y,r,t,dur,color,kind}
let enemySlashes = [];     // 敌人斩击特效 {x,y,angle,range,arc,t,dur,color,dir}
let bossKnives = [];       // Boss 扇形飞刀 {x,y,vx,vy,ang,t,life,dead}
const KNIFE_DMG = 16;      // 飞刀伤害
let wave = 0, kills = 0, waveTarget = 0, spawnTimer = 0;
let waveBannerT = 0;
/* 通关最后一击慢动作 */
let slowmoT = 0;           // >0 表示慢动作进行中（剩余真实秒数）
let pendingClear = false;  // 慢动作结束后要推进波次/结算
const SLOWMO_DUR = 1.1;    // 慢动作总时长（真实时间）
const SLOWMO_SCALE = 0.14; // 时间流速（越小越慢）

/* ---------- 关卡 & 存档 ---------- */
const MAX_LEVEL = 12;
let currentLevel = 1;
let unlockedLevel = 1;
try { unlockedLevel = Math.max(1, Math.min(MAX_LEVEL, +localStorage.getItem('egret_unlocked') || 1)); } catch(e){}
function saveProgress(){ try { localStorage.setItem('egret_unlocked', unlockedLevel); } catch(e){} }
const LEVEL_NAMES = ['鼓浪屿','环岛路','白城沙滩','南普陀','曾厝垵','集美学村','鳌园','园博苑','天竺山','五缘湾','筼筜湖','鹭江道'];
/* ★ 十二关平面像素地图（640x320 逻辑像素，最近邻放大至1280x640） */
const LEVEL_BGS = ["assets/embedded/a076.png", "assets/embedded/a077.png", "assets/embedded/a078.png", "assets/embedded/a079.png", "assets/embedded/a080.png", "assets/embedded/a081.png", "assets/embedded/a082.png", "assets/embedded/a083.png", "assets/embedded/a084.png", "assets/embedded/a085.png", "assets/embedded/a086.png", "assets/embedded/a087.png"];
const LEVEL_BG_IMGS = LEVEL_BGS.map(u => { const i = new Image(); i.src = u; return i; });
/* ★ 预合成：背景图+米色薄纱一次画进离屏画布，每帧只做一次 drawImage（低配机防掉帧）
   ★ 懒合成：进到哪关才合成哪关（旧版启动即合成 12 张 1280×640，白占 ~40MB 显存，低端机易被系统杀掉） */
const LEVEL_BG_CANVAS = LEVEL_BGS.map(() => {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 640;
  return { c, g: c.getContext('2d'), ready: false };
});
function composeLevelBg(i){
  const o=LEVEL_BG_CANVAS[i];if(!o||o.ready)return;
  const img=LEVEL_BG_IMGS[i];if(!img||!img.complete||!img.naturalWidth)return;
  const g=o.g;g.imageSmoothingEnabled=false;g.drawImage(img,0,0,1280,640);
  g.globalCompositeOperation='saturation';g.globalAlpha=.045;g.fillStyle='#808080';g.fillRect(0,0,1280,640);
  g.globalAlpha=1;g.globalCompositeOperation='source-over';
  g.fillStyle='rgba(243,242,230,.055)';g.fillRect(0,0,1280,640);
  g.fillStyle='rgba(92,157,173,.025)';g.fillRect(0,0,1280,640);
  o.ready=true;
}
/* ★ 首页背景 = 鼓浪屿水彩图（模糊） */
// 首页背景由本地海面绘制器生成。

/* 每关配置：波数 / 敌人属性倍率 / 刷怪密度 / 该关 Boss 颜色
   ★ 能力极缓慢提升：hp +18%/关、速度 +4%/关（比之前温和很多） */
function levelConfig(lv){
  const boss = BOSS_BY_LEVEL[(lv-1) % BOSS_BY_LEVEL.length];
  return {
    waves: 2 + Math.ceil(lv/3.5),       // 3~6 波
    hpMul: 1 + (lv-1)*0.18,             // 极缓慢
    spdMul: 1 + (lv-1)*0.04,            // 极缓慢
    maxAlive: Math.min(4 + Math.floor(lv*0.7), 9),
    boss,
    bossWave: 0,                        // 运行时记录 Boss 出现在第几波
  };
}
/* 该关可出现的颜色池：随关卡推进逐步开放（1关只有蓝，之后逐个解锁） */
function colorsForLevel(lv){
  const pool = ['blue'];
  if (lv >= 2) pool.push('red');
  if (lv >= 3) pool.push('green');
  if (lv >= 5) pool.push('purple');
  if (lv >= 7) pool.push('yellow');
  return pool;
}
let lvCfg = levelConfig(1);

/* ---------- 重置一局（选关后调用） ---------- */
function resetGame(lv){
  clearCombatVfx(); BailuSprites.clearFalls();
  currentLevel = lv; lvCfg = levelConfig(lv);
  document.getElementById('kills').dataset.level=String(lv).padStart(2,'0')+' · '+LEVEL_NAMES[lv-1];
  enemies = []; debris = []; floatTexts = []; slashFx = []; slashParts = []; afterimages = [];
  enemyZones = []; enemySlashes = []; bossKnives = [];
  lvCfg.bossSpawned = false;
  wave = 0; kills = 0; spawnTimer = 0; combo = 0; comboTimer = 0; waveBannerT = 0;
  slowmoT = 0; pendingClear = false;
  player.hitRedT = 0; player.hurtParticleT = 0;
  invulnT = 0; player.dashT = 0; player.atkT = 0; player.atkKind = 'L';
  cardRefreshes = REFRESH_PER_RUN;      // 每局刷新次数重置
  /* ★ buff 跨关永久继承：不再在这里清成长属性 */
  pendingWave = null;
  /* ★ 统一恢复 HUD（修复：通关选卡后走"下一关"时 HUD 消失的 bug） */
  document.getElementById('hud').classList.add('show');
  const worldMap = BailuWorld.load(lv);
  if (worldMap){ player.x = worldMap.entry[0]; player.y = worldMap.entry[1]; } else { player.x = W/2; player.y = H/2; }
  BailuWorld.follow(player.x, player.y, 0, true);
  player.vx = 0; player.vy = 0; player.lean = 0; player.bob = 0; player.spd01 = 0;
  player.hp = player.hpMax; player.mp = player.mpMax;   // 每关满血满蓝开局（上限由 buff 决定）
  player.facing = 0; player.idleT = 0;
  document.getElementById('combo').style.opacity = 0;
  document.getElementById('waveTitle').style.opacity = 0;
  document.getElementById('cardLayer').classList.remove('active');
  bgmPlay('main');                                   // ★ 每关开局回到主曲
  syncBuffs();
  startNextWave();
}

/* =====================================================
   存档系统：命名存档 / 记录 buff 与关卡进度 / 导入导出
   存储结构：{ name, unlocked, lv, buffs:{id:层数}, ts }
   ===================================================== */
const SAVE_KEY = 'egret_saves';
function loadSaveList(){
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch(e){ return {}; }
}
function writeSaveList(obj){
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); } catch(e){}
}
/* 保存一份存档（名为空则用默认名） */
function saveGame(name){
  name = (name || '').trim() || ('存档' + (Object.keys(loadSaveList()).length + 1));
  const list = loadSaveList();
  list[name] = {
    name,
    unlocked: unlockedLevel,
    lv: currentLevel,
    buffs: { ...buffStack },
    /* 记录累积成长后的关键属性，读档时直接还原（不重放 buff） */
    stats: {
      atk: player.atk, atkRange: player.atkRange, speed: player.speed,
      hpMax: player.hpMax, mpMax: player.mpMax, mpRegen: player.mpRegen,
      mpCost: player.mpCost, hpRegen: player.hpRegen, crit: player.crit,
      comboBoost: player.comboBoost, lifesteal: player.lifesteal,
      knockbackBonus: player.knockbackBonus || 0, hitSlow: player.hitSlow || 0,
      DASH_DIST, DASH_WIDTH, enemySlowMul, MP_COST,
    },
    ts: Date.now(),
  };
  writeSaveList(list);
  try { localStorage.setItem('egret_lastSave', name); } catch(e){}   // ★ 存储不可用/配额满时不能拖垮主流程
  return name;
}
/* 读取存档 */
function applySave(sv){
  if (!sv) return;
  unlockedLevel = Math.max(1, Math.min(MAX_LEVEL, sv.unlocked || 1));
  saveProgress();
  buffStack = { ...(sv.buffs || {}) };
  const st = sv.stats || {};
  /* 还原累积属性 */
  if (st.atk != null) player.atk = st.atk;
  if (st.atkRange != null) player.atkRange = st.atkRange;
  if (st.speed != null) player.speed = st.speed;
  if (st.hpMax != null) player.hpMax = st.hpMax;
  if (st.mpMax != null) player.mpMax = st.mpMax;
  if (st.mpRegen != null) player.mpRegen = st.mpRegen;
  if (st.mpCost != null){ player.mpCost = st.mpCost; MP_COST = st.mpCost; }
  if (st.hpRegen != null) player.hpRegen = st.hpRegen;
  if (st.crit != null) player.crit = st.crit;
  if (st.comboBoost != null) player.comboBoost = st.comboBoost;
  if (st.lifesteal != null) player.lifesteal = st.lifesteal;
  player.knockbackBonus = Math.max(0,Math.min(1,Number(st.knockbackBonus)||0));
  player.hitSlow = Math.max(0,Math.min(.35,Number(st.hitSlow)||0));
  if (st.DASH_DIST != null) DASH_DIST = st.DASH_DIST;
  if (st.DASH_WIDTH != null) DASH_WIDTH = st.DASH_WIDTH;
  if (st.enemySlowMul != null) enemySlowMul = st.enemySlowMul;
  if (st.MP_COST != null) MP_COST = st.MP_COST;
  /* ★ 记住"当前所在存档"：之后通关自动存档会写回这份档，buff 持续累积 */
  try { if (sv.name) localStorage.setItem('egret_lastSave', sv.name); } catch(e){}
  syncBuffs();
}
/* 每局重置与"基础属性归位"分开：成长属性由 buff 记录承载
   ★ 主动重开一整局（retry/新关）时保留成长，仅满血满蓝 */
function noteSaved(msg, ok){
  const color = ok === false ? '#b03a2e' : '#3f8a4a';
  document.querySelectorAll('.note').forEach(el => {
    el.textContent = msg; el.style.opacity = 1; el.style.color = color;
  });
}

/* ===================== 存档处页面 ===================== */
/* 成长属性基线：新建存档"从头打"时归位到这里 */
const BASE_STATS = {
  speed:340, hpMax:100, mpMax:100, mpRegen:20, atk:34, atkRange:155,
  mpCost:12, DASH_DIST:220, DASH_WIDTH:70, enemySlowMul:1,
};
function resetGrowth(){
  player.speed   = BASE_STATS.speed;
  player.hpMax   = BASE_STATS.hpMax;  player.hp = player.hpMax;
  player.mpMax   = BASE_STATS.mpMax;  player.mp = player.mpMax;
  player.mpRegen = BASE_STATS.mpRegen;
  player.atk     = BASE_STATS.atk;
  player.atkRange= BASE_STATS.atkRange;
  player.mpCost  = BASE_STATS.mpCost; MP_COST = BASE_STATS.mpCost;
  player.hpRegen = 0; player.crit = 0; player.comboBoost = 0; player.lifesteal = 0;
  DASH_DIST = BASE_STATS.DASH_DIST; DASH_WIDTH = BASE_STATS.DASH_WIDTH;
  enemySlowMul = BASE_STATS.enemySlowMul;
  player.knockbackBonus = 0; player.hitSlow = 0;
  syncBuffs();
}
function openSaves(){ setScreen('saves'); buildSaveList(); }
function fmtTime(ts){
  if (!ts) return '';
  const d = new Date(ts), p = n => String(n).padStart(2, '0');
  return `${d.getMonth()+1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/* 渲染存档列表：进度 + 已获得 buff（名字×层数） */
function buildSaveList(){
  const box = document.getElementById('saveList');
  if (!box) return;
  const list = loadSaveList();
  const names = Object.keys(list).sort((a,b) => (list[b].ts||0) - (list[a].ts||0));
  if (!names.length){
    box.innerHTML = '<div class="saveEmpty">还没有存档 —— 在下面新建一个，从头开始鹭岛之战</div>';
    return;
  }
  const C = {}; CARDS.forEach(c => C[c.id] = c);
  let last = '';
  try { last = localStorage.getItem('egret_lastSave') || ''; } catch(e){}
  box.innerHTML = names.map((nm, i) => {
    const sv = list[nm] || {};
    const buffs = sv.buffs || {};
    const ids = Object.keys(buffs).filter(id => C[id]);
    const chips = ids.length
      ? ids.map(id => `<span class="buffChip">${C[id].name.replace(/\s/g,'')} ×${buffs[id]}</span>`).join('')
      : '<span class="scNone">暂无强化</span>';
    const lv = Math.max(1, Math.min(MAX_LEVEL, sv.lv || 1));
    const unlocked = Math.max(1, Math.min(MAX_LEVEL, sv.unlocked || 1));
    const done = unlocked >= MAX_LEVEL && lv >= MAX_LEVEL;
    return `<div class="saveCard${nm === last ? ' last' : ''}">
      <div class="scHead">
        <span class="scName">${escapeHtml(nm)}</span>
        <span class="scMeta">${done ? '已通关 · ' : ''}第 ${lv} 关 · 已解锁 ${unlocked}/${MAX_LEVEL} · 强化 ${ids.length} 种</span>
      </div>
      <div class="scBuffs">${chips}</div>
      <div class="scFoot">
        <span class="scTime">${fmtTime(sv.ts)}</span>
        <button class="abtn tiny" data-read-idx="${i}">读 取 此 档</button>
      </div>
    </div>`;
  }).join('');
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
/* 读取存档 → 进该关继续 */
function readSave(nm){
  const list = loadSaveList();
  const sv = list[nm];
  if (!sv){ noteSaved('没找到这个存档：' + nm, false); return; }
  applySave(sv);
  try { saveGame(nm); } catch(e){}     // 回写当前进度（失败不影响读档）
  noteSaved('已读档：' + nm, true);
  setScreen(null); state = 'play';
  document.getElementById('hud').classList.add('show');
  resetGame(Math.max(1, Math.min(MAX_LEVEL, sv.lv || 1)));
}
/* ★ 自动读档：启动时自动接续上次玩的存档（不然进去后没 buff）
   优先取上次标记的档；标记不存在则取最近修改的档；一个档都没有就静默跳过 */
function autoLoadLastSave(){
  const list = loadSaveList();
  const names = Object.keys(list);
  if (!names.length) return null;
  let nm = '';
  try { nm = localStorage.getItem('egret_lastSave') || ''; } catch(e){}
  if (!nm || !list[nm]){
    names.sort((a, b) => (list[b].ts || 0) - (list[a].ts || 0));
    nm = names[0];
  }
  const sv = list[nm];
  if (!sv) return null;
  applySave(sv);                      // 还原 buff / 成长属性 / 解锁进度（并回写 egret_lastSave）
  const lv = Math.max(1, Math.min(MAX_LEVEL, sv.lv || 1));
  const nb = Object.keys(sv.buffs || {}).length;
  const el = document.getElementById('senseNote');
  if (el){
    el.textContent = `已自动接续存档「${nm}」· 第 ${lv} 关 · 强化 ${nb} 种`;
    el.style.opacity = 1; el.style.color = '#3f8a4a';
  }
  return nm;
}
/* 新建存档：属性与 buff 全部归位，从第 1 关从头打 */
function startNewSave(){
  const inp = document.getElementById('newSaveName');
  const nm = (inp && inp.value || '').trim();
  if (!nm){ noteSaved('先给新存档起个名字', false); return; }
  const exists = !!loadSaveList()[nm];
  const msg = exists
    ? `存档「${nm}」已存在，覆盖并从第 1 关重开？`
    : `新建存档「${nm}」，从第 1 关从头开始？（当前未存档的进度会清空）`;
  if (!confirm(msg)) return;
  resetGrowth();
  buffStack = {};
  unlockedLevel = 1; saveProgress();
  currentLevel = 1;
  saveGame(nm);
  if (inp) inp.value = '';
  /* 若正在战斗中，退回存档页，避免带着旧战斗状态继续 */
  if (state !== 'menu'){ try { hideOverlay(); } catch(e){} state = 'menu'; setScreen('saves'); }
  noteSaved(`新存档「${nm}」已创建，从头开始`, true);
  buildSaveList();
}
/* 存档页交互绑定 */
document.getElementById('btnSaves').onclick = () => playPageTransition(openSaves);
document.getElementById('btnSavesBack').onclick = () => playPageTransition(() => setScreen('menu'), true);
document.getElementById('btnNewSave').onclick = () => startNewSave();
document.getElementById('saveList').addEventListener('click', e => {
  const btn = e.target.closest('[data-read-idx]');
  if (!btn) return;
  const list = loadSaveList();
  const names = Object.keys(list).sort((a,b) => (list[b].ts||0) - (list[a].ts||0));
  const nm = names[+btn.dataset.readIdx];
  if (nm) playPageTransition(() => readSave(nm));
});

/* 升级卡片系统 */
let buffStack = {};          // { cardId: 层数 }
let pendingWave = null;      // 选卡完成后要进入的波次动作
let cardChoices = [];        // 当前三张卡
const REFRESH_PER_RUN = 2;   // 每局可刷新次数
let cardRefreshes = REFRESH_PER_RUN;
let _cardLock = false;       // ★ 选卡互斥锁：一次弹卡只允许生效一次选择

/* buff 取值：基础值 × 层数，支持线性/衰减两种增长
   ★ buff 跨关永久继承，成长放缓：单卡收益调低 */
const CARDS = [
  { id:'atk',   ico:'刀', name:'利 刃',   rare:'普通',
    desc:'挥砍伤害 +10%',
    apply:() => { player.atk *= 1.10; } },
  { id:'range', ico:'弧', name:'长 风',   rare:'普通',
    desc:'挥砍范围 +8%',
    apply:() => { player.atkRange = Math.min(360, player.atkRange * 1.08); } },
  { id:'mp',    ico:'露', name:'潮 汐',   rare:'普通',
    desc:'回蓝速度 +15%',
    apply:() => { player.mpRegen *= 1.15; } },
  { id:'cost',  ico:'简', name:'轻 掠',   rare:'稀有',
    desc:'挥砍蓝耗 -1（最低 6）',
    apply:() => { MP_COST = Math.max(6, MP_COST - 1); player.mpCost = MP_COST; } },
  { id:'hp',    ico:'盾', name:'磐 石',   rare:'普通',
    desc:'生命上限 +15，并回复等量',
    apply:() => { player.hpMax += 15; player.hp = Math.min(player.hpMax, player.hp + 15); } },
  { id:'regen', ico:'愈', name:'生 机',   rare:'普通',
    desc:'每秒自动回血 +0.8',
    apply:() => { player.hpRegen = (player.hpRegen || 0) + 0.8; } },
  { id:'spd',   ico:'翼', name:'疾 羽',   rare:'普通',
    desc:'移动速度 +8%',
    apply:() => { player.speed = Math.min(560, player.speed * 1.08); } },
  { id:'dash',  ico:'闪', name:'破 浪',   rare:'稀有',
    desc:'闪击距离 +40，路径伤害范围 +12',
    apply:() => { DASH_DIST += 40; DASH_WIDTH += 12; } },
  { id:'crit',  ico:'雷', name:'雷 鹭',   rare:'史诗',
    desc:'12% 概率打出 2.6 倍暴击',
    apply:() => { player.crit = Math.min(0.5, (player.crit || 0) + 0.12); } },
  { id:'lifest',ico:'血', name:'掠 食',   rare:'史诗',
    desc:'每击杀 1 名倭寇回复 2 点生命',
    apply:() => { player.lifesteal = (player.lifesteal || 0) + 2; } },
  { id:'combo', ico:'浪', name:'连 浪',   rare:'稀有',
    desc:'连击 ≥5 时伤害额外 +10%',
    apply:() => { player.comboBoost = (player.comboBoost || 0) + 0.10; } },
  { id:'slow',  ico:'雾', name:'迷 雾',   rare:'稀有',
    desc:'敌人移动速度 -5%',
    apply:() => { enemySlowMul = Math.max(0.5, enemySlowMul * 0.95); } },
];
CARDS.push(
  {id:'repel',ico:'震',name:'鹤 震',rare:'普通',max:5,
    desc:'击退距离 +20%（最多 +100%；首领效果减弱）',
    apply:()=>{player.knockbackBonus=Math.min(1,(player.knockbackBonus||0)+.2);}},
  {id:'hit-slow',ico:'霜',name:'凝 羽',rare:'稀有',max:4,
    desc:'命中减速 20%，持续 1.2 秒；再获 +5%，最多 35%；首领效果减弱',
    apply:()=>{player.hitSlow=Math.min(.35,player.hitSlow>0?player.hitSlow+.05:.2);}}
);
const RARE_WEIGHT = { '普通': 10, '稀有': 4, '史诗': 2 };

/* 距离衰减：同一张卡叠得越多，出现权重越低 */
function cardWeight(c){
  const lv = buffStack[c.id] || 0;
  if(c.max && lv >= c.max)return 0;
  return RARE_WEIGHT[c.rare] / (1 + lv * 0.85);
}
/* 抽出 3 张不重复的卡 */
function rollCards(){
  const pool = CARDS.map(c => ({ c, w: cardWeight(c) })).filter(x => x.w > 0.05);
  const picked = [];
  while (picked.length < 3 && pool.length){
    let total = pool.reduce((s,x) => s + x.w, 0);
    let r = Math.random() * total, idx = 0;
    for (let i = 0; i < pool.length; i++){ r -= pool[i].w; if (r <= 0){ idx = i; break; } }
    picked.push(pool[idx].c);
    pool.splice(idx, 1);
  }
  return picked;
}

/* 打开升级选择 */
function openCardPicker(after){
  pendingWave = after;                 // 'next-wave' | 'clear' | null
  _cardLock = false;                   // ★ 每次开卡重置锁
  state = 'card';
  document.getElementById('hud').classList.remove('show');
  /* 卡层背景：当前关卡水彩图（CSS ::before 模糊渲染） */
  try {
    const cl = document.getElementById('cardLayer');
    const bg = (typeof LEVEL_BGS !== 'undefined') ? LEVEL_BGS[currentLevel-1] : null;
    if (cl && bg) cl.style.setProperty('--cardBg', 'url("' + bg + '")');
  } catch(err){ console.warn('card bg skipped:', err.message); }
  renderCardChoices();
  document.getElementById('cardLayer').classList.add('active');
}
/* 渲染三张卡（刷新时复用） */
function renderCardChoices(){
  cardChoices = rollCards();
  const row = document.getElementById('cardRow'); row.innerHTML = '';
  cardChoices.forEach(c => {
    const lv = buffStack[c.id] || 0;
    const el = document.createElement('div');
    el.className = 'upCard rare-' + c.rare;
    el.innerHTML = `<i class="cCorner tl"></i><i class="cCorner tr"></i><i class="cCorner bl"></i><i class="cCorner br"></i>
      <div class="cRare">${c.rare}</div>
      <div class="cName">${c.name}</div>
      <div class="cVal">${lv > 0 ? '已有 ' + lv + ' 层 → ' + (lv+1) : '首次获得'}</div>
      <div class="cLine"></div>
      <div class="cDesc">${c.desc}</div>`;
    el.dataset.cardId = c.id;          // ★ 只标记身份，点击统一交给 cardLayer 委托处理
    row.appendChild(el);
  });
  /* 刷新按钮状态 */
  const btn = document.getElementById('btnRefresh');
  if (btn){
    btn.textContent = `刷新 (${cardRefreshes} 次)`;
    btn.disabled = cardRefreshes <= 0;
    btn.classList.toggle('used', cardRefreshes <= 0);
  }
  /* 保险：动画无论是否执行，0.6s 后强制卡片可见可点（避免动画异常导致透明） */
  clearTimeout(renderCardChoices._t);
  renderCardChoices._t = setTimeout(() => {
    document.querySelectorAll('.upCard').forEach(el => {
      el.style.opacity = '1'; el.style.transform = 'none';
      el.style.animation = 'none';   /* 解除 forwards 对 transform 的锁定，hover 才能生效 */
    });
  }, 600);
}
/* 刷新三张卡（每局限次） */
function refreshCards(){
  if (state !== 'card' || _cardLock) return;   // ★ 只在卡片态、且未锁定时可刷新
  if (cardRefreshes <= 0) return;
  cardRefreshes--;
  renderCardChoices();
}
/* ★ 选卡/放弃统一走这里：用 _cardLock 保证一次选择只执行一次，
      彻底杜绝「同一帧多点触发 → 3 张卡全拿到」和「放弃后仍在拿卡」 */
function pickCard(c){
  if (state !== 'card' || _cardLock) return;   // 双保险：状态 + 锁
  _cardLock = true;
  try {
    c.apply();
    buffStack[c.id] = (buffStack[c.id] || 0) + 1;
    floatText(player.x, player.y - 60, c.name.replace(/\s/g,''), '#4a6fa5');
    autoSave();                       // ★ 选完卡自动存档（记录 buff）
  } catch(err){ console.warn('pickCard apply error', err); }
  closeCardPicker();
}
/* 自动存档：沿用上次存档名，没有就用"自动存档"
   ★ 整体兜底：存档系统在任何环境下都不允许打断游戏主流程 */
function autoSave(){
  try {
    let nm = '自动存档';
    try { nm = localStorage.getItem('egret_lastSave') || '自动存档'; } catch(e){}
    saveGame(nm);
  } catch(err){ console.warn('autoSave skipped:', err.message); }
}
function closeCardPicker(){
  if (state !== 'card') return;          // ★ 只有卡片态才能关闭，防止重复推进关卡
  document.getElementById('cardLayer').classList.remove('active');
  syncBuffs();
  const after = pendingWave; pendingWave = null;
  state = 'play';                        // ★ 先落状态，再执行后续，避免重入
  if (after === 'clear'){ levelClear(); }
  else {                                 // 继续下一波
    document.getElementById('hud').classList.add('show');
    startNextWave();
  }
  _cardLock = false;                     // ★ 解锁，等下一次开卡再上锁
}
/* HUD 里显示已获得的强化 */
function syncBuffs(){
  const box = document.getElementById('lvlBuffs'); if (!box) return;
  box.innerHTML = '';
  for (const c of CARDS){
    const lv = buffStack[c.id]; if (!lv) continue;
    const s = document.createElement('span');
    s.className = 'buffChip'; s.textContent = `${c.name.replace(/\s/g,'')}×${lv}`;
    box.appendChild(s);
  }
}

/* 波次颜色配比：前期蓝色为主，越往后越危险的颜色占比越高
   返回一个概率权重表，spawnEnemy 会按它抽类型 */
function buildWaveMix(w){
  const pool = colorsForLevel(currentLevel);
  const mix = {};
  pool.forEach(k => mix[k] = 1);
  /* 稀有危险色随时间/波次加权 */
  const t = w / Math.max(1, lvCfg.waves);        // 0→1 关内进度
  if (pool.includes('red'))    mix.red    += 0.6 + t*0.9;   // 自爆：中后期变多
  if (pool.includes('green'))  mix.green  += 0.4 + t*0.6;   // 突刺：稳定存在
  if (pool.includes('purple')) mix.purple += 0.3 + t*0.5;   // 幽影：偏少
  if (pool.includes('yellow')) mix.yellow += 0.2 + t*0.5;   // 连斩：最稀有
  /* 逐渐减少纯普通怪 */
  mix.blue = Math.max(0.8, mix.blue + 1.2 - t*1.1);
  return mix;
}
/* 按配比抽一个颜色 */
function pickColorByMix(mix){
  let total = 0; for (const k in mix) total += mix[k];
  let r = Math.random() * total;
  for (const k in mix){ r -= mix[k]; if (r <= 0) return k; }
  return 'blue';
}

function startNextWave(){
  /* 所有波次全清 → 通关 */
  if (wave >= lvCfg.waves){ levelClear(); return; }
  wave++; kills = 0;
  BailuWorld.startWave(wave);
  /* 敌人数量随波次与关卡缓慢上升；Boss 波额外 +1（Boss 本体计入击杀） */
  lvCfg.thisWaveBoss = (wave === lvCfg.waves);
  waveTarget = 3 + wave*2 + Math.floor(currentLevel*1.2) + (lvCfg.thisWaveBoss ? 1 : 0);
  /* 敌人构成：按波次逐步加入更 "麻烦" 的颜色（布局配比） */
  lvCfg.waveMix = buildWaveMix(wave);
  if (lvCfg.thisWaveBoss) showBanner(`第 ${wave} 波 · BOSS 现身`);
  else showBanner(`第 ${wave}/${lvCfg.waves} 波`);
}
/* 一波清完：先给升级卡，选完再推进 */
function waveCleared(){
  if (wave >= lvCfg.waves) openCardPicker('clear');   // 最后一波：选完卡直接结算
  else openCardPicker('next-wave');
}
/* 通关：解锁下一关 + 弹出结算 */
function levelClear(){
  state = 'result';
  const last = currentLevel >= MAX_LEVEL;
  try {
    if (!last && currentLevel + 1 > unlockedLevel){ unlockedLevel = currentLevel + 1; saveProgress(); }
    autoSave();                                // ★ 通关自动存档（内部兜底，绝不打断结算）
  } catch(err){ console.warn('levelClear save skipped:', err.message); }
  showOverlay({
    tag: last ? '全 部 通 关' : '通 关',
    title: last ? '鹭江道 · 守卫成功' : `第 ${currentLevel} 关 · ${LEVEL_NAMES[currentLevel-1]} 完成`,
    sub: last ? '十二关全部清空，厦门白鹭凯旋' : `已解锁第 ${currentLevel+1} 关：${LEVEL_NAMES[currentLevel]||''}`,
    buttons: last
      ? [{label:'返回选关', act:'sel', primary:true}, {label:'重开本关', act:'retry'}]
      : [{label:'下一关', act:'next', primary:true}, {label:'重开本关', act:'retry'}, {label:'返回选关', act:'sel'}],
  });
}
/* 失败 */
function gameOver(){
  state = 'result';
  bgmPlay('main');                                   // ★ 失败也切回主曲
  showOverlay({
    tag: '失 败',
    title: `第 ${currentLevel} 关 · 白鹭倒下了`,
    sub: '再来一次，把波次清完',
    buttons: [{label:'重新开始', act:'retry', primary:true}, {label:'返回选关', act:'sel'}],
  });
}

/* 生成一个敌人。typeKey 指定颜色；isBoss 强化体型与属性 */
function spawnEnemy(typeKey, isBoss){
  const key = typeKey || pickColorByMix(lvCfg.waveMix || {blue:1});
  const T = ENEMY_TYPES[key];
  const skin = SKIN_ORDER.indexOf(key);

  /* 布局：从画布四边外刷入，稍微错开角度避免叠在同一侧 */
  const side = Math.floor(Math.random()*4);
  let x,y;
  const worldSpawn = BailuWorld.active() ? BailuWorld.spawnPoint(20) : null;
  const off = 34 + Math.random()*26;
  if(side===0){x=-off;y=Math.random()*H;} else if(side===1){x=W+off;y=Math.random()*H;}
  else if(side===2){x=Math.random()*W;y=-off;} else {x=Math.random()*W;y=H+off;}
  if (worldSpawn){ x = worldSpawn[0]; y = worldSpawn[1]; }

  const baseHp = 26 + currentLevel*6 + wave*6;
  const baseSpd = 56 + Math.random()*18 + currentLevel*2;
  let hpMax = Math.round(baseHp * lvCfg.hpMul * T.hpMul);
  let spd   = baseSpd * lvCfg.spdMul * T.spdMul;
  let r     = 13 + Math.random()*9;

  if (isBoss){                       // Boss：更大更硬，技能更强
    hpMax = Math.round(hpMax * 6.8);   // ★ BOSS 血量已翻倍（原 3.4）
    r = r * 1.55;
    spd *= 0.92;
  }

  enemies.push({
    key, skin, T, isBoss,
    x, y, r, hp:hpMax, hpMax, spd, flash:0, dead:false,
    animT: Math.random()*10,
    walkPhase: Math.random(), walkBlend: 0,
    /* 技能运行时状态 */
    cd: T.cdMin ? T.cdMin + Math.random()*(T.cdMax - T.cdMin) : 0,   // 技能冷却
    state:'walk',       // walk | charge | dash | fuse | slash
    stateT:0,           // 当前状态计时
    lunge:{x:0,y:0},    // 冲刺方向
    stealthT:0,         // 隐身剩余时间
    stealthPhase:Math.random()*1, // 错开隐身节奏
    tripleHits:0, tripleGap:0,      // 三连斩进度
    knifeCD: isBoss ? 2.0 : 0,      // Boss 专属：每 2s 扔一次扇形飞刀
  });
}
function showBanner(text){
  const el = document.getElementById('waveTitle');
  el.textContent = text; el.style.opacity = 1; waveBannerT = 1.4;
}
function spawnDebris(e){ emitKillVfx(e); BailuSprites.addFall(e, player.x); }
function floatText(x,y,text,color){ floatTexts.push({x,y,text,color,t:0.8}); }

/* ---------- 主循环 ---------- */
let last = performance.now();
window.__lastFrame = performance.now();
let _loopErrStreak = 0;
let _drawErrStreak = 0;
let _dbgT = 0;
/* ★ 唯一主循环调度器：保证同一时刻只有一条 loop 在排队。
   旧代码的看门狗在 rAF 暂停（标签页最小化 / 被遮挡 / 弹出系统对话框）时
   仍会每 800ms 叠加一条新 loop，回来后几十条循环同时全量 update+draw
   —— 这才是"很容易闪退"的真正原因。 */
let _loopScheduled = false, _loopRuns = 0;
function scheduleLoop(){
  if (_loopScheduled) return;
  _loopScheduled = true;
  requestAnimationFrame(t => { _loopScheduled = false; loop(t); });
}
function loop(now){
  window.__lastFrame = performance.now();
  if (document.hidden){ scheduleLoop(); return; }   // 后台不绘制，避免回来时雪崩
  _loopRuns++;
  const dt = Math.min(0.033, (now-last)/1000); last = now;
  player.idleT += dt;                       // 待机动画常开（菜单背景也是活的）
  /* ★ try/catch：任何一帧的异常都不再杀死整个循环（防无声卡死） */
  if (state === 'play' && !_transitionBusy){
    try { update(dt); _loopErrStreak = 0; }
    catch(err){
      _loopErrStreak++;
      console.warn('update error', err);
      if (_loopErrStreak === 5) showBanner('游戏异常：' + err.message);
    }
  }
  try { draw(); drawHomeScene(now); drawHomeArrival(now); drawHomeSword(now); _drawErrStreak = 0; }
  catch(err){
    /* ★ 连续绘制失败：自动清掉可疑的瞬时状态自救（脏 atkT/特效），避免画面永久冻住像"闪退" */
    _drawErrStreak++;
    console.warn('draw error', err);
    if (_drawErrStreak === 5){
      try {
        player.atkT = 0; player.atkKind = 'L';
        player.moving = false; player.spd01 = 0;
        afterimages = []; slashFx = [];
        showBanner('画面异常，已自动恢复');
      } catch(e){}
    }
  }
  /* ★ 诊断角标：版本+状态+波次（卡住时截图自带现场） */
  if (now - _dbgT > 400){ _dbgT = now;
    const t = 'v3.3 ' + state + ' · Lv' + currentLevel + ' 波' + wave + '/' + lvCfg.waves + ' ' + kills + '/' + waveTarget;
    const el = document.getElementById('dbg'); if (el && el.textContent !== t) el.textContent = t;
  }
  scheduleLoop();
}
/* ★ 看门狗：循环被意外中断时拉起。必须同时判断"已有排队"，
   否则会在 rAF 暂停期间疯狂叠加循环（崩页元凶）。 */
setInterval(() => {
  const active = (state === 'play' || state === 'card' || state === 'select' || state === 'menu');
  if (!active) return;
  if (_loopScheduled) return;                                  // 已排队 → 绝不重复拉起
  if (performance.now() - window.__lastFrame < 4000) return;   // 放宽阈值，抗瞬时卡顿
  console.warn('主循环停摆，看门狗自动恢复');
  last = performance.now();
  scheduleLoop();
}, 2000);
/* 回到前台时重置计时，避免第一帧 dt 过大 */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden){ last = performance.now(); window.__lastFrame = last; scheduleLoop(); }
});
function update(rawDt){
  player.hitRedT=Math.max(0,(player.hitRedT||0)-rawDt);
  player.hurtParticleT=Math.max(0,(player.hurtParticleT||0)-rawDt);
  /* ★ 慢动作：通关最后一击后时间放缓，播完再弹结算 */
  let dt = rawDt;
  if (slowmoT > 0){
    slowmoT -= rawDt;
    dt = rawDt * SLOWMO_SCALE;
    if (slowmoT <= 0){
      slowmoT = 0;
      /* ★ 慢动作播完 → 弹升级卡：最后一波选完结算，其余波选完进下一波 */
      if (pendingClear){ pendingClear = false; waveCleared(); return; }
    }
  }
  /* 玩家移动：加速度平滑 + 惯性滑行（不再瞬间启停） */
  const [mx,my] = getMoveVec();
  player.moving = !!(mx || my);
  const ACCEL = 7.5;                      // 越大越跟手（起步/刹车的回弹速度）
  const tvx = mx * player.speed, tvy = my * player.speed;
  const moveBlend = window.EgretGameBridge && window.EgretGameBridge.isGestureActive() ? 1 : Math.min(1, ACCEL*dt);
  player.vx += (tvx - player.vx) * moveBlend;
  player.vy += (tvy - player.vy) * moveBlend;
  if (!player.moving && Math.hypot(player.vx,player.vy) < 8){ player.vx = 0; player.vy = 0; }
  if (BailuWorld.active()){
    const tx = player.x + player.vx*dt, ty = player.y + player.vy*dt;
    const [qx, qy] = BailuWorld.move(player.x, player.y, tx, ty, 12);
    if (qx !== tx) player.vx *= 0.5; if (qy !== ty) player.vy *= 0.5;
    player.x = qx; player.y = qy;
  } else {
    player.x = Math.max(20, Math.min(W-20, player.x + player.vx*dt));
    player.y = Math.max(20, Math.min(H-20, player.y + player.vy*dt));
  }
  BailuWorld.follow(player.x, player.y, rawDt);
  mouse.x = mouse.sx + BailuWorld.cam.x; mouse.y = mouse.sy + BailuWorld.cam.y;
  /* 实际速度（用于动画节奏：起步慢、加速快） */
  player.spd01 = Math.min(1, Math.hypot(player.vx,player.vy) / player.speed);
  if (player.spd01 > 0.02) player.animT += dt * (0.55 + player.spd01*0.85);
  else player.animT = 0;
  /* 身体朝移动方向微微前倾（投影到屏幕坐标，作为倾斜量） */
  const leanT = player.moving ? player.vx/player.speed * 0.09 : 0;
  player.lean += (leanT - player.lean) * Math.min(1, 8*dt);
  /* 走路起伏：速度越快颠得越明显 */
  player.bob += dt * 11 * player.spd01;

  /* 朝向跟随鼠标（以后=右手拇指指向方向） */
  player.facing = window.EgretGameBridge && window.EgretGameBridge.isActive() ? window.EgretGameBridge.getFacing() : Math.atan2(mouse.y-player.y, mouse.x-player.x);

  /* 回蓝 */
  player.mp = Math.min(player.mpMax, player.mp + player.mpRegen*dt);
  /* 回血（升级卡"生机"获得） */
  if (player.hpRegen > 0 && player.hp > 0)
    player.hp = Math.min(player.hpMax, player.hp + player.hpRegen*dt);
  /* 无敌帧计时 */
  if (invulnT > 0) invulnT = Math.max(0, invulnT - dt);
  if (player.dashT > 0) player.dashT = Math.max(0, player.dashT - dt);
  if (player.atkT > 0) player.atkT = Math.max(0, player.atkT - dt);

  /* 连击计时 */
  if(comboTimer > 0){ comboTimer -= dt; if(comboTimer<=0) combo = 0; }

  /* 波次控制：Boss 波先放 Boss，再补小怪 */
  const waveArmed = !BailuWorld.active() || BailuWorld.updateArm(player.x);   // spawning starts once the hero passes the zone gate
  if (waveArmed && lvCfg.thisWaveBoss && !lvCfg.bossSpawned && wave === lvCfg.waves){
    spawnEnemy(lvCfg.boss, true);
    lvCfg.bossSpawned = true;
    floatText(BailuWorld.cam.x + W/2, BailuWorld.cam.y + H/2 - 120, 'BOSS 现 身', ENEMY_TYPES[lvCfg.boss].color);
    bgmPlay('boss');                                // ★ BOSS 现身：切燃曲
    spawnTimer = 1.2;                                  // Boss 先单挑一会儿
  }
  if (waveArmed && enemies.length < lvCfg.maxAlive && waveTarget - kills > enemies.length){
    spawnTimer -= dt;
    if (spawnTimer <= 0){ spawnEnemy(); spawnTimer = Math.max(0.5, 1.35 - currentLevel*0.04); }
  }
  /* ★ 兜底：本波清空（含被爆炸溅死等未走 hitEnemy 的情况）→ 先起慢动作，再弹升级卡 */
  if (kills >= waveTarget && enemies.length === 0 && state === 'play' && !pendingClear && slowmoT <= 0){
    slowmoT = SLOWMO_DUR; pendingClear = true;
    floatText(player.x, player.y - 90, '最 后 一 击', '#e07b1f');
  }

  /* 敌人 AI：按类型走不同技能状态机 */
  for (const e of enemies){
    e.flash = Math.max(0, e.flash - dt);
    e.animT += dt;
    if (e.dead) continue;
    const gaitX=e.x,gaitY=e.y,wasWalking=e.state==='walk';
    const worldSize=BailuWorld.active()?BailuWorld.level().world:[W,H];
    const hitStunned=EgretCombatFeedback.tick(e,dt,worldSize[0],worldSize[1],rawDt);
    if (!hitStunned) updateEnemy(e, dt);
    if (BailuWorld.active() && !e.dead){ const q=BailuWorld.move(gaitX,gaitY,e.x,e.y,8); e.x=q[0]; e.y=q[1]; }
    advanceEnemyGait(e,dt,Math.hypot(e.x-gaitX,e.y-gaitY),wasWalking);
  }
  enemies = enemies.filter(e => !e.dead);
  /* 技能预警区 / 斩击特效衰减 */
  enemyZones.forEach(z => z.t -= dt);   enemyZones = enemyZones.filter(z => z.t > 0);
  enemySlashes.forEach(s => s.t -= dt); enemySlashes = enemySlashes.filter(s => s.t > 0);
  /* Boss 飞刀：飞行 + 命中玩家 + 被平A/闪击挡掉 */
  updateBossKnives(dt);

  /* 特效衰减 */
  tickCombatVfx(dt);
  slashFx.forEach(f => f.t -= dt);  slashFx = slashFx.filter(f => f.t > 0);
  slashParts.forEach(p => { p.t-=dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.vx*=0.9; p.vy*=0.9; });
  slashParts = slashParts.filter(p => p.t > 0);
  afterimages.forEach(a => a.t -= dt);  afterimages = afterimages.filter(a => a.t > 0);
  debris.forEach(d => { d.t-=dt; d.x+=d.vx*dt; d.y+=d.vy*dt; d.vx*=0.92; d.vy*=0.92; });
  debris = debris.filter(d => d.t > 0);
  floatTexts.forEach(f => { f.t-=dt; f.y-=40*dt; });
  floatTexts = floatTexts.filter(f => f.t > 0);

  if (waveBannerT > 0){ waveBannerT -= dt; if (waveBannerT <= 0)
    document.getElementById('waveTitle').style.opacity = 0; }

  syncHud();
}
/* =====================================================
   敌人技能状态机
   blue   : 纯追击
   green  : 蓄力1s(感叹号+距离线) → 短距冲刺闪击
   red    : 靠近定身2s → 小范围自爆(波及友军)
   purple : 每3s隐身5s(可见度50%)
   yellow : 每10s放一次三连斩(有范围预警)
   ===================================================== */
/* Eight distinct poses, clocked by travel distance rather than a fixed frame timer. */
function advanceEnemyGait(e, dt, distance, walking){
  const stride=Math.max(26,e.r*2.15);
  const travel=walking?Math.min(distance,Math.max(1,e.spd)*dt*1.5):0;
  const target=travel>.025?Math.min(1,travel/(Math.max(1,e.spd)*dt)):0;
  e.walkBlend=(e.walkBlend||0)+(target-(e.walkBlend||0))*Math.min(1,dt*12);
  if(travel>.025)e.walkPhase=((e.walkPhase||0)+travel/stride)%1;
}
function enemyWalkFrame(e){
  const count=wokouWalk[e.skin]?.length||1;
  return Math.floor((e.walkPhase||0)*count)%count;
}
function enemyWalkBob(e){
  return -Math.abs(Math.sin((e.walkPhase||0)*Math.PI*2))*.55*(e.walkBlend||0);
}

function updateEnemy(e, dt){
  const dx = player.x - e.x, dy = player.y - e.y;
  const d  = Math.hypot(dx, dy) || 1;
  const ux = dx/d, uy = dy/d;
  const espd = e.spd * EgretCombatFeedback.speed(e,enemySlowMul);

  /* ---- 紫色：隐身计时（独立于状态机，始终生效） ---- */
  if (e.T.skill === 'stealth'){
    if (e.stealthT > 0){
      e.stealthT -= dt;                             // 隐身中：只倒计时，不累积下一次
      if (e.stealthT < 0) e.stealthT = 0;
    } else {
      e.stealthPhase += dt;                         // 隐身结束才重新累积
      if (e.stealthPhase >= e.T.stealthEvery){
        e.stealthPhase = 0;
        e.stealthT = e.T.stealthT * (e.isBoss ? 1.4 : 1);
      }
    }
  }

  const moveTo = (spd, mul=1) => { e.x += ux*spd*mul*dt; e.y += uy*spd*mul*dt; };
  const touchPlayer = () => {
    if (d < e.r + player.r){
      damagePlayer(e.spd*0.30 + 3);
      e.x -= ux*30; e.y -= uy*30;
    }
  };

  /* ---- Boss 专属：每 2s 扇形扔 4 把飞刀（可被平A/突刺挡掉） ---- */
  if (e.isBoss && e.state !== 'dead'){
    e.knifeCD = Math.max(0, e.knifeCD - dt);
    if (e.knifeCD <= 0){
      e.knifeCD = 2.0;
      const base = Math.atan2(dy, dx);
      for (let i = 0; i < 4; i++){
        const ang = base + (i - 1.5) * 0.28;            // 扇形 4 把
        bossKnives.push({
          x:e.x, y:e.y, ang, dir:ang,
          vx:Math.cos(ang)*300, vy:Math.sin(ang)*300,
          t:0, life:3.0, dead:false, spin:0,
        });
      }
      floatText(e.x, e.y - e.r*2.4, '飞 刀', '#e07b1f');
    }
  }

  switch (e.state){
    /* ---------------- 普通行走 ---------------- */
    case 'walk': {
      moveTo(espd);
      touchPlayer();
      /* 绿色：进入触发距离开始蓄力 */
      if (e.T.skill === 'charge'){
        e.cd = Math.max(0, e.cd - dt);
        if (d < e.T.triggerRange && e.cd <= 0){
          e.state = 'charge'; e.stateT = e.T.chargeT;
          e.lunge = {x:ux, y:uy};
          enemyZones.push({ x:e.x, y:e.y, r:e.T.dashWidth+14, t:e.T.chargeT, dur:e.T.chargeT,
                            color:'#3f8a4a', kind:'line', tx:e.x+ux*e.T.dashDist, ty:e.y+uy*e.T.dashDist });
        }
      }
      /* 红色：靠近就点燃引信 */
      else if (e.T.skill === 'boom'){
        if (d < e.T.triggerRange + e.r){
          e.state = 'fuse'; e.stateT = e.T.fuseT;
          const z = { x:e.x, y:e.y, r:e.T.boomR*(e.isBoss?1.5:1), t:e.T.fuseT, dur:e.T.fuseT,
                      color:'#b03a2e', kind:'circle', follow:true, owner:e };
          enemyZones.push(z); e.fuseZone = z;
          floatText(e.x, e.y - e.r*2.6, '！', '#b03a2e');
        }
      }
      /* 黄色：CD 到就放三连突进斩 */
      else if (e.T.skill === 'triple'){
        e.cd = Math.max(0, e.cd - dt);
        if (e.cd <= 0 && d < e.T.triggerRange){
          e.state = 'slash';
          e.stateT = 0.72;                       // 三段总时长
          e.tripleHits = 0; e.tripleGap = 0;
          e.slashAngle = Math.atan2(dy, dx);
          e.lunge = { x:ux, y:uy };              // 锁定突进方向
          e.slashDir = 1;
          enemyZones.push({ x:e.x, y:e.y, r:e.T.tripleRange, t:0.3, dur:0.3,
                            color:'#c9962a', kind:'fan', ang:e.slashAngle, arc:e.T.tripleArc });
        }
      }
      break;
    }

    /* ---------------- 绿色：蓄力 → 冲刺 ---------------- */
    case 'charge': {
      e.stateT -= dt;
      if (e.stateT <= 0){
        e.state = 'dash'; e.stateT = 0.22;
        e.dashFrom = {x:e.x, y:e.y};
        e.dashTo = {
          x: Math.max(30, Math.min(W-30, e.x + e.lunge.x*e.T.dashDist)),
          y: Math.max(30, Math.min(H-30, e.y + e.lunge.y*e.T.dashDist)),
        };
        if (BailuWorld.active()){ const q=BailuWorld.along(e.x,e.y,e.x+e.lunge.x*e.T.dashDist,e.y+e.lunge.y*e.T.dashDist,8); e.dashTo={x:q[0],y:q[1]}; }
        e.lunge0 = {x:e.lunge.x, y:e.lunge.y};
      }
      break;
    }
    case 'dash': {
      e.stateT -= dt;
      const p = 1 - Math.max(0, e.stateT) / 0.22;     // 0→1
      const ease = 1 - Math.pow(1-p, 3);
      e.x = e.dashFrom.x + (e.dashTo.x - e.dashFrom.x) * ease;
      e.y = e.dashFrom.y + (e.dashTo.y - e.dashFrom.y) * ease;
      /* 冲刺路径伤害 */
      if (!e._hitThisDash){
        const ox=e.dashFrom.x, oy=e.dashFrom.y, nx=e.dashTo.x, ny=e.dashTo.y;
        const segLen2 = (nx-ox)**2 + (ny-oy)**2 || 1;
        let t = ((player.x-ox)*(nx-ox) + (player.y-oy)*(ny-oy)) / segLen2;
        t = Math.max(0, Math.min(1, t));
        const px = ox + (nx-ox)*t, py = oy + (ny-oy)*t;
        if (Math.hypot(player.x-px, player.y-py) < e.T.dashWidth + player.r){
          damagePlayer(e.T.dashDmg * (e.isBoss ? 1.5 : 1));
          e._hitThisDash = true;
        }
      }
      /* 冲刺拖尾粒子 */
      if (Math.random() < 0.7) slashParts.push({
        x:e.x+(Math.random()-0.5)*18, y:e.y+(Math.random()-0.5)*18,
        vx:-e.lunge0.x*60, vy:-e.lunge0.y*60, t:0.2, dur:0.3,
        r:1.5+Math.random()*2, color:'#3f8a4a' });
      if (e.stateT <= 0){
        e.state = 'walk'; e._hitThisDash = false;
        e.cd = e.T.cdMin + Math.random()*(e.T.cdMax - e.T.cdMin);
      }
      break;
    }

    /* ---------------- 红色：引信 → 爆炸 ---------------- */
    case 'fuse': {
      e.stateT -= dt;
      /* 引信期间原地不动（定身），预警圈跟随 */
      if (e.fuseZone){ e.fuseZone.x = e.x; e.fuseZone.y = e.y; e.fuseZone.t = Math.max(0.01, e.stateT); }
      if (e.flash <= 0 && Math.random() < 0.25) e.flash = 0.06;
      if (e.stateT <= 0){
        /* 自爆：范围内玩家 + 其他倭寇都吃伤害 */
        const R = e.T.boomR * (e.isBoss ? 1.5 : 1);
        const D = e.T.boomDmg * (e.isBoss ? 1.4 : 1);
        boomAt(e.x, e.y, R, D, e);
        if (e.isBoss){
          /* ★ 红色 BOSS：自爆不立即死亡，只炸掉自己 1/4 血量 —— 需引爆 4 次才会倒下 */
          e.fuseZone = null;
          hitEnemy(e, e.hpMax * 0.25, false, false);
          if (!e.dead){ e.state = 'walk'; e.cd = 0; }   // 回追击状态，靠近后再次引爆
        } else {
          e.dead = true; e.selfDestruct = true; e.state = 'dead';
          spawnDebris(e);
          kills++;                                     // 自爆也算清理掉了
          checkFinalBlow();
        }
      }
      break;
    }

    /* ---------------- 黄色：向前三次突进斩 ---------------- */
    case 'slash': {
      e.stateT -= dt;
      e.tripleGap -= dt;
      /* 突进位移（朝锁定方向匀速前冲，分三段） */
      if (e.tripleHits < 3 && e.stateT > 0){
        e.x += e.lunge.x * e.T.lungeStep / e.T.tripleGap * dt * 0.9;
        e.y += e.lunge.y * e.T.lungeStep / e.T.tripleGap * dt * 0.9;
      }
      if (e.tripleGap <= 0 && e.tripleHits < 3){
        e.tripleHits++; e.tripleGap = e.T.tripleGap;
        const ang = e.slashAngle + (e.slashDir * 0.18);
        e.slashDir *= -1;
        const R = e.T.tripleRange * (e.isBoss ? 1.2 : 1);
        enemySlashes.push({ x:e.x, y:e.y, angle:ang, range:R, arc:e.T.tripleArc,
                            t:0.16, dur:0.16, color:'#c9962a', dir:e.slashDir });
        /* 判定：扇形内 + 在范围内 */
        const pdx = player.x-e.x, pdy = player.y-e.y, pd = Math.hypot(pdx,pdy);
        if (pd < R + player.r){
          const da = Math.abs(normalizeAngle(Math.atan2(pdy,pdx) - ang));
          if (da < e.T.tripleArc) damagePlayer(e.T.tripleDmg * (e.isBoss ? 1.4 : 1));
        }
        /* 第三段带一点收势停顿 */
        if (e.tripleHits >= 3) e.stateT = Math.min(e.stateT, 0.18);
      }
      if (e.stateT <= 0){
        e.state = 'walk';
        e.cd = e.T.tripleCD * (e.isBoss ? 0.7 : 1);
      }
      break;
    }
  }
}
/* 爆炸：波及玩家与友军倭寇 */
function boomAt(x, y, R, dmg, src){
  /* 视觉 */
  enemyZones.push({ x, y, r:R, t:0.28, dur:0.28, color:'#e07b1f', kind:'boom' });
  for (let i = 0; i < 22; i++){
    const a = Math.random()*Math.PI*2, s = 120 + Math.random()*320;
    slashParts.push({ x, y, vx:Math.cos(a)*s, vy:Math.sin(a)*s, t:0.3+Math.random()*0.25,
                      dur:0.6, r:2+Math.random()*3.5,
                      color: Math.random()<0.5 ? '#e07b1f' : '#b03a2e' });
  }
  /* 玩家伤害 */
  if (Math.hypot(player.x-x, player.y-y) < R + player.r) damagePlayer(dmg);
  /* 友军伤害（炸到其他倭寇） */
  for (const o of enemies){
    if (o === src || o.dead) continue;
    if (Math.hypot(o.x-x, o.y-y) < R + o.r){
      const d2 = Math.round(dmg * 0.8);
      o.hp -= d2; o.flash = 0.1;
      floatText(o.x, o.y - o.r*2.2, '' + d2, '#e07b1f');
      if (o.hp <= 0 && !o.dead){ o.dead = true; kills++; spawnDebris(o); }
    }
  }
}

/* Boss 飞刀：飞行 / 命中玩家 / 被玩家平A斩击或闪击挡掉 */
function updateBossKnives(dt){
  for (const k of bossKnives){
    if (k.dead) continue;
    k.t += dt;  k.spin += dt * 14;
    k.x += k.vx*dt;  k.y += k.vy*dt;

    /* 出界或超时 */
    const kb=BailuWorld.active()?{x:BailuWorld.cam.x,y:BailuWorld.cam.y}:{x:0,y:0};
    if (k.t > k.life || k.x < kb.x-40 || k.x > kb.x+W+40 || k.y < kb.y-40 || k.y > kb.y+H+40){
      k.dead = true; continue;
    }
    /* ★ 被玩家平A扫中：刀光扇形覆盖 = 挡掉 */
    for (const f of slashFx){
      if (f.t <= 0) continue;
      const d = Math.hypot(k.x - f.x, k.y - f.y);
      if (d < player.atkRange + 16){
        const da = Math.abs(normalizeAngle(Math.atan2(k.y-f.y, k.x-f.x) - f.angle));
        if (da < SECTOR_HALF){ deflectKnife(k); break; }
      }
    }
    if (k.dead) continue;
    /* ★ 被闪击范围覆盖 = 挡掉（闪击自带无敌，用冲刺路径判定） */
    if (invulnT > 0 && player.dashT > 0 &&
        Math.hypot(k.x - player.x, k.y - player.y) < 60){
      deflectKnife(k); continue;
    }
    /* 命中玩家 */
    if (Math.hypot(k.x - player.x, k.y - player.y) < player.r + 9){
      damagePlayer(KNIFE_DMG);
      k.dead = true;
      for (let i = 0; i < 7; i++) slashParts.push({
        x:k.x, y:k.y, vx:(Math.random()-0.5)*220, vy:(Math.random()-0.5)*220,
        t:0.25, dur:0.4, r:1.5+Math.random()*2, color:'#e07b1f' });
    }
  }
  bossKnives = bossKnives.filter(k => !k.dead);
}
/* 挡刀：火花 + 记一个格挡反馈 */
function deflectKnife(k){
  k.dead = true;
  floatText(k.x, k.y - 12, '挡!', '#4a6fa5');
  for (let i = 0; i < 8; i++) slashParts.push({
    x:k.x, y:k.y, vx:(Math.random()-0.5)*300, vy:(Math.random()-0.5)*300,
    t:0.22, dur:0.36, r:1.5+Math.random()*2.2,
    color: Math.random()<0.5 ? '#fff8ee' : '#4a6fa5' });
}

function damagePlayer(dmg){
  if (invulnT > 0) return;                            // ★ 无敌帧：闪击过程与落点免伤
  if (!(dmg > 0) || player.hp <= 0) return;
  player.hp -= dmg; player.hitRedT = .3;
  if (!(player.hurtParticleT>0)){
    player.hurtParticleT=.12;
    for(let i=0;i<(combatVfxMotion.matches?3:7);i++){
      const a=Math.random()*Math.PI*2,s=35+Math.random()*70;
      combatVfxParticle({x:player.x,y:player.y-28,vx:Math.cos(a)*s,vy:Math.sin(a)*s,
        life:.35+Math.random()*.2,r:1+Math.random()*1.3,color:i%3?'#a73c36':'#eee6db',type:'ink',angle:a,spin:2,drag:3});
    }
  }
  BailuSprites.onHurt();
  floatText(player.x, player.y-30, `-${Math.round(dmg)}`, '#b03a2e');
  if (player.hp <= 0){ player.hp = 0; gameOver(); }   // 血量归零 → 失败结算
}

/* ---------- HUD 同步 ---------- */
function syncHud(){
  document.getElementById('hpFill').style.width = (player.hp/player.hpMax*100)+'%';
  document.getElementById('mpFill').style.width = (player.mp/player.mpMax*100)+'%';
  document.getElementById('hpNum').textContent = `${Math.ceil(player.hp)}/${player.hpMax}`;
  document.getElementById('mpNum').textContent = `${Math.ceil(player.mp)}/${player.mpMax}`;
  document.getElementById('kills').textContent = `${kills} / ${waveTarget}`;
  /* 属性行随升级动态刷新 */
  const as = document.getElementById('aspeed');
  if (as){
    let s = `蓝耗 ${player.mpCost}/砍 · 回蓝 ${Math.round(player.mpRegen)}/秒`;
    if (player.hpRegen > 0) s += ` · 回血 ${player.hpRegen.toFixed(1)}/秒`;
    if (player.crit > 0) s += ` · 暴击 ${Math.round(player.crit*100)}%`;
    as.textContent = s;
  }
  const cEl = document.getElementById('combo');
  cEl.textContent = `COMBO ${combo}`;
  cEl.style.opacity = combo >= 3 ? 1 : 0;
}

/* ---------- 绘制（纸张风：米白底 + 网格 + 黑色几何） ---------- */
function draw(){
  if (state === 'play' && BailuSprites.holding()) return;     // visual hit-stop: hold the last frame, logic keeps running
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);
  const worldView = BailuWorld.active() && state !== 'menu' && state !== 'select';
  const shake = worldView ? BailuSprites.shakeOffset() : [0,0];
  const camX = worldView ? BailuWorld.cam.x - shake[0] : 0, camY = worldView ? BailuWorld.cam.y - shake[1] : 0;
  window.__drawCam = {x:camX, y:camY};
  if (worldView){
    ctx.save(); ctx.translate(-camX, -camY);
    if (!BailuWorld.drawGround(ctx, darkMapMode ? makeNightScene : null, camX, camY)){ ctx.fillStyle = '#d9d4c4'; ctx.fillRect(camX, camY, W, H); }
    ctx.restore();
  }

  /* ★ 本关像素背景图（菜单/选关不画，保持纸面干净；用预合成离屏画布，进关时才懒合成） */
  const bgO = LEVEL_BG_CANVAS[currentLevel-1];
  if (!worldView && state !== 'menu' && state !== 'select' && bgO){
    if (!bgO.ready) composeLevelBg(currentLevel-1);
    if (bgO.ready) drawSceneBackground(ctx,bgO.c,currentLevel-1);
  }

  /* 原画完整保留，以海雾色温连接敌人与场景，不再叠加全屏方格。 */

  /* 暗角 */
  const vg = ctx.createRadialGradient(W/2,H/2,H*0.4, W/2,H/2, W*0.65);
  vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(23,57,70,0.18)');
  ctx.fillStyle = vg; ctx.fillRect(0,0,W,H);

  /* ★ 慢动作：白闪渐隐 + 聚焦暗角 */
  if (slowmoT > 0){
    const prog = slowmoT / SLOWMO_DUR;              // 1→0
    const flash = Math.max(0, prog - 0.75) * 4;     // 起手 0.25s 白闪
    if (flash > 0){ ctx.fillStyle = `rgba(255,250,238,${flash*0.85})`; ctx.fillRect(0,0,W,H); }
    const vg2 = ctx.createRadialGradient(W/2,H/2,H*0.22, W/2,H/2, W*0.55);
    vg2.addColorStop(0,'rgba(0,0,0,0)');
    vg2.addColorStop(1,`rgba(40,30,20,${0.28*(1-prog)+0.1})`);
    ctx.fillStyle = vg2; ctx.fillRect(0,0,W,H);
  }

  if (worldView){ ctx.save(); ctx.translate(-camX, -camY); }
  /* ---- 敌人技能预警区（画在敌人下面） ---- */
  for (const z of enemyZones){
    ctx.save();
    const life = z.t / z.dur;                       // 1→0
    if (z.kind === 'circle'){
      /* 自爆预警：红圈收缩 */
      ctx.strokeStyle = z.color; ctx.lineWidth = 2;
      ctx.globalAlpha = 0.35 + 0.45*(1-life);
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle = z.color; ctx.globalAlpha = 0.10 + 0.14*(1-life);
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI*2); ctx.fill();
      /* 内圈随引信逼近 */
      ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r*life, 0, Math.PI*2); ctx.stroke();
    } else if (z.kind === 'line'){
      /* 冲刺预警：方向线 + 感叹号 */
      ctx.globalAlpha = 0.35 + 0.4*(1-life);
      ctx.strokeStyle = z.color; ctx.lineWidth = 2; ctx.setLineDash([8,6]);
      ctx.beginPath(); ctx.moveTo(z.x, z.y); ctx.lineTo(z.tx, z.ty); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = z.color; ctx.font = 'bold 26px "Courier New"'; ctx.textAlign = 'center';
      ctx.fillText('!', z.x, z.y - 34);
    } else if (z.kind === 'fan'){
      /* 三连斩预警：扇形 */
      ctx.globalAlpha = 0.16 + 0.2*(1-life);
      ctx.fillStyle = z.color;
      ctx.beginPath(); ctx.moveTo(z.x, z.y);
      ctx.arc(z.x, z.y, z.r, z.ang - z.arc, z.ang + z.arc); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.6; ctx.strokeStyle = z.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, z.ang - z.arc, z.ang + z.arc); ctx.stroke();
    } else if (z.kind === 'boom'){
      /* 爆炸瞬间：白橙实心扩散 */
      ctx.globalAlpha = life * 0.85;
      ctx.fillStyle = '#f7a04a';
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r*(1.15-life*0.35), 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = life; ctx.strokeStyle = '#e07b1f'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r*(1.2-life*0.3), 0, Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }

  enemies.forEach(drawEnemyGround);
  { const nowD = performance.now(); BailuSprites.drawFalls(ctx, Math.min(.05, (nowD - (draw._ft || nowD)) / 1000)); draw._ft = nowD; }
  /* 敌人：倭寇精灵图（8帧距离驱动行走 + 朝向玩家 + 受击闪白） */
  for (const e of enemies){
    ctx.save(); ctx.translate(e.x, e.y + enemyWalkBob(e));
    ctx.imageSmoothingEnabled=BailuSprites.ready();
    const fi = enemyWalkFrame(e);
    const img = (wokouWalk[e.skin] && wokouWalk[e.skin][fi]);
    if (img && img.complete && img.naturalWidth){
      const w = e.r*3.1, h = w*img.height/img.width;
      /* facing comes from separately drawn right-facing frames (BailuSprites); no mirroring */
      /* ★ 紫色隐身：可见度降到 50% */
      const stealthA = e.stealthT > 0 ? 1 - e.T.stealthAlpha : 1;   // 0.5 可见
      if (e.state === 'fuse') ctx.globalAlpha = stealthA * (0.6 + 0.4*Math.abs(Math.sin(e.stateT*22)));
      else ctx.globalAlpha = stealthA;
      /* ★ Boss 光晕：径向渐变（替代每帧 drop-shadow 滤镜，不再走 GPU 滤镜管线） */
      if (e.isBoss){
        const gr = ctx.createRadialGradient(0, -h*0.45, h*0.25, 0, -h*0.45, h*0.95);
        gr.addColorStop(0, hexA(e.T.color, 0.26));
        gr.addColorStop(1, hexA(e.T.color, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(-h*1.1, -h*1.4, h*2.2, h*2.8);
      }
      if (!BailuSprites.drawEnemy(ctx, e, player.x, ctx.globalAlpha)){
        ctx.drawImage(harmonizedEnemyOf(e.skin,fi)||img, -w/2, -h*0.88, w, h);
        // Cached red silhouette preserves the original sprite's alpha and pose.
        if (e.hitRedT>0){
          ctx.globalAlpha=stealthA*.72*Math.min(1,e.hitRedT/.045);
          ctx.drawImage(EgretCombatFeedback.redSprite(harmonizedEnemyOf(e.skin,fi)||img),-w/2,-h*.88,w,h);
        }
      }
      if (e.hitSlowT>0){
        ctx.globalAlpha=.65;ctx.strokeStyle='#6f91ac';ctx.lineWidth=1.2;
        ctx.beginPath();ctx.ellipse(0,2,w*.32,4,0,0,Math.PI*1.7);ctx.stroke();
      }
      ctx.globalAlpha = 1;
      /* ---- 头顶血条·墨韵：宣纸底槽 + 朱砂笔触 + 飞白高光 ---- */
      const bh = e.isBoss ? 6 : 4.5;
      const bw = w*0.76;
      const by = -h*0.88 - (e.isBoss ? 14 : 11);
      ctx.fillStyle = 'rgba(247,243,232,0.62)';
      inkRR(ctx, -bw/2-1, by-1, bw+2, bh+2, (bh+2)/2); ctx.fill();
      ctx.strokeStyle = 'rgba(46,79,87,0.42)'; ctx.lineWidth = 1;
      inkRR(ctx, -bw/2-1, by-1, bw+2, bh+2, (bh+2)/2); ctx.stroke();
      const hpr = Math.max(0, Math.min(1, e.hp/e.hpMax));
      if (hpr > 0){
        const hg = ctx.createLinearGradient(-bw/2, 0, bw/2, 0);
        if (e.isBoss){ hg.addColorStop(0,'#b3671f'); hg.addColorStop(1,'#e0a63f'); }
        else { hg.addColorStop(0,'#8f2f25'); hg.addColorStop(1,'#c9564a'); }
        ctx.fillStyle = hg;
        inkRR(ctx, -bw/2, by, bw*hpr, bh, bh/2); ctx.fill();
        /* 飞白：条上部一道米白细高光，模拟毛笔枯笔边缘 */
        if (bw*hpr > 4){
          ctx.fillStyle = 'rgba(255,247,235,0.42)';
          inkRR(ctx, -bw/2+1.5, by+1, bw*hpr-3, Math.max(1, bh*0.28), bh*0.14); ctx.fill();
        }
      }
      /* 首领：朱砂印标记（楷体，取代原 BOSS 英文小字） */
      if (e.isBoss){
        ctx.font = 'bold 12px "KaiTi","STKaiti",Georgia,serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        const tw = ctx.measureText('首 领').width;
        ctx.fillStyle = '#b03a2e';
        inkRR(ctx, -tw/2-5, by-20, tw+10, 15, 2); ctx.fill();
        ctx.fillStyle = '#f7f3e8';
        ctx.fillText('首 领', 0, by-9);
      }
    }
    ctx.restore();
  }

  /* 敌人斩击特效（黄色三连斩刀光） */
  for (const s of enemySlashes){
    const prog = 1 - s.t/s.dur;
    const a0 = s.angle - s.arc, a1 = s.angle + s.arc;
    ctx.save(); ctx.globalAlpha = Math.max(0, 1-prog) * 0.85;
    ctx.strokeStyle = s.color; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.range, a0, a1); ctx.stroke();
    ctx.strokeStyle = '#fff3d6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.range*0.92, a0, a1); ctx.stroke();
    ctx.restore();
  }

  /* Boss 飞刀：旋转的刀形 */
  for (const k of bossKnives){
    ctx.save(); ctx.translate(k.x, k.y); ctx.rotate(k.ang + k.spin);
    ctx.globalAlpha = k.t > k.life - 0.5 ? Math.max(0, (k.life-k.t)/0.5) : 1;
    /* 刀身 */
    ctx.fillStyle = '#d9b06a';
    ctx.beginPath(); ctx.moveTo(0,-13); ctx.lineTo(4,-2); ctx.lineTo(2,10);
    ctx.lineTo(-2,10); ctx.lineTo(-4,-2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#8a6a2a'; ctx.lineWidth = 1.2; ctx.stroke();
    /* 刀柄 */
    ctx.fillStyle = '#5a4a2a'; ctx.fillRect(-2, 10, 4, 6);
    /* 刀光尾 */
    ctx.globalAlpha *= 0.4; ctx.strokeStyle = '#e07b1f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0,-13);
    ctx.lineTo(-k.vx*0.06, -k.vy*0.06); ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  /* 死亡碎块 */
  for (const d of debris){ ctx.globalAlpha = Math.min(1,d.t*2);
    ctx.fillStyle = d.color || '#2a2a28';
    ctx.fillRect(d.x-d.r/2, d.y-d.r/2, d.r, d.r); }
  ctx.globalAlpha = 1;

  /* 玩家：白鹭（待机跳动 / 移动挥翅 + 朝向指示） */
  const hop  = Math.abs(Math.sin(player.idleT * 2.2));      // 人形待机：轻微呼吸浮动
  const yOff = -hop * 2.5;
  const sx = 1.015 - 0.015*hop, sy = 0.985 + 0.015*hop;

  /* 影子 */
  const spriteHero = BailuSprites.ready();
  if (!spriteHero){
  ctx.save(); ctx.translate(player.x, player.y + 16);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(0, 0, 22*(1-hop*0.3), 5*(1-hop*0.3), 0, 0, Math.PI*2); ctx.fill();
  ctx.restore();
  }

  /* 闪击残影：渐隐半透明少年剑士 */
  for (const a of afterimages){
    if (BailuSprites.drawAfterimage(ctx, a)) continue;
    const ai = birdIdle[0];
    if (!ai.complete || !ai.naturalWidth) continue;
    const ah = ai.width * HERO_SCALE, avh = ai.height * HERO_SCALE;
    ctx.save(); ctx.translate(a.x, a.y);
    ctx.globalAlpha = 0.35 * (a.t/a.dur);
    ctx.drawImage(ai, -ah/2, -avh*0.80, ah, avh);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  /* 本体：四态选帧 — 右键斩击(+剑回空中) > 左键攻击 > 跑步 > 待机(3帧循环) */
  const atkOk = heroAtkL[0].complete && heroAtkL[0].naturalWidth
                && heroAtkR[0].complete && heroAtkR[0].naturalWidth
                && swordBack[0].complete && swordBack[0].naturalWidth;
  const useAtk = player.atkT > 0 && atkOk;
  const useRun = !useAtk && player.moving && player.spd01 > 0.15
                 && birdRun[0].complete && birdRun[0].naturalWidth;
  let img;
  /* ★ 安全取帧：NaN / 负数 / 越界一律回退第 0 帧（脏状态最多错一帧，绝不抛异常冻屏） */
  function safeFrame(arr, raw){
    let i = Math.floor(raw);
    if (!isFinite(i)) return arr[0];
    i = ((i % arr.length) + arr.length) % arr.length;
    return arr[i] || arr[0];
  }
  if (useAtk){
    if (player.atkKind === 'R'){
      /* 右键斩击 8 帧 → 剑脱手飞回空中 4 帧 */
      const total = ATK_R_DUR + SWORD_BACK_DUR;
      const t = total - player.atkT;                       // 已播秒数
      if (t < ATK_R_DUR) img = safeFrame(heroAtkR, t / ATK_R_DUR * 8);
      else img = safeFrame(swordBack, (t - ATK_R_DUR) / SWORD_BACK_DUR * 4);
    } else {
      const t = ATK_L_DUR - player.atkT;
      img = safeFrame(heroAtkL, t / ATK_L_DUR * 8);
    }
  } else if (useRun){
    const runRate = 7 + player.spd01 * 8;                    // 跑步循环随速度加快
    img = safeFrame(birdRun, player.animT * runRate);
  } else {
    img = safeFrame(birdIdle, player.idleT * 4);             // 待机 3 帧轻循环
  }
  if (!img) img = birdIdle[0];
  const moveBob = useRun ? Math.abs(Math.sin(player.bob))*3.2*player.spd01 : 0;
  ctx.imageSmoothingEnabled = true;
  if (BailuSprites.drawHero(ctx, player, {ATK_L_DUR, ATK_R_DUR, SWORD_BACK_DUR, invuln: invulnT > 0, bob: useRun ? -moveBob : yOff})){ /* new body + single sword */ }
  else if (img.complete && img.naturalWidth){
    const sw = img.width * HERO_SCALE, sh = img.height * HERO_SCALE;  // 素材已统一身高，同倍率显示
    ctx.save();
    ctx.translate(player.x, player.y + (useRun ? -moveBob : yOff));
    ctx.rotate(player.facing * 0.06 + player.lean);          // 朝向微倾 + 移动前倾
    ctx.scale(sx, sy);
    /* ★ 无敌帧视觉：本体高频闪烁 + 淡青光晕（径向渐变，替代 drop-shadow 滤镜） */
    if (invulnT > 0){
      ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(performance.now()*0.028));
      const gr = ctx.createRadialGradient(0, -sh*0.4, sh*0.2, 0, -sh*0.4, sh*0.8);
      gr.addColorStop(0, 'rgba(90,200,220,0.32)');
      gr.addColorStop(1, 'rgba(90,200,220,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(-sw*1.2, -sh*1.1, sw*2.4, sh*2.2);
    }
    ctx.drawImage(cleanHeroActionFrame(img), -sw/2, -sh*0.80, sw, sh);
    if(player.hitRedT>0){
      ctx.globalAlpha=.67*Math.min(1,player.hitRedT/.045);
      ctx.drawImage(EgretCombatFeedback.redSprite(cleanHeroActionFrame(img)),-sw/2,-sh*.80,sw,sh);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* 朝向指示小三角（画在羊之后，不被遮挡） */
  ctx.save(); ctx.translate(player.x, player.y); ctx.rotate(player.facing);
  ctx.fillStyle = '#b03a2e';
  ctx.beginPath(); ctx.moveTo(46,0); ctx.lineTo(36,-6); ctx.lineTo(36,6); ctx.closePath(); ctx.fill();
  ctx.restore();

  /* 青白浪刃与紫蓝两段斩光：仅替换视觉，保留原 slashFx 判定。 */
  drawAttackVfx();
  /* 刀光拖尾粒子（渐变消失） */
  for (const p of slashParts){
    ctx.globalAlpha = Math.max(0, p.t/p.dur);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  drawImpactParticles();
  if (worldView) ctx.restore();
  drawLowHealthEdge();
  if (worldView){ ctx.save(); ctx.translate(-camX, -camY); }
  /* 飘字 */
  ctx.font = 'bold 15px "Courier New"'; ctx.textAlign = 'center';
  for (const f of floatTexts){
    if (BailuSprites.drawFloat(ctx, f)) continue;     // glyph-atlas numbers built from the real value
    ctx.globalAlpha = Math.min(1, f.t);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  if (worldView){ ctx.restore(); drawGateHint(); }
}
/* Zone gate guidance (screen space): shown while the next wave waits for the hero to advance. */
function drawGateHint(){
  const gx = BailuWorld.gateHint(); if (gx == null || state !== 'play') return;
  const sx = gx - BailuWorld.cam.x, t = performance.now()/1000;
  const pulse = combatVfxMotion.matches ? 1 : .75 + .25*Math.sin(t*4);
  const x = Math.min(W - 70, Math.max(W*0.62, sx)), y = H*0.5;
  ctx.save(); ctx.globalAlpha = .85*pulse;
  ctx.fillStyle = 'rgba(16,58,66,.55)'; ctx.strokeStyle = '#e9d39a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x-26,y-22); ctx.lineTo(x+8,y-22); ctx.lineTo(x+34,y); ctx.lineTo(x+8,y+22); ctx.lineTo(x-26,y+22); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#f4efe2'; ctx.font = 'bold 15px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('前进', x, y); ctx.restore();
}

/* =====================================================
   页面状态机：menu（主页面） / select（选关） / play / result
   ===================================================== */
let state = 'menu';           // 当前页面

function setScreen(id){
  ['menu','select','saves'].forEach(s => {
    document.getElementById('screen-' + s).classList.toggle('active', s === id);
  });
  if(id==='menu')beginHomeArrival();
}

/* ---- 覆盖层（暂停 / 结算共用） ---- */
let pausedNow = false;        // 标记当前覆盖层是否为"暂停"（区分结算）
function showOverlay({tag, title, sub, buttons, isPause}){
  pausedNow = !!isPause;
  document.getElementById('ovTag').textContent = tag;
  document.getElementById('ovTitle').textContent = title;
  document.getElementById('ovSub').textContent = sub || '';
  const box = document.getElementById('ovBtns'); box.innerHTML = '';
  buttons.forEach(b => {
    const el = document.createElement('button');
    el.textContent = b.label;
    el.className = 'btn' + (b.primary ? ' primary' : '');
    el.onclick = () => handleAct(b.act);
    box.appendChild(el);
  });
  /* 暂停页才显示音量控制 */
  const au = document.getElementById('audioRow');
  au.classList.toggle('show', !!isPause);
  if (isPause) buildAudioPanel();
  document.getElementById('overlay').classList.add('active');
}
function hideOverlay(){ document.getElementById('overlay').classList.remove('active'); }

/* ---- 动作分发 ---- */
function handleAct(act){
  if (_transitionBusy) return;
  const pageActions = ['resume','pause','retry','next','sel','home','quit','farewell-back','menu-pause'];
  if (pageActions.includes(act)){
    playPageTransition(() => runAction(act), ['home','sel','farewell-back'].includes(act));
  } else runAction(act);
}
function runAction(act){
  try { handleActInner(act); }
  catch(err){
    /* ★ 兜底：任何动作异常都退回选关页，绝不允许按钮点了没反应/死机 */
    console.warn('handleAct error', act, err);
    try { hideOverlay(); state = 'select'; setScreen('select'); buildLevels(); } catch(e){}
  }
}
function handleActInner(act){
  if (act === 'resume'){ hideOverlay(); state = 'play'; document.getElementById('hud').classList.add('show'); }
  else if (act === 'pause'){ state = 'result'; showOverlay({
      tag:'已 暂 停', title:`第 ${currentLevel} 关 · ${LEVEL_NAMES[currentLevel-1]}`,
      sub:'继续挑战，或重新开始', isPause:true,
      buttons:[{label:'继续游戏', act:'resume', primary:true},{label:'重新开始', act:'retry'},{label:'返回选关', act:'sel'}]});
  }
  else if (act === 'retry'){ hideOverlay(); state = 'play'; document.getElementById('hud').classList.add('show');
      setScreen(null); document.getElementById('hud').classList.add('show'); resetGame(currentLevel); }
  else if (act === 'next'){
      const nx = Math.min(MAX_LEVEL, currentLevel + 1); hideOverlay(); state = 'play'; resetGame(nx); }
  else if (act === 'sel'){
      hideOverlay(); state = 'select'; setScreen('select'); buildLevels(); }
  else if (act === 'start'){ state = 'select'; setScreen('select'); buildLevels(); }
  else if (act === 'quit'){ state = 'menu'; setScreen('menu'); }
  else if (act === 'farewell-back'){
      hideOverlay(); state = 'menu'; setScreen('menu'); }
  else if (act === 'home'){ state = 'menu'; setScreen('menu'); }
  else if (act === 'menu-pause'){ handleActInner('pause'); }
}

/* ---- 选关页 ---- */
function buildLevels(){
  const grid=document.getElementById('lvGrid');grid.innerHTML='';
  const screen=document.getElementById('screen-select'),caption=document.getElementById('routeCaption');
  const showRoute=i=>{screen.style.setProperty('--route-bg',`url("${LEVEL_BGS[i-1]}")`);
    caption.innerHTML=`<strong>${String(i).padStart(2,'0')} / ${LEVEL_NAMES[i-1]}</strong> · 像素鹭岛，御剑逐浪`;};
  showRoute(Math.min(unlockedLevel,MAX_LEVEL));
  for(let i=1;i<=MAX_LEVEL;i++){
    const locked=i>unlockedLevel,isNow=!locked&&i===unlockedLevel,el=document.createElement('button');
    el.type='button';el.className='lvCard'+(locked?' locked':'')+(isNow?' now':'');el.disabled=locked;
    el.style.backgroundImage=`url(${LEVEL_BGS[i-1]})`;el.style.setProperty('--route-order',String(i-1));
    el.setAttribute('aria-label',`第${i}关 ${LEVEL_NAMES[i-1]} ${locked?'未解锁':i<unlockedLevel?'已通关':'开始挑战'}`);
    el.innerHTML=`<div class="lvNo">${String(i).padStart(2,'0')}</div><div class="lvName">${LEVEL_NAMES[i-1]}</div>
      <div class="lvState">${locked?'未解锁':i<unlockedLevel?'已通关':'待启航'}</div>`;
    el.onpointerenter=()=>showRoute(i);el.onfocus=()=>showRoute(i);
    if(!locked)el.onclick=()=>playPageTransition(()=>{setScreen(null);state='play';
      document.getElementById('hud').classList.add('show');resetGame(i);});
    grid.appendChild(el);
  }
}

/* ---- 主菜单 / 选关 按钮绑定 ---- */
/* ---------- 页面动画共用锁：阻止重复触发，战斗在过渡结束后推进 ---------- */
let _transitionBusy = false;
let _transitionGuard = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function transitionLock(on){
  clearTimeout(_transitionGuard);
  _transitionBusy = on;
  if (on) _transitionGuard = setTimeout(()=>{ if(_transitionBusy){ transitionLock(false); document.querySelectorAll('.home-launching').forEach(e=>e.classList.remove('home-launching')); } },4000);
  stage.classList.toggle('is-transitioning', on);
  stage.setAttribute('aria-busy', String(on));
  if (on) Object.keys(keys).forEach(key => { keys[key] = false; });
}
// 鼠标、触屏用实际点击点；键盘激活使用按钮中心。坐标始终是 1280×640 舞台坐标。
function transitionPoint(event){
  const rect = stage.getBoundingClientRect();
  if (event && event.detail && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)){
    return {x:Math.max(0,Math.min(W,(event.clientX-rect.left)*W/rect.width)),
      y:Math.max(0,Math.min(H,(event.clientY-rect.top)*H/rect.height))};
  }
  const button = event && event.currentTarget;
  if (button){
    const bounds = button.getBoundingClientRect();
    return {x:(bounds.left+bounds.width/2-rect.left)*W/rect.width,
      y:(bounds.top+bounds.height/2-rect.top)*H/rect.height};
  }
  return {x:W/2,y:H/2};
}
function restorePageFocus(){
  // 只在焦点因切页失去可见目标时移动它，避免截断输入框编辑。
  const focused = document.activeElement;
  if (focused && focused !== document.body && focused.getClientRects().length) return;
  const panel = document.querySelector('#overlay.active') || document.querySelector('.screen.active');
  const target = panel ? panel.querySelector('button,input') : document.getElementById('btnPause');
  if (target) target.focus({preventScroll:true});
}
function runTransitionCallback(callback){
  if (typeof callback === 'function') callback();
}
function playPageTransition(callback, reverse = false){
  if (_transitionBusy) return;
  if (reducedMotion.matches){ runTransitionCallback(callback); restorePageFocus(); return; }
  const layer = document.getElementById('pageTurnLayer');
  const front = layer.querySelector('.pageFront');
  const sheet = layer.querySelector('.pageSheet');
  transitionLock(true);
  let fallback, finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    clearTimeout(fallback);
    sheet.removeEventListener('animationend', cleanup);
    layer.className = '';
    front.replaceChildren();
    transitionLock(false);
    restorePageFocus();
  };
  try {
    // Shadow DOM 保留原页面的全部样式；快照 ID 不会干扰游戏 getElementById。
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    const shadow = host.attachShadow({mode:'open'});
    const style = document.createElement('style');
    style.textContent = document.querySelector('style').textContent;
    shadow.appendChild(style);
    for (const child of stage.children){
      if (['pageTurnLayer','inkLayer','dbg','gesturePanel','gestureBadge','gestureCursor','gestureLaunch','gestureMovePad','gamepadPanel','gamepadBadge','gamepadLaunch'].includes(child.id) || getComputedStyle(child).display === 'none') continue;
      const copy = child.cloneNode(true);
      if (child.tagName === 'CANVAS') copy.getContext('2d').drawImage(child,0,0);
      copy.querySelectorAll('canvas').forEach((canvas,index) => {
        canvas.getContext('2d').drawImage(child.querySelectorAll('canvas')[index],0,0);
      });
      copy.querySelectorAll('input').forEach((input,index) => {
        input.value = child.querySelectorAll('input')[index].value;
      });
      shadow.appendChild(copy);
    }
    front.replaceChildren(host);
    layer.className = 'play' + (reverse ? ' reverse' : '');
    runTransitionCallback(callback);
    sheet.addEventListener('animationend', cleanup, {once:true});
    // 关闭标签页、浏览器禁用动画等情况下，仍能释放交互锁。
    fallback = setTimeout(cleanup, 1100);
  } catch(error){ cleanup(); throw error; }
}

/* ---------- 墨水晕染：稳定的不规则轮廓 + 灰色水痕 + 深墨中心 ---------- */
let _inkGrain = null;
function getInkGrain(w, h){
  if (_inkGrain && _inkGrain.width === w && _inkGrain.height === h) return _inkGrain;
  const grain = document.createElement('canvas');
  grain.width = w; grain.height = h;
  const g2 = grain.getContext('2d'), px = g2.createImageData(w, h);
  let seed = 721;
  for (let i = 0; i < px.data.length; i += 4){
    seed = (seed*1664525 + 1013904223) >>> 0;
    px.data[i] = px.data[i+1] = px.data[i+2] = 140;
    px.data[i+3] = (seed >>> 28);
  }
  g2.putImageData(px, 0, 0);
  _inkGrain = grain;
  return grain;
}
function playInkTransition(x, y, callback){
  if (_transitionBusy) return;
  if (reducedMotion.matches){ runTransitionCallback(callback); restorePageFocus(); return; }
  const layer = document.getElementById('inkLayer');
  const canvas = document.getElementById('inkBloomCanvas');
  const ink = canvas.getContext('2d');
  const scale = canvas.width/W;
  const cx = x*scale, cy = y*scale;
  const coverRadius = Math.hypot(Math.max(x,W-x),Math.max(y,H-y))*scale/0.65;
  const duration = 1600;
  // 细微纸纤维颗粒全局只生成一次（原来是每次过场都逐像素重算）
  const grain = getInkGrain(canvas.width, canvas.height);
  let start, frame, fallback, switched = false, finished = false;
  transitionLock(true);
  layer.className = 'play';
  layer.style.opacity = '1';
  function switchPage(){
    if (switched) return;
    switched = true;
    runTransitionCallback(callback);
  }
  function cleanup(){
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    clearTimeout(fallback);
    try { switchPage(); }
    finally {
      layer.className = '';
      layer.style.opacity = '';
      ink.clearRect(0,0,canvas.width,canvas.height);
      transitionLock(false);
      restorePageFocus();
    }
  }
  function contour(radius, phase){
    ink.beginPath();
    for (let i=0;i<=200;i++){
      const a=i/200*Math.PI*2;
      // 大尺度水痕与细小毛边叠加；不会每帧跳动或出现机械圆圈。
      const edge=1 + .095*Math.sin(a*3+phase) + .065*Math.sin(a*7+1.4)
        + .035*Math.sin(a*13+phase*.5) + .018*Math.sin(a*31+2.1) + .008*Math.sin(a*71+.8);
      const px=cx+Math.cos(a)*radius*edge, py=cy+Math.sin(a)*radius*edge;
      if (i===0) ink.moveTo(px,py); else ink.lineTo(px,py);
    }
    ink.closePath();
  }
  function paint(now){
    try {
      if (start === undefined) start = now;
      const t=Math.min(1,(now-start)/duration);
      const growth=Math.min(1,t/.54);
      const radius=coverRadius*Math.pow(growth,1.45);
      ink.clearRect(0,0,canvas.width,canvas.height);
      // 从淡灰水边向深墨芯累积，边缘有自然的吸水扩散。
      /* ★ 不再用 ctx.filter='blur()'（每帧 6 次全屏模糊，GPU 滤镜路径会崩渲染进程）。
         改为多层同心水痕由外向内叠加，靠层差自然形成柔边。 */
      const washes=[ [1.16,'rgba(97,94,87,.06)',.8], [1.11,'rgba(97,94,87,.09)',.72],
        [1.07,'rgba(73,71,66,.16)',.65], [1.04,'rgba(48,47,44,.22)',.5],
        [1.015,'rgba(33,32,30,.38)',.4], [.99,'rgba(33,32,30,.62)',.3],
        [.96,'#22211f',.2] ];
      for (const [size,color,phase] of washes){
        contour(Math.max(.01,radius*size),phase);
        ink.fillStyle=color; ink.fill();
      }
      ink.globalCompositeOperation='source-atop';
      ink.drawImage(grain,0,0);
      ink.globalCompositeOperation='source-over';
      // 少量渗化小墨点贴近水痕，不做向四处飞散的爆炸效果。
      if (growth>.05 && growth<.85){
        ink.fillStyle='rgba(48,47,44,.22)';
        for(let i=0;i<12;i++){
          const a=i*2.39996, r=radius*(1.09+(i%3)*.045);
          ink.beginPath(); ink.arc(cx+Math.cos(a)*r,cy+Math.sin(a)*r,1.2+i%3,0,Math.PI*2); ink.fill();
        }
      }
      if(t>=.55) switchPage();
      const fade=Math.max(0,(t-.6)/.4);
      layer.style.opacity=String(1-fade*fade*(3-2*fade));
      if(t<1) frame=requestAnimationFrame(paint); else cleanup();
    } catch(error){ cleanup(); console.warn('ink transition error',error); }
  }
  frame=requestAnimationFrame(paint);
  fallback=setTimeout(cleanup,duration+400);
}
// 动画期间拦截新的鼠标和键盘操作，但保留松开按键事件，防止移动键卡住。
stage.addEventListener('pointerdown',event => {
  if (!_transitionBusy) return;
  event.preventDefault(); event.stopImmediatePropagation();
},true);
stage.addEventListener('click',event => {
  if (!_transitionBusy) return;
  event.preventDefault(); event.stopImmediatePropagation();
},true);
window.addEventListener('keydown',event => {
  if (!_transitionBusy) return;
  event.preventDefault(); event.stopImmediatePropagation();
},true);


document.getElementById('btnStart').onclick = playLaunchTransition;
document.getElementById('btnSense').onclick = () => {
  const el = document.getElementById('senseNote');
  el.textContent = '体感模式将在下一步接入摄像头（左手食指控移动 / 右手抓握挥砍）';
  el.style.opacity = 1;
};
document.getElementById('btnQuit').onclick = () => {
  /* 退出：浏览器禁止脚本关闭非脚本打开的标签页（旧写法会卡死/无反应），
     改为优雅的告别页，不再依赖 window.close */
  playPageTransition(() => {
  state = 'menu';
  showOverlay({
    tag: '再 会',
    title: '白 鹭 归 巢',
    sub: '感谢游玩 · 期待与你再会',
    buttons: [{ label: '回来继续', act: 'farewell-back', primary: true }]
  });
  });
};
document.getElementById('btnSelBack').onclick = () => handleAct('home');
document.getElementById('btnPause').onclick = () => handleAct('menu-pause');
/* 升级卡：放弃强化（直接推进） */
document.getElementById('cardSkip').onclick = () => closeCardPicker();
document.getElementById('btnRefresh').onclick = () => refreshCards();

/* ★ 事件委托：选卡唯一入口。
      用 click（兼容性最广，鼠标/触屏/合成事件都能触发），
      并且保证一次点击只处理一次 —— 不再和卡片自身 onclick 双路径打架。 */
document.getElementById('cardLayer').addEventListener('click', e => {
  if (state !== 'card' || _cardLock) return;
  const target = e.target.closest('.upCard');
  if (!target) return;
  const id = target.dataset.cardId;
  const c = cardChoices.find(x => x.id === id);
  if (c) pickCard(c);
});

/* 存档 / 存档处 / 导出（★ 全部兜底：存档环境异常时提示而不是无反应）
   「读 档」已升级为「存 档 处」页面：页面内可读取任一存档、新建存档从头打（见上方 readSave / startNewSave） */
document.getElementById('btnSave').onclick = () => {
  try {
    const nm = saveGame(document.getElementById('saveName').value);
    noteSaved('已存档：' + nm, true);
  } catch(err){ noteSaved('存档失败：浏览器存储不可用', false); }
};
document.getElementById('btnExport').onclick = () => {
  const nm = saveGame(document.getElementById('saveName').value);
  const data = loadSaveList()[nm];
  const blob = new Blob([JSON.stringify({ [nm]: data }, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'egret_save_' + nm + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  noteSaved('已导出存档文件：' + a.download, true);
};

/* 升级卡也支持键盘 1/2/3 选择，1/2/3 之外用 Esc 放弃 */
addEventListener('keydown', e => {
  if (state !== 'card') return;
  const n = +e.key;
  if (n >= 1 && n <= cardChoices.length){ e.preventDefault(); pickCard(cardChoices[n-1]); }
  else if (e.key === 'Escape'){ e.preventDefault(); closeCardPicker(); }
});

/* 下载游戏包：把当前页面本身打包成离线单文件 HTML */
document.getElementById('btnDownload').onclick = async () => {
  try {
    noteSaved('正在打包…', true);
    let html='';
    if(location.protocol!=='file:'){
      try{const res=await fetch(location.href,{cache:'no-store'});if(res.ok)html=await res.text();}catch(_){}
    }
    if(!html) html=buildOfflineGameSource();
    /* 剥离仅为预览注入的测试代码（正常运行时不存在，此处做保险） */
    html = html.replace(/\/\* TEST-[\s\S]*?\/\* END-TEST \*\//g, '');
    const blob = new Blob([html], { type:'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '白鹭击浪.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    noteSaved('已下载「白鹭击浪.html」——双击即可离线游玩（含全部素材与音乐）', true);
  } catch(e){
    noteSaved('打包失败，请直接右键保存本页面', false);
  }
};

/* 空格暂停 / 继续（结算页不可误按继续） */
addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === 'Escape'){
    e.preventDefault();
    if (state === 'play') handleAct('pause');
    else if (state === 'result' && pausedNow) handleAct('resume');
  }
});

/* 进入游戏时默认停在主页面 */

/* ---------- 背景音乐：主曲（页面/常规波次）+ BOSS 燃曲 ---------- */
const BGM_MAIN = 'assets/embedded/a088.m4a';   /* 平时每波战斗 + 各页面 */
const BGM_BOSS = 'assets/embedded/a089.m4a';   /* BOSS 战 */
let bgmOn = true, bgmVol = 0.55, bgmTrack = 'main';
const bgm = new Audio();
bgm.src = BGM_MAIN; bgm.loop = true; bgm.volume = bgmVol;
let bgmStarted = false;
function startBgm(){ if (bgmStarted || !bgmOn) return; bgmStarted = true; bgm.play().catch(()=>{}); }
addEventListener('pointerdown', startBgm);
addEventListener('keydown', startBgm);
/* ★ 切歌：'main' = 平时/页面 · 'boss' = BOSS 战（首次交互前只换源，交互后自动播） */
function bgmPlay(which){
  if (bgmTrack === which && bgm.src) return;
  bgmTrack = which;
  bgm.src = (which === 'boss') ? BGM_BOSS : BGM_MAIN;
  if (bgmOn && bgmStarted) bgm.play().catch(()=>{});
}
function setBgmVol(v){ bgmVol = v; bgm.volume = v; try { localStorage.setItem('egret_vol', v); } catch(e){} }
function setBgmOn(on){ bgmOn = on; if (on){ bgm.volume = bgmVol; bgm.play().catch(()=>{}); } else bgm.pause();
  try { localStorage.setItem('egret_bgm', on ? '1' : '0'); } catch(e){} }
try {
  const sv = parseFloat(localStorage.getItem('egret_vol')); if (!isNaN(sv)) bgmVol = sv;
  bgmOn = localStorage.getItem('egret_bgm') !== '0'; bgm.volume = bgmVol;
} catch(e){}

/* ---------- 暂停页音量控件 ---------- */
function buildAudioPanel(){
  const row = document.getElementById('audioRow');
  if (!row || row.dataset.built) return;
  row.dataset.built = '1';
  row.innerHTML = '<span class="auLabel">音量</span><input type="range" id="volRange" min="0" max="100" value="' + Math.round(bgmVol*100) + '"><button class="btn small" id="btnBgmToggle">' + (bgmOn ? '关闭音乐' : '开启音乐') + '</button>';
  document.getElementById('volRange').oninput = e => setBgmVol(e.target.value/100);
  document.getElementById('btnBgmToggle').onclick = e => {
    setBgmOn(!bgmOn); e.target.textContent = bgmOn ? '关闭音乐' : '开启音乐'; startBgm();
  };
}

/* ---------- 首页：本地绘制海洋航站，离线可用 ---------- */
const homeCanvas=document.getElementById('menuScene');
const homeContext=homeCanvas.getContext('2d');
const homeScreen=document.getElementById('screen-menu');
document.getElementById('menuHero').src='assets/embedded/a090.png';
let homeLastPaint=-Infinity;
function drawHomeScene(now){
  if(!homeScreen.classList.contains('active') || document.hidden) return;
  if(reducedMotion.matches && homeLastPaint!==-Infinity) return;
  if(now-homeLastPaint<1000/30) return;
  homeLastPaint=now;
  const g=homeContext, t=reducedMotion.matches ? 0 : now*.00018;
  g.clearRect(0,0,W,H);
  const sky=g.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,'#07111f'); sky.addColorStop(.57,'#102f42'); sky.addColorStop(.63,'#173e50'); sky.addColorStop(1,'#04121e');
  g.fillStyle=sky; g.fillRect(0,0,W,H);
  const glow=g.createRadialGradient(685,285,10,685,285,420);
  glow.addColorStop(0,'rgba(79,170,186,.17)'); glow.addColorStop(.5,'rgba(35,103,134,.06)'); glow.addColorStop(1,'transparent');
  g.fillStyle=glow; g.fillRect(0,0,W,H);
  // 远岸剪影：让背景仍然属于海港，而非宇宙仪表盘。
  g.fillStyle='#091b2a';
  for(let i=0;i<66;i++){
    const x=i*21, height=8+(Math.sin(i*16.7)+1)*13;
    g.fillRect(x,388-height,12+(i%4)*3,height);
    if(i%7===0){g.fillStyle='#73c6cf44';g.fillRect(x+4,383-height,2,2);g.fillStyle='#091b2a';}
  }
  g.beginPath();g.moveTo(970,388);g.lineTo(980,323);g.lineTo(993,388);
  g.moveTo(997,388);g.lineTo(1008,316);g.lineTo(1021,388);g.fill();
  g.fillStyle='#75b5c52a';g.fillRect(0,389,W,1);
  // 透视海面网格随潮汐轻移，越近处越疏。
  for(let row=0;row<27;row++){
    const depth=(row+1)/27, y=394+Math.pow(depth,2.05)*245;
    g.beginPath();
    for(let x=-20;x<=W+20;x+=12){
      const wave=Math.sin(x*.009+t*4+row*.38)*(1+depth*8)+Math.cos(x*.016-t*3+row*.2)*depth*3;
      if(x===-20)g.moveTo(x,y+wave);else g.lineTo(x,y+wave);
    }
    g.strokeStyle=`rgba(82,175,195,${.035+depth*.16})`;g.lineWidth=.7;g.stroke();
  }
  for(let col=-17;col<=17;col++){
    g.beginPath();
    for(let s=0;s<=34;s++){
      const d=s/34, y=394+Math.pow(d,1.4)*246, x=660+col*(4+Math.pow(d,1.3)*67);
      if(s===0)g.moveTo(x,y);else g.lineTo(x,y+Math.sin(x*.009+t*4+s*.18)*d*5);
    }
    g.strokeStyle='rgba(80,165,188,.065)';g.lineWidth=.7;g.stroke();
  }
  // 白鹭角色的全息投影底座。
  [ [162,28,.34], [186,34,.15], [214,41,.07] ].forEach(([rx,ry,alpha],i)=>{
    g.beginPath();g.ellipse(670,520,rx,ry,-.07,0,Math.PI*2);g.strokeStyle=`rgba(139,226,228,${alpha})`;g.lineWidth=i===0?1.3:1;g.stroke();
  });
  g.save();g.translate(670,520);g.scale(1,.18);g.rotate(t*.6);
  g.beginPath();g.arc(0,0,180,.15,1.05);g.arc(0,0,180,3.3,4.2);g.strokeStyle='#b5f3e0';g.lineWidth=3;g.shadowColor='#70dcdf';g.shadowBlur=13;g.stroke();g.restore();
  // 微弱流光，保持标题和交互的阅读空间。
  for(let i=0;i<22;i++){
    const x=380+(i*173.7)%870, y=100+(i*87.3)%440, a=.12+.12*Math.sin(t*4+i);
    g.fillStyle=`rgba(151,226,230,${a})`;g.fillRect(x,y-Math.sin(t*2+i)*5,i%4===0?2:1,i%4===0?2:1);
  }
}
// 按钮自身倾斜，浮动由外层承载，二者不会相互覆盖。
document.querySelectorAll('#screen-menu .sciButton').forEach(button=>{
  button.addEventListener('pointermove',event=>{
    if(reducedMotion.matches || _transitionBusy) return;
    const r=button.getBoundingClientRect(),x=(event.clientX-r.left)/r.width,y=(event.clientY-r.top)/r.height;
    button.style.setProperty('--rx',((.5-y)*5)+'deg');
    button.style.setProperty('--ry',((x-.5)*7)+'deg');
    button.style.setProperty('--spot',(x*100)+'%');
  });
  button.addEventListener('pointerleave',()=>{
    button.style.setProperty('--rx','0deg');button.style.setProperty('--ry','0deg');
  });
});
homeScreen.addEventListener('pointermove',event=>{
  if(reducedMotion.matches || _transitionBusy) return;
  const r=homeScreen.getBoundingClientRect();
  homeScreen.style.setProperty('--look-x',((event.clientX-r.left)/r.width-.5)*8+'px');
  homeScreen.style.setProperty('--look-y',((event.clientY-r.top)/r.height-.5)*5+'px');
});
homeScreen.addEventListener('pointerleave',()=>{
  homeScreen.style.setProperty('--look-x','0px');homeScreen.style.setProperty('--look-y','0px');
});
reducedMotion.addEventListener('change',()=>{homeLastPaint=-Infinity;});


/* ---------- 启动 ---------- */
/* 海雾聚形：只服务首页，不引用或修改战斗主角的帧。 */
const arrivalCanvas=document.getElementById('arrivalParticles');
const arrivalContext=arrivalCanvas.getContext('2d');
const homeHero=document.getElementById('menuHero');
const heroFloat=document.querySelector('.heroFloat');
let arrivalStart=0, arrivalDone=false, arrivalPoints=[], arrivalPaint=-Infinity;
const easeTide=v=>1-Math.pow(1-Math.max(0,Math.min(1,v)),3);
function stageBox(el){
  const a=el.getBoundingClientRect(),b=stage.getBoundingClientRect();
  return {x:(a.left-b.left)*W/b.width,y:(a.top-b.top)*H/b.height,w:a.width*W/b.width,h:a.height*H/b.height};
}
function collectArrivalPoints(){
  const points=[];
  if(homeHero.complete&&homeHero.naturalWidth){
    const sample=document.createElement('canvas');sample.width=160;sample.height=272;
    const s=sample.getContext('2d',{willReadFrequently:true});
    s.drawImage(homeHero,0,0,160,272);
    const d=s.getImageData(0,0,160,272).data,r=stageBox(homeHero);
    const fit=Math.min(r.w/homeHero.naturalWidth,r.h/homeHero.naturalHeight);
    const iw=homeHero.naturalWidth*fit,ih=homeHero.naturalHeight*fit;
    for(let y=0;y<272;y+=4)for(let x=0;x<160;x+=4){
      const i=(y*160+x)*4;if(d[i+3]<125)continue;
      points.push({x:r.x+(r.w-iw)/2+x/160*iw,y:r.y+(r.h-ih)/2+y/272*ih,
        color:`rgb(${d[i]},${d[i+1]},${d[i+2]})`,group:0});
    }
  }
  const b=stageBox(document.getElementById('btnStart'));
  for(let i=0;i<100;i++){
    const p=i/100,side=Math.floor(p*4),u=p*4-side;
    points.push({x:side===0?b.x+b.w*u:side===1?b.x+b.w:side===2?b.x+b.w*(1-u):b.x,
      y:side===0?b.y:side===1?b.y+b.h*u:side===2?b.y+b.h:b.y+b.h*(1-u),color:'#c9fff0',group:1});
  }
  const mask=document.createElement('canvas');mask.width=220;mask.height=40;
  const m=mask.getContext('2d',{willReadFrequently:true});m.font='600 21px "Microsoft YaHei",sans-serif';m.fillText('开始游戏',0,27);
  const md=m.getImageData(0,0,220,40).data;
  for(let y=0;y<40;y+=3)for(let x=0;x<220;x+=3)if(md[(y*220+x)*4+3]>150)
    points.push({x:b.x+25+x,y:b.y+20+y,color:'#c9fff0',group:1});
  arrivalPoints=points.map((p,i)=>({...p,seed:(Math.sin(i*127.1+19)*43758.5453)%1,delay:(i%29)/29*.28}));
}
function finishHomeArrival(){
  arrivalDone=true;homeScreen.classList.remove('home-arriving');homeScreen.classList.add('home-ready');
  homeScreen.style.setProperty('--hero-alpha','1');homeScreen.style.setProperty('--dock-alpha','1');
  heroFloat.style.transform='';arrivalContext.clearRect(0,0,W,H);
}
function beginHomeArrival(){
  resetHomeSword();
  arrivalStart=performance.now();arrivalPaint=-Infinity;arrivalDone=false;
  homeScreen.classList.remove('home-ready','home-launching');homeScreen.classList.add('home-arriving');
  homeScreen.style.setProperty('--hero-alpha',reducedMotion.matches?'1':'0');
  homeScreen.style.setProperty('--dock-alpha',reducedMotion.matches?'1':'.5');
  heroFloat.style.transform='';
  collectArrivalPoints();if(reducedMotion.matches)finishHomeArrival();
}
homeHero.addEventListener('load',()=>{if(homeScreen.classList.contains('active'))collectArrivalPoints();});
homeHero.addEventListener('error',()=>{finishHomeArrival();document.getElementById('senseNote').textContent='首页立绘未能载入，仍可开始游戏。';});
reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)finishHomeArrival();});
function drawHomeArrival(now){
  if(!homeScreen.classList.contains('active')||document.hidden||_transitionBusy||reducedMotion.matches)return;
  if(now-arrivalPaint<1000/30)return;arrivalPaint=now;
  const g=arrivalContext;g.clearRect(0,0,W,H);
  if(arrivalDone)return;
  const p=Math.min(1,(now-arrivalStart)/2450),fly=easeTide(p/.83);
  heroFloat.style.transform=`translate(${-56*(1-fly)}px,${28*(1-fly)}px) rotate(${-2*(1-fly)}deg)`;
  homeScreen.style.setProperty('--hero-alpha',String(easeTide((p-.36)/.56)));
  homeScreen.style.setProperty('--dock-alpha',String(.5+.5*easeTide((p-.48)/.42)));
  for(let i=0;i<arrivalPoints.length;i++){
    const a=arrivalPoints[i],q=Math.max(0,Math.min(1,(p-a.delay)/(.68+a.group*.04))),e=easeTide(q);
    if(q===0)continue;
    const sx=i%2?180+(i%107)*5:1150+(i%47)*3,sy=i%2?610+(i%31)*2:35+(i%109)*4;
    const cx=a.x-170+Math.sin(i*.41)*90,cy=a.y-130+Math.cos(i*.23)*120;
    const x=(1-e)*(1-e)*sx+2*(1-e)*e*cx+e*e*a.x;
    const y=(1-e)*(1-e)*sy+2*(1-e)*e*cy+e*e*a.y;
    const alpha=Math.min(1,q*5)*(1-easeTide((p-.73)/.27));
    g.globalAlpha=alpha*(.4+(i%5)*.11);g.fillStyle=q>.8?a.color:(i%3?'#9ae5e4':'#79b8e8');
    const size=1.2+(1-e)*1.2;g.fillRect(x,y,size,size);
    if(q<.6&&i%6===0){g.strokeStyle='#95dce1';g.lineWidth=.7;g.beginPath();g.moveTo(x,y);g.lineTo(x+(a.x-x)*.035,y+(a.y-y)*.035);g.stroke();}
  }
  g.globalAlpha=1;
  if(p===1)finishHomeArrival();
}
/* 开始：光粒子回流到按钮，潮光铺满后揭开航线。一次锁、一次切页、一次清理。 */
function playLaunchTransition(event){
  if(_transitionBusy)return;
  if(reducedMotion.matches){runAction('start');restorePageFocus();return;}
  transitionLock(true);homeScreen.classList.add('home-launching');
  const layer=document.getElementById('launchLayer'),c=document.getElementById('launchCanvas'),g=c.getContext('2d');
  const b=stageBox(document.getElementById('btnStart')),target={x:b.x+b.w/2,y:b.y+b.h/2};
  const started=performance.now();let switched=false,ended=false,raf=0;
  layer.classList.add('play');
  const switchPage=()=>{if(!switched){switched=true;runAction('start');}};
  const finish=()=>{if(ended)return;ended=true;cancelAnimationFrame(raf);clearTimeout(fallback);switchPage();
    layer.classList.remove('play');g.clearRect(0,0,W,H);homeScreen.classList.remove('home-launching');
    homeScreen.style.setProperty('--hero-alpha','1');transitionLock(false);restorePageFocus();};
  const fallback=setTimeout(finish,1550);
  function paint(now){
    if(ended)return;const p=Math.min(1,(now-started)/1080);g.clearRect(0,0,W,H);
    homeScreen.style.setProperty('--hero-alpha',String(1-easeTide(p/.48)));
    if(p<.68){
      const e=easeTide(p/.6);
      arrivalPoints.forEach((a,i)=>{
        const x=a.x+(target.x-a.x)*e,y=a.y+(target.y-a.y)*e+Math.sin(e*Math.PI)*(a.x-target.x)*.2;
        g.globalAlpha=(1-p/.8)*(.3+(i%4)*.15);g.fillStyle=i%3?'#b9f3e6':'#71c6f0';
        g.fillRect(x,y,1.5+(1-e)*.5,1.5+(1-e)*.5);
      });
    }
    const cover=easeTide((p-.23)/.36),reveal=1-easeTide((p-.66)/.34);
    if(cover>0){
      g.globalAlpha=reveal;
      const radius=cover*1550,gr=g.createRadialGradient(target.x,target.y,0,target.x,target.y,Math.max(1,radius));
      gr.addColorStop(0,'#c3f4e9');gr.addColorStop(.22,'#7abec9');gr.addColorStop(.6,'#174b68');gr.addColorStop(.88,'#091f35');gr.addColorStop(1,'#091f3500');
      g.fillStyle=gr;g.fillRect(0,0,W,H);
      if(p>.55){g.globalAlpha=reveal*Math.min(1,(p-.55)/.05);g.fillStyle='#0a2337';g.fillRect(0,0,W,H);}
      for(let i=0;i<4;i++){
        g.globalAlpha=reveal*.25;g.strokeStyle=i%2?'#9ee7dd':'#8dc1ed';g.lineWidth=1;
        g.beginPath();g.ellipse(target.x,target.y,radius*(.3+i*.11),radius*(.09+i*.035),-.3,0,Math.PI*2);g.stroke();
      }
    }
    g.globalAlpha=1;if(p>=.62)switchPage();if(p===1)finish();else raf=requestAnimationFrame(paint);
  }
  raf=requestAnimationFrame(paint);
}
/* CPU 缓存统一敌人的色温，保留五种技能色和原行走帧；避免逐帧滤镜。 */
const seaEnemyCache=new Map();
function harmonizedEnemyOf(skin,frame){
  const key=skin+':'+frame;if(seaEnemyCache.has(key))return seaEnemyCache.get(key);
  const img=wokouWalk[skin]&&wokouWalk[skin][frame];if(!img||!img.complete||!img.naturalWidth)return null;
  const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
  const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(restoredEnemyOf(skin,frame)||img,0,0);
  const pixels=g.getImageData(0,0,c.width,c.height),d=pixels.data;
  for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;const l=d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722;
    d[i]=(d[i]*.81+l*.19)*.95+3;d[i+1]=(d[i+1]*.81+l*.19)*.98+4;d[i+2]=(d[i+2]*.81+l*.19)*1.02+5;
  }
  g.putImageData(pixels,0,0);seaEnemyCache.set(key,c);return c;
}
function drawEnemyGround(e){
  const w=e.r*3.1,img=wokouWalk[e.skin]&&wokouWalk[e.skin][0];if(!img||!img.naturalWidth)return;
  const h=w*img.naturalHeight/img.naturalWidth,fade=e.stealthT>0?.45:1;
  ctx.save();ctx.translate(e.x,e.y+h*.105);ctx.scale(1,.24);
  const shadow=ctx.createRadialGradient(0,0,1,0,0,w*.43);
  shadow.addColorStop(0,`rgba(18,51,58,${.24*fade})`);shadow.addColorStop(1,'rgba(18,51,58,0)');
  ctx.fillStyle=shadow;ctx.beginPath();ctx.arc(0,0,w*.43,0,Math.PI*2);ctx.fill();ctx.restore();
}
// 保留初始页面供本地离线下载，避免 file:// 无法 fetch 自身时打包失败。
/* 首页御剑：用运行时裁切显示原立绘中的剑，原图片和战斗主角均不改写。 */
const homeSword=document.getElementById('homeSword');
const homeSwordContext=homeSword.getContext('2d');
const swordAura=document.getElementById('swordAura');
const swordAuraContext=swordAura.getContext('2d');
const swordShape=[[640,12],[855,12],[868,300],[837,334],[950,853],[938,837],[805,331],[721,344],[711,271],[724,196],[640,114]];
const swordMotion={x:0,y:0,rotation:0,targetX:0,targetY:0,targetRotation:0,lastInput:-Infinity,lastPaint:0,ready:false};
function prepareHomeSword(){
  if(!homeHero.complete||!homeHero.naturalWidth)return;
  const width=homeHero.naturalWidth,height=homeHero.naturalHeight;
  const fit=Math.min(310/width,520/height),iw=width*fit,ih=height*fit,ox=(310-iw)/2,oy=(520-ih)/2;
  // SVG objectBoundingBox coordinates mirror drawImage's contain alignment.
  const polygon=swordShape.map(([x,y])=>[Math.max(0,Math.min(1,(ox+x/971*iw)/310)),Math.max(0,Math.min(1,(oy+y/1619*ih)/520))]);
  const hole=polygon.map(([x,y],i)=>(i?'L':'M')+x.toFixed(6)+' '+y.toFixed(6)).join(' ')+'Z';
  document.getElementById('homeBodyClipPath').setAttribute('d','M0 0H1V1H0Z '+hole);
  const g=homeSwordContext;g.clearRect(0,0,310,520);g.save();g.beginPath();
  polygon.forEach(([x,y],i)=>{if(i)g.lineTo(x*310,y*520);else g.moveTo(x*310,y*520);});g.closePath();g.clip();
  g.drawImage(homeHero,ox,oy,iw,ih);g.restore();
  swordMotion.ready=true;homeScreen.classList.add('sword-layer-ready');
}
homeHero.addEventListener('load',prepareHomeSword);
homeHero.addEventListener('error',()=>{homeScreen.classList.remove('sword-layer-ready');swordMotion.ready=false;});
if(homeHero.complete&&homeHero.naturalWidth)prepareHomeSword();
function resetSwordTarget(){swordMotion.targetX=0;swordMotion.targetY=0;swordMotion.targetRotation=0;swordMotion.lastInput=-Infinity;}
function resetHomeSword(){resetSwordTarget();swordMotion.x=swordMotion.y=swordMotion.rotation=swordMotion.lastPaint=0;homeSword.style.transform='';}
function aimHomeSword(event){
  if(reducedMotion.matches||_transitionBusy||!homeScreen.classList.contains('active'))return;
  const r=stage.getBoundingClientRect(),x=(event.clientX-r.left)*W/r.width,y=(event.clientY-r.top)*H/r.height;
  // Bounded orbit leaves the title and controls clear at every window size.
  swordMotion.targetX=Math.max(-43,Math.min(58,(x-760)*.17));
  swordMotion.targetY=Math.max(-24,Math.min(52,(y-230)*.16));
  swordMotion.targetRotation=Math.max(-12,Math.min(12,(x-760)*.027+(y-230)*.008));
  swordMotion.lastInput=performance.now();
}
homeScreen.addEventListener('pointermove',aimHomeSword);
homeScreen.addEventListener('pointerleave',resetSwordTarget);
homeScreen.addEventListener('pointercancel',resetSwordTarget);
addEventListener('blur',resetSwordTarget);
reducedMotion.addEventListener('change',()=>{
  resetSwordTarget();if(reducedMotion.matches){swordMotion.x=swordMotion.y=swordMotion.rotation=0;homeSword.style.transform='';
    homeScreen.style.setProperty('--idle-roll','0deg');homeScreen.style.setProperty('--idle-scale-x','1');homeScreen.style.setProperty('--idle-scale-y','1');swordAuraContext.clearRect(0,0,W,H);}
});
function drawHomeSword(now){
  if(!swordMotion.ready||!homeScreen.classList.contains('active')||document.hidden)return;
  const g=swordAuraContext;g.clearRect(0,0,W,H);
  if(reducedMotion.matches||_transitionBusy||!arrivalDone)return;
  const dt=Math.min(.05,Math.max(0,(now-(swordMotion.lastPaint||now))/1000));swordMotion.lastPaint=now;
  const t=now*.001,idle=now-swordMotion.lastInput>2200;
  // Breathing, slight shoulder roll and a small sword flourish, rather than a rigid bob.
  const breath=Math.sin(t*1.6),flourish=idle?Math.pow(Math.max(0,Math.sin(t*.62)),5):0;
  homeScreen.style.setProperty('--idle-roll',(breath*.24)+'deg');
  homeScreen.style.setProperty('--idle-scale-x',String(1-breath*.0015));
  homeScreen.style.setProperty('--idle-scale-y',String(1+breath*.004));
  const tx=swordMotion.targetX+Math.sin(t*1.25)*3+flourish*9;
  const ty=swordMotion.targetY+Math.sin(t*1.65)*4-flourish*8;
  const tr=swordMotion.targetRotation+Math.sin(t*.9)*1.1+flourish*4;
  const k=1-Math.exp(-dt*6.8);swordMotion.x+=(tx-swordMotion.x)*k;swordMotion.y+=(ty-swordMotion.y)*k;swordMotion.rotation+=(tr-swordMotion.rotation)*k;
  homeSword.style.transform=`translate(${swordMotion.x.toFixed(2)}px,${swordMotion.y.toFixed(2)}px) rotate(${swordMotion.rotation.toFixed(2)}deg)`;
  const r=stageBox(heroFloat),hand={x:r.x+r.w*.755,y:r.y+r.h*.237};
  // Original hilt anchor is close to the transform origin (81%,18%).
  const hilt={x:r.x+r.w*.814+swordMotion.x,y:r.y+r.h*.181+swordMotion.y};
  const active=(idle?.16+flourish*.18:.37),glow=g.createRadialGradient(hand.x,hand.y,0,hand.x,hand.y,10);
  glow.addColorStop(0,`rgba(200,255,244,${active})`);glow.addColorStop(1,'rgba(140,235,240,0)');
  g.fillStyle=glow;g.fillRect(hand.x-10,hand.y-10,20,20);
  g.beginPath();g.moveTo(hand.x,hand.y);g.quadraticCurveTo((hand.x+hilt.x)/2-15,hand.y-30,hilt.x,hilt.y);
  g.strokeStyle=`rgba(139,226,230,${active*.56})`;g.lineWidth=.75;g.stroke();
  for(let i=0;i<4;i++){
    const q=(t*.32+i*.25)%1,x=(1-q)*(1-q)*hand.x+2*(1-q)*q*((hand.x+hilt.x)/2-15)+q*q*hilt.x;
    const y=(1-q)*(1-q)*hand.y+2*(1-q)*q*(hand.y-30)+q*q*hilt.y;
    g.fillStyle=`rgba(191,249,237,${active*Math.sin(q*Math.PI)})`;g.beginPath();g.arc(x,y,i===0?1.3:.8,0,Math.PI*2);g.fill();
  }
}

/* 持久化地图模式。底图缓存独立于角色和战斗渲染；file:// 禁用存储时仍可切换。 */
const NIGHT_MAP_STORAGE_KEY='egret_dark_map_v1';
let darkMapMode=false;
const nightSceneCache=new WeakMap();
try{darkMapMode=localStorage.getItem(NIGHT_MAP_STORAGE_KEY)==='1';}catch(_nightStorageError){}

function makeNightScene(source){
  const c=document.createElement('canvas');c.width=source.width;c.height=source.height;
  const g=c.getContext('2d');g.drawImage(source,0,0);
  try{
    const frame=g.getImageData(0,0,c.width,c.height),d=frame.data;
    // 压缩纸白到有层次的月蓝，保留原画的明暗结构与少量本色。
    for(let p=0;p<d.length;p+=4){
      const r=d[p],b=d[p+2],green=d[p+1];
      const lum=.2126*r+.7152*green+.0722*b;
      const tone=Math.pow(lum/255,.88);
      d[p]=14+60*tone+(r-lum)*.22;
      d[p+1]=23+85*tone+(green-lum)*.26;
      d[p+2]=34+103*tone+(b-lum)*.26;
    }
    g.putImageData(frame,0,0);
  }catch(_nightCanvasReadError){
    // 限制像素读取的浏览器中使用一次性混色，仍保留完整原景。
    g.globalCompositeOperation='multiply';g.fillStyle='#496d91';g.fillRect(0,0,c.width,c.height);
    g.globalCompositeOperation='source-over';g.fillStyle='rgba(7,30,51,.31)';g.fillRect(0,0,c.width,c.height);
  }
  const light=g.createRadialGradient(c.width*.53,c.height*.42,0,c.width*.53,c.height*.42,c.width*.68);
  light.addColorStop(0,'rgba(108,175,192,.055)');light.addColorStop(1,'rgba(3,14,30,.14)');
  g.fillStyle=light;g.fillRect(0,0,c.width,c.height);
  return c;
}

function drawSceneBackground(context,source,_levelIndex){
  context.save();context.imageSmoothingEnabled=false;
  if(!darkMapMode){context.drawImage(source,0,0,W,H);context.restore();return;}
  let night=nightSceneCache.get(source);
  if(!night){night=makeNightScene(source);nightSceneCache.set(source,night);}
  context.drawImage(night,0,0,W,H);context.restore();
}

function syncNightControls(){
  document.documentElement.classList.toggle('map-night',darkMapMode);
  document.documentElement.dataset.mapTheme=darkMapMode?'night':'day';
  document.querySelectorAll('.nightMapToggle').forEach(button=>{
    button.setAttribute('aria-pressed',String(darkMapMode));
    button.title=darkMapMode?'关闭深色地图，恢复日间海岸':'开启深色地图，进入月蓝海岸';
  });
}

function setDarkMapMode(next,{persist=true,announce=true}={}){
  darkMapMode=!!next;syncNightControls();
  if(persist){try{localStorage.setItem(NIGHT_MAP_STORAGE_KEY,darkMapMode?'1':'0');}catch(_nightStorageError){}}
  if(announce){const status=document.getElementById('nightModeAnnouncement');
    if(status)status.textContent=darkMapMode?'深色地图已开启':'已恢复日间地图';}
  // 当前关提前构建，后续画面只进行一次 drawImage，不使用每帧滤镜。
  if(darkMapMode){const activeBg=LEVEL_BG_CANVAS[currentLevel-1];
    if(activeBg&&activeBg.ready&&!nightSceneCache.has(activeBg.c))nightSceneCache.set(activeBg.c,makeNightScene(activeBg.c));}
}

function mountNightSwitch(id,parent){
  let button=document.getElementById(id);
  if(!button){button=document.createElement('button');button.id=id;parent.appendChild(button);}
  button.type='button';button.className='nightMapToggle';button.setAttribute('aria-label','深色地图');
  button.innerHTML='<span>深色地图</span><span class="nightSwitchTrack" aria-hidden="true"></span>';
  button.onclick=event=>{event.stopPropagation();setDarkMapMode(!darkMapMode);};
  button.onkeydown=event=>{
    if(event.key===' '||event.key==='Enter')event.stopPropagation();
  };
  return button;
}

function mountNightControls(){
  const homeLocation=document.querySelector('.homeLocation'),hud=document.getElementById('hud');
  if(homeLocation)mountNightSwitch('btnNightHome',homeLocation);
  if(hud)mountNightSwitch('btnNightHud',hud);
  const audio=document.getElementById('audioRow');
  if(audio){
    let row=document.getElementById('nightPauseRow');
    if(!row){row=document.createElement('div');row.id='nightPauseRow';audio.insertAdjacentElement('afterend',row);}
    mountNightSwitch('btnNightPause',row);
    if(!row.querySelector('.nightModeHint')){const hint=document.createElement('span');hint.className='nightModeHint';
      hint.textContent='地图与界面同步切换';row.appendChild(hint);}
  }
  if(!document.getElementById('nightModeAnnouncement')){const status=document.createElement('div');
    status.id='nightModeAnnouncement';status.className='nightModeAnnouncement';status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');document.getElementById('wrap').appendChild(status);}
  syncNightControls();
}
mountNightControls();

/* Combat VFX · tidal / prismatic. Only visual state; original combat rules remain separate. */
const COMBAT_VFX_PARTICLE_LIMIT = 180;
const COMBAT_VFX_ATTACK_OPACITY = 0.82;
const combatVfxMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let combatVfxAttacks = [], combatVfxParticles = [], combatVfxBursts = [], combatVfxRings = [];
let combatVfxDash = null;
const combatVfxSprites = new Map();

// Only a narrow border is tinted; the center and HUD remain clear.
function drawLowHealthEdge(){
  if(state!=='play'||player.hp<=0||player.hp/player.hpMax>=.3)return;
  const danger=1-player.hp/player.hpMax/.3;
  const pulse=combatVfxMotion.matches?1:.88+.12*Math.sin(performance.now()*.004);
  ctx.save();
  const edge=44,alpha=(.14+danger*.16)*pulse;
  for(const [x0,y0,x1,y1,x,y,w,h] of [[0,0,edge,0,0,0,edge,H],[W,0,W-edge,0,W-edge,0,edge,H],[0,0,0,edge,0,0,W,edge],[0,H,0,H-edge,0,H-edge,W,edge]]){
    const gr=ctx.createLinearGradient(x0,y0,x1,y1);gr.addColorStop(0,'rgba(155,24,29,'+alpha+')');gr.addColorStop(1,'rgba(155,24,29,0)');
    ctx.fillStyle=gr;ctx.fillRect(x,y,w,h);
  }
  ctx.restore();
}
function combatVfxClamp(n, a=0, b=1){ return Math.max(a, Math.min(b, n)); }
function combatVfxEase(n){ n=combatVfxClamp(n); return 1-Math.pow(1-n,3); }
function combatVfxEnvelope(age, enter, exit, life){
  return combatVfxClamp(age / enter) * combatVfxClamp((life-age) / exit);
}
/* C1 continuous appearance and dissolve: no abrupt alpha ramp at phase boundaries. */
function combatVfxAttackEnvelope(age, enter, exit, life){
  const smooth=p=>{p=combatVfxClamp(p);return p*p*(3-2*p);};
  return smooth(age/enter) * smooth((life-age)/exit);
}
/* Composite the entire attack group once: overlapping crests must also stay at 50% opacity. */
const combatVfxAttackLayer=document.createElement('canvas');
combatVfxAttackLayer.width=W;combatVfxAttackLayer.height=H;
const combatVfxAttackContext=combatVfxAttackLayer.getContext('2d');
function clearCombatVfx(){
  combatVfxAttacks.length=0; combatVfxParticles.length=0;
  combatVfxBursts.length=0; combatVfxRings.length=0; combatVfxDash=null;
}
combatVfxMotion.addEventListener('change', clearCombatVfx);

/* Store the existing dash endpoints before the instant gameplay displacement. */
function prepareDashVfx(ox, oy, nx, ny, angle){ combatVfxDash={ox,oy,nx,ny,angle}; }
function beginAttackVfx(kind, angle, dir){
  kind = kind === 'R' ? 'R' : 'L';
  if(kind==='R'){
    // The legacy right-click dispatch also fires an L attack in the same event.
    // Hide only that fresh visual; neither of its original damage calls is changed.
    combatVfxAttacks = combatVfxAttacks.filter(f => !(f.kind==='L' && f.age<0.04));
  }
  const dash=kind==='R' ? combatVfxDash : null;
  combatVfxAttacks.push({kind,angle,dir:dir||1,x:player.x,y:player.y,age:0,
    range:player.atkRange,life:window.EgretInkAttack?.life(kind,combatVfxMotion.matches) || (kind==='R' ? ATK_R_DUR+SWORD_BACK_DUR : ATK_L_DUR+0.08),
    dash:dash ? {...dash} : null});
  combatVfxDash=null;
  if(combatVfxAttacks.length>6) combatVfxAttacks.shift();
}
function combatVfxParticle(p){
  const cap=combatVfxMotion.matches ? 60 : COMBAT_VFX_PARTICLE_LIMIT;
  if(combatVfxParticles.length>=cap) combatVfxParticles.shift();
  p.px=p.x; p.py=p.y; p.age=0; combatVfxParticles.push(p);
}

/* White core, pink/violet split silhouette and fine amber fragments, as in the hit reference. */
function emitImpactVfx(e, angle, isCrit){
  if(!e || e.dead) return;
  const reduced=combatVfxMotion.matches;
  const x=e.x-Math.cos(angle)*8, y=e.y-Math.max(17,e.r*0.8);
  combatVfxBursts.push({x,y,angle:angle-Math.PI/5,age:0,life:reduced?0.22:0.28,
    size:(isCrit?65:49)*(reduced?0.75:1),kill:false});
  if(combatVfxBursts.length>20) combatVfxBursts.shift();
  const n=reduced ? 4 : (isCrit ? 20 : 15);
  const cols=['#fff8ea','#243b40','#c6d0c4','#617976','#b74336'];
  for(let i=0;i<n;i++){
    const a=angle+(Math.random()-0.5)*Math.PI*1.65;
    const speed=(155+Math.random()*245)*(reduced?0.28:1)*(isCrit?1.16:1);
    combatVfxParticle({x,y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,
      life:0.38+Math.random()*0.27,r:0.8+Math.random()*1.6,
      color:cols[i%cols.length],type:i%3===0?'feather':i%3===1?'ink':'spark',angle:a,spin:(Math.random()-.5)*8,drag:1.35});
  }
}

/* A real dead enemy is the only source. Boss decoration calls have no dead flag and are ignored. */
function emitKillVfx(e){
  if(!e || !e.dead || e._deathVfxEmitted) return;
  e._deathVfxEmitted=true;
  const reduced=combatVfxMotion.matches, x=e.x, y=e.y-Math.max(15,e.r*0.55);
  combatVfxBursts.push({x,y,angle:-Math.PI/5,age:0,life:reduced?0.24:0.36,
    size:(e.isBoss?94:71)*(reduced?0.7:1),kill:true});
  if(combatVfxBursts.length>20) combatVfxBursts.shift();
  if(!reduced){
    combatVfxRings.push({x,y,age:0,life:e.isBoss?0.65:0.48,r:e.isBoss?122:90});
    if(combatVfxRings.length>12) combatVfxRings.shift();
  }
  const count=reduced?10:(e.isBoss?50:36);
  const cols=['#fff9ec','#1f343b','#cfdbcf','#6b807b','#b44539'];
  for(let i=0;i<count;i++){
    const a=i/count*Math.PI*2+(Math.random()-.5)*0.25;
    const s=(220+Math.random()*270)*(reduced?0.26:1)*(e.isBoss?1.15:1);
    combatVfxParticle({x:x+(Math.random()-.5)*12,y:y+(Math.random()-.5)*12,
      vx:Math.cos(a)*s,vy:Math.sin(a)*s*0.84,
      life:0.66+Math.random()*0.3,r:1.1+Math.random()*2.9,
      color:cols[i%cols.length],type:i%3===0?'feather':i%3===1?'ink':'spark',angle:a,spin:(Math.random()-.5)*10,drag:1.25});
  }
}

/* dt comes from update() AFTER its slow-motion conversion, so the effects follow the original frames. */
function tickCombatVfx(dt){
  if(!Number.isFinite(dt) || dt<=0) return;
  for(const f of combatVfxAttacks) f.age+=dt;
  combatVfxAttacks=combatVfxAttacks.filter(f=>f.age<f.life);
  for(const p of combatVfxParticles){
    p.age+=dt; p.px=p.x; p.py=p.y;
    const drag=Math.exp(-p.drag*dt);
    p.vx*=drag; p.vy*=drag; p.x+=p.vx*dt; p.y+=p.vy*dt; p.angle+=p.spin*dt;
  }
  combatVfxParticles=combatVfxParticles.filter(p=>p.age<p.life);
  for(const f of combatVfxBursts) f.age+=dt;
  combatVfxBursts=combatVfxBursts.filter(f=>f.age<f.life);
  for(const f of combatVfxRings) f.age+=dt;
  combatVfxRings=combatVfxRings.filter(f=>f.age<f.life);
}

/* A tapered, broken crest. Closed silhouettes, rather than stroked rings, give water a clear mass. */
function combatVfxRibbon(g,r,a0,a1,width,color,jagged){
  const n=38, points=[];
  for(let i=0;i<=n;i++){
    const t=i/n,a=a0+(a1-a0)*t;
    const w=width*Math.pow(Math.sin(Math.PI*t),0.68);
    const ridge=jagged ? (Math.sin(i*2.8)*0.028+Math.sin(i*1.35)*0.018)*r*Math.sin(Math.PI*t) : 0;
    const rr=r+w*0.11+ridge;
    points.push([Math.cos(a)*rr,Math.sin(a)*rr*0.84]);
  }
  for(let i=n;i>=0;i--){
    const t=i/n,a=a0+(a1-a0)*t;
    const tooth=jagged ? ((i%4===0?0.12:0)+(i%7===0?0.09:0))*r*Math.sin(Math.PI*t) : 0;
    const rr=r-width*Math.pow(Math.sin(Math.PI*t),0.68)+tooth;
    points.push([Math.cos(a)*rr,Math.sin(a)*rr*0.84]);
  }
  g.fillStyle=color; g.beginPath(); g.moveTo(points[0][0],points[0][1]);
  for(let i=1;i<points.length;i++) g.lineTo(points[i][0],points[i][1]);
  g.closePath(); g.fill();
}
function combatVfxBlade(g,x0,y0,x1,y1,width,alpha){
  const dx=x1-x0,dy=y1-y0,len=Math.hypot(dx,dy)||1;
  const nx=-dy/len,ny=dx/len;
  const gradient=g.createLinearGradient(x0,y0,x1,y1);
  gradient.addColorStop(0,'rgba(20,90,115,0)');
  gradient.addColorStop(0.35,'#2f8fb0');gradient.addColorStop(0.73,'#b9f1fb');gradient.addColorStop(1,'#f6feff');
  g.globalAlpha=alpha;g.fillStyle=gradient;
  g.beginPath();g.moveTo(x0,y0);
  g.bezierCurveTo(x0+dx*.4+nx*width*.44,y0+dy*.4+ny*width*.44,
    x1-dx*.18+nx*width,y1-dy*.18+ny*width,x1,y1);
  g.bezierCurveTo(x1-dx*.2-nx*width*.2,y1-dy*.2-ny*width*.2,
    x0+dx*.25-nx*width*.12,y0+dy*.25-ny*width*.12,x0,y0);
  g.closePath();g.fill();
  // Flared, cut-out foil at the leading end, matching the broad white triangular tips.
  const ux=dx/len,uy=dy/len,tip=width*2.35;
  g.beginPath();g.moveTo(x1,y1);
  g.lineTo(x1-ux*tip*1.65+nx*tip,y1-uy*tip*1.65+ny*tip);
  g.lineTo(x1-ux*tip*1.02+nx*tip*.24,y1-uy*tip*1.02+ny*tip*.24);
  g.lineTo(x1-ux*tip*1.78-nx*tip*.1,y1-uy*tip*1.78-ny*tip*.1);
  g.closePath();g.fill();
  g.strokeStyle='#f5f0e4';g.lineWidth=1.4;g.beginPath();
  g.moveTo(x1-ux*tip*1.65+nx*tip,y1-uy*tip*1.65+ny*tip);g.lineTo(x1,y1);g.stroke();
  g.globalAlpha=alpha*.95;g.strokeStyle='#f5f0e4';g.lineWidth=1.2;
  g.beginPath();g.moveTo(x0+dx*.3,y0+dy*.3);
  g.quadraticCurveTo(x0+dx*.7+nx*width*.2,y0+dy*.7+ny*width*.2,x1,y1);g.stroke();
}

function drawAttackVfx(){
  if(!combatVfxAttacks.length)return;
  const g=combatVfxAttackContext;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,W,H);
  const vfxCam=BailuWorld.active()&&state!=='menu'&&state!=='select'?(window.__drawCam||BailuWorld.cam):{x:0,y:0};g.setTransform(1,0,0,1,-vfxCam.x,-vfxCam.y);
  const reduced=combatVfxMotion.matches;
  if(window.EgretInkAttack?.ready()){
    for(const f of combatVfxAttacks)if(!(f.kind==='L'&&BailuSprites.ready()))window.EgretInkAttack.draw(g,f,reduced);   // L arc = sword trail
    ctx.save();ctx.globalAlpha*=COMBAT_VFX_ATTACK_OPACITY;
    ctx.drawImage(combatVfxAttackLayer,vfxCam.x,vfxCam.y);ctx.restore();return;
  }
  // Texture loading failures retain the existing vector attack effect.
  g.save();
  for(const f of combatVfxAttacks){
    if(f.kind==='L'&&BailuSprites.ready())continue;   // replaced by the ice-cyan sword trail (BailuSprites)
    if(f.kind==='L'){
      const p=combatVfxClamp(f.age/ATK_L_DUR), ease=combatVfxEase(p);
      const alpha=combatVfxAttackEnvelope(f.age,0.045,0.24,f.life)*(reduced?0.62:0.95);
      const r=Math.min(290,f.range)*(reduced?0.86:0.7+ease*.3);
      g.save();g.translate(player.x,player.y-15);g.rotate(f.angle);g.scale(1,f.dir);
      g.globalAlpha=alpha;
      const water=g.createLinearGradient(-r,-r,r,r);
      water.addColorStop(0,'#1d3036');water.addColorStop(.48,'#647777');water.addColorStop(1,'#d2dcd5');
      const a0=-2.45+(reduced?0.3:ease*.3),a1=1.05+(reduced?0.2:ease*.42);
      combatVfxRibbon(g,r,a0,a1,r*.46,water,true);
      combatVfxRibbon(g,r*.98,a0+.42,a1-.12,r*.28,'#fff9eb',true);
      // Separated ribbons and pointed foam retain the reference's broken curling edge.
      g.globalAlpha=alpha*.82;
      combatVfxRibbon(g,r*1.065,a0+.75,a1-.07,r*.035,'#e0e8df',false);
      for(let i=0;i<5;i++){
        const a=a0+.4+i*.58,rr=r*(1.06+(i%2)*.08),s=(3+i%3)*Math.sin(Math.PI*p);
        const x=Math.cos(a)*rr,y=Math.sin(a)*rr*.84;
        EgretCombatFeedback.feather(g,x,y,1.8+s*.45,a+.65,'#fff9eb');
        g.fillStyle=i%2?'#fffaf0':'#b4c2be';g.beginPath();
        g.moveTo(x,y);g.lineTo(x+s*2,y-s);g.lineTo(x+s*.3,y+s*.65);g.closePath();g.fill();
      }
      g.restore();
    }else{
      const attackP=combatVfxClamp(f.age/ATK_R_DUR);
      g.save();g.translate(f.x,f.y-19);g.rotate(f.angle);
      const distance=f.dash?Math.hypot(f.dash.nx-f.dash.ox,f.dash.ny-f.dash.oy):120;
      const rear=-Math.min(300,distance+55),front=Math.min(220,f.range*1.05);
      for(let i=0;i<3;i++){
        const age=f.age-i*.034;
        if(age<0 || age>0.32)continue;
        const p=combatVfxClamp(age/.21),alpha=combatVfxAttackEnvelope(age,.035,.17,.32)*(reduced?.42:.84);
        const shift=reduced?0:(combatVfxEase(p)-.5)*35;
        const ys=[52,-35,18],ye=[-53,43,-17];
        const end=front+[0,-32,22][i];
        combatVfxBlade(g,rear+shift,ys[i],end+shift,ye[i],i===1?19:13,alpha);
        if(!reduced){
          g.globalAlpha=alpha*.45;g.strokeStyle='#4fb8d2';g.lineWidth=.9;
          g.beginPath();g.moveTo(rear-8,ys[i]+14);g.quadraticCurveTo(-20,ye[i]+37,front+40,ye[i]-10);g.stroke();
        }
      }
      // The broad final cut rises out of the last crossing streak, then dissolves during sword return.
      const endAge=f.age-.145, endLife=ATK_R_DUR+SWORD_BACK_DUR-.145;
      if(endAge>0){
        const p=combatVfxClamp(endAge/.25),ease=reduced?.75:combatVfxEase(p);
        const alpha=combatVfxAttackEnvelope(endAge,.12,.32,endLife)*(reduced?.58:.9);
        const r=Math.min(335,f.range*1.18)*(.7+ease*.3);
        g.globalAlpha=alpha;g.translate(15,0);g.scale(1,-f.dir);
        const color=g.createLinearGradient(-r*.7,-r,r,r*.6);
        color.addColorStop(0,'#e6fbff');color.addColorStop(.26,'#ffffff');
        color.addColorStop(.52,'#86dcef');color.addColorStop(.77,'#2b93b5');color.addColorStop(1,'#0e4a63');
        combatVfxRibbon(g,r,-2.6+ease*.2,.95+ease*.4,r*.4,color,false);
        combatVfxRibbon(g,r*1.025,-2.38+ease*.2,.72+ease*.4,r*.044,'#f4feff',true);
        combatVfxRibbon(g,r*.88,-2.3+ease*.18,.94+ease*.4,r*.03,'#a6ecf8',false);
        if(!reduced){
          g.globalAlpha=alpha*.6;
          combatVfxRibbon(g,r*1.12,-1.9,1.35,r*.013,'#c6f5ff',false);
          combatVfxRibbon(g,r*1.16,-2.1,-.15,r*.018,'#74877d',false);
        }
      }
      g.restore();
    }
  }
  g.restore();
  ctx.save();ctx.globalAlpha*=COMBAT_VFX_ATTACK_OPACITY;
  ctx.drawImage(combatVfxAttackLayer,vfxCam.x,vfxCam.y);ctx.restore();
}

function combatVfxStarPath(g,r,points,phase){
  g.beginPath();
  for(let i=0;i<points*2;i++){
    const a=i/(points*2)*Math.PI*2+phase;
    const rr=i%2 ? r*.19 : r*(i%6===0?1.25:(i%4===0?.84:.64));
    const x=Math.cos(a)*rr,y=Math.sin(a)*rr*.74;
    if(i===0)g.moveTo(x,y);else g.lineTo(x,y);
  }
  g.closePath();
}
function combatVfxBurstSprite(kill){
  const key=kill?'kill':'hit';if(combatVfxSprites.has(key))return combatVfxSprites.get(key);
  const c=document.createElement('canvas');c.width=192;c.height=192;
  const g=c.getContext('2d');g.translate(96,96);g.rotate(-.12);
  g.fillStyle=kill?'#253b40':'#263d41';combatVfxStarPath(g,66,9,0);g.fill();
  g.fillStyle='#82918a';combatVfxStarPath(g,49,8,.13);g.fill();
  g.fillStyle='#fff8ec';combatVfxStarPath(g,36,7,-.08);g.fill();
  g.fillStyle='#ffffff';combatVfxStarPath(g,17,5,.2);g.fill();
  combatVfxSprites.set(key,c);return c;
}
function drawImpactParticles(){
  const reduced=combatVfxMotion.matches;
  ctx.save();
  for(const f of combatVfxRings){
    const p=f.age/f.life,r=8+f.r*combatVfxEase(p);
    ctx.globalAlpha=Math.pow(1-p,2)*.52;ctx.strokeStyle='#87988c';ctx.lineWidth=2.5*(1-p)+.5;
    ctx.beginPath();ctx.ellipse(f.x,f.y,r,r*.62,0,0,Math.PI*2);ctx.stroke();
  }
  for(const p of combatVfxParticles){
    const life=1-p.age/p.life;
    ctx.globalAlpha=Math.pow(life,1.15);ctx.fillStyle=p.color;ctx.strokeStyle=p.color;
    if(p.type==='spark'){
      const v=Math.hypot(p.vx,p.vy)||1,tail=Math.min(21,3+v*.032)*(reduced?.4:1);
      ctx.lineWidth=p.r*life+.5;ctx.beginPath();
      ctx.moveTo(p.x-p.vx/v*tail,p.y-p.vy/v*tail);ctx.lineTo(p.x,p.y);ctx.stroke();
      ctx.fillStyle='#fffaf0';ctx.fillRect(p.x-0.7,p.y-0.7,1.4,1.4);
    }else if(p.type==='feather'){
      EgretCombatFeedback.feather(ctx,p.x,p.y,p.r*(.4+life*.6),p.angle,p.color);
    }else{
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle);
      const r=p.r*(.4+life*.6);ctx.beginPath();ctx.moveTo(-r*2.8,0);
      ctx.lineTo(0,-r*.65);ctx.lineTo(r*1.4,0);ctx.lineTo(0,r*.65);ctx.closePath();ctx.fill();ctx.restore();
    }
  }
  for(const f of combatVfxBursts){
    const p=f.age/f.life,scale=.76+combatVfxEase(p)*.35;
    const alpha=combatVfxEnvelope(f.age,.016,f.life*.77,f.life)*(reduced?.52:.97);
    ctx.save();ctx.translate(f.x,f.y);ctx.rotate(f.angle);ctx.globalAlpha=alpha;
    const s=f.size*scale;ctx.drawImage(combatVfxBurstSprite(f.kill),-s,-s,s*2,s*2);ctx.restore();
  }
  ctx.restore();
}


const HERO_ACTION_GAP_GUIDES={"birdRun":{"0":{"polygon":[[247,133],[258,133],[258,134],[260,134],[260,135],[261,135],[261,136],[263,137],[263,139],[265,140],[265,146],[264,146],[264,147],[262,147],[262,148],[259,148],[259,149],[257,149],[257,150],[256,150],[256,149],[254,149],[244,149],[244,148],[238,148],[238,147],[236,146],[236,144],[235,144],[235,140],[236,140],[236,138],[237,138],[237,137],[238,137],[238,136],[239,136],[240,134],[242,134],[242,133]],"seed":[250,140],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"1":{"polygon":[[266,141],[266,142],[267,142],[267,144],[265,144],[265,145],[263,145],[263,146],[260,146],[260,147],[258,147],[258,148],[257,148],[257,147],[241,147],[241,146],[239,146],[239,145],[237,145],[237,144],[235,144],[235,143],[234,143],[234,139],[237,133],[240,133],[240,132],[245,132],[245,131],[252,131],[252,132],[257,132],[257,133],[259,133],[259,134],[263,135],[263,136],[265,137]],"seed":[250,138],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"2":{"polygon":[[250,134],[251,134],[251,135],[256,135],[256,136],[260,137],[260,138],[261,138],[261,139],[262,139],[262,140],[263,140],[263,141],[265,142],[265,146],[264,146],[264,148],[263,148],[263,149],[262,149],[261,151],[259,151],[259,152],[249,152],[241,152],[241,151],[239,151],[239,150],[235,149],[234,147],[235,147],[235,143],[236,143],[236,140],[240,139],[241,137],[243,137],[243,136],[245,136],[245,135],[248,135],[248,134]],"seed":[251,142],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"3":{"polygon":[[240,139],[241,139],[241,138],[246,138],[247,136],[251,136],[251,135],[261,135],[261,136],[265,137],[265,138],[267,139],[267,141],[268,141],[268,149],[267,149],[266,151],[265,151],[265,152],[263,152],[263,153],[243,153],[243,152],[241,152],[241,151],[239,151],[239,150],[237,150],[237,149],[236,149],[236,147],[237,147],[237,143],[238,143],[238,141],[239,141]],"seed":[253,143],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"4":{"polygon":[[226,80],[226,77],[228,77],[228,76],[229,76],[229,75],[230,75],[231,73],[233,73],[233,72],[236,72],[236,71],[247,71],[248,73],[251,73],[251,74],[252,74],[252,75],[253,75],[253,76],[254,76],[254,77],[256,78],[256,82],[255,86],[253,86],[252,88],[240,88],[240,87],[236,87],[236,88],[227,88],[227,87],[225,87],[225,86],[224,86],[224,85],[225,85],[225,81],[226,81]],"seed":[242,80],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"5":{"polygon":[[227,85],[227,81],[226,81],[226,79],[227,79],[227,77],[228,77],[229,75],[232,75],[232,74],[234,74],[234,73],[237,73],[237,72],[238,72],[238,73],[247,73],[247,74],[248,74],[247,78],[246,78],[246,79],[245,79],[245,80],[244,80],[244,81],[243,81],[243,82],[242,82],[242,83],[241,83],[241,84],[240,84],[240,85],[239,85],[238,87],[233,87],[233,88],[230,88],[230,87],[228,87]],"seed":[236,80],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"6":{"polygon":[[236,87],[237,87],[237,84],[238,84],[238,83],[239,83],[240,81],[242,81],[242,80],[244,80],[244,79],[247,79],[248,77],[260,77],[260,78],[262,78],[262,79],[264,79],[264,80],[267,80],[267,81],[269,81],[269,82],[271,83],[271,89],[271,92],[270,92],[270,94],[269,94],[269,95],[266,95],[266,96],[264,96],[264,97],[262,97],[262,98],[261,98],[261,97],[244,97],[244,96],[242,96],[242,95],[240,95],[240,94],[238,94],[238,93],[236,93],[236,92],[235,92],[235,91],[236,91]],"seed":[254,85],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"7":{"polygon":[[256,97],[243,97],[243,96],[241,96],[241,95],[239,95],[239,94],[237,94],[237,93],[235,93],[235,92],[234,92],[234,90],[235,90],[235,85],[236,85],[236,84],[237,84],[238,82],[240,82],[240,81],[242,81],[242,80],[244,80],[244,79],[248,79],[248,78],[250,78],[259,78],[259,79],[261,79],[261,80],[263,80],[263,81],[266,81],[266,82],[268,82],[268,83],[270,84],[270,86],[271,86],[271,89],[272,89],[272,91],[271,91],[271,93],[270,93],[270,94],[268,94],[268,95],[266,95],[266,96],[263,96],[263,97]],"seed":[252,85],"note":"Conservative white-hole core; one source pixel inset from color boundary."}},"heroAtkL":{"0":{"polygon":[[275,132],[275,133],[272,133],[272,134],[270,134],[270,135],[269,135],[269,134],[254,134],[254,133],[253,133],[253,131],[252,131],[252,130],[251,130],[251,128],[250,128],[250,124],[251,124],[252,118],[253,118],[254,116],[256,116],[256,115],[257,115],[258,115],[258,114],[260,114],[260,113],[261,113],[261,114],[274,114],[274,115],[276,115],[277,117],[279,117],[279,118],[281,119],[281,121],[282,121],[283,125],[282,125],[282,127],[281,127],[280,131],[277,131],[277,132]],"seed":[266,123],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"1":{"polygon":[[243,127],[243,126],[242,126],[242,122],[243,122],[243,118],[244,118],[244,116],[246,116],[246,115],[249,115],[249,114],[252,114],[252,113],[253,113],[253,114],[264,114],[264,115],[266,115],[267,117],[269,117],[269,119],[270,119],[270,121],[271,121],[272,127],[271,127],[270,131],[268,131],[268,132],[265,132],[265,133],[263,133],[263,134],[260,134],[260,135],[249,135],[249,133],[248,133],[248,132],[246,132],[246,131],[244,130],[244,128],[243,128]],"seed":[256,123],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"2":{"polygon":[[247,121],[247,117],[248,117],[248,116],[250,116],[250,115],[252,115],[252,114],[255,114],[255,113],[256,113],[256,114],[268,114],[268,115],[270,115],[271,117],[273,117],[273,119],[275,120],[275,127],[275,129],[274,129],[274,130],[273,130],[273,131],[272,131],[271,133],[267,133],[267,134],[252,134],[252,133],[251,133],[251,132],[249,131],[249,129],[248,129],[248,128],[246,127],[246,121]],"seed":[260,123],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"3":{"polygon":[[267,133],[267,134],[256,134],[256,135],[253,135],[253,134],[251,134],[251,133],[249,132],[249,130],[247,129],[247,125],[245,124],[245,119],[246,119],[246,117],[248,117],[248,116],[251,116],[251,115],[254,115],[254,114],[255,114],[255,115],[266,115],[266,116],[268,116],[268,117],[272,118],[272,120],[273,120],[273,129],[272,129],[272,130],[271,130],[271,131],[270,131],[269,133]],"seed":[258,124],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"4":{"polygon":[[263,91],[264,91],[265,93],[267,93],[267,94],[269,95],[269,97],[270,97],[271,103],[270,103],[269,107],[268,107],[268,108],[266,108],[266,109],[264,109],[264,110],[261,110],[261,111],[259,111],[259,112],[247,112],[246,112],[245,108],[243,107],[243,105],[242,105],[242,104],[240,103],[240,102],[241,102],[241,98],[242,98],[242,95],[243,95],[244,93],[246,93],[246,92],[250,91],[250,90],[262,90],[262,91]],"seed":[255,100],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"5":{"polygon":[[248,88],[254,88],[254,89],[256,89],[256,90],[258,90],[258,91],[260,92],[260,95],[261,95],[261,103],[260,103],[260,105],[258,105],[258,106],[256,106],[256,107],[253,107],[253,108],[251,108],[251,109],[245,109],[236,109],[236,107],[235,107],[235,106],[233,105],[233,103],[232,103],[232,98],[233,98],[233,94],[234,94],[234,92],[235,92],[235,91],[237,91],[237,90],[239,90],[239,89],[241,89],[241,88]],"seed":[247,97],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"6":{"polygon":[[244,91],[245,91],[245,90],[246,90],[246,91],[258,91],[258,92],[260,92],[260,93],[262,94],[262,96],[264,97],[264,104],[262,105],[262,108],[261,108],[261,109],[259,109],[259,110],[257,110],[257,111],[255,111],[254,111],[254,112],[240,112],[240,111],[239,111],[239,110],[238,110],[238,109],[237,109],[237,108],[235,107],[238,95],[239,95],[240,93],[242,93],[242,92]],"seed":[250,100],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"7":{"polygon":[[256,92],[263,92],[263,93],[265,93],[266,95],[268,95],[268,96],[270,97],[270,100],[271,100],[271,105],[270,105],[269,109],[266,109],[266,110],[264,110],[264,111],[261,111],[261,112],[259,112],[259,113],[258,113],[258,112],[255,112],[245,112],[245,111],[244,111],[244,110],[243,110],[243,109],[241,108],[240,102],[241,102],[242,96],[243,96],[244,94],[246,94],[246,93],[248,93],[248,92],[250,92],[250,91],[251,91],[251,92]],"seed":[255,101],"note":"Conservative white-hole core; one source pixel inset from color boundary."}},"heroAtkR":{"1":{"polygon":[[263,125],[262,125],[262,121],[261,121],[261,119],[268,119],[268,120],[270,120],[270,121],[271,121],[271,123],[272,123],[272,126],[273,126],[273,127],[273,131],[272,131],[272,133],[271,133],[271,134],[269,135],[269,134],[267,134],[267,133],[265,133],[265,132],[264,132],[264,129],[263,129]],"seed":[269,126],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"2":{"polygon":[[273,135],[273,136],[272,136],[272,138],[271,138],[271,140],[269,140],[269,141],[266,141],[266,142],[264,142],[264,143],[262,143],[262,144],[252,143],[252,142],[253,142],[253,137],[254,137],[254,135],[254,134],[255,134],[255,130],[256,130],[256,127],[257,127],[257,126],[265,126],[265,125],[266,125],[267,127],[269,127],[270,129],[272,129],[272,131],[273,131],[273,133],[274,133]],"seed":[262,134],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"3":{"polygon":[[244,145],[240,145],[240,146],[228,146],[227,144],[225,144],[225,136],[227,135],[228,131],[229,131],[229,130],[231,130],[231,129],[232,129],[232,128],[234,128],[234,127],[238,127],[247,127],[247,128],[249,128],[249,129],[251,129],[251,130],[255,131],[255,133],[256,133],[256,135],[257,135],[257,139],[256,139],[256,141],[254,141],[254,142],[252,141],[252,142],[251,142],[251,143],[249,143],[248,145]],"seed":[240,136],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"4":{"polygon":[[252,95],[254,95],[254,97],[255,97],[255,98],[257,99],[257,101],[258,101],[258,102],[257,102],[257,104],[256,104],[256,106],[255,106],[255,108],[252,108],[252,109],[250,109],[250,110],[247,110],[247,111],[245,111],[245,112],[233,112],[232,110],[228,110],[228,109],[225,109],[225,108],[223,107],[223,102],[224,102],[224,99],[226,99],[226,98],[227,98],[227,97],[228,97],[228,96],[229,96],[230,94],[232,94],[232,93],[234,93],[234,92],[236,92],[236,91],[246,91],[246,92],[248,92],[248,93],[250,93],[250,94],[252,94]],"seed":[240,100],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"5":{"polygon":[[244,91],[252,91],[252,92],[254,92],[254,93],[256,93],[256,94],[260,95],[260,97],[261,97],[261,98],[263,99],[263,103],[262,103],[262,105],[261,105],[260,107],[254,108],[253,110],[248,110],[248,109],[239,109],[239,108],[234,108],[234,107],[230,107],[230,106],[228,105],[228,104],[229,104],[229,101],[230,101],[230,99],[231,99],[231,97],[233,96],[233,94],[235,94],[235,93],[237,93],[237,92],[239,92],[239,91]],"seed":[245,100],"note":"Conservative white-hole core; one source pixel inset from color boundary."},"7":{"polygon":[[252,95],[253,95],[254,93],[256,93],[256,92],[258,92],[258,91],[259,91],[259,92],[271,92],[271,93],[273,93],[273,94],[275,94],[275,95],[279,96],[279,98],[280,98],[280,100],[281,100],[281,102],[282,102],[282,103],[281,103],[281,105],[279,106],[279,108],[277,108],[276,108],[276,109],[274,109],[274,110],[271,110],[271,111],[269,111],[269,112],[265,112],[265,111],[262,111],[262,110],[255,110],[255,109],[250,109],[250,108],[248,108],[248,107],[247,107],[247,105],[248,105],[248,102],[249,102],[250,96]],"seed":[265,101],"note":"Conservative white-hole core; one source pixel inset from color boundary."}},"swordBack":{}};
/* Render-mask repair. Keep the embedded animation frames and their RGB artwork intact. */
const heroActionAlphaCache=new WeakMap();
const heroActionAlphaStats=new Map();
function heroActionGapGuide(img){
  for(const [name,frames] of [['birdRun',birdRun],['heroAtkL',heroAtkL],['heroAtkR',heroAtkR],['swordBack',swordBack]]){
    const index=frames.indexOf(img);if(index!==-1)return HERO_ACTION_GAP_GUIDES[name]?.[index];
  }
  return null;
}
function inHeroGapPolygon(x,y,polygon){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function cleanHeroActionFrame(img){
  if(!img || birdIdle.includes(img) || !img.complete || !img.naturalWidth)return img;
  if(heroActionAlphaCache.has(img))return heroActionAlphaCache.get(img);
  const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
  const g=canvas.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0);
  const pixels=g.getImageData(0,0,canvas.width,canvas.height),d=pixels.data;
  let cleared=0,gapCleared=0;
  for(let i=0;i<d.length;i+=4){
    const a=d[i+3];if(a===0 || a===255)continue;
    const r=d[i],green=d[i+1],b=d[i+2],hi=Math.max(r,green,b),lo=Math.min(r,green,b);
    // The failed original cutout left neutral, translucent matte inside ribbon loops.
    // Opaque costume shadows, blue water, skin and every opaque outline remain untouched.
    if(a<240 && hi-lo<=24 && hi<206){d[i+3]=0;cleared++;}
  }
  // Frame-specific inner apertures: the original animation baked white into some ribbon loops.
  // The guides stop inside their blue contour and avoid the sword hilt and crest in R1/R2.
  const guide=heroActionGapGuide(img);
  if(guide?.polygon){
    const polygon=guide.polygon,minX=Math.min(...polygon.map(p=>p[0])),maxX=Math.max(...polygon.map(p=>p[0]));
    const minY=Math.min(...polygon.map(p=>p[1])),maxY=Math.max(...polygon.map(p=>p[1]));
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const i=(y*canvas.width+x)*4;
      if(inHeroGapPolygon(x+.5,y+.5,polygon)&&d[i+3]){d[i+3]=0;gapCleared++;}
    }
  }
  g.putImageData(pixels,0,0);heroActionAlphaCache.set(img,canvas);heroActionAlphaStats.set(img,{cleared,gapCleared});return canvas;
}

/* Recover the alpha removed by the original beige-background keying.
   All original RGB values, animation dimensions and fully transparent gaps stay intact. */
const restoredEnemyAlphaCache = new Map();
function restoredEnemyOf(skin, frame){
  const key=skin+':'+frame;
  if(restoredEnemyAlphaCache.has(key)) return restoredEnemyAlphaCache.get(key);
  const img=wokouWalk[skin]&&wokouWalk[skin][frame];
  if(!img||!img.complete||!img.naturalWidth) return null;
  const c=document.createElement('canvas');
  c.width=img.naturalWidth;c.height=img.naturalHeight;
  const g=c.getContext('2d',{willReadFrequently:true});
  g.drawImage(img,0,0);
  const pixels=g.getImageData(0,0,c.width,c.height),d=pixels.data;
  const w=c.width,h=c.height,sourceAlpha=new Uint8Array(w*h);
  for(let n=0;n<sourceAlpha.length;n++) sourceAlpha[n]=d[n*4+3];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const n=y*w+x,i=n*4,a=sourceAlpha[n];
    if(a===0||a===255)continue;
    // Interior coverage belongs to the character. Preserve the original outer antialias.
    const interior=x>0&&x<w-1&&y>0&&y<h-1&&
      sourceAlpha[n-1]>0&&sourceAlpha[n+1]>0&&sourceAlpha[n-w]>0&&sourceAlpha[n+w]>0;
    // The keyed skin extends to the cheek, hands and feet; restore those warm edge pixels too.
    const r=d[i],green=d[i+1],b=d[i+2];
    const warmSkin=r>120&&r-green>=10&&green-b>=8&&r-b>=24;
    if(interior||warmSkin)d[i+3]=255;
  }
  g.putImageData(pixels,0,0);
  restoredEnemyAlphaCache.set(key,c);
  return c;
}

/* ★ 惰性构建：启动时不再克隆整个文档并常驻一个 16MB+ 的字符串，
   只在用户真的点「下载游戏包」时才现算，算完即可被回收。 */
function buildOfflineGameSource(){
  const root=document.documentElement.cloneNode(true);
  const hero=root.querySelector('#menuHero'); if (hero) hero.removeAttribute('src');
  const wrap=root.querySelector('#wrap');    if (wrap) wrap.removeAttribute('style');
  return '<!DOCTYPE html>\n'+root.outerHTML;
}


autoLoadLastSave();                   // ★ 自动接续上次玩的存档（buff / 属性 / 解锁进度）
setScreen('menu');
scheduleLoop();
