import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireSession, authError } from "@/lib/auth";

const SYSTEM_PROMPT = `You are an expert web developer. Create a complete, production-quality single-file HTML web application based on the user's description.

VERY IMPORTANT — START IMMEDIATELY WITH THE HTML CODE. Your entire response must be only the HTML file. Do NOT include any introductory text, explanations, greetings, or sign-offs. Do NOT wrap in markdown fences. The very first character you output must be "<" starting the DOCTYPE.

RULES:
1. Output ONLY a complete, valid HTML file. No text before or after.
2. Include all CSS (<style>) and JavaScript (<script>) inline in one file.
3. Beautiful, modern design: nice colors, shadows, rounded corners, animations.
4. Cohesive color scheme, fully responsive, semantic HTML5.
5. Use localStorage for data persistence when applicable.
6. Complete, interactive, working app — ready to use immediately.

STYLE: modern CSS (flexbox, grid, custom properties, gradients, backdrop-filter), clean minimal design, smooth transitions, system font stack.

START NOW with <!DOCTYPE html>`;

function fallbackGenerate(prompt: string): string {
  const lower = prompt.toLowerCase();

  if (lower.includes("todo") || lower.includes("task") || lower.includes("công việc")) {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Todo App</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f11; color: #e4e4e7; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .app { width: 100%; max-width: 480px; background: #1a1a1e; border-radius: 20px; padding: 32px; box-shadow: 0 25px 60px rgba(0,0,0,0.5); border: 1px solid #27272a; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 24px; text-align: center; letter-spacing: -0.5px; }
    h1 span { color: #22c55e; }
    .input-group { display: flex; gap: 10px; margin-bottom: 20px; }
    .input-group input { flex: 1; padding: 12px 16px; border-radius: 12px; border: 1px solid #27272a; background: #27272a; color: #e4e4e7; font-size: 15px; outline: none; transition: border-color 0.2s; }
    .input-group input:focus { border-color: #22c55e; }
    .input-group button { padding: 12px 20px; border-radius: 12px; background: #22c55e; color: #000; border: none; font-weight: 600; font-size: 15px; cursor: pointer; transition: background 0.2s; }
    .input-group button:hover { background: #16a34a; }
    ul { list-style: none; }
    li { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: #27272a; border-radius: 12px; margin-bottom: 8px; transition: all 0.2s; animation: slideIn 0.3s ease; }
    @keyframes slideIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
    li:hover { background: #2d2d32; }
    li.completed span { text-decoration: line-through; opacity: 0.4; }
    li input[type="checkbox"] { width: 20px; height: 20px; accent-color: #22c55e; cursor: pointer; }
    li span { flex: 1; font-size: 15px; }
    li button { background: none; border: none; color: #ef4444; cursor: pointer; font-size: 18px; padding: 4px 8px; border-radius: 8px; transition: background 0.2s; opacity: 0.5; }
    li button:hover { opacity: 1; background: #ef444420; }
    .empty { text-align: center; color: #52525b; padding: 40px 0; font-size: 15px; }
    .tools { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding-top: 16px; border-top: 1px solid #27272a; }
    .tools span { color: #52525b; font-size: 13px; }
    .tools button { background: none; border: 1px solid #3f3f46; color: #a1a1aa; padding: 6px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; transition: all 0.2s; }
    .tools button:hover { border-color: #52525b; color: #e4e4e7; }
    .dark-toggle { display: flex; justify-content: center; margin-bottom: 20px; }
    .dark-toggle button { background: #27272a; border: none; color: #a1a1aa; padding: 8px 20px; border-radius: 20px; cursor: pointer; font-size: 13px; transition: all 0.2s; }
    .dark-toggle button:hover { color: #e4e4e7; }
  </style>
</head>
<body>
  <div class="app">
    <h1><span>&#10003;</span> Todo App</h1>
    <div class="input-group">
      <input type="text" id="todoInput" placeholder="Thêm công việc mới..." onkeydown="if(event.key==='Enter')addTodo()">
      <button onclick="addTodo()">Thêm</button>
    </div>
    <ul id="todoList"></ul>
    <p class="empty" id="emptyMsg">Chưa có công việc nào. Hãy thêm một việc!</p>
    <div class="tools">
      <span id="counter">0 việc</span>
      <button onclick="clearCompleted()">Xóa đã xong</button>
    </div>
  </div>
  <script>
    let todos = JSON.parse(localStorage.getItem('todos') || '[]');
    function save() { localStorage.setItem('todos', JSON.stringify(todos)); render(); }
    function addTodo() { const inp = document.getElementById('todoInput'); const text = inp.value.trim(); if (!text) return; todos.push({ id: Date.now(), text, completed: false }); inp.value = ''; save(); }
    function toggle(id) { const t = todos.find(t => t.id === id); if (t) { t.completed = !t.completed; save(); } }
    function remove(id) { todos = todos.filter(t => t.id !== id); save(); }
    function clearCompleted() { todos = todos.filter(t => !t.completed); save(); }
    function render() {
      const list = document.getElementById('todoList');
      const empty = document.getElementById('emptyMsg');
      const counter = document.getElementById('counter');
      list.innerHTML = todos.map(t => '<li class="' + (t.completed ? 'completed' : '') + '"><input type="checkbox" ' + (t.completed ? 'checked' : '') + ' onclick="toggle(' + t.id + ')"><span>' + escapeHtml(t.text) + '</span><button onclick="remove(' + t.id + ')">×</button></li>').join('');
      empty.style.display = todos.length ? 'none' : 'block';
      const remaining = todos.filter(t => !t.completed).length;
      counter.textContent = remaining + ' việc còn lại';
    }
    function escapeHtml(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }
    render();
  </script>
</body>
</html>`;
  }

  if (lower.includes("calculator") || lower.includes("tính") || lower.includes("calc")) {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Calculator</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #0f0f11 0%, #18181b 100%); color: #e4e4e7; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .calc { width: 100%; max-width: 360px; background: #1a1a1e; border-radius: 24px; padding: 24px; box-shadow: 0 25px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05); border: 1px solid #27272a; }
    .display { background: #0f0f11; border-radius: 16px; padding: 20px; margin-bottom: 20px; text-align: right; border: 1px solid #27272a; }
    .display .expr { font-size: 16px; color: #52525b; min-height: 24px; word-break: break-all; }
    .display .result { font-size: 40px; font-weight: 300; color: #e4e4e7; letter-spacing: -1px; word-break: break-all; }
    .btns { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    button { padding: 18px; border-radius: 16px; border: none; font-size: 20px; font-weight: 500; cursor: pointer; transition: all 0.15s; font-family: inherit; }
    button:active { transform: scale(0.95); }
    .btn-num { background: #27272a; color: #e4e4e7; }
    .btn-num:hover { background: #333338; }
    .btn-op { background: #3b2146; color: #c084fc; }
    .btn-op:hover { background: #4a2a58; }
    .btn-func { background: #1e1e22; color: #22c55e; }
    .btn-func:hover { background: #26262c; }
    .btn-eq { background: #22c55e; color: #000; font-weight: 700; }
    .btn-eq:hover { background: #16a34a; }
    .btn-zero { grid-column: span 2; }
  </style>
</head>
<body>
  <div class="calc">
    <div class="display">
      <div class="expr" id="expr"></div>
      <div class="result" id="result">0</div>
    </div>
    <div class="btns">
      <button class="btn-func" onclick="input('C')">C</button>
      <button class="btn-func" onclick="input('+/-')">+/-</button>
      <button class="btn-func" onclick="input('%')">%</button>
      <button class="btn-op" onclick="input('÷')">÷</button>
      <button class="btn-num" onclick="input('7')">7</button>
      <button class="btn-num" onclick="input('8')">8</button>
      <button class="btn-num" onclick="input('9')">9</button>
      <button class="btn-op" onclick="input('×')">×</button>
      <button class="btn-num" onclick="input('4')">4</button>
      <button class="btn-num" onclick="input('5')">5</button>
      <button class="btn-num" onclick="input('6')">6</button>
      <button class="btn-op" onclick="input('-')">−</button>
      <button class="btn-num" onclick="input('1')">1</button>
      <button class="btn-num" onclick="input('2')">2</button>
      <button class="btn-num" onclick="input('3')">3</button>
      <button class="btn-op" onclick="input('+')">+</button>
      <button class="btn-num btn-zero" onclick="input('0')">0</button>
      <button class="btn-num" onclick="input('.')">.</button>
      <button class="btn-eq" onclick="input('=')">=</button>
    </div>
  </div>
  <script>
    let current = '0', previous = '', operator = null, resetAfter = false;
    function input(v) {
      if (v === 'C') { current = '0'; previous = ''; operator = null; resetAfter = false; update(); return; }
      if (v === '+/-') { if (current !== '0') { current = (parseFloat(current) * -1).toString(); } update(); return; }
      if (v === '%') { current = (parseFloat(current) / 100).toString(); update(); return; }
      if ('+-×÷'.includes(v)) {
        if (operator && !resetAfter) { compute(); }
        previous = current; operator = v; resetAfter = true; updateExpr(); return;
      }
      if (v === '=') { compute(); update(); return; }
      if (resetAfter) { current = ''; resetAfter = false; }
      if (current === '0' && v !== '.') current = '';
      if (v === '.' && current.includes('.')) return;
      current += v; update();
    }
    function compute() {
      const a = parseFloat(previous), b = parseFloat(current);
      if (isNaN(a) || isNaN(b)) return;
      let r;
      switch(operator) {
        case '+': r = a + b; break;
        case '-': r = a - b; break;
        case '×': r = a * b; break;
        case '÷': r = b !== 0 ? a / b : 'Lỗi'; break;
      }
      current = typeof r === 'number' ? parseFloat(r.toFixed(10)).toString() : r;
      operator = null; previous = ''; resetAfter = true;
    }
    function update() { document.getElementById('result').textContent = current; updateExpr(); }
    function updateExpr() { const opMap = { '+':'+','-':'-','×':'×','÷':'÷' }; document.getElementById('expr').textContent = previous ? previous + ' ' + (opMap[operator] || '') : ''; }
    update();

    document.addEventListener('keydown', (e) => {
      const map = { '0':'0','1':'1','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9','.':'.','+':'+','-':'-','*':'×','/':'÷','Enter':'=','Escape':'C','%':'%' };
      if (map[e.key]) { e.preventDefault(); input(map[e.key]); }
    });
  </script>
</body>
</html>`;
  }

  if (lower.includes("note") || lower.includes("ghi chú") || lower.includes("note") || lower.includes("memo")) {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notes App</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f11; color: #e4e4e7; min-height: 100vh; padding: 32px; }
    .app { max-width: 720px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
    .header h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.5px; }
    .header h1 span { color: #f59e0b; }
    .header button { padding: 10px 20px; border-radius: 12px; background: #f59e0b; color: #000; border: none; font-weight: 600; font-size: 14px; cursor: pointer; transition: background 0.2s; }
    .header button:hover { background: #d97706; }
    .notes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
    .note { background: #1a1a1e; border-radius: 16px; padding: 20px; border: 1px solid #27272a; cursor: pointer; transition: all 0.2s; min-height: 160px; display: flex; flex-direction: column; position: relative; }
    .note:hover { border-color: #3f3f46; transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.3); }
    .note h3 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
    .note p { font-size: 13px; color: #71717a; flex: 1; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; line-height: 1.5; }
    .note .meta { font-size: 11px; color: #3f3f46; margin-top: 12px; }
    .note .delete-btn { position: absolute; top: 12px; right: 12px; background: none; border: none; color: #52525b; cursor: pointer; font-size: 16px; padding: 4px 8px; border-radius: 8px; opacity: 0; transition: all 0.2s; }
    .note:hover .delete-btn { opacity: 1; }
    .note .delete-btn:hover { color: #ef4444; background: #ef444420; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
    .modal { background: #1a1a1e; border-radius: 20px; padding: 32px; width: 100%; max-width: 550px; border: 1px solid #27272a; box-shadow: 0 25px 60px rgba(0,0,0,0.6); }
    .modal input { width: 100%; padding: 14px 16px; border-radius: 12px; border: 1px solid #27272a; background: #27272a; color: #e4e4e7; font-size: 18px; font-weight: 600; margin-bottom: 12px; outline: none; font-family: inherit; }
    .modal input:focus { border-color: #f59e0b; }
    .modal textarea { width: 100%; padding: 14px 16px; border-radius: 12px; border: 1px solid #27272a; background: #27272a; color: #e4e4e7; font-size: 15px; resize: vertical; min-height: 200px; outline: none; font-family: inherit; line-height: 1.6; }
    .modal textarea:focus { border-color: #f59e0b; }
    .modal .actions { display: flex; gap: 10px; margin-top: 16px; justify-content: flex-end; }
    .modal .actions button { padding: 10px 24px; border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; border: none; }
    .modal .btn-save { background: #f59e0b; color: #000; }
    .modal .btn-save:hover { background: #d97706; }
    .modal .btn-cancel { background: #27272a; color: #a1a1aa; }
    .modal .btn-cancel:hover { background: #333338; color: #e4e4e7; }
    .empty-state { text-align: center; padding: 80px 20px; color: #3f3f46; }
    .empty-state svg { margin-bottom: 16px; opacity: 0.3; }
    .empty-state p { font-size: 15px; }
    .search { margin-bottom: 24px; }
    .search input { width: 100%; padding: 12px 16px; border-radius: 12px; border: 1px solid #27272a; background: #27272a; color: #e4e4e7; font-size: 14px; outline: none; }
    .search input:focus { border-color: #52525b; }
    .colors { display: flex; gap: 8px; margin-bottom: 12px; }
    .colors div { width: 24px; height: 24px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; transition: border-color 0.2s; }
    .colors div.active { border-color: #e4e4e7; }
  </style>
</head>
<body>
  <div class="app">
    <div class="header">
      <h1><span>&#9998;</span> Ghi chú</h1>
      <button onclick="openModal()">+ Ghi chú mới</button>
    </div>
    <div class="search">
      <input type="text" id="searchInput" placeholder="Tìm kiếm ghi chú..." oninput="render()">
    </div>
    <div class="notes-grid" id="notesGrid"></div>
    <div class="empty-state" id="emptyState">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
      <p>Chưa có ghi chú nào</p>
    </div>
    <div class="modal-overlay" id="modalOverlay" style="display:none" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="colors">
          <div style="background:#f59e0b" data-color="#f59e0b" class="active" onclick="selectColor(this)"></div>
          <div style="background:#22c55e" data-color="#22c55e" onclick="selectColor(this)"></div>
          <div style="background:#3b82f6" data-color="#3b82f6" onclick="selectColor(this)"></div>
          <div style="background:#ef4444" data-color="#ef4444" onclick="selectColor(this)"></div>
          <div style="background:#a855f7" data-color="#a855f7" onclick="selectColor(this)"></div>
          <div style="background:#ec4899" data-color="#ec4899" onclick="selectColor(this)"></div>
        </div>
        <input type="text" id="noteTitle" placeholder="Tiêu đề">
        <textarea id="noteContent" placeholder="Nội dung ghi chú..."></textarea>
        <div class="actions">
          <button class="btn-cancel" onclick="closeModal()">Hủy</button>
          <button class="btn-save" onclick="saveNote()">Lưu</button>
        </div>
      </div>
    </div>
  </div>
  <script>
    let notes = JSON.parse(localStorage.getItem('notes') || '[]');
    let editingId = null;
    let selectedColor = '#f59e0b';

    function save() { localStorage.setItem('notes', JSON.stringify(notes)); render(); }

    function selectColor(el) {
      document.querySelectorAll('.colors div').forEach(d => d.classList.remove('active'));
      el.classList.add('active');
      selectedColor = el.dataset.color;
    }

    function openModal(id) {
      editingId = id;
      const overlay = document.getElementById('modalOverlay');
      if (id) {
        const note = notes.find(n => n.id === id);
        if (note) {
          document.getElementById('noteTitle').value = note.title;
          document.getElementById('noteContent').value = note.content;
          selectedColor = note.color;
          document.querySelectorAll('.colors div').forEach(d => { d.classList.toggle('active', d.dataset.color === note.color); });
        }
      } else {
        document.getElementById('noteTitle').value = '';
        document.getElementById('noteContent').value = '';
        selectedColor = '#f59e0b';
        document.querySelectorAll('.colors div').forEach((d,i) => d.classList.toggle('active', i===0));
      }
      overlay.style.display = 'flex';
      document.getElementById('noteTitle').focus();
    }

    function closeModal() { document.getElementById('modalOverlay').style.display = 'none'; editingId = null; }

    function saveNote() {
      const title = document.getElementById('noteTitle').value.trim();
      const content = document.getElementById('noteContent').value.trim();
      if (!title && !content) return;
      if (editingId) {
        const note = notes.find(n => n.id === editingId);
        if (note) { note.title = title || 'Không tiêu đề'; note.content = content; note.color = selectedColor; note.updated = Date.now(); }
      } else {
        notes.unshift({ id: Date.now(), title: title || 'Không tiêu đề', content, color: selectedColor, created: Date.now(), updated: Date.now() });
      }
      closeModal();
      save();
    }

    function deleteNote(id) { notes = notes.filter(n => n.id !== id); save(); }

    function render() {
      const grid = document.getElementById('notesGrid');
      const empty = document.getElementById('emptyState');
      const search = document.getElementById('searchInput').value.toLowerCase();
      let filtered = notes;
      if (search) filtered = notes.filter(n => n.title.toLowerCase().includes(search) || n.content.toLowerCase().includes(search));
      grid.innerHTML = filtered.map(n => {
        const date = new Date(n.updated).toLocaleDateString('vi-VN', { day: 'numeric', month: 'short', year: 'numeric' });
        const bg = n.color + '15';
        const border = n.color + '40';
        return '<div class="note" style="border-color:' + border + '" onclick="openModal(' + n.id + ')"><button class="delete-btn" onclick="event.stopPropagation();deleteNote(' + n.id + ')">×</button><h3 style="color:' + n.color + '">' + escapeHtml(n.title) + '</h3><p>' + escapeHtml(n.content) + '</p><div class="meta">' + date + '</div></div>';
      }).join('');
      empty.style.display = filtered.length ? 'none' : 'block';
    }

    function escapeHtml(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); openModal(); }
    });

    render();
  </script>
</body>
</html>`;
  }

  if (lower.includes("pomodoro") || lower.includes("timer") || lower.includes("đếm giờ") || lower.includes("hẹn giờ")) {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pomodoro Timer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f11; color: #e4e4e7; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .timer { text-align: center; }
    .circle { position: relative; width: 280px; height: 280px; margin: 0 auto 40px; }
    .circle svg { transform: rotate(-90deg); }
    .circle .bg { fill: none; stroke: #27272a; stroke-width: 8; }
    .circle .progress { fill: none; stroke: #ef4444; stroke-width: 8; stroke-linecap: round; transition: stroke-dashoffset 1s linear; }
    .circle .time { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .circle .time span { font-size: 64px; font-weight: 200; letter-spacing: -2px; font-variant-numeric: tabular-nums; }
    .circle .time .session { font-size: 14px; color: #52525b; margin-top: 4px; }
    .controls { display: flex; gap: 12px; justify-content: center; }
    button { padding: 14px 32px; border-radius: 14px; border: none; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-family: inherit; }
    .btn-start { background: #ef4444; color: white; }
    .btn-start:hover { background: #dc2626; }
    .btn-pause { background: #f59e0b; color: #000; }
    .btn-pause:hover { background: #d97706; }
    .btn-reset { background: #27272a; color: #a1a1aa; border: 1px solid #3f3f46; }
    .btn-reset:hover { background: #333338; color: #e4e4e7; }
    .modes { display: flex; gap: 4px; background: #1a1a1e; border-radius: 14px; padding: 4px; margin-bottom: 40px; border: 1px solid #27272a; }
    .mode { padding: 10px 24px; border-radius: 11px; border: none; background: none; color: #71717a; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s; font-family: inherit; }
    .mode.active { background: #27272a; color: #e4e4e7; }
    .sessions { margin-top: 32px; display: flex; gap: 8px; justify-content: center; }
    .sessions span { width: 10px; height: 10px; border-radius: 50%; background: #27272a; }
    .sessions span.done { background: #ef4444; }
  </style>
</head>
<body>
  <div class="timer">
    <div class="modes">
      <button class="mode active" data-mode="pomodoro" onclick="setMode('pomodoro')">Pomodoro</button>
      <button class="mode" data-mode="short" onclick="setMode('short')">Nghỉ ngắn</button>
      <button class="mode" data-mode="long" onclick="setMode('long')">Nghỉ dài</button>
    </div>
    <div class="circle">
      <svg width="280" height="280" viewBox="0 0 280 280">
        <circle class="bg" cx="140" cy="140" r="124" />
        <circle class="progress" id="progressCircle" cx="140" cy="140" r="124" stroke-dasharray="779.12" stroke-dashoffset="0" />
      </svg>
      <div class="time">
        <div>
          <span id="timerDisplay">25:00</span>
          <div class="session" id="sessionLabel">Phiên 1 / 4</div>
        </div>
      </div>
    </div>
    <div class="controls">
      <button class="btn-start" id="startBtn" onclick="toggleTimer()">Bắt đầu</button>
      <button class="btn-reset" onclick="resetTimer()">Reset</button>
    </div>
    <div class="sessions" id="sessions">
      <span class="done"></span><span></span><span></span><span></span>
    </div>
  </div>
  <script>
    const TIMES = { pomodoro: 25 * 60, short: 5 * 60, long: 15 * 60 };
    let mode = 'pomodoro';
    let timeLeft = TIMES.pomodoro;
    let totalTime = TIMES.pomodoro;
    let interval = null;
    let running = false;
    let sessions = 1;

    function setMode(m) {
      if (running) return;
      mode = m; timeLeft = TIMES[m]; totalTime = TIMES[m];
      document.querySelectorAll('.mode').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
      updateDisplay();
    }

    function toggleTimer() {
      if (running) { clearInterval(interval); running = false; document.getElementById('startBtn').textContent = 'Tiếp tục'; document.getElementById('startBtn').className = 'btn-start'; return; }
      running = true;
      document.getElementById('startBtn').textContent = 'Tạm dừng';
      document.getElementById('startBtn').className = 'btn-pause';
      interval = setInterval(() => {
        timeLeft--;
        updateDisplay();
        if (timeLeft <= 0) { clearInterval(interval); running = false; notify(); nextSession(); }
      }, 1000);
    }

    function resetTimer() {
      clearInterval(interval); running = false;
      timeLeft = TIMES[mode]; totalTime = TIMES[mode];
      document.getElementById('startBtn').textContent = 'Bắt đầu';
      document.getElementById('startBtn').className = 'btn-start';
      updateDisplay();
    }

    function nextSession() {
      const modes = ['pomodoro','short','pomodoro','short','pomodoro','short','pomodoro','long'];
      const idx = Math.min(sessions * 2 - 2 + (mode === 'pomodoro' ? 0 : 1), modes.length - 1);
      if (mode === 'pomodoro') sessions++;
      mode = modes[idx];
      timeLeft = TIMES[mode]; totalTime = TIMES[mode];
      document.querySelectorAll('.mode').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
      updateDisplay();
    }

    function notify() {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Hết giờ!', { body: mode === 'pomodoro' ? 'Đến giờ nghỉ ngơi!' : 'Bắt đầu làm việc thôi!' });
      }
    }

    function updateDisplay() {
      const m = Math.floor(timeLeft / 60); const s = timeLeft % 60;
      document.getElementById('timerDisplay').textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
      const circumference = 2 * Math.PI * 124;
      const offset = circumference - (timeLeft / totalTime) * circumference;
      document.getElementById('progressCircle').style.strokeDasharray = circumference;
      document.getElementById('progressCircle').style.strokeDashoffset = offset;
      document.getElementById('sessionLabel').textContent = 'Phiên ' + Math.min(sessions, 4) + ' / 4';
      const dots = document.getElementById('sessions').children;
      for (let i = 0; i < 4; i++) dots[i].classList.toggle('done', i < sessions - 1);
    }

    if ('Notification' in window) Notification.requestPermission();
    updateDisplay();
  </script>
</body>
</html>`;
  }

  if (lower.includes("counter") || lower.includes("đếm") || lower.includes("bộ đếm")) {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Counter</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f11; color: #e4e4e7; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .counter { text-align: center; background: #1a1a1e; border-radius: 24px; padding: 48px; border: 1px solid #27272a; box-shadow: 0 25px 60px rgba(0,0,0,0.4); min-width: 320px; }
    h1 { font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #52525b; margin-bottom: 32px; }
    .number { font-size: 120px; font-weight: 200; letter-spacing: -4px; font-variant-numeric: tabular-nums; line-height: 1; margin-bottom: 40px; transition: color 0.3s; }
    .number.negative { color: #ef4444; }
    .number.zero { color: #71717a; }
    .number.positive { color: #22c55e; }
    .buttons { display: flex; gap: 16px; justify-content: center; }
    button { width: 64px; height: 64px; border-radius: 50%; border: 1px solid #27272a; background: #27272a; color: #e4e4e7; font-size: 28px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
    button:hover { background: #333338; border-color: #52525b; }
    button:active { transform: scale(0.95); }
    button.decrement:hover { border-color: #ef4444; color: #ef4444; }
    button.increment:hover { border-color: #22c55e; color: #22c55e; }
    button.reset { width: auto; padding: 0 24px; border-radius: 32px; font-size: 14px; }
    .step { display: flex; gap: 10px; justify-content: center; margin-top: 24px; }
    .step button { width: 36px; height: 36px; font-size: 12px; color: #52525b; }
    .step button.active { color: #22c55e; border-color: #22c55e40; }
  </style>
</head>
<body>
  <div class="counter">
    <h1>Bộ đếm</h1>
    <div class="number zero" id="display">0</div>
    <div class="buttons">
      <button class="decrement" onclick="change(-step)">−</button>
      <button class="reset" onclick="reset()">Reset</button>
      <button class="increment" onclick="change(step)">+</button>
    </div>
    <div class="step">
      <button class="active" onclick="setStep(1)">1</button>
      <button onclick="setStep(5)">5</button>
      <button onclick="setStep(10)">10</button>
    </div>
  </div>
  <script>
    let count = parseInt(localStorage.getItem('counter') || '0');
    let step = parseInt(localStorage.getItem('counterStep') || '1');
    function update() {
      const d = document.getElementById('display');
      d.textContent = count;
      d.className = 'number ' + (count > 0 ? 'positive' : count < 0 ? 'negative' : 'zero');
      localStorage.setItem('counter', count);
    }
    function change(s) { count += s; update(); }
    function reset() { count = 0; update(); }
    function setStep(s) { step = s; localStorage.setItem('counterStep', s); document.querySelectorAll('.step button').forEach(b => b.classList.toggle('active', parseInt(b.textContent) === s)); }
    document.addEventListener('keydown', e => { if (e.key === 'ArrowUp') change(step); if (e.key === 'ArrowDown') change(-step); if (e.key === 'r') reset(); });
    update();
  </script>
</body>
</html>`;
  }

  if (lower.includes("weather") || lower.includes("thời tiết")) {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weather App</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 50%, #0c0a20 100%); color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .weather { width: 100%; max-width: 420px; }
    .search { display: flex; gap: 10px; margin-bottom: 24px; }
    .search input { flex:1; padding: 14px 20px; border-radius: 16px; border: 1px solid #1e293b; background: #1e293b80; color: #e2e8f0; font-size: 15px; outline: none; backdrop-filter: blur(10px); transition: border-color 0.2s; font-family: inherit; }
    .search input::placeholder { color: #64748b; }
    .search input:focus { border-color: #6366f1; }
    .search button { padding: 14px 20px; border-radius: 16px; border: none; background: #6366f1; color: white; font-weight: 600; cursor: pointer; transition: background 0.2s; font-family: inherit; }
    .search button:hover { background: #4f46e5; }
    .card { background: #1e293b60; border-radius: 24px; padding: 32px; backdrop-filter: blur(20px); border: 1px solid #1e293b; text-align: center; }
    .card .city { font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 2px; }
    .card .temp { font-size: 80px; font-weight: 200; letter-spacing: -3px; margin: 12px 0; }
    .card .desc { font-size: 18px; color: #94a3b8; text-transform: capitalize; }
    .card .details { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 32px; padding-top: 24px; border-top: 1px solid #1e293b; }
    .card .details div { text-align: center; }
    .card .details .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    .card .details .value { font-size: 18px; font-weight: 500; }
    .icon { font-size: 48px; margin-bottom: 8px; }
    .loading { text-align: center; color: #64748b; }
  </style>
</head>
<body>
  <div class="weather">
    <div class="search">
      <input type="text" id="cityInput" placeholder="Nhập tên thành phố..." onkeydown="if(event.key==='Enter')search()">
      <button onclick="search()">Tìm</button>
    </div>
    <div class="card" id="weatherCard" style="display:none">
      <div class="icon" id="weatherIcon"></div>
      <div class="temp" id="temp"></div>
      <div class="desc" id="desc"></div>
      <div class="city" id="city"></div>
      <div class="details">
        <div><div class="label">Độ ẩm</div><div class="value" id="humidity"></div></div>
        <div><div class="label">Gió</div><div class="value" id="wind"></div></div>
        <div><div class="label">Cảm giác</div><div class="value" id="feels"></div></div>
      </div>
    </div>
    <p class="loading" id="loading" style="display:none">Đang tìm...</p>
    <p class="loading" id="error" style="display:none;color:#ef4444"></p>
  </div>
  <script>
    const API_KEY = '9fd7a449d055f3d933a1e2cdb628ec73';
    function search() {
      const city = document.getElementById('cityInput').value.trim();
      if (!city) return;
      document.getElementById('loading').style.display = 'block';
      document.getElementById('weatherCard').style.display = 'none';
      document.getElementById('error').style.display = 'none';
      fetch('https://api.openweathermap.org/data/2.5/weather?q=' + encodeURIComponent(city) + '&appid=' + API_KEY + '&units=metric&lang=vi')
        .then(r => { if (!r.ok) throw new Error('Không tìm thấy thành phố'); return r.json(); })
        .then(d => {
          document.getElementById('city').textContent = d.name + ', ' + d.sys.country;
          document.getElementById('temp').textContent = Math.round(d.main.temp) + '°C';
          document.getElementById('desc').textContent = d.weather[0].description;
          document.getElementById('humidity').textContent = d.main.humidity + '%';
          document.getElementById('wind').textContent = d.wind.speed + ' m/s';
          document.getElementById('feels').textContent = Math.round(d.main.feels_like) + '°C';
          document.getElementById('weatherCard').style.display = 'block';
          const icons = { 'Clear':'☀️', 'Clouds':'☁️', 'Rain':'🌧️', 'Drizzle':'🌦️', 'Thunderstorm':'⛈️', 'Snow':'🌨️', 'Mist':'🌫️', 'Fog':'🌫️' };
          document.getElementById('weatherIcon').textContent = icons[d.weather[0].main] || '🌤️';
        })
        .catch(e => { document.getElementById('error').textContent = e.message; document.getElementById('error').style.display = 'block'; })
        .finally(() => { document.getElementById('loading').style.display = 'none'; });
    }
  </script>
</body>
</html>`;
  }

  if (lower.includes("color") || lower.includes("màu") || lower.includes("palette") || lower.includes("bảng màu")) {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Color Palette Generator</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f11; color: #e4e4e7; min-height: 100vh; }
    .app { max-width: 900px; margin: 0 auto; padding: 40px 20px; }
    h1 { text-align: center; font-size: 28px; font-weight: 700; margin-bottom: 8px; letter-spacing: -0.5px; }
    h1 span { color: #a855f7; }
    .subtitle { text-align: center; color: #52525b; font-size: 14px; margin-bottom: 32px; }
    .controls { display: flex; gap: 12px; justify-content: center; margin-bottom: 32px; flex-wrap: wrap; }
    .controls button { padding: 10px 24px; border-radius: 12px; border: 1px solid #27272a; background: #1a1a1e; color: #a1a1aa; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s; font-family: inherit; }
    .controls button:hover { background: #27272a; color: #e4e4e7; border-color: #3f3f46; }
    .controls button.active { background: #a855f7; color: white; border-color: #a855f7; }
    .palette { display: grid; grid-template-columns: repeat(5, 1fr); border-radius: 20px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.4); margin-bottom: 32px; border: 1px solid #27272a; }
    .color { height: 200px; cursor: pointer; position: relative; transition: all 0.2s; display: flex; align-items: flex-end; justify-content: center; padding: 16px; }
    .color:hover { transform: scale(1.05); z-index: 10; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border-radius: 12px; }
    .color span { background: #00000060; backdrop-filter: blur(8px); color: white; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; font-family: 'SF Mono', 'Fira Code', monospace; letter-spacing: 0.5px; }
    .copied-toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #22c55e; color: #000; padding: 10px 24px; border-radius: 12px; font-weight: 600; font-size: 14px; z-index: 100; animation: fadeInOut 1.5s ease forwards; }
    @keyframes fadeInOut { 0% { opacity: 0; transform: translateX(-50%) translateY(-10px); } 15% { opacity: 1; transform: translateX(-50%) translateY(0); } 85% { opacity: 1; } 100% { opacity: 0; } }
    .saved { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    .saved .mini { display: flex; height: 40px; border-radius: 10px; overflow: hidden; cursor: pointer; transition: transform 0.2s; border: 1px solid #27272a; }
    .saved .mini:hover { transform: scale(1.03); }
    .saved .mini div { flex: 1; }
    .section-title { font-size: 14px; color: #52525b; margin-bottom: 12px; font-weight: 600; }
    .lock-btn { position: absolute; top: 10px; right: 10px; font-size: 14px; background: #00000050; border: none; color: white; cursor: pointer; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); opacity: 0; transition: opacity 0.2s; }
    .color:hover .lock-btn { opacity: 1; }
  </style>
</head>
<body>
  <div class="app">
    <h1>🎨 <span>Color</span> Palette</h1>
    <p class="subtitle">Nhấn Space để tạo bảng màu mới. Click vào màu để copy.</p>
    <div class="controls">
      <button class="active" onclick="grabPalette()" id="regenerateBtn">Ngẫu nhiên</button>
      <button onclick="generateFromBase()" id="fromBaseBtn">Từ màu gốc</button>
      <button onclick="savePalette()">Lưu palette</button>
    </div>
    <div class="palette" id="palette"></div>
    <div id="toastContainer"></div>
    <div class="section-title">Palette đã lưu</div>
    <div class="saved" id="saved"></div>
  </div>
  <script>
    let currentPalette = [];
    let locked = Array(5).fill(false);
    let savedPalettes = JSON.parse(localStorage.getItem('savedPalettes') || '[]');

    randomPalette();

    function randomColor() { const h = Math.floor(Math.random() * 360); const s = 40 + Math.floor(Math.random() * 40); const l = 35 + Math.floor(Math.random() * 30); return 'hsl('+h+','+s+'%,'+l+'%)'; }

    function complementary(h) { return 'hsl('+((h+180)%360)+',50%,45%)'; }
    function analogous(h, offset) { return 'hsl('+((h+offset+360)%360)+',50%,45%)'; }
    function triadic(h, idx) { return 'hsl('+((h+idx*120)%360)+',50%,45%)'; }

    function generatePalette(type) {
      const baseH = Math.floor(Math.random() * 360);
      const baseS = 40 + Math.floor(Math.random() * 40);
      const baseL = 35 + Math.floor(Math.random() * 30);
      const base = 'hsl('+baseH+','+baseS+'%,'+baseL+'%)';

      let colors;
      if (type === 'analogous') colors = [analogous(baseH, -40), analogous(baseH, -20), base, analogous(baseH, 20), analogous(baseH, 40)];
      else if (type === 'triadic') colors = [triadic(baseH, 0), base, triadic(baseH, 1), complementary(baseH), triadic(baseH, 2)];
      else if (type === 'mono') { let l = baseL; colors = []; for (let i = -2; i <= 2; i++) colors.push('hsl('+baseH+','+baseS+'%,'+Math.max(10,Math.min(90,l+i*15))+'%)'); }
      else colors = [randomColor(), randomColor(), randomColor(), randomColor(), randomColor()];

      for (let i = 0; i < 5; i++) { if (locked[i]) colors[i] = currentPalette[i]; }
      currentPalette = colors;
      render();
    }

    function grabPalette() { generatePalette('random'); }
    function generateFromBase() { const types = ['analogous','triadic','mono']; generatePalette(types[Math.floor(Math.random()*3)]); }

    function render() {
      document.getElementById('palette').innerHTML = currentPalette.map((c,i) =>
        '<div class="color" style="background:'+c+'" onclick="copyColor(\''+c+'\')"><button class="lock-btn" onclick="event.stopPropagation();toggleLock('+i+')">'+(locked[i]?'🔒':'🔓')+'</button><span>'+hslToHex(c)+'</span></div>'
      ).join('');
      renderSaved();
    }

    function toggleLock(i) { locked[i] = !locked[i]; render(); }

    function copyColor(color) {
      const hex = hslToHex(color);
      navigator.clipboard.writeText(hex);
      const toast = document.createElement('div');
      toast.className = 'copied-toast';
      toast.textContent = 'Đã copy ' + hex;
      document.getElementById('toastContainer').appendChild(toast);
      setTimeout(() => toast.remove(), 1500);
    }

    function savePalette() { savedPalettes.push([...currentPalette]); if (savedPalettes.length > 20) savedPalettes.shift(); localStorage.setItem('savedPalettes', JSON.stringify(savedPalettes)); renderSaved(); }

    function renderSaved() {
      document.getElementById('saved').innerHTML = savedPalettes.map(p =>
        '<div class="mini" onclick="loadPalette(\''+JSON.stringify(p)+'\')">'+p.map(c=>'<div style="background:'+c+'"></div>').join('')+'</div>'
      ).join('');
    }

    function loadPalette(json) { currentPalette = JSON.parse(json); locked = Array(5).fill(false); render(); }

    function hslToHex(color) {
      const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
      if (!match) return color;
      let h = parseInt(match[1]) / 360, s = parseInt(match[2]) / 100, l = parseInt(match[3]) / 100;
      let r,g,b;
      if (s===0) r=g=b=l;
      else {
        const hue2rgb = (p,q,t) => { if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
        const q = l < 0.5 ? l*(1+s) : l+s-l*s;
        const p = 2*l - q;
        r = hue2rgb(p,q,h+1/3); g = hue2rgb(p,q,h); b = hue2rgb(p,q,h-1/3);
      }
      return '#'+[r,g,b].map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('').toUpperCase();
    }

    document.addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); grabPalette(); } });
    randomPalette();
    function randomPalette() { grabPalette(); }
  </script>
</body>
</html>`;
  }

  // Default: generic app based on description
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f11; color: #e4e4e7; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .app { text-align: center; background: #1a1a1e; border-radius: 24px; padding: 48px; border: 1px solid #27272a; box-shadow: 0 25px 60px rgba(0,0,0,0.4); max-width: 500px; width: 100%; }
    h1 { font-size: 24px; font-weight: 600; margin-bottom: 8px; }
    p { color: #52525b; margin-bottom: 24px; }
    button { padding: 12px 28px; border-radius: 12px; background: #3b82f6; color: white; border: none; font-weight: 600; font-size: 14px; cursor: pointer; transition: background 0.2s; font-family: inherit; }
    button:hover { background: #2563eb; }
    input { padding: 12px 16px; border-radius: 12px; border: 1px solid #27272a; background: #27272a; color: #e4e4e7; font-size: 15px; width: 100%; margin-bottom: 16px; outline: none; font-family: inherit; }
    input:focus { border-color: #3b82f6; }
    .result { margin-top: 20px; padding: 16px; background: #27272a; border-radius: 12px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="app">
    <h1>🛠️ App của bạn</h1>
    <p>${prompt.length > 120 ? prompt.slice(0, 120) + '...' : prompt}</p>
    <p style="color:#52525b;font-size:13px">Đây là bản xem trước. Kết nối API AI để tạo app mạnh mẽ hơn.</p>
  </div>
</body>
</html>`;
}

function chunkHtml(html: string, chunkSize: number = 80): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < html.length; i += chunkSize) {
    chunks.push(html.slice(i, i + chunkSize));
  }
  return chunks;
}

export async function POST(req: NextRequest) {
  try {
    let session;
    try { session = await requireSession(); } catch { return authError(); }
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Vui lòng nhập mô tả app" }, { status: 400 });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (apiKey) {
      try {
        const openai = new OpenAI({
          apiKey,
          baseURL: "https://api.deepseek.com/v1",
        });

        const stream = await openai.chat.completions.create({
          model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 16000,
          stream: true,
        });

        const encoder = new TextEncoder();

        const readable = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || "";
                if (content) {
                  controller.enqueue(encoder.encode(content));
                }
              }
              controller.close();
            } catch (e) {
              controller.close();
            }
          },
        });

        return new Response(readable, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (err: any) {
        console.error("DeepSeek error:", err.message);
      }
    }

    const html = fallbackGenerate(prompt);
    const chunkSize = Math.max(20, Math.floor(html.length / 50));
    const chunks = chunkHtml(html, chunkSize);
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
          await new Promise((r) => setTimeout(r, 15));
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
