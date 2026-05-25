"use client";

import Link from "next/link";
import { useLang, LangToggle } from "@/components/LangProvider";

export default function RulesPage() {
  const { t, lang } = useLang();

  const categories = [
    {
      emoji: "🔒",
      titleKey: "promptInjection",
      descVi: "Mọi hành vi cố gắng ghi đè chỉ dẫn AI, trích xuất system prompt hoặc đánh cắp API key đều bị chặn ở lớp đầu vào.",
      descEn: "Any attempt to override AI instructions, extract system prompts, or steal API keys is blocked at the input layer.",
    },
    {
      emoji: "🛡️",
      titleKey: "violence",
      descVi: "Không đe dọa, không hướng dẫn phạm tội, không cổ súy bạo lực dưới mọi hình thức.",
      descEn: "No threats, criminal instructions, or promotion of violence in any form.",
    },
    {
      emoji: "👶",
      titleKey: "childSafety",
      descVi: "Tuyệt đối không khoan nhượng với mọi nội dung liên quan đến xâm hại, lạm dụng hoặc bóc lột trẻ em.",
      descEn: "Zero tolerance for any content involving child harm, abuse, or exploitation — including fictional depictions.",
    },
    {
      emoji: "🤝",
      titleKey: "hate",
      descVi: "Không tấn công dựa trên chủng tộc, dân tộc, quốc tịch, giới tính, tôn giáo, tuổi tác, khuyết tật.",
      descEn: "No attacks based on race, ethnicity, nationality, gender, religion, age, disability.",
    },
    {
      emoji: "🔞",
      titleKey: "adultContent",
      descVi: "Không nội dung khiêu dâm, mô tả quan hệ tình dục rõ ràng hoặc môi giới dịch vụ người lớn.",
      descEn: "No explicit sexual content, pornography, or solicitation of adult services.",
    },
    {
      emoji: "🎣",
      titleKey: "phishing",
      descVi: "Không trang đăng nhập giả, thu thập mật khẩu, lừa đảo đầu tư hoặc dịch vụ tài chính gian dối.",
      descEn: "No fake login pages, credential harvesting, investment scams, or deceptive financial services.",
    },
    {
      emoji: "💻",
      titleKey: "malware",
      descVi: "Không mã độc, virus, trojan, công cụ hack hoặc hướng dẫn khai thác lỗ hổng.",
      descEn: "No malicious code, viruses, trojans, hacking tools, or exploitation instructions.",
    },
    {
      emoji: "🎭",
      titleKey: "impersonation",
      descVi: "Không giả làm cá nhân, thương hiệu, ngân hàng hoặc cơ quan chính phủ nhằm mục đích gian lận.",
      descEn: "No pretending to be individuals, brands, banks, or government entities for fraudulent purposes.",
    },
    {
      emoji: "💊",
      titleKey: "illegalGoods",
      descVi: "Không quảng cáo hoặc buôn bán chất cấm, vũ khí không giấy phép, hàng giả.",
      descEn: "No promotion or sale of controlled substances, unlicensed weapons, or counterfeit goods.",
    },
    {
      emoji: "❤️",
      titleKey: "selfHarm",
      descVi: "Không nội dung cổ súy hoặc hướng dẫn tự hại, tự tử hoặc rối loạn ăn uống.",
      descEn: "No content promoting or instructing self-harm, suicide, or eating disorders.",
    },
    {
      emoji: "🔐",
      titleKey: "privacy",
      descVi: "Không chia sẻ hoặc yêu cầu thông tin cá nhân riêng tư khi chưa có sự đồng ý.",
      descEn: "No sharing or requesting private personal information without consent.",
    },
    {
      emoji: "©️",
      titleKey: "copyright",
      descVi: "Không sao chép y nguyên trang web thương mại hiện có hoặc sử dụng trái phép nhãn hiệu.",
      descEn: "No 1:1 copies of existing commercial websites or unauthorized use of trademarks.",
    },
  ];

  const catTitles: Record<string, string> = {
    promptInjection: "Tấn công Prompt",
    violence: "Bạo lực & Tội phạm",
    childSafety: "Bảo vệ Trẻ em",
    hate: "Thù địch & Phân biệt",
    adultContent: "Nội dung Người lớn",
    phishing: "Lừa đảo & Gian lận",
    malware: "Mã độc & Tấn công",
    impersonation: "Mạo danh",
    illegalGoods: "Hàng hóa & Dịch vụ Trái phép",
    selfHarm: "Tự hại & Sức khỏe",
    privacy: "Riêng tư & Lộ thông tin",
    copyright: "Bản quyền",
  };

  const catTitlesEn: Record<string, string> = {
    promptInjection: "Prompt Injection",
    violence: "Violence & Criminal Acts",
    childSafety: "Child Protection",
    hate: "Hate Speech & Discrimination",
    adultContent: "Adult & Sexual Content",
    phishing: "Phishing & Fraud",
    malware: "Malware & Hacking",
    impersonation: "Impersonation",
    illegalGoods: "Illegal Goods & Services",
    selfHarm: "Self-Harm Prevention",
    privacy: "Privacy & Doxxing",
    copyright: "Copyright",
  };

  return (
    <div className="min-h-screen bg-[#fcfcfd] text-[#18181b]">
      <nav className="flex items-center justify-between px-6 py-4 max-w-4xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#a855f7] shadow-sm shadow-[#7c3aed]/20">
            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
          </div>
          <span className="text-lg font-semibold tracking-tight">JustVibe</span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-4">
          <LangToggle />
          <Link href="/" className="text-xs sm:text-sm text-[#71717a] hover:text-[#18181b] transition-colors">{t.home}</Link>
        </div>
      </nav>

      <section className="max-w-3xl mx-auto px-6 pt-12 pb-32">
        <h1 className="text-3xl font-bold tracking-tight mb-2">{t.rulesTitle}</h1>
        <p className="text-[#71717a] mb-10 leading-relaxed">{t.rulesDesc}</p>
        <div className="space-y-4">
          {categories.map((c) => (
            <div key={c.titleKey} className="rounded-2xl border border-[#e8e8ec] bg-white p-5 hover:border-[#d4d4d8] transition-all">
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5">{c.emoji}</span>
                <div>
                  <h3 className="font-semibold text-sm mb-1">{lang === "vi" ? catTitles[c.titleKey] : catTitlesEn[c.titleKey]}</h3>
                  <p className="text-xs text-[#71717a] leading-relaxed">{lang === "vi" ? c.descVi : c.descEn}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-[#e8e8ec] bg-white p-6">
          <h2 className="font-semibold text-sm mb-2">{t.rulesEnforce}</h2>
          <ul className="text-xs text-[#71717a] space-y-2 list-disc pl-4">
            <li><strong>{lang === "vi" ? "Lớp đầu vào:" : "Input layer:"}</strong> {t.rulesL1}</li>
            <li><strong>{lang === "vi" ? "Lớp AI:" : "AI layer:"}</strong> {t.rulesL2}</li>
            <li><strong>{lang === "vi" ? "Lớp đầu ra:" : "Output layer:"}</strong> {t.rulesL3}</li>
            <li><strong>{lang === "vi" ? "Giới hạn:" : "Rate limit:"}</strong> {t.rulesL4}</li>
          </ul>
        </div>
        <div className="mt-6 text-center">
          <p className="text-xs text-[#d4d4d8]">{t.rulesReport} <a href="mailto:abuse@justvibe.me" className="text-[#7c3aed] hover:underline">abuse@justvibe.me</a></p>
        </div>
      </section>
      <footer className="border-t border-[#e8e8ec] px-6 py-6 text-center">
        <div className="flex items-center justify-center gap-4 text-xs text-[#a1a1aa]">
          <Link href="/pricing" className="hover:text-[#71717a] transition-colors">{t.pricing}</Link>
          <Link href="/" className="hover:text-[#71717a] transition-colors">{t.home}</Link>
        </div>
      </footer>
    </div>
  );
}
