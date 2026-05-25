// Mode registry: each entry tells the AI pipeline how to specialize generation
// for a particular kind of app. Adding a new mode = appending one entry here
// + adding i18n keys; nothing else needs to be touched in routes.
//
// systemHints is APPENDED to the base system prompt (NEW_APP_PROMPT for /api/chat,
// AGENT_SYSTEM_PROMPT for /api/edit) — keep it short (~200-400 chars) so it
// doesn't displace too much of the prefix-cached prelude.
//
// template (5/6 modes) is a complete HTML scaffold with {{PLACEHOLDER}} tokens
// and `LLM_FILL` comment blocks. /api/chat sends it to the model and asks it to
// fill placeholders only — saves ~50-60% of completion tokens vs writing the
// whole file from scratch. web_app has no template (truly generic).

import { t } from "./i18n";

export type ModeId =
  | "web_app"
  | "qr_menu"
  | "wedding"
  | "landing"
  | "pitch_deck"
  | "cv_resume";

type LabelKey = keyof typeof t.vi;

export interface ModeDef {
  id: ModeId;
  emoji: string;
  labelKey: LabelKey;
  descKey: LabelKey;
  systemHints: string;
  template?: string;
  // Vietnamese + English keywords used by the classifier's keyword
  // short-circuit (skip the LLM call when match ≥ 2).
  keywords: string[];
  // JustVibe runtime capabilities the template wants pre-loaded. For
  // template-mode generation we skip the LLM capability classifier (the
  // template's needs are well-known up-front) and just inject these docs.
  // Empty = static template (CV / wedding invite — no jv.* helpers).
  capabilities?: import("./jv-capabilities").CapabilityName[];
}

export const DEFAULT_MODE: ModeId = "web_app";

// === SYSTEM HINTS per mode ===

const HINTS_QR_MENU = `
## MODE: QR menu (F&B)
- Layout mobile-first, single column < 768px, card-based items.
- Each item: name + short description + VND price (format like "35.000đ").
- Group items into category sections with clear headers.
- Include a "Đặt qua Zalo" sticky button linking to https://zalo.me/<phone>.
- If the user mentions specific dishes, use them; otherwise pick 6-12 realistic Vietnamese F&B items matching the venue type.
- No login, no cart persistence — cart state in memory only.`.trim();

const HINTS_WEDDING = `
## MODE: Wedding invitation
- Layout: hero with couple names + date, countdown timer to the date, RSVP form (in-memory only, shows "Cảm ơn!" on submit), photo gallery grid, schedule, map placeholder (iframe src placeholder).
- Tone: warm, elegant. Default palette pastel (rose/cream/sage) unless user specifies.
- Vietnamese copy: "Trân trọng kính mời", "Lễ thành hôn", "Vu quy", "Tân hôn".
- Smooth scroll between sections.`.trim();

const HINTS_LANDING = `
## MODE: Marketing landing page
- Sections in order: hero (headline + subhead + primary CTA), features (3-4 cards), social proof/testimonial, secondary CTA with email-capture form (in-memory, shows "Cảm ơn, sẽ liên hệ sớm" on submit), footer.
- Headline ≤ 12 words. Subhead ≤ 25 words. CTAs concrete verbs.
- Sticky header with logo + nav + CTA button.
- Smooth scroll, fade-in animations on scroll.`.trim();

const HINTS_PITCH_DECK = `
## MODE: Pitch deck (slide presentation)
- One container with N slides stacked; only one visible at a time.
- Keyboard: ArrowRight / Space → next, ArrowLeft → previous. Touch: swipe.
- Slide counter "n / total" bottom-right.
- Default slides: Title, Problem, Solution, Market, Product, Traction, Team, Ask. Adapt if user specifies different deck type.
- Slide layout: large title, short bullets (≤ 6 words each), supporting visual placeholder.
- Print-friendly: each slide = one A4 landscape page when printed.`.trim();

const HINTS_CV_RESUME = `
## MODE: CV / Resume
- Single page, print-optimized (A4). Black on white for print, can have accent color.
- Sections in order: header (name + title + contact icons), summary (2-3 lines), experience (reverse chronological), skills (grouped or tagged), education, optional projects/certifications.
- Header icons: email, phone, linkedin, github. Use SVG inline.
- Theme toggle (light/dark) for screen view; print uses light always (@media print).
- "Print to PDF" button calls window.print().`.trim();

