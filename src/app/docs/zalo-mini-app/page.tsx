import Link from "next/link";

export const metadata = {
  title: "Xuất Zalo Mini App — JustVibe",
  description: "Hướng dẫn tải app JustVibe thành Zalo Mini App và submit lên Zalo Developers.",
};

export default function ZaloMiniAppDocs() {
  return (
    <div className="min-h-screen bg-[#fafafa]">
      <nav className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/dashboard" className="text-sm text-[#52525b] hover:text-[#18181b]">
          ← Dashboard
        </Link>
        <a href="https://developers.zalo.me" target="_blank" rel="noopener noreferrer" className="text-sm text-[#0068ff] hover:underline">
          Mở Zalo Developers ↗
        </a>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-8 prose prose-sm prose-slate">
        <h1 className="text-2xl font-bold mb-2">Xuất app sang Zalo Mini App</h1>
        <p className="text-[#52525b] mb-6">
          Đưa app JustVibe của bạn chạy bên trong Zalo (75 triệu user VN). Toàn quy trình ~30 phút setup ban đầu, sau đó 1 click mỗi lần cập nhật.
        </p>

        <Section title="🎯 Khi nào nên dùng Zalo Mini App?">
          <ul>
            <li><b>Khách của bạn dùng Zalo nhiều</b> (F&B, salon, shop nhỏ, sự kiện) — họ không cần cài app, không cần nhập URL, chỉ cần quét QR hoặc bấm từ chat</li>
            <li><b>Cần thanh toán nhanh không out-of-app</b> — ZaloPay native + ZNS notify cho khách</li>
            <li><b>Cần phân phối qua Zalo Official Account của business</b> — followers nhận tin app mới ngay</li>
          </ul>
          <p>Không phù hợp khi: app cần SEO, cần Google index, hoặc target user quốc tế.</p>
        </Section>

        <Section title="📋 Chuẩn bị (làm 1 lần)">
          <ol>
            <li>
              <b>Zalo Official Account (OA) verified</b> của doanh nghiệp.
              Đăng ký miễn phí tại <a href="https://oa.zalo.me" target="_blank" rel="noopener noreferrer">oa.zalo.me</a>.
              Cần giấy phép kinh doanh + giấy tờ pháp nhân. Zalo xét duyệt ~3-5 ngày.
            </li>
            <li>
              <b>Đăng ký tài khoản Zalo Developers</b> tại <a href="https://developers.zalo.me" target="_blank" rel="noopener noreferrer">developers.zalo.me</a> với cùng số Zalo có OA.
            </li>
            <li>
              <b>Tạo Mini App mới</b>: Console → New App → chọn loại <code>Zalo Mini App</code>.
              Ghi lại <code>App ID</code> mà Zalo cấp cho bạn — sẽ paste vào <code>app-config.json</code>.
            </li>
            <li>
              <b>Chuẩn bị icon 192×192 PNG</b> (logo brand) — Zalo sẽ reject submission nếu bạn dùng icon placeholder JV cấp sẵn.
            </li>
          </ol>
        </Section>

        <Section title="🚀 Tải Mini App từ JustVibe">
          <ol>
            <li>
              Vào <Link href="/dashboard">Dashboard</Link> → tìm app bạn muốn xuất → bấm nút{" "}
              <span className="inline-block bg-[#f5f3ff] text-[#7c3aed] px-2 py-0.5 rounded text-xs font-mono">💬 Zalo .zip</span>
            </li>
            <li>
              File <code>&lt;ten-app&gt;.zmp.zip</code> tự tải về máy — bên trong có 5 file:
              <ul className="my-2 ml-4 text-xs font-mono">
                <li><b>index.html</b> — code app của bạn (đã inject JV runtime)</li>
                <li><b>app-config.json</b> — Zalo metadata (title, permissions, network whitelist)</li>
                <li><b>manifest.json</b> — icon + display config</li>
                <li><b>icon.png</b> — placeholder 1×1, BẮT BUỘC thay bằng icon thật</li>
                <li><b>README.txt</b> — hướng dẫn submit</li>
              </ul>
            </li>
            <li>
              <b>Giải nén → thay icon.png → nén lại</b> (giữ nguyên cấu trúc folder).
            </li>
          </ol>
        </Section>

        <Section title="📤 Submit lên Zalo Developers">
          <ol>
            <li>
              Vào Zalo Developers Console → app vừa tạo → tab <b>Source Code</b>.
            </li>
            <li>
              Upload toàn bộ zip vừa nén lại (Zalo sẽ extract).
              Mở <code>app-config.json</code> trong console → paste <code>App ID</code>{" "}
              Zalo cấp vào field <code>app.id</code>.
            </li>
            <li>
              Tab <b>Preview</b> để test thử trong Zalo của bạn trước khi submit.
            </li>
            <li>
              Khi OK → tab <b>Submit Review</b> → Zalo xét duyệt:
              <ul>
                <li>Lần đầu: ~3-5 ngày làm việc</li>
                <li>Update sau: ~1 ngày làm việc</li>
              </ul>
            </li>
            <li>
              Approve → app live tại <code>zalo.me/s/&lt;app-id&gt;</code> + có thể QR code phân phối.
            </li>
          </ol>
        </Section>

        <Section title="⚠️ Quy tắc Zalo hay reject">
          <ul>
            <li><b>Không dùng external CDN script</b> — JV mode <code>zalo_mini_app</code> đã đảm bảo inline, nhưng nếu anh edit thêm tag <code>&lt;script src=&quot;...&quot;&gt;</code> bên ngoài → reject</li>
            <li><b>Permissions phải khớp với feature</b> — đừng xin <code>scope.userLocation</code> nếu app không dùng GPS</li>
            <li><b>Vietnamese-only content</b> — app full English Zalo cũng reject</li>
            <li><b>Icon thật, không placeholder</b> — Zalo nhìn icon đầu tiên</li>
            <li><b>Không scrape data từ Zalo</b> — không truy cập friend list, message history</li>
          </ul>
        </Section>

        <Section title="🔄 Cập nhật app sau review">
          <ol>
            <li>Edit app trên JustVibe như thường — bấm Deploy</li>
            <li>Tải <code>.zip</code> mới từ Dashboard</li>
            <li>Upload lại trong Zalo Developers → Submit Review</li>
            <li>~1 ngày → version mới live</li>
          </ol>
          <p className="text-xs text-amber-700 mt-3">
            ⚠️ Khác với web (deploy 1 click live ngay), Zalo Mini App MỖI UPDATE đều phải qua Zalo review. Đây là constraint Zalo, không phải JV.
          </p>
        </Section>

        <Section title="🆘 Lỗi thường gặp">
          <ul>
            <li><b>&quot;App chưa deploy&quot;</b> — bấm Deploy trên Dashboard ít nhất 1 lần trước khi tải zip. JV chỉ đóng gói version đã live trên subdomain.</li>
            <li><b>&quot;Network request blocked&quot;</b> trong Zalo Preview — JV runtime gọi <code>justvibe.me</code> đã whitelist trong <code>app-config.json/network/allowedHosts</code>. Nếu app gọi domain khác, thêm vào danh sách đó.</li>
            <li><b>&quot;Permission denied: scope.X&quot;</b> — sửa <code>app-config.json/permissions</code> trên Zalo Developers UI rồi re-submit.</li>
          </ul>
        </Section>

        <div className="mt-12 p-4 rounded-xl bg-[#f5f3ff] border border-[#e9d5ff] text-xs">
          <b className="text-[#5b21b6]">Mẹo:</b> Zalo Mini App là một trong những kênh phân phối <b>chỉ có ở Việt Nam</b>. Các tool no-code global (Lovable, v0, Bolt) chưa hỗ trợ. Đây là lợi thế đặc biệt cho business VN — tận dụng sớm.
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-base font-semibold mb-2 text-[#18181b]">{title}</h2>
      <div className="text-sm text-[#334155] [&_a]:text-[#0068ff] [&_a]:underline [&_code]:bg-[#f1f5f9] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_ol]:list-decimal [&_ol]:ml-5 [&_ul]:list-disc [&_ul]:ml-5 [&_ol_li]:my-2 [&_ul_li]:my-1.5">
        {children}
      </div>
    </section>
  );
}
