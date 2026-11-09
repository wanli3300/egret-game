(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EgretGamepadNavigation = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SELECTOR = 'button,.upCard,select,input[type="range"],input[type="checkbox"],a[href]';

  class Navigation {
    constructor(options = {}) {
      this.document = options.document || (typeof document !== 'undefined' ? document : null);
      if (!this.document) throw new Error('Navigation requires a document.');
      this.root = options.root || this.document;
      this.scope = this.root;
      this._current = null;
      this._items = [];
      this._temporaryTabIndex = new WeakSet();
    }

    get current() { return this._current; }
    get focusElement() { return this._current; }

    _visible(element) {
      if (!element || element.isConnected === false || element.disabled || element.hasAttribute?.('disabled')) return false;
      if (element.getAttribute?.('aria-disabled') === 'true' || element.classList?.contains('locked')) return false;
      if (this.scope !== this.document && !this.scope.contains?.(element)) return false;
      const view = this.document.defaultView;
      for (let ancestor = element; ancestor && ancestor !== this.document; ancestor = ancestor.parentElement) {
        if (ancestor.hidden || ancestor.hasAttribute?.('hidden') || ancestor.hasAttribute?.('inert') || ancestor.getAttribute?.('aria-hidden') === 'true') return false;
        const style = view?.getComputedStyle ? view.getComputedStyle(ancestor) : ancestor.style;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
      }
      const rect = element.getBoundingClientRect?.();
      return !!rect && Number.isFinite(rect.left) && Number.isFinite(rect.top) && rect.width > 0 && rect.height > 0;
    }

    _removeFocus() {
      const old = this._current;
      if (!old) return;
      old.classList?.remove('gamepadFocused');
      if (this._temporaryTabIndex.has(old)) {
        old.removeAttribute('tabindex');
        this._temporaryTabIndex.delete(old);
      }
      this._current = null;
    }

    _focus(element) {
      if (this._current === element) return element;
      this._removeFocus();
      if (!element) return null;
      this._current = element;
      element.classList?.add('gamepadFocused');
      const tag = String(element.tagName || '').toLowerCase();
      const nativeFocus = ['button', 'input', 'select', 'textarea'].includes(tag) || (tag === 'a' && element.hasAttribute?.('href'));
      if (!nativeFocus && !element.hasAttribute?.('tabindex')) {
        element.setAttribute('tabindex', '-1');
        this._temporaryTabIndex.add(element);
      }
      try { element.focus?.({ preventScroll: true }); } catch (_) { element.focus?.(); }
      element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      return element;
    }

    setScope(element, preferred) {
      const scope = element || this.root;
      if (this.scope !== scope) {
        this._removeFocus();
        this.scope = scope;
      }
      return this.refresh(preferred);
    }

    refresh(preferred) {
      const candidates = Array.from(this.scope.querySelectorAll?.(SELECTOR) || []);
      if (this.scope.matches?.(SELECTOR)) candidates.unshift(this.scope);
      this._items = candidates.filter(element => this._visible(element));
      let next = this._items.includes(this._current) ? this._current : null;
      if (!next && this._items.includes(this.document.activeElement)) next = this.document.activeElement;
      if (!next && typeof preferred === 'string') preferred = this.scope.querySelector?.(preferred);
      if (!next && this._items.includes(preferred)) next = preferred;
      return this._focus(next || this._items[0] || null);
    }

    _dispatch(element, types) {
      const EventType = this.document.defaultView?.Event || (typeof Event !== 'undefined' ? Event : null);
      if (EventType) for (const type of types) element.dispatchEvent(new EventType(type, { bubbles: true }));
    }

    _adjustRange(element, direction) {
      const attribute = name => element.getAttribute?.(name) ?? element[name];
      const numeric = (value, fallback) => value === '' || value == null || !Number.isFinite(Number(value)) ? fallback : Number(value);
      const min = numeric(attribute('min'), 0), max = Math.max(min, numeric(attribute('max'), 100));
      const oldValue = numeric(element.value, (min + max) / 2);
      const rawStep = attribute('step');
      const anyStep = rawStep === 'any';
      const step = anyStep ? (max - min) / 100 || 1 : Math.max(Number.EPSILON, numeric(rawStep, 1) > 0 ? numeric(rawStep, 1) : 1);
      const position = (oldValue - min) / step;
      const index = direction > 0 ? Math.floor(position + 1e-9) + 1 : Math.ceil(position - 1e-9) - 1;
      const value = Math.max(min, Math.min(max, Number((anyStep ? oldValue + direction * step : min + index * step).toPrecision(12))));
      if (value !== oldValue) {
        element.value = String(value);
        this._dispatch(element, ['input', 'change']);
        if (this._current === element && !this._visible(element)) this._removeFocus();
      }
      return this._current;
    }

    move(direction) {
      this.refresh();
      if (!this._current) return null;
      const dx = Number(direction?.[0]) || 0, dy = Number(direction?.[1]) || 0;
      if (!dx && !dy) return this._current;
      // Resolve diagonal samples to one axis so focus cannot skip two rows at once.
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const sign = Math.sign(horizontal ? dx : dy);
      // Horizontal input edits sliders; vertical input leaves them for nearby controls.
      if (horizontal && String(this._current.tagName).toLowerCase() === 'input' && (this._current.getAttribute?.('type') || this._current.type) === 'range') {
        return this._adjustRange(this._current, sign);
      }
      const origin = this._current.getBoundingClientRect();
      const ox = origin.left + origin.width / 2, oy = origin.top + origin.height / 2;
      let best = null, bestScore = Infinity;
      for (const candidate of this._items) {
        if (candidate === this._current) continue;
        const rect = candidate.getBoundingClientRect();
        const x = rect.left + rect.width / 2 - ox, y = rect.top + rect.height / 2 - oy;
        const forward = (horizontal ? x : y) * sign;
        if (forward <= 1) continue;
        const cross = Math.abs(horizontal ? y : x);
        const score = forward + cross * 2 + cross * cross / Math.max(forward, 24);
        if (score < bestScore) { best = candidate; bestScore = score; }
      }
      return best ? this._focus(best) : this._current;
    }

    confirm() {
      const previous = this._current;
      this.refresh();
      // A disabled or removed target cannot transfer its pending click to another control.
      if (!previous || previous !== this._current || !this._visible(previous)) return false;
      if (String(previous.tagName).toLowerCase() === 'select') {
        const options = Array.from(previous.options || []);
        let next = previous.selectedIndex;
        for (let offset = 1; offset <= options.length; offset++) {
          const index = (previous.selectedIndex + offset + options.length) % options.length;
          const option = options[index];
          if (!option.disabled && !option.hidden && !option.parentElement?.disabled) { next = index; break; }
        }
        if (next === previous.selectedIndex || next < 0) return false;
        previous.selectedIndex = next;
        this._dispatch(previous, ['change']);
      } else {
        previous.click?.();
      }
      // Click handlers can replace cards, hide a dialog, or change the entire page.
      if (this._current === previous && !this._visible(previous)) this._removeFocus();
      return true;
    }

    clear() {
      this._removeFocus();
      this._items = [];
    }
  }

  return { Navigation };
}));
