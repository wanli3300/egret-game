(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EgretGamepadCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_BINDINGS = Object.freeze({ up: 12, down: 13, left: 14, right: 15, leftClick: 2, rightClick: 3, confirm: 0, cancel: 1 });
  var NAMES = ['up', 'down', 'left', 'right', 'leftClick', 'rightClick', 'confirm', 'cancel'];
  var ADDED_NAMES = ['left', 'right', 'confirm', 'cancel'];
  var DEAD_ZONE = 0.18;

  function bindingsFor(value) {
    var bindings = value === undefined ? DEFAULT_BINDINGS : value;
    if (!bindings || typeof bindings !== 'object') return null;
    // Existing four-button profiles migrate only when none of the new controls is present.
    var legacy = ADDED_NAMES.every(function (name) { return bindings[name] === undefined; });
    var seen = [], copy = {};
    for (var i = 0; i < NAMES.length; i++) {
      var name = NAMES[i], index = legacy && ADDED_NAMES.indexOf(name) !== -1 ? DEFAULT_BINDINGS[name] : bindings[name];
      if (!Number.isSafeInteger(index) || index < 0 || seen.indexOf(index) !== -1) return null;
      seen.push(index);
      copy[name] = index;
    }
    return copy;
  }

  function buttonPressed(button) {
    if (!button || typeof button !== 'object') return null;
    var hasPressed = typeof button.pressed === 'boolean';
    var hasValue = typeof button.value === 'number' && Number.isFinite(button.value) && button.value >= 0 && button.value <= 1;
    if (button.pressed !== undefined && !hasPressed) return null;
    if (button.value !== undefined && !hasValue) return null;
    if (!hasPressed && !hasValue) return null;
    return button.pressed === true || (hasValue && button.value > 0.5);
  }

  function facing(value) {
    if (value && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number' && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      var scale = Math.max(Math.abs(value[0]), Math.abs(value[1]));
      if (scale > 0) {
        var x = value[0] / scale, y = value[1] / scale, length = Math.hypot(x, y);
        return [x / length, y / length];
      }
    }
    return [1, 0];
  }

  function stickFor(axes) {
    if (!axes || !Number.isSafeInteger(axes.length) || axes.length < 2) return null;
    var x = axes[0], y = axes[1];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1 || Math.abs(y) > 1) return null;
    var radius = Math.hypot(x, y);
    if (radius <= DEAD_ZONE) return [0, 0];
    var magnitude = Math.min(1, (radius - DEAD_ZONE) / (1 - DEAD_ZONE));
    return [x / radius * magnitude, y / radius * magnitude];
  }

  function GamepadEngine() { this.reset(); }

  GamepadEngine.prototype.reset = function (facingDirection) {
    this._direction = facing(facingDirection);
    this._device = null;
    this._bindingKey = null;
    this._context = null;
    this._disarm();
  };

  GamepadEngine.prototype._disarm = function () {
    this._ready = false;
    this._previous = { leftClick: false, rightClick: false, confirm: false, cancel: false };
    this._navDirection = [0, 0];
    this._navNextMs = 0;
    this._lastNowMs = null;
  };

  GamepadEngine.prototype._packet = function (move, actions, nav) {
    actions = actions || {};
    return {
      leftClick: actions.leftClick === true,
      rightClick: actions.rightClick === true,
      confirm: actions.confirm === true,
      cancel: actions.cancel === true,
      move: move ? move.slice() : [0, 0],
      nav: nav ? nav.slice() : [0, 0],
      direction: this._direction.slice(),
      ready: this._ready
    };
  };

  GamepadEngine.prototype.process = function (gamepad, options) {
    options = options && typeof options === 'object' ? options : {};
    var bindings = bindingsFor(options.bindings);
    var context = options.context === undefined ? 'play' : options.context;
    if (!bindings || (context !== 'play' && context !== 'ui')) {
      this._bindingKey = null;
      this._disarm();
      return this._packet();
    }
    if (!gamepad || gamepad.connected !== true || !Number.isSafeInteger(gamepad.index) || gamepad.index < 0 || typeof gamepad.id !== 'string' || !gamepad.id.length || !gamepad.buttons || !Number.isSafeInteger(gamepad.buttons.length) || gamepad.buttons.length < 1) {
      this._device = null;
      this._disarm();
      return this._packet();
    }
    var device = String(gamepad.index) + '\u0000' + gamepad.id;
    var bindingKey = NAMES.map(function (name) { return bindings[name]; }).join(',');
    if (device !== this._device || bindingKey !== this._bindingKey || context !== this._context) {
      this._device = device;
      this._bindingKey = bindingKey;
      this._context = context;
      this._disarm();
      return this._packet();
    }
    if (options.allowed === false) {
      this._disarm();
      return this._packet();
    }
    var stick = stickFor(gamepad.axes);
    if (!stick) {
      this._disarm();
      return this._packet();
    }
    var down = {};
    for (var i = 0; i < NAMES.length; i++) {
      var name = NAMES[i], index = bindings[name];
      var pressed = index < gamepad.buttons.length ? buttonPressed(gamepad.buttons[index]) : null;
      if (pressed === null) {
        this._disarm();
        return this._packet();
      }
      down[name] = pressed;
    }
    if (!this._ready) {
      // No held combat, navigation or stick input may cross device or scene boundaries.
      if (NAMES.every(function (name) { return !down[name]; }) && !stick[0] && !stick[1]) this._ready = true;
      return this._packet();
    }
    var x = (down.right ? 1 : 0) - (down.left ? 1 : 0);
    var y = (down.down ? 1 : 0) - (down.up ? 1 : 0);
    var move = x || y ? facing([x, y]) : stick;
    var actions = {};
    ['leftClick', 'rightClick', 'confirm', 'cancel'].forEach(function (name) {
      actions[name] = down[name] && !this._previous[name];
      this._previous[name] = down[name];
    }, this);
    if (context === 'play') {
      if (move[0] || move[1]) this._direction = facing(move);
      return this._packet(move, { leftClick: actions.leftClick, rightClick: actions.rightClick, cancel: actions.cancel });
    }

    var navDirection = [0, 0];
    if (move[0] || move[1]) {
      // A diagonal moves one menu position, with horizontal winning an exact tie.
      if (Math.abs(move[0]) >= Math.abs(move[1])) navDirection[0] = move[0] > 0 ? 1 : -1;
      else navDirection[1] = move[1] > 0 ? 1 : -1;
    }
    var nowMs = typeof options.nowMs === 'number' && Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    var changed = navDirection[0] !== this._navDirection[0] || navDirection[1] !== this._navDirection[1];
    var nav = [0, 0];
    if (navDirection[0] || navDirection[1]) {
      if (changed || this._lastNowMs !== null && nowMs < this._lastNowMs) {
        nav = navDirection.slice();
        this._navNextMs = nowMs + 330;
      } else if (nowMs >= this._navNextMs) {
        nav = navDirection.slice();
        this._navNextMs = nowMs + 140;
      }
    } else this._navNextMs = 0;
    this._navDirection = navDirection;
    this._lastNowMs = nowMs;
    return this._packet(null, { confirm: actions.confirm, cancel: actions.cancel }, nav);
  };

  return { GamepadEngine: GamepadEngine, DEFAULT_BINDINGS: DEFAULT_BINDINGS };
});
