(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EgretGestureCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FINGERS = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  var clamp = function (value, min, max) { return Math.max(min, Math.min(max, value)); };
  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  function angle(a, joint, b) {
    var ax = a.x - joint.x, ay = a.y - joint.y, az = a.z - joint.z;
    var bx = b.x - joint.x, by = b.y - joint.y, bz = b.z - joint.z;
    var lengths = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
    return lengths < 0.000001 ? 0 : Math.acos(clamp((ax * bx + ay * by + az * bz) / lengths, -1, 1)) * 180 / Math.PI;
  }
  function confidence(hand) {
    var value = hand.confidence === undefined ? hand.score : hand.confidence;
    return value === undefined ? 1 : Number(value);
  }
  function validHand(hand) {
    if (!hand || (hand.side !== 'Left' && hand.side !== 'Right') || !Array.isArray(hand.landmarks) || hand.landmarks.length !== 21) return false;
    var score = confidence(hand);
    if (!Number.isFinite(score) || score < 0.6) return false;
    for (var i = 0; i < 21; i++) {
      var p = hand.landmarks[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z) || p.x < -0.25 || p.x > 1.25 || p.y < -0.25 || p.y > 1.25 || Math.abs(p.z) > 2) return false;
    }
    var lm = hand.landmarks;
    var palm = Math.max(distance(lm[0], lm[9]), distance(lm[5], lm[17]));
    if (palm < 0.018 || palm > 0.6) return false;
    // Palm tracking stays useful when a fingertip is briefly occluded. Finger
    // articulation must not invalidate a geometrically sound wrist/palm.
    return true;
  }
  function describe(hand, wasPinching) {
    var lm = hand.landmarks;
    var fingers = FINGERS.map(function (ids) {
      var mcp = lm[ids[0]], pip = lm[ids[1]], dip = lm[ids[2]], tip = lm[ids[3]];
      var pipAngle = angle(mcp, pip, dip);
      var dipAngle = angle(pip, dip, tip);
      var wristTip = distance(lm[0], tip), wristPip = distance(lm[0], pip);
      return {
        extended: pipAngle >= 150 && dipAngle >= 135 && wristTip > wristPip * 1.08 && distance(mcp, tip) > distance(mcp, pip) * 1.55,
        folded: pipAngle < 125 || wristTip < wristPip * 1.02
      };
    });
    var extended = fingers.filter(function (f) { return f.extended; }).length;
    var folded = fingers.filter(function (f) { return f.folded; }).length;
    var palmScale = Math.max(distance(lm[0], lm[9]), distance(lm[5], lm[17]));
    var otherExtended = fingers.slice(1).filter(function (f) { return f.extended; }).length;
    // Palm-relative distance works for hands at different camera distances. Hysteresis
    // prevents landmark jitter from creating several pinch edges during one hold.
    var pinch = otherExtended >= 2 && distance(lm[4], lm[8]) / palmScale < (wasPinching ? 0.43 : 0.32);
    return {
      indexExtended: fingers[0].extended,
      open: extended >= 3 && !pinch,
      palmOpen: extended === 4 && !pinch,
      fist: extended === 0 && folded === 4 && !pinch &&
        FINGERS.reduce(function (sum, ids) { return sum + distance(lm[0],lm[ids[3]]); },0) / (4*palmScale) < 0.86 &&
        FINGERS.every(function(ids){return distance(lm[ids[0]],lm[ids[1]])>0.003&&distance(lm[ids[1]],lm[ids[2]])>0.003&&distance(lm[ids[2]],lm[ids[3]])>0.003;}),
      pinch: pinch,
      tip: lm[8],
      palm: {
        x: (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5,
        y: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5
      },
      palmScale: palmScale,
      palmY: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5
    };
  }

  class GestureEngine {
    constructor() {
      this._center = null;
      this._attackDirection = [1, 0];
      this.reset();
    }

    // Normal gameplay/UI transitions keep the user's neutral joystick position.
    reset() {
      this._lastTime = null;
      this._move = [0, 0];
      this._calibrationAnchor = null;
      this._calibrationAverage = null;
      this._calibrationSince = null;
      this._calibrationProgress = this._center ? 1 : 0;
      this._leftSeen = false;
      this._leftBraking = false;
      this._leftAcquireAnchor = null;
      this._leftAcquireSince = null;
      this._leftAcquired = false;
      this._leftMoving = false;
      this._leftScale = null;
      this._neutralOnAcquire = false;
      this._lastLeftShape = null;
      this._lastLeftAt = -Infinity;
      this._lastRightAt = -Infinity;
      this._aim = null;
      this._rightSeen = false;
      this._rightPinching = false;
      this._resetRightMotion();
      this._pinchSince = null;
      this._pinchLatched = false;
      this._lastDashAt = -Infinity;
      this._pauseSince = null;
      this._pauseLatched = false;
      this._gameAllowed = false;
    }

    calibrate() {
      this._center = null;
      this.reset();
    }

    _loseRight() {
      this._rightSeen = false;
      this._rightPinching = false;
      this._aim = null;
      this._resetRightMotion();
      this._pinchSince = null;
      this._pinchLatched = false;
    }

    _resetRightMotion() {
      this._rightCenter = null;
      this._rightAcquireAnchor = null;
      this._rightAcquireAverage = null;
      this._rightAcquireSince = null;
      this._rightReturnSince = null;
      this._swipeState = 'acquiring';
      this._swipeHistory = [];
      this._returnPeak = 0;
      this._returnInward = 0;
      this._returnAnchor = null;
      this._returnFromPinch = false;
    }

    _clearLeftHold() {
      this._calibrationAnchor = null;
      this._calibrationAverage = null;
      this._calibrationSince = null;
      this._calibrationProgress = this._center ? 1 : 0;
    }

    _reacquireLeft() {
      this._leftAcquireAnchor = null;
      this._leftAcquireSince = null;
      this._leftAcquired = false;
      this._move = [0, 0];
      this._leftMoving = false;
    }

    _left(shape, now, dt, sensitivity, movementAllowed, calibrationAllowed) {
      if (!shape) {
        if(this._leftSeen)this._neutralOnAcquire=true;
        this._leftSeen = false;
        this._reacquireLeft();
        this._clearLeftHold();
        return;
      }
      this._leftSeen = true;
      // Palm/wrist points remain fixed when the fingers bend. A fist is an
      // explicit clutch: stop immediately and choose a new center on release.
      if (shape.fist) {
        this._leftBraking = true;
        this._reacquireLeft();
        this._clearLeftHold();
        return;
      }
      var palm = shape.palm, scale = shape.palmScale;
      if (this._leftBraking) {
        if (this._center) this._center = { x: palm.x, y: palm.y };
        this._leftBraking = false;
        this._reacquireLeft();
        this._leftAcquired = true;
        this._neutralOnAcquire = false;
      }
      if (!this._center && calibrationAllowed) {
        if (!this._calibrationAnchor || Math.hypot(palm.x - this._calibrationAnchor.x, palm.y - this._calibrationAnchor.y) > scale * 0.14) {
          this._calibrationAnchor = { x: palm.x, y: palm.y };
          this._calibrationAverage = { x: palm.x, y: palm.y };
          this._calibrationSince = now;
        }
        var calibrationAlpha = 1 - Math.exp(-dt / 100);
        this._calibrationAverage.x += (palm.x - this._calibrationAverage.x) * calibrationAlpha;
        this._calibrationAverage.y += (palm.y - this._calibrationAverage.y) * calibrationAlpha;
        this._calibrationProgress = clamp((now - this._calibrationSince) / 400, 0, 1);
        if (this._calibrationProgress >= 1) {
          this._center = { x: this._calibrationAverage.x, y: this._calibrationAverage.y };
          this._leftAcquired = true;
        }
      }
      if (!movementAllowed || !this._center) {
        this._move = [0, 0];
        if (!this._center && !calibrationAllowed) this._clearLeftHold();
        return;
      }
      if (!this._leftAcquired) {
        if (!this._leftAcquireAnchor || Math.hypot(palm.x - this._leftAcquireAnchor.x, palm.y - this._leftAcquireAnchor.y) > scale * 0.14) {
          this._leftAcquireAnchor = { x: palm.x, y: palm.y };
          this._leftAcquireSince = now;
        }
        if (now - this._leftAcquireSince < 80) {
          this._move = [0, 0];
          return;
        }
        this._leftAcquired = true;
        if(this._neutralOnAcquire){this._center={x:palm.x,y:palm.y};this._neutralOnAcquire=false;}
      }
      // Input landmarks have already been mirrored by the camera adapter.
      // Positive x means screen-right; negative y means screen-up.
      var dx = palm.x - this._center.x, dy = palm.y - this._center.y;
      var radius = Math.hypot(dx, dy);
      this._leftScale = this._leftScale === null ? scale : this._leftScale+(scale-this._leftScale)*(1-Math.exp(-dt/150));
      scale=this._leftScale;
      var deadzone = scale * 0.08, fullSpeed = scale * 0.52;
      if (radius <= (this._leftMoving?deadzone:scale*0.12)) {
        this._move = [0, 0];
        this._leftMoving = false;
        return;
      }
      this._leftMoving = true;
      var magnitude = Math.sqrt(clamp((radius - deadzone) / (fullSpeed - deadzone) * sensitivity, 0, 1));
      var tau=this._move[0]*dx+this._move[1]*dy<0?12:24;
      var alpha = 1 - Math.exp(-dt / tau);
      this._move[0] += (dx / radius * magnitude - this._move[0]) * alpha;
      this._move[1] += (dy / radius * magnitude - this._move[1]) * alpha;
      var length = Math.hypot(this._move[0], this._move[1]);
      if (length > 1) {
        this._move[0] /= length;
        this._move[1] /= length;
      }
    }

    _right(shape, now, dt, allowed) {
      if (!shape) {
        this._loseRight();
        return { attack: false, dash: false };
      }
      var raw = { x: clamp((shape.tip.x - 0.12) / 0.76, 0, 1), y: clamp((shape.tip.y - 0.12) / 0.76, 0, 1) };
      if (!this._rightSeen) {
        this._rightSeen = true;
        this._aim = raw;
        this._pinchSince = shape.pinch ? now : null;
        // A hand first acquired in a pinch must release before it can dash.
        this._pinchLatched = shape.pinch;
      } else if (shape.indexExtended && !shape.pinch) {
        // Closing the hand changes the index-tip position. Keep the last
        // deliberate pointing direction for the attack/dash and UI click.
        var aimAlpha = 1 - Math.exp(-dt / 55);
        this._aim.x += (raw.x - this._aim.x) * aimAlpha;
        this._aim.y += (raw.y - this._aim.y) * aimAlpha;
      }
      this._rightPinching = shape.pinch;
      var attack = false, dash = false;
      if (shape.pinch) {
        if (this._pinchSince === null) this._pinchSince = now;
        if (!this._pinchLatched && now - this._pinchSince >= 80) {
          this._pinchLatched = true;
          if (allowed && now - this._lastDashAt >= 650) {
            dash = true;
            this._lastDashAt = now;
          }
        }
      } else {
        this._pinchSince = null;
        this._pinchLatched = false;
      }
      if (!allowed) {
        this._resetRightMotion();
        return { attack: false, dash: false };
      }
      var palm = shape.palm, scale = shape.palmScale;
      if (shape.pinch) {
        // A pinch cannot also become a swipe, including the release movement.
        this._swipeHistory = [];
        this._rightReturnSince = null;
        if (this._rightCenter) this._swipeState = 'returning';
        else {
          this._rightAcquireAnchor = null;
          this._rightAcquireSince = null;
        }
        this._returnFromPinch=true;this._returnAnchor=null;this._rightReturnSince=null;
        return { attack: false, dash: dash };
      }
      if (!this._rightCenter) {
        if (!this._rightAcquireAnchor || Math.hypot(palm.x - this._rightAcquireAnchor.x, palm.y - this._rightAcquireAnchor.y) > scale * 0.14) {
          this._rightAcquireAnchor = { x: palm.x, y: palm.y };
          this._rightAcquireAverage = { x: palm.x, y: palm.y };
          this._rightAcquireSince = now;
        }
        var acquireAlpha = 1 - Math.exp(-dt / 70);
        this._rightAcquireAverage.x += (palm.x - this._rightAcquireAverage.x) * acquireAlpha;
        this._rightAcquireAverage.y += (palm.y - this._rightAcquireAverage.y) * acquireAlpha;
        if (now - this._rightAcquireSince >= 80) {
          this._rightCenter = { x: this._rightAcquireAverage.x, y: this._rightAcquireAverage.y };
          this._swipeState = 'ready';
          this._swipeHistory = [{ x: palm.x, y: palm.y, time: now }];
        }
        return { attack: false, dash: dash };
      }
      var dx = palm.x - this._rightCenter.x, dy = palm.y - this._rightCenter.y;
      var radius = Math.hypot(dx, dy);
      if (this._swipeState === 'returning') {
        this._returnPeak=Math.max(this._returnPeak,radius);
        this._returnInward=Math.max(this._returnInward,this._returnPeak-radius);
        var returned=radius<=scale*0.22||this._returnInward>=scale*0.18||this._returnFromPinch;
        if (returned) {
          if(!this._returnAnchor||Math.hypot(palm.x-this._returnAnchor.x,palm.y-this._returnAnchor.y)>scale*0.08){
            this._returnAnchor={x:palm.x,y:palm.y};this._rightReturnSince=now;
          }
          if (now - this._rightReturnSince >= 70) {
            this._swipeState = 'ready';
            this._rightCenter={x:palm.x,y:palm.y};
            this._swipeHistory = [{ x: palm.x, y: palm.y, time: now }];
            this._rightReturnSince = null;
            this._returnFromPinch=false;
          }
        } else {this._rightReturnSince=null;this._returnAnchor=null;}
        return { attack: false, dash: dash };
      }
      this._swipeHistory.push({ x: palm.x, y: palm.y, time: now });
      this._swipeHistory = this._swipeHistory.filter(function (point) { return now - point.time <= 280; });
      if (radius >= scale * 0.28) {
        for (var i = 0; i < this._swipeHistory.length; i++) {
          var previous = this._swipeHistory[i], elapsed = now - previous.time;
          if (elapsed < 20) continue;
          var vx = palm.x - previous.x, vy = palm.y - previous.y;
          var travel = Math.hypot(vx, vy);
          var startRadius = Math.hypot(previous.x - this._rightCenter.x, previous.y - this._rightCenter.y);
          var outward = travel > 0 ? (vx * dx + vy * dy) / (travel * radius) : 0;
          if (startRadius <= scale * 0.3 && travel >= scale * 0.25 && travel / scale / (elapsed / 1000) >= 1.05 && outward >= 0.7) {
            this._attackDirection = [dx / radius, dy / radius];
            this._swipeState = 'returning';
            this._swipeHistory = [];
            this._rightReturnSince = null;
            this._returnPeak=radius;this._returnInward=0;this._returnAnchor=null;this._returnFromPinch=false;
            attack = true;
            break;
          }
        }
      }
      return { attack: attack, dash: dash };
    }

    process(hands, nowMs, options) {
      options = options || {};
      var now = Number.isFinite(nowMs) ? nowMs : Date.now();
      if (this._lastTime !== null && now < this._lastTime) this.reset();
      var dt = this._lastTime === null ? 16 : clamp(now - this._lastTime, 0, 100);
      this._lastTime = now;
      var selected = { Left: null, Right: null };
      (Array.isArray(hands) ? hands : []).forEach(function (hand) {
        if (validHand(hand) && (!selected[hand.side] || confidence(hand) > confidence(selected[hand.side]))) selected[hand.side] = hand;
      });
      var left = selected.Left ? describe(selected.Left, false) : null;
      var right = selected.Right ? describe(selected.Right, this._rightPinching) : null;
      var effectiveLeft=left,leftTrackingGrace=false;
      if(left){this._lastLeftShape=left;this._lastLeftAt=now;}
      else if(this._center&&this._lastLeftShape&&now-this._lastLeftAt<=80&&!(Array.isArray(hands)&&hands.some(function(h){return h&&h.side==='Left';}))){
        effectiveLeft=this._lastLeftShape;leftTrackingGrace=true;
      }
      var rightTrackingGrace=!right&&this._rightSeen&&now-this._lastRightAt<=80;
      if(right)this._lastRightAt=now;
      var inPlay = options.state === undefined || options.state === 'play';
      var canPause = inPlay || options.paused === true;
      var raised = options.pauseGesture === true && !!(left && right && left.palmOpen && right.palmOpen && left.palmY < 0.36 && right.palmY < 0.36);
      var pause = false;
      // Lowering either palm releases the latch. Tracking loss alone does not,
      // so re-acquiring hands overhead cannot repeatedly toggle pause/resume.
      if ((left && left.palmY > 0.43) || (right && right.palmY > 0.43)) this._pauseLatched = false;
      if (canPause && raised && !this._pauseLatched) {
        if (this._pauseSince === null) this._pauseSince = now;
        if (now - this._pauseSince >= 1100) {
          pause = true;
          this._pauseLatched = true;
          this._pauseSince = null;
        }
      } else {
        this._pauseSince = null;
      }
      var allowed = inPlay && !options.paused && !raised;
      if (allowed && !this._gameAllowed) {
        this._reacquireLeft();
        this._resetRightMotion();
        this._pinchSince = right && right.pinch ? now : null;
        this._pinchLatched = !!(right && right.pinch);
      }
      this._gameAllowed = allowed;
      var calibrationAllowed = !raised && (allowed || options.state === 'settings');
      var sensitivity = Number.isFinite(options.sensitivity) ? clamp(options.sensitivity, 0.5, 2) : 1;
      this._left(effectiveLeft, now, dt, sensitivity, allowed, calibrationAllowed&&!!left);
      var actions;
      if(rightTrackingGrace){this._swipeHistory=[];actions={attack:false,dash:false};}
      else actions=this._right(right, now, dt, allowed);
      var cursor = this._aim ? { x: this._aim.x, y: this._aim.y } : null;
      var moveLength = Math.hypot(this._move[0], this._move[1]);
      var dashDirection = moveLength > 0.001 ? [this._move[0] / moveLength, this._move[1] / moveLength] : this._attackDirection.slice();
      return {
        move: allowed ? this._move.slice() : [0, 0],
        aim: cursor ? { x: cursor.x, y: cursor.y } : null,
        attack: allowed && actions.attack,
        dash: allowed && actions.dash,
        attackDirection: this._attackDirection.slice(),
        dashDirection: dashDirection,
        brake: !!(effectiveLeft && effectiveLeft.fist),
        leftTrackingGrace: leftTrackingGrace,
        rightTrackingGrace: rightTrackingGrace,
        rightReady: allowed && this._swipeState === 'ready',
        swipeState: this._swipeState,
        rightCenter: this._rightCenter ? { x: this._rightCenter.x, y: this._rightCenter.y } : null,
        leftCenter: this._center ? { x: this._center.x, y: this._center.y } : null,
        palmPosition: { left: left ? { x: left.palm.x, y: left.palm.y } : null, right: right ? { x: right.palm.x, y: right.palm.y } : null },
        pause: canPause && pause,
        cursor: cursor,
        pinch: !!(right && right.pinch),
        calibrated: !!this._center,
        calibrationProgress: this._center ? 1 : this._calibrationProgress,
        leftVisible: !!left,
        rightVisible: !!right
      };
    }
  }

  return { GestureEngine: GestureEngine };
});
