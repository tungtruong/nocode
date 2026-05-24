interface VirtualFiles {
  [path: string]: string;
}

export function parseHtmlToFiles(html: string): VirtualFiles {
  const files: VirtualFiles = {};

  // Extract inline <style> blocks → /style.css. Dedupe byte-identical blocks
  // (common when previous turns of the agent accidentally duplicated <style>).
  const styleMatches = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
  const seenCss = new Set<string>();
  let styleCss = "";
  for (const m of styleMatches) {
    const content = m.replace(/<style[^>]*>/i, "").replace(/<\/style>/i, "").trim();
    if (!content || seenCss.has(content)) continue;
    seenCss.add(content);
    styleCss += content + "\n";
  }
  if (styleCss.trim()) {
    files["/style.css"] = styleCss.trim();
  }

  // Extract inline <script> blocks → /script.js. Same dedupe — also strips
  // duplicate top-level `const NAME = ...;` declarations that survive when
  // two non-identical scripts both declare the same global.
  const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const seenJs = new Set<string>();
  let scriptJs = "";
  for (const m of scriptMatches) {
    if (/src\s*=/i.test(m)) continue; // skip external scripts
    const content = m.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
    if (!content || seenJs.has(content)) continue;
    seenJs.add(content);
    scriptJs += content + "\n";
  }
  if (scriptJs.trim()) {
    files["/script.js"] = dedupeTopLevelDeclarations(scriptJs.trim());
  }

  // Store the full HTML as canonical source
  files["/index.html"] = html;

  return files;
}

// Best-effort dedupe of duplicate `const|let|var NAME = ...;` and
// `function NAME(...){...}` declarations at the TOP level (column 0 / lightly
// indented). Keeps the first occurrence, removes subsequent ones. Doesn't
// touch declarations inside other functions/blocks (column-indented). This is
// purely defensive — duplicate top-level `const` is a SyntaxError that kills
// the whole script.
function dedupeTopLevelDeclarations(js: string): string {
  const lines = js.split("\n");
  const seenNames = new Set<string>();
  const out: string[] = [];
  let skipUntilBalanced = 0;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (skipUntilBalanced) {
      // Track braces/brackets/parens to find end of the duplicate decl block.
      for (const c of line) {
        if (c === "{" || c === "[" || c === "(") depth++;
        else if (c === "}" || c === "]" || c === ")") depth--;
      }
      if (depth <= 0 && /[;}]\s*$/.test(line.trimEnd())) {
        skipUntilBalanced = 0;
        depth = 0;
      }
      continue;
    }

    // Match: optional indent (≤8 spaces), then const|let|var|function NAME
    const m = line.match(/^\s{0,8}(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/);
    if (m) {
      const name = m[1];
      if (seenNames.has(name)) {
        // Duplicate — skip this line and any continuation lines until the
        // declaration is balanced.
        skipUntilBalanced = 1;
        depth = 0;
        for (const c of line) {
          if (c === "{" || c === "[" || c === "(") depth++;
          else if (c === "}" || c === "]" || c === ")") depth--;
        }
        if (depth <= 0 && /[;}]\s*$/.test(line.trimEnd())) {
          skipUntilBalanced = 0;
          depth = 0;
        }
        continue;
      }
      seenNames.add(name);
    }
    out.push(line);
  }
  return out.join("\n");
}

export function mergeFilesToHtml(files: VirtualFiles): string {
  const html = files["/index.html"];
  if (!html) return "";

  const styleCss = files["/style.css"];
  const scriptJs = files["/script.js"];

  let result = html;

  // parseHtmlToFiles concatenated EVERY inline <style> / <script> in the
  // document into a single /style.css and /script.js. When merging back we
  // must keep exactly ONE replacement and remove the rest — otherwise the
  // combined content gets duplicated N times (with N = number of original
  // blocks), which causes `const X already declared` SyntaxErrors and kills
  // the whole page.
  result = replaceFirstAndRemoveRest(
    result,
    /<style[^>]*>[\s\S]*?<\/style>/gi,
    styleCss !== undefined ? `<style>\n${styleCss}\n</style>` : null
  );
  if (styleCss !== undefined && !/<style/i.test(result) && /<\/head>/i.test(result)) {
    result = result.replace(/<\/head>/i, `<style>\n${styleCss}\n</style>\n</head>`);
  }

  result = replaceFirstAndRemoveRest(
    result,
    /<script(?![^>]*\bsrc\b)[^>]*>[\s\S]*?<\/script>/gi,
    scriptJs !== undefined ? `<script>\n${scriptJs}\n</script>` : null
  );
  if (scriptJs !== undefined && !/<script(?![^>]*\bsrc\b)/i.test(result) && /<\/body>/i.test(result)) {
    result = result.replace(/<\/body>/i, `<script>\n${scriptJs}\n</script>\n</body>`);
  }

  return result;
}

// Replace the FIRST match with `replacement` and delete all subsequent matches.
// If `replacement` is null, just delete all matches.
function replaceFirstAndRemoveRest(input: string, re: RegExp, replacement: string | null): string {
  let first = true;
  return input.replace(re, () => {
    if (first) {
      first = false;
      return replacement ?? "";
    }
    return "";
  });
}

export function extractRelevantFiles(
  files: VirtualFiles,
  _instruction: string
): { file: string; content: string }[] {
  void _instruction;
  const relevant: { file: string; content: string }[] = [];

  relevant.push({
    file: "/FILES.txt",
    content: Object.entries(files)
      .map(([path, content]) => `${path} (${content.length} chars)`)
      .join("\n"),
  });

  if (files["/style.css"]) relevant.push({ file: "/style.css", content: files["/style.css"] });
  if (files["/script.js"]) relevant.push({ file: "/script.js", content: files["/script.js"] });
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
