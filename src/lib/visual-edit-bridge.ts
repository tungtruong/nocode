// Visual Edit bridge — script injected into the preview iframe so the parent
// (builder UI) can: highlight elements on hover, capture clicks, push live
// style edits back in, and finally snapshot the modified HTML.
//
// Communication is postMessage with `{ source: "jv-edit", type, ...payload }`.
//
// Parent → iframe:
//   { type: "enable" }           — start listening, add hover highlight
//   { type: "disable" }          — stop, remove highlight
//   { type: "apply", path, prop, value }
//                                — set CSS prop / textContent on element at path
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
// that child's 2nd child". Robust to class/id changes; brittle only if the
// user re-orders elements (acceptable for visual editing session).

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
    // Try to read raw inline first (the user's edit target), fall back to
    // computed so the panel has something to display.
    var raw = el.style || {};
    var firstChildText = '';
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { firstChildText = (n.textContent || '').trim(); break; }
    }
    return {
      tag: el.tagName.toLowerCase(),
      className: (el.className && typeof el.className === 'string') ? el.className : '',
      text: firstChildText || (el.childElementCount === 0 ? (el.textContent || '').trim() : ''),
      color: raw.color || rgb2hex(cs.color),
      backgroundColor: raw.backgroundColor || rgb2hex(cs.backgroundColor),
      fontSize: raw.fontSize || cs.fontSize,
      padding: raw.padding || cs.padding,
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

  function apply(path, prop, value) {
    var el = elFromPath(path);
    if (!el) return;
    if (prop === 'text') {
      // Replace the FIRST text-node child only. Leaves nested elements alone.
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { n.textContent = value; return; }
      }
      // No text node yet — prepend one.
      el.insertBefore(document.createTextNode(value), el.firstChild);
    } else if (prop === 'color' || prop === 'backgroundColor' || prop === 'fontSize' || prop === 'padding') {
      el.style[prop] = value;
    }
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
    } else if (d.type === 'snapshot') {
      window.parent.postMessage({ source: 'jv-edit', type: 'snapshot', html: snapshot() }, '*');
    }
  });

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseleave', onLeave, true);
  document.addEventListener('click', onClick, true);

  window.parent.postMessage({ source: 'jv-edit', type: 'ready' }, '*');
})();</script>`;
