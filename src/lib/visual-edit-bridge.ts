// Visual Edit bridge — script injected into the preview iframe so the parent
// (builder UI) can: highlight elements on hover, capture clicks, push live
// style edits back in, restructure (move / delete / duplicate), and finally
// snapshot the modified HTML.
//
// Communication is postMessage with `{ source: "jv-edit", type, ...payload }`.
//
// Parent → iframe:
//   { type: "enable" }           — start listening, add hover highlight
//   { type: "disable" }          — stop, remove highlight
//   { type: "apply", path, prop, value }
//                                — set CSS prop / textContent on element at path
//   { type: "move", path, dir }  — dir: "up" | "down" — swap sibling order
//   { type: "delete", path }     — remove element from DOM
//   { type: "duplicate", path }  — clone element after itself
//   { type: "theme", color }     — apply primary color globally (CSS variable)
//   { type: "snapshot" }         — reply with current outerHTML
//
// Iframe → parent:
//   { type: "ready" }            — bridge installed and listening
//   { type: "select", path, info }
//                                — user clicked an element
//   { type: "snapshot", html }   — full document outerHTML reply
//
// `path` is a positional selector: an array of child-index numbers from
// document.documentElement, e.g. [0, 2, 1] means "html → body's 3rd child →
// that child's 2nd child". After a move/delete/duplicate, the parent must
// re-snapshot and re-select — old paths can shift.

