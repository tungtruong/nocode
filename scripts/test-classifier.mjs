// Smoke-test the multilingual capability classifier with a spread of
// real-world prompts the user is likely to type. Verifies:
//  - JSON parsing survives DeepSeek's various formatting habits
//  - Multilingual inputs (VI / EN / ZH / mixed) route correctly
//  - Auth always implies db when picked
//  - Static apps correctly classify to []
//
// Run from repo root: node --env-file=.env scripts/test-classifier.mjs
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Use the Next.js + tsconfig path resolver via tsx, falling back to plain ts node.
try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // tsx not installed — try alternative
}

const { classifyCapabilities } = await import("../src/lib/capability-classifier.ts");

const CASES = [
  // [input, expected_caps]
  ["Tạo CV của tôi tên Tùng, lập trình viên 10 năm kinh nghiệm", []],
  ["Simple calculator app", []],
  ["Một trang BMI calculator", []],
  ["Pitch deck for AI startup raising seed round", []],

  ["Landing page bán khoá học, có form đăng ký nhận tài liệu", ["forms"]],
  ["Wedding invitation site với RSVP form", ["forms"]],

  ["Menu QR cafe, có thể đổi giá", ["forms", "db"]],
  ["Real estate listing page cho công ty bất động sản", ["db"]],
  ["E-commerce catalog của hàng quần áo", ["db"]],

  ["Personal journal app, đăng nhập Google, lưu note riêng", ["db", "auth"]],
  ["A personal todo list where each user sees only their own tasks", ["db", "auth"]],
  ["个人日记应用，用Google登录", ["db", "auth"]],
  ["Bookmark manager — sign in to save bookmarks", ["db", "auth"]],

  // files capability — added in R2 sprint
  ["Catalog quần áo, owner upload ảnh sản phẩm thật", ["db", "files"]],
  ["Menu cafe có ảnh thật của từng món", ["db", "files"]],
  ["Journal app, user upload ảnh đính kèm note", ["db", "auth", "files"]],
  ["CV portfolio với upload avatar thật", ["files"]],
];

let pass = 0;
let fail = 0;
const start = Date.now();

for (const [input, expected] of CASES) {
  try {
    const { caps, source } = await classifyCapabilities(input);
    const ok =
      caps.length === expected.length &&
      caps.every((c) => expected.includes(c));
    if (ok) {
      pass++;
      console.log(`  ✓ [${source}] "${input.slice(0, 50)}" → ${JSON.stringify(caps)}`);
    } else {
      fail++;
      console.log(
        `  ✗ [${source}] "${input.slice(0, 50)}"\n      expected ${JSON.stringify(expected)} got ${JSON.stringify(caps)}`,
      );
    }
  } catch (e) {
    fail++;
    console.log(`  ✗ ERROR "${input.slice(0, 50)}": ${e?.message || e}`);
  }
}

console.log(
  `\n${pass}/${pass + fail} passed in ${((Date.now() - start) / 1000).toFixed(1)}s`,
);
process.exit(fail > 0 ? 1 : 0);
