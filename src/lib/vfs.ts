interface VirtualFiles {
  [path: string]: string;
}

export function parseHtmlToFiles(html: string): VirtualFiles {
  const files: VirtualFiles = {};

  // Extract inline <style> blocks → /style.css
  const styleMatches = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
  let styleCss = "";
  for (const m of styleMatches) {
    const content = m.replace(/<style[^>]*>/i, "").replace(/<\/style>/i, "");
    styleCss += content + "\n";
  }
  if (styleCss.trim()) {
    files["/style.css"] = styleCss.trim();
  }

  // Extract inline <script> blocks → /script.js
  const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  let scriptJs = "";
  for (const m of scriptMatches) {
    if (/src\s*=/i.test(m)) continue; // skip external scripts
    const content = m.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");
    scriptJs += content + "\n";
  }
  if (scriptJs.trim()) {
    files["/script.js"] = scriptJs.trim();
  }

  // Store the full HTML as canonical source
  files["/index.html"] = html;

  return files;
}

export function mergeFilesToHtml(files: VirtualFiles): string {
  const html = files["/index.html"];
  if (!html) return "";

  const styleCss = files["/style.css"];
  const scriptJs = files["/script.js"];

  let result = html;

  if (styleCss !== undefined) {
    const styleRegex = /<style[^>]*>[\s\S]*?<\/style>/gi;
    const replaced = result.replace(styleRegex, () => `<style>\n${styleCss}\n</style>`);
    if (replaced !== result) {
      result = replaced;
    } else if (/<\/head>/i.test(result)) {
      result = result.replace(/<\/head>/i, `<style>\n${styleCss}\n</style>\n</head>`);
    }
  }

  if (scriptJs !== undefined) {
    const scriptRegex = /<script(?!.*src\s*=)[^>]*>[\s\S]*?<\/script>/gi;
    const replaced = result.replace(scriptRegex, () => `<script>\n${scriptJs}\n</script>`);
    if (replaced !== result) {
      result = replaced;
    } else if (/<\/body>/i.test(result)) {
      result = result.replace(/<\/body>/i, `<script>\n${scriptJs}\n</script>\n</body>`);
    }
  }

  return result;
}

export function extractRelevantFiles(
  files: VirtualFiles,
  instruction: string
): { file: string; content: string }[] {
  const lower = instruction.toLowerCase();
  const relevant: { file: string; content: string }[] = [];

  // Always include a summary/toc
  relevant.push({
    file: "/FILES.txt",
    content: Object.entries(files)
      .map(([path, content]) => `${path} (${content.length} chars)`)
      .join("\n"),
  });

  // Check what the instruction relates to
  const styleKeywords = [
    "màu", "color", "style", "css", "dark", "light", "theme", "font",
    "size", "width", "height", "padding", "margin", "border", "background",
    "layout", "responsive", "mobile", "animation", "hover", "design",
    "đẹp", "giao diện", "nền", "chữ", "viền", "bo góc", "shadow",
    "header", "footer", "button", "nút", "card", "sidebar",
  ];
  const scriptKeywords = [
    "js", "javascript", "script", "function", "logic", "click",
    "event", "data", "save", "load", "localStorage", "api", "fetch",
    "tính năng", "chức năng", "xử lý", "lưu", "thêm", "xóa", "sửa",
    "filter", "search", "sort", "validate", "form", "input",
  ];

  const needsStyle = styleKeywords.some((k) => lower.includes(k));
  const needsScript = scriptKeywords.some((k) => lower.includes(k));

  // If unclear, include both
  if (!needsStyle && !needsScript) {
    if (files["/style.css"]) relevant.push({ file: "/style.css", content: files["/style.css"] });
    if (files["/script.js"]) relevant.push({ file: "/script.js", content: files["/script.js"] });
    // Always include HTML for structural changes
    relevant.push({ file: "/index.html", content: summarizeHtml(files["/index.html"]) });
    return relevant;
  }

  if (needsStyle && files["/style.css"]) {
    relevant.push({ file: "/style.css", content: files["/style.css"] });
  }
  if (needsScript && files["/script.js"]) {
    relevant.push({ file: "/script.js", content: files["/script.js"] });
  }

  // Always include a slim HTML summary for structural context
  relevant.push({ file: "/index.html", content: summarizeHtml(files["/index.html"]) });

  return relevant;
}

function summarizeHtml(html: string): string {
  // Return just the HTML structure (tags) without full CSS/JS content
  let slim = html;
  slim = slim.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "<style>/* CSS — see /style.css */</style>");
  slim = slim.replace(/<script(?!.*src\s*=)[^>]*>[\s\S]*?<\/script>/gi, "<script>/* JS — see /script.js */</script>");
  return slim;
}