export const VISUAL_EDIT_BRIDGE_SCRIPT = `<script data-jv-bridge>(function(){
  var enabled = false;
  var hovered = null;
  var hoverOutline = '';

  function pathOf(el) {
    var p = [];
    var cur = el;
    while (cur && cur !== document.documentElement) {
      var parent = cur.parentNode;
      if (!parent) break;
      var idx = Array.prototype.indexOf.call(parent.childNodes, cur);
      p.unshift(idx);
      cur = parent;
    }
    return p;
  }

  function elFromPath(path) {
    var cur = document.documentElement;
    for (var i = 0; i < path.length; i++) {
      if (!cur || !cur.childNodes[path[i]]) return null;
      cur = cur.childNodes[path[i]];
    }
    return cur && cur.nodeType === 1 ? cur : null;
  }

  function infoOf(el) {
    var cs = window.getComputedStyle(el);
    var raw = el.style || {};
    var firstChildText = '';
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { firstChildText = (n.textContent || '').trim(); break; }
    }
    // Read previous-sibling and next-sibling existence so the inspector can
    // grey out the up/down move buttons at boundaries.
    var canMoveUp = false, canMoveDown = false;
    var prev = el.previousElementSibling;
    while (prev) { if (prev.tagName && !prev.hasAttribute('data-jv-bridge')) { canMoveUp = true; break; } prev = prev.previousElementSibling; }
    var next = el.nextElementSibling;
    while (next) { if (next.tagName && !next.hasAttribute('data-jv-bridge')) { canMoveDown = true; break; } next = next.nextElementSibling; }
    return {
      tag: el.tagName.toLowerCase(),
      className: (el.className && typeof el.className === 'string') ? el.className : '',
      text: firstChildText || (el.childElementCount === 0 ? (el.textContent || '').trim() : ''),
      color: raw.color || rgb2hex(cs.color),
      backgroundColor: raw.backgroundColor || rgb2hex(cs.backgroundColor),
      fontSize: raw.fontSize || cs.fontSize,
      padding: raw.padding || cs.padding,
      margin: raw.margin || cs.margin,
      borderRadius: raw.borderRadius || cs.borderRadius,
      textAlign: raw.textAlign || cs.textAlign,
      fontWeight: raw.fontWeight || cs.fontWeight,
      // For <img> swap: expose current src so the inspector can show it.
      src: el.tagName === 'IMG' ? (el.getAttribute('src') || '') : '',
      canMoveUp: canMoveUp,
      canMoveDown: canMoveDown,
    };
  }

  function rgb2hex(v) {
    if (!v) return '';
    if (v.indexOf('#') === 0) return v;
    var m = v.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    if (!m) return v;
    var h = '#';
    for (var i = 1; i <= 3; i++) {
      var x = parseInt(m[i], 10).toString(16);
      if (x.length < 2) x = '0' + x;
      h += x;
    }
    return h;
  }

  function onMove(e) {
    if (!enabled) return;
    var t = e.target;
    if (!t || t.nodeType !== 1 || t === document.documentElement || t === document.body) return;
    if (hovered === t) return;
    if (hovered) hovered.style.outline = hoverOutline;
    hovered = t;
    hoverOutline = t.style.outline;
    t.style.outline = '2px solid #7c3aed';
  }
  function onLeave() {
    if (hovered) { hovered.style.outline = hoverOutline; hovered = null; }
  }
  function onClick(e) {
    if (!enabled) return;
    var t = e.target;
    if (!t || t.nodeType !== 1 || t === document.documentElement || t === document.body) return;
    e.preventDefault();
    e.stopPropagation();
    var path = pathOf(t);
    window.parent.postMessage({ source: 'jv-edit', type: 'select', path: path, info: infoOf(t) }, '*');
  }

  // Allowed inline-style props the inspector can set. Anything else is
  // ignored — keeps malformed messages from corrupting the DOM.
  var STYLE_PROPS = {
    color: 1, backgroundColor: 1, fontSize: 1, padding: 1,
    margin: 1, borderRadius: 1, textAlign: 1, fontWeight: 1,
  };

  function apply(path, prop, value) {
    var el = elFromPath(path);
    if (!el) return;
    if (prop === 'text') {
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { n.textContent = value; return; }
      }
      el.insertBefore(document.createTextNode(value), el.firstChild);
    } else if (prop === 'src') {
      // <img> swap — replace the src attribute (used by the file-upload flow
      // in the inspector). Also clear srcset so the new src wins.
      if (el.tagName === 'IMG') {
        el.setAttribute('src', value);
        el.removeAttribute('srcset');
      }
    } else if (STYLE_PROPS[prop]) {
      el.style[prop] = value;
    }
  }

  function move(path, dir) {
    var el = elFromPath(path);
    if (!el || !el.parentNode) return;
    var sibling = dir === 'up' ? el.previousElementSibling : el.nextElementSibling;
    // Skip bridge artifact siblings if any.
    while (sibling && sibling.hasAttribute && sibling.hasAttribute('data-jv-bridge')) {
      sibling = dir === 'up' ? sibling.previousElementSibling : sibling.nextElementSibling;
    }
    if (!sibling) return;
    if (dir === 'up') el.parentNode.insertBefore(el, sibling);
    else el.parentNode.insertBefore(el, sibling.nextSibling);
  }

  function removeEl(path) {
    var el = elFromPath(path);
    if (!el || el === document.body || el === document.documentElement) return;
    if (hovered === el) { hovered = null; }
    el.parentNode && el.parentNode.removeChild(el);
  }

  function duplicate(path) {
    var el = elFromPath(path);
    if (!el || !el.parentNode) return;
    var clone = el.cloneNode(true);
    el.parentNode.insertBefore(clone, el.nextSibling);
  }

  function applyTheme(color) {
    // Inject (or update) a <style> tag that overrides common "primary" hooks
    // — Tailwind utility hex matches, CSS variables, common class names.
    // Crude but works on AI-generated HTML which rarely uses theme tokens.
    var existing = document.getElementById('__jv_theme_override__');
    if (!existing) {
      existing = document.createElement('style');
      existing.id = '__jv_theme_override__';
      document.head.appendChild(existing);
    }
    // Strategy: rewrite the most common AI-emitted primary colors to the
    // chosen value. The selectors target inline styles + class-based
    // utilities the model frequently uses (#7c3aed, #6d28d9, #0068ff, etc).
    // We use CSS variables when possible so cascading respects user intent.
    existing.textContent =
      ':root { --jv-theme-primary: ' + color + '; }\\n' +
      '[style*="#7c3aed"], [style*="#6d28d9"], [style*="#0068ff"], ' +
      '[style*="rgb(124, 58, 237)"], [style*="rgb(0, 104, 255)"] ' +
      '{ color: ' + color + ' !important; background-color: ' + color + ' !important; border-color: ' + color + ' !important; }';
  }

  function snapshot() {
    // Strip our outline + bridge artifacts before snapshotting.
    if (hovered) { hovered.style.outline = hoverOutline; hovered = null; }
    return '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
  }

  window.addEventListener('message', function(ev) {
    var d = ev.data;
    if (!d || d.source !== 'jv-edit') return;
    if (d.type === 'enable') {
      enabled = true;
      document.body && (document.body.style.cursor = 'crosshair');
    } else if (d.type === 'disable') {
      enabled = false;
      if (hovered) { hovered.style.outline = hoverOutline; hovered = null; }
      document.body && (document.body.style.cursor = '');
    } else if (d.type === 'apply') {
      apply(d.path, d.prop, d.value);
    } else if (d.type === 'move') {
      move(d.path, d.dir);
      // Path shifted — tell parent to re-snapshot so its state matches.
      window.parent.postMessage({ source: 'jv-edit', type: 'restructured' }, '*');
    } else if (d.type === 'delete') {
      removeEl(d.path);
      window.parent.postMessage({ source: 'jv-edit', type: 'restructured' }, '*');
    } else if (d.type === 'duplicate') {
      duplicate(d.path);
      window.parent.postMessage({ source: 'jv-edit', type: 'restructured' }, '*');
    } else if (d.type === 'theme') {
      applyTheme(d.color);
    } else if (d.type === 'snapshot') {
      window.parent.postMessage({ source: 'jv-edit', type: 'snapshot', html: snapshot() }, '*');
    }
  });

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseleave', onLeave, true);
  document.addEventListener('click', onClick, true);

  window.parent.postMessage({ source: 'jv-edit', type: 'ready' }, '*');
})();</script>`;