// === HTML TEMPLATES per mode ===
// Conventions inside templates:
//   {{PLACEHOLDER}}  — single inline value the model substitutes
//   <!-- LLM_FILL: ... --> block the model expands into real HTML
// Keep templates compact; the model adds the rest.

const TEMPLATE_QR_MENU = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{RESTAURANT_NAME}}</title>
<style>
:root { --primary: {{COLOR_PRIMARY}}; --bg: {{COLOR_BG}}; --text: #1a1a1a; --muted: #6b7280; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);padding-bottom:80px}
header{padding:32px 20px;text-align:center;background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary) 70%,#000))}
header h1{color:#fff;font-size:28px;margin-bottom:4px}
header p{color:rgba(255,255,255,.85);font-size:14px}
main{max-width:600px;margin:0 auto;padding:20px}
.category{margin:32px 0 16px}
.category h2{font-size:20px;margin-bottom:12px;color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px}
.item{display:flex;justify-content:space-between;align-items:flex-start;padding:14px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-bottom:10px;gap:12px;cursor:pointer;transition:transform .15s}
.item:active{transform:scale(.98)}
.item h3{font-size:16px;margin-bottom:4px}
.item p{font-size:14px;color:var(--muted);margin-bottom:6px;line-height:1.4}
.item .price{color:var(--primary);font-weight:600;white-space:nowrap}
.order-btn{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--primary);color:#fff;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.2);display:flex;align-items:center;gap:8px}
.cart-count{background:rgba(255,255,255,.25);padding:2px 8px;border-radius:999px;font-size:13px}
</style>
</head>
<body>
<header>
<h1>{{RESTAURANT_NAME}}</h1>
<p>{{TAGLINE}}</p>
</header>
<main>
<!-- LLM_FILL: menu categories. Format:
  <section class="category">
    <h2>Category Name (vd: Cà phê, Trà sữa, Bánh ngọt)</h2>
    <div class="item" onclick="addToCart('Item Name', 35000)">
      <div><h3>Item Name</h3><p>Short description in Vietnamese</p></div>
      <span class="price">35.000đ</span>
    </div>
  </section>
6-12 items total across 2-4 categories. Use realistic Vietnamese F&B names + prices appropriate to {{RESTAURANT_NAME}}.
-->
</main>
<a href="https://zalo.me/{{ZALO_PHONE}}" class="order-btn">
  Đặt qua Zalo
  <span class="cart-count" id="cart-count" style="display:none">0</span>
</a>
<script>
let cart = [];
function addToCart(name, price) {
  cart.push({ name, price });
  const c = document.getElementById('cart-count');
  c.textContent = cart.length;
  c.style.display = 'inline-block';
}
</script>
</body>
</html>`;

const TEMPLATE_WEDDING = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{GROOM_NAME}} & {{BRIDE_NAME}}</title>
<style>
:root { --primary: {{COLOR_PRIMARY}}; --bg: {{COLOR_BG}}; --accent: {{COLOR_ACCENT}}; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Georgia,serif;background:var(--bg);color:#3a3a3a;line-height:1.6}
section{padding:60px 24px;text-align:center;max-width:720px;margin:0 auto}
.hero{min-height:90vh;display:flex;flex-direction:column;justify-content:center;background:linear-gradient(rgba(255,255,255,.6),rgba(255,255,255,.6)),{{HERO_BG}};background-size:cover;background-position:center}
.hero .label{font-size:14px;letter-spacing:4px;color:var(--primary);text-transform:uppercase;margin-bottom:16px}
.hero h1{font-family:'Playfair Display',Georgia,serif;font-size:52px;color:var(--primary);font-style:italic;margin-bottom:8px}
.hero .amp{font-size:32px;color:var(--accent);margin:8px 0}
.hero .date{font-size:18px;margin-top:24px;letter-spacing:2px}
.countdown{display:flex;justify-content:center;gap:16px;margin:32px 0}
.countdown div{background:#fff;padding:16px 12px;border-radius:8px;min-width:70px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.countdown .num{font-size:28px;font-weight:600;color:var(--primary);display:block}
.countdown .lbl{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888}
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:24px}
.gallery img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px}
form{display:flex;flex-direction:column;gap:12px;max-width:400px;margin:24px auto 0}
input,select,button{padding:14px;border:1px solid #ddd;border-radius:8px;font-size:16px;font-family:inherit;min-height:48px}
button{background:var(--primary);color:#fff;border:0;cursor:pointer;font-weight:600}
.section-title{font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:32px;color:var(--primary);margin-bottom:24px}
</style>
</head>
<body>
<section class="hero">
  <div class="label">Trân trọng kính mời</div>
  <h1>{{GROOM_NAME}}</h1>
  <div class="amp">&</div>
  <h1>{{BRIDE_NAME}}</h1>
  <div class="date">{{WEDDING_DATE_TEXT}}</div>
  <div class="countdown" id="countdown" data-target="{{WEDDING_DATE_ISO}}">
    <div><span class="num" id="cd-d">0</span><span class="lbl">Ngày</span></div>
    <div><span class="num" id="cd-h">0</span><span class="lbl">Giờ</span></div>
    <div><span class="num" id="cd-m">0</span><span class="lbl">Phút</span></div>
    <div><span class="num" id="cd-s">0</span><span class="lbl">Giây</span></div>
  </div>
</section>
<!-- LLM_FILL: 3-4 sections in order:
  1. story (love story 2-3 paragraphs)
  2. schedule (ceremony + reception times/venues)
  3. gallery (4-6 placeholder images: https://picsum.photos/seed/X/400)
  4. RSVP form — MUST use:
       <form action="/f/{{APP_ID}}/submit" method="POST">
         <input name="name" placeholder="Họ tên" required>
         <input name="guests" type="number" min="1" placeholder="Số người" required>
         <textarea name="message" placeholder="Lời chúc"></textarea>
         <button type="submit">Xác nhận tham dự</button>
       </form>
     The {{APP_ID}} stays literal — server substitutes it.
  Each section starts with <section><h2 class="section-title">...</h2>...</section>.
-->
<section style="text-align:center;color:#888;padding-bottom:24px">Với sự yêu thương từ {{GROOM_NAME}} & {{BRIDE_NAME}}</section>
<script>
const target = new Date(document.getElementById('countdown').dataset.target).getTime();
function tick() {
  const diff = target - Date.now();
  if (diff < 0) return;
  document.getElementById('cd-d').textContent = Math.floor(diff/86400000);
  document.getElementById('cd-h').textContent = Math.floor(diff%86400000/3600000);
  document.getElementById('cd-m').textContent = Math.floor(diff%3600000/60000);
  document.getElementById('cd-s').textContent = Math.floor(diff%60000/1000);
}
tick(); setInterval(tick, 1000);
</script>
</body>
</html>`;

const TEMPLATE_LANDING = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{PRODUCT_NAME}}</title>
<style>
:root { --primary: {{COLOR_PRIMARY}}; --bg: #fff; --text: #0a0a0a; --muted: #666; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
header.nav{position:sticky;top:0;background:rgba(255,255,255,.92);backdrop-filter:blur(10px);padding:16px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #eee;z-index:100}
.nav .logo{font-weight:700;font-size:18px}
.nav .nav-cta{background:var(--primary);color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500}
section{padding:80px 24px;max-width:1100px;margin:0 auto}
.hero{text-align:center;padding-top:100px;padding-bottom:100px}
.hero .tag{display:inline-block;background:color-mix(in srgb,var(--primary) 12%,transparent);color:var(--primary);padding:6px 14px;border-radius:999px;font-size:13px;font-weight:500;margin-bottom:24px}
.hero h1{font-size:clamp(36px,6vw,64px);font-weight:800;letter-spacing:-.02em;line-height:1.1;margin-bottom:20px}
.hero .sub{font-size:20px;color:var(--muted);max-width:600px;margin:0 auto 32px}
.btn{display:inline-block;background:var(--primary);color:#fff;padding:16px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;border:0;cursor:pointer}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px;margin-top:48px}
.feature{padding:28px;border:1px solid #eee;border-radius:12px}
.feature .icon{font-size:28px;margin-bottom:12px}
.feature h3{font-size:18px;margin-bottom:8px}
.feature p{color:var(--muted);font-size:15px}
.section-title{text-align:center;font-size:36px;font-weight:700;margin-bottom:16px}
.section-sub{text-align:center;color:var(--muted);margin-bottom:48px}
.cta-section{background:var(--primary);color:#fff;border-radius:20px;padding:60px 32px;text-align:center}
.cta-section h2{font-size:32px;margin-bottom:12px;color:#fff}
.cta-section p{opacity:.9;margin-bottom:24px}
.cta-form{display:flex;gap:8px;max-width:440px;margin:0 auto;flex-wrap:wrap;justify-content:center}
.cta-form input{flex:1;min-width:200px;padding:14px 16px;border:0;border-radius:8px;font-size:16px;min-height:48px}
.cta-form button{background:#000;color:#fff;border:0;padding:14px 24px;border-radius:8px;font-weight:600;cursor:pointer;font-size:16px;min-height:48px}
footer{text-align:center;color:var(--muted);padding:32px 24px;border-top:1px solid #eee;font-size:14px}
</style>
</head>
<body>
<header class="nav">
  <div class="logo">{{PRODUCT_NAME}}</div>
  <a href="#cta" class="nav-cta">{{CTA_TEXT}}</a>
</header>
<section class="hero">
  <div class="tag">{{TAG_LINE}}</div>
  <h1>{{HEADLINE}}</h1>
  <p class="sub">{{SUBHEAD}}</p>
  <a href="#cta" class="btn">{{CTA_TEXT}}</a>
</section>
<!-- LLM_FILL: in this order:
  1. Features section: <section><h2 class="section-title">Tính năng nổi bật</h2><p class="section-sub">...</p><div class="features"> 3 .feature divs with icon (emoji), h3, p </div></section>
  2. Social proof: <section style="text-align:center"><h2 class="section-title">Khách hàng nói gì</h2> 1-2 testimonial blockquotes with author name & company.
  3. (Optional) Pricing or how-it-works if relevant to {{PRODUCT_NAME}}.
Use Vietnamese copy. Keep concise. Match tone of {{PRODUCT_NAME}}.
-->
<section id="cta">
  <div class="cta-section">
    <h2>{{CTA_HEADLINE}}</h2>
    <p>{{CTA_SUB}}</p>
    <form class="cta-form" action="/f/{{APP_ID}}/submit" method="POST">
      <input type="email" name="email" placeholder="Email của bạn" required>
      <button type="submit">{{CTA_TEXT}}</button>
    </form>
  </div>
</section>
<footer>© 2026 {{PRODUCT_NAME}}. {{FOOTER_NOTE}}</footer>
</body>
</html>`;

const TEMPLATE_PITCH_DECK = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{DECK_TITLE}}</title>
<style>
:root { --primary: {{COLOR_PRIMARY}}; --bg: {{COLOR_BG}}; --text: #f0f0f0; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);overflow:hidden;height:100vh}
.slide{display:none;height:100vh;padding:8vh 8vw;flex-direction:column;justify-content:center;animation:fade .35s ease}
.slide.active{display:flex}
.slide h1{font-size:clamp(40px,7vw,80px);font-weight:800;letter-spacing:-.02em;margin-bottom:16px;line-height:1.1}
.slide h2{font-size:clamp(24px,4vw,42px);color:var(--primary);margin-bottom:32px;font-weight:600}
.slide ul{font-size:clamp(18px,2.2vw,28px);line-height:1.7;list-style:none;padding:0}
.slide li{padding:8px 0;padding-left:32px;position:relative}
.slide li::before{content:'→';color:var(--primary);position:absolute;left:0;font-weight:700}
.slide.center{text-align:center;align-items:center;justify-content:center}
.slide .big-num{font-size:clamp(80px,15vw,180px);font-weight:800;color:var(--primary);line-height:1}
.slide .label{font-size:clamp(20px,3vw,32px);color:#aaa;margin-top:16px}
.counter{position:fixed;bottom:16px;right:24px;font-size:14px;color:#888}
.hint{position:fixed;bottom:16px;left:24px;font-size:13px;color:#555}
@keyframes fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media print { .slide { display:flex; page-break-after:always; height:100vh; } .counter, .hint { display:none } }
</style>
</head>
<body>
<!-- LLM_FILL: 6-9 slides as <div class="slide">. First should be:
  <div class="slide center active"><h1>{{DECK_TITLE}}</h1><p class="label">{{PRESENTER}}</p></div>
Subsequent slides typically: Problem, Solution, Market (use .big-num for stat), Product (.slide with bulleted features), Traction, Team, Ask. Tailor to whatever deck the user describes. Each slide one strong headline + ≤6 short bullets OR one big number + caption. Class="active" only on first slide.
-->
<div class="counter"><span id="cur">1</span> / <span id="tot">1</span></div>
<div class="hint">← → để chuyển slide</div>
<script>
const slides = document.querySelectorAll('.slide');
let idx = 0;
document.getElementById('tot').textContent = slides.length;
function show(i) {
  slides.forEach((s, n) => s.classList.toggle('active', n === i));
  document.getElementById('cur').textContent = i + 1;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ') { idx = Math.min(idx + 1, slides.length - 1); show(idx); }
  if (e.key === 'ArrowLeft') { idx = Math.max(idx - 1, 0); show(idx); }
});
let touchX = 0;
document.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX });
document.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - touchX;
  if (dx < -50) { idx = Math.min(idx + 1, slides.length - 1); show(idx); }
  if (dx > 50) { idx = Math.max(idx - 1, 0); show(idx); }
});
</script>
</body>
</html>`;

const TEMPLATE_CV_RESUME = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{FULL_NAME}} — CV</title>
<style>
:root { --primary: {{COLOR_PRIMARY}}; --bg: #fff; --text: #1a1a1a; --muted: #6b7280; --border: #e5e7eb; }
[data-theme="dark"] { --bg: #0a0a0a; --text: #f0f0f0; --muted: #9ca3af; --border: #2a2a2a; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);line-height:1.6;padding:24px}
main{max-width:820px;margin:0 auto;padding:48px;border:1px solid var(--border);border-radius:12px}
header.top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:24px;border-bottom:2px solid var(--primary)}
.name{font-size:32px;font-weight:700;margin-bottom:4px}
.title{font-size:18px;color:var(--primary);margin-bottom:12px}
.contact{display:flex;gap:16px;flex-wrap:wrap;font-size:14px;color:var(--muted)}
.contact span{display:flex;align-items:center;gap:6px}
.controls{display:flex;gap:8px}
.controls button{background:transparent;border:1px solid var(--border);color:var(--text);padding:12px 18px;border-radius:8px;cursor:pointer;font-size:14px;min-height:44px}
.controls button:hover{background:var(--primary);color:#fff;border-color:var(--primary)}
section.cv{margin-top:28px}
section.cv > h2{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--primary);margin-bottom:14px}
.entry{margin-bottom:18px}
.entry-head{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:4px}
.entry .role{font-weight:600;font-size:16px}
.entry .org{color:var(--muted);font-size:14px}
.entry .when{color:var(--muted);font-size:14px;white-space:nowrap}
.entry p, .entry ul{font-size:14px;color:var(--text);margin-top:6px}
.entry ul{padding-left:20px}
.skills{display:flex;flex-wrap:wrap;gap:8px}
.skills .skill{background:color-mix(in srgb,var(--primary) 10%,transparent);color:var(--primary);padding:6px 12px;border-radius:6px;font-size:13px;font-weight:500}
@media print { body{padding:0} main{border:0;padding:24px} .controls{display:none} [data-theme]{--bg:#fff;--text:#000;--muted:#444;--border:#ccc} }
</style>
</head>
<body>
<main>
<header class="top">
  <div>
    <div class="name">{{FULL_NAME}}</div>
    <div class="title">{{JOB_TITLE}}</div>
    <div class="contact">
      <span>✉ {{EMAIL}}</span>
      <span>☎ {{PHONE}}</span>
      <span>📍 {{LOCATION}}</span>
      <span>🔗 {{LINKEDIN}}</span>
    </div>
  </div>
  <div class="controls">
    <button onclick="document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'">Theme</button>
    <button onclick="window.print()">In PDF</button>
  </div>
</header>
<section class="cv">
  <h2>Giới thiệu</h2>
  <p>{{SUMMARY}}</p>
</section>
<!-- LLM_FILL: in this order (or matching user's request):
  - Experience: <section class="cv"><h2>Kinh nghiệm</h2> with multiple .entry divs (reverse chronological), each has .entry-head (.role + .org on left, .when on right) + bulleted achievements.
  - Skills: <section class="cv"><h2>Kỹ năng</h2><div class="skills"> N .skill spans with technology names.
  - Education: <section class="cv"><h2>Học vấn</h2> with .entry blocks (degree + school + year).
  - (Optional) Projects, Certifications, Languages if mentioned.
Match tone + level to {{JOB_TITLE}} (vd: senior dev → 3-5 jobs, 5-8 skills per group).
-->
</main>
</body>
</html>`;

// === REGISTRY ===

export const APP_MODES: Record<ModeId, ModeDef> = {
  web_app: {
    id: "web_app",
    emoji: "🌐",
    labelKey: "modeWebApp",
    descKey: "modeWebAppDesc",
    systemHints: "",
    keywords: ["app", "tool", "calculator", "todo", "tracker", "công cụ", "ứng dụng", "máy tính"],
  },
  // Per-mode capabilities are now MAXIMALLY INCLUSIVE within reason: each
  // template gets every cap it could plausibly use, even if the user didn't
  // explicitly ask. User preference: "cần gì là cho hết luôn đỡ phải hỏi" —
  // don't make the AI pick a subset, just give templates everything the niche
  // typically wants. Trade-off is +500-1500 prompt tokens per template gen;
  // upside is the gen always has the right helper available so users don't
  // hit "AI didn't include X" mid-edit.
  qr_menu: {
    id: "qr_menu",
    emoji: "🍽",
    labelKey: "modeQrMenu",
    descKey: "modeQrMenuDesc",
    systemHints: HINTS_QR_MENU,
    template: TEMPLATE_QR_MENU,
    keywords: ["menu", "thực đơn", "quán", "cafe", "cà phê", "nhà hàng", "restaurant", "đồ ăn", "đồ uống", "F&B", "trà sữa"],
    // Menu items + prices in jv.db; order/booking form; real food photos
    // uploaded by owner; QR pay for table deposit / online order.
    capabilities: ["forms", "db", "files", "payment"],
  },
  wedding: {
    id: "wedding",
    emoji: "💍",
    labelKey: "modeWedding",
    descKey: "modeWeddingDesc",
    systemHints: HINTS_WEDDING,
    template: TEMPLATE_WEDDING,
    keywords: ["cưới", "thiệp cưới", "thiệp mời", "đám cưới", "lễ cưới", "wedding", "vu quy", "tân hôn", "mời cưới"],
    // RSVP form, couple/family photo gallery, mừng cưới QR.
    capabilities: ["forms", "files", "payment"],
  },
  landing: {
    id: "landing",
    emoji: "🚀",
    labelKey: "modeLanding",
    descKey: "modeLandingDesc",
    systemHints: HINTS_LANDING,
    template: TEMPLATE_LANDING,
    keywords: ["landing", "landing page", "trang chủ", "marketing", "lead", "thu lead", "ra mắt", "giới thiệu sản phẩm", "khóa học"],
    // Lead capture form, hero/product photos, optional course-fee payment.
    capabilities: ["forms", "files", "payment"],
  },
  pitch_deck: {
    id: "pitch_deck",
    emoji: "📊",
    labelKey: "modePitchDeck",
    descKey: "modePitchDeckDesc",
    systemHints: HINTS_PITCH_DECK,
    template: TEMPLATE_PITCH_DECK,
    keywords: ["pitch", "deck", "slide", "thuyết trình", "presentation", "gọi vốn", "seed round", "investor"],
    // Slides may want logos / team photos, but rarely anything else.
    capabilities: ["files"],
  },
  cv_resume: {
    id: "cv_resume",
    emoji: "📄",
    labelKey: "modeCvResume",
    descKey: "modeCvResumeDesc",
    systemHints: HINTS_CV_RESUME,
    template: TEMPLATE_CV_RESUME,
    keywords: ["cv", "resume", "hồ sơ", "portfolio", "lý lịch", "xin việc", "ứng tuyển"],
    // Real avatar upload + portfolio sample images.
    capabilities: ["files"],
  },
};

export function isValidModeId(value: unknown): value is ModeId {
  return typeof value === "string" && value in APP_MODES;
}

export function modeOf(id: unknown): ModeId {
  return isValidModeId(id) ? id : DEFAULT_MODE;
}
