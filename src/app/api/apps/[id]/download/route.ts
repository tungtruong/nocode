import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import JSZip from "jszip";
import { requireSession, authError } from "@/lib/auth";
import { getApp } from "@/lib/store";

const README = `# {title}

App này được tạo bằng nocode AI builder. Mã nguồn nằm hoàn toàn trong file \`index.html\` (HTML + CSS + JS inline).

## Cách deploy nhanh nhất (chọn 1 trong 3)

### 1. Netlify Drop — không cần tài khoản
1. Mở https://app.netlify.com/drop
2. Kéo thả thư mục giải nén vào trang đó
3. Netlify tự cấp domain dạng \`<random>.netlify.app\` trong 10 giây

### 2. Vercel — cần tài khoản (miễn phí)
\`\`\`
npx vercel --prod
\`\`\`
Vercel tự detect static HTML, deploy luôn.

### 3. Cloudflare Pages — cần tài khoản (miễn phí, CDN toàn cầu)
1. Mở https://dash.cloudflare.com → Pages → Create
2. Chọn "Upload assets", kéo thả thư mục giải nén
3. Cloudflare tạo domain \`<name>.pages.dev\`

### 4. GitHub Pages
1. Tạo repo GitHub mới, push file \`index.html\` lên branch \`main\`
2. Settings → Pages → Source = \`main\` branch
3. Truy cập tại \`<user>.github.io/<repo>\`

## Lưu ý
- App lưu trạng thái trong bộ nhớ tạm (refresh là mất). Nếu cần lưu lâu dài, sửa \`<script>\` để dùng \`localStorage\` (chỉ hoạt động khi deploy lên domain thật, không hoạt động trong sandbox preview của nocode).
- File tự đứng được, không cần build tool / npm install.
- Có thể chỉnh sửa trực tiếp \`index.html\` bằng bất kỳ trình soạn thảo nào.

---
Sinh bởi nocode · {date}
`;

const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let session;
    try { session = await requireSession(); } catch { return authError(); }

    const { id } = await params;
    if (!ID_RE.test(id)) {
      return NextResponse.json({ error: "ID không hợp lệ" }, { status: 400 });
    }

    const meta = await getApp(id);
    if (!meta) return NextResponse.json({ error: "Không tìm thấy app" }, { status: 404 });
    if (meta.user_email !== session.email) {
      return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
    }

    let html: string;
    try {
      html = await fs.readFile(
        path.join(process.cwd(), "public", "apps", id, "index.html"),
        "utf-8"
      );
    } catch {
      return NextResponse.json({ error: "File app bị thiếu" }, { status: 404 });
    }

    const zip = new JSZip();
    zip.file("index.html", html);
    zip.file(
      "README.md",
      README
        .replace("{title}", meta.title || "App")
        .replace("{date}", new Date(meta.created_at).toISOString().slice(0, 10))
    );

    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    // Sanitize title for the filename — Latin alphanumerics + dash only,
    // fallback to the app id so we never emit a weird name to the user's
    // browser download dialog.
    const safeName = (meta.title || id)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || id;

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("Download error:", e);
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
