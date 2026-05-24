type Category = "injection" | "violence" | "child_harm" | "hate" | "adult" | "phishing" | "malware" | "impersonation" | "illegal_goods" | "self_harm" | "deceptive" | "doxxing" | "copyright";

interface Violation {
  category: Category;
  reason: string;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|your)\s+(instructions?|prompts?)/i,
  /you\s+are\s+now\s+(a\s+)?(different|new)\s+(AI|assistant)/i,
  /\b(DAN|jailbreak|roleplay|pretend)\b/i,
  /(tell|show|output|reveal)\s+(me\s+)?(your|the)\s+(system\s*)?(prompt|instructions?)/i,
  /(tell|show|give)\s+(me\s+)?(your|the|an)\s+(API\s*)?(key|token|secret|password)/i,
  /(execute|run)\s+(a\s+)?(shell\s+)?(command|bash|sh|terminal)/i,
  /sudo\s+|rm\s+-rf|curl\s+|wget\s+/i,
];

const CONTENT_CATEGORIES: [Category, RegExp[], string][] = [
  [
    "violence",
    [
      /\b(kill|murder|assassinate|terrorist|bomb|massacre|torture)\b/i,
      /how\s+to\s+(make|build|create)\s+(a\s+)?(bomb|weapon|explosive)/i,
      /\b(threaten|violent|brutal)\s+(attack|assault|harm)/i,
    ],
    "Violence & criminal behavior",
  ],
  [
    "child_harm",
    [
      /\b(child|minor|underage|pedophil|grooming)\b.*\b(abuse|harm|exploit|sexual)\b/i,
      /\bCSAM\b|\bchild\s+(porn|abuse)\b/i,
    ],
    "Child harm or exploitation",
  ],
  [
    "hate",
    [
      /\b(hate\s*speech|racist|nazi|supremac|lynch|ethnic\s*clean)\b/i,
      /\bdiscriminat(e|ion)\b.*\b(race|ethnic|religion|gender|disability)\b/i,
      /\b(nigger|kike|chink|faggot)\b/i,
    ],
    "Hate speech & discrimination",
  ],
  [
    "adult",
    [
      /\b(porn|pornograph|xxx|sexual\s*(act|content|intercourse)|hardcore|fetish)\b/i,
      /\b(escort|prostitut|brothel|sex\s*(work|worker|traffic))\b/i,
      /(create|generate|make).*(porn|nude|naked|sexual).*(image|photo|picture|video)/i,
    ],
    "Adult & sexual content",
  ],
  [
    "phishing",
    [
      /\b(phish|fake\s*(login|password|credential|bank))\b/i,
      /\b(steal|collect)\s+(password|credential|credit\s*card|identity)\b/i,
      /(clone|cop(y|ied))\s+(exactly|identically).*\b(login|bank|paypal|stripe)\b/i,
      /\b(scam|fraud|ponzi|pyramid)\b.*\b(site|website|page|app)\b/i,
      /\b(giả\s*mạo|lừa\s*đảo|đánh\s*cắp)\b.*\b(ngân\s*hàng|tài\s*khoản|mật\s*khẩu|password)\b/i,
      /\b(trang\s*web\s*giả|website\s*giả|fake\s*web)\b/i,
    ],
    "Phishing, scams & fraud",
  ],
  [
    "malware",
    [
      /\b(malware|virus|trojan|ransomware|worm|rootkit|keylogger|spyware)\b/i,
      /(create|generate|build|write|code).*\b(malware|virus|trojan|ransom)\b/i,
      /\b(exploit|backdoor|payload)\b.*\b(inject|install|deploy)\b/i,
      /\b(crack|hack)\b.*\b(password|account|system|server|database)\b/i,
    ],
    "Malware, hacking & exploits",
  ],
  [
    "impersonation",
    [
      /\b(impersonate|pretend\s*to\s*be)\b.*\b(bank|government|police|company|brand)\b/i,
      /(fake|false)\s+(identity|ID|passport|license|certificate)/i,
    ],
    "Impersonation & identity fraud",
  ],
  [
    "illegal_goods",
    [
      /\b(buy|sell|purchase|order)\b.*\b(drug|heroin|cocaine|meth|opioid|fentanyl)\b/i,
      /\b(unlicensed|illegal|black\s*market)\b.*\b(weapon|gun|firearm|ammo)\b/i,
      /\b(counterfeit|fake|bootleg)\b.*\b(goods|products|medicine|drug)\b/i,
    ],
    "Illegal goods & services",
  ],
  [
    "self_harm",
    [
      /\b(suicide|self[\s-]*harm|cut\s*yourself|kill\s*yourself)\b/i,
      /(how\s+to|ways\s+to|method).*\b(commit\s+suicide|end\s+(your|my)\s+life)\b/i,
      /\b(anorexia|bulimia|eating\s*disorder)\b.*\b(promot|encourag|instruct)\b/i,
    ],
    "Self-harm & suicide",
  ],
  [
    "doxxing",
    [
      /\b(dox|doxx|doxxing)\b/i,
      /(find|reveal|leak|expose|publish|share).*(someone|a\s*person).*(address|phone|location|private\s*info)/i,
      /\b(SSN|social\s*security|passport\s*number|ID\s*number)\b/i,
    ],
    "Doxxing & private information",
  ],
];

export function detectPromptViolation(input: string): Violation | null {
  // 1. Injection attacks
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return { category: "injection", reason: "Prompt injection attempt detected" };
    }
  }

  // 2. Content categories
  for (const [category, patterns, reason] of CONTENT_CATEGORIES) {
    for (const pattern of patterns) {
      if (pattern.test(input)) {
        return { category: category as Category, reason };
      }
    }
  }

  return null;
}

// Output scanning: check generated HTML for prohibited content patterns
export function scanGeneratedHtml(html: string): Violation | null {
  const lower = html.toLowerCase();

  // Phishing patterns in generated HTML
  if (
    /(password|credit\s*card|bank\s*account|social\s*security|login\s*credentials?)\s*(please|enter|type|input)/i.test(
      lower
    ) &&
    /(submit|verify|confirm|validate|authenticate)\s*(your|now|here)/i.test(lower) &&
    /\b(urgent|immediately|limited|suspend|security\s*alert)\b/i.test(lower)
  ) {
    return { category: "phishing", reason: "Generated content resembles phishing" };
  }

  // Malware/exploit patterns
  if (
    /eval\s*\(.*atob\s*\(/i.test(html) || // JS obfuscation
    /document\.write\s*\(\s*unescape\s*\(/i.test(html) || // JS unpack
    /<script[^>]*src\s*=\s*["'](?!https?:\/\/cdn\.|https?:\/\/unpkg\.|https?:\/\/jsdelivr\.)/i.test(html) // unknown script sources
  ) {
    return { category: "malware", reason: "Generated content contains suspicious JavaScript" };
  }

  // Adult content patterns — require explicit context to avoid false positives
  // on words like "adult education", "explicit type", "nude color", "naked CSS".
  // Input-side scan in CONTENT_CATEGORIES already catches user intent; this is
  // a safety net for output that drifted into actual adult material.
  const text = html.replace(/<[^>]*>/g, "");
  if (
    /\b(porn|pornograph|xxx)\b/i.test(text) ||
    /\b(escort|prostitut|brothel)\b/i.test(text) ||
    /\b(sexual|explicit|adult|nude|naked)\s+(content|material|image|photo|video|scene)\b/i.test(text) ||
    /\bsexual\s*(act|intercourse|fetish)\b/i.test(text)
  ) {
    return { category: "adult", reason: "Generated content contains adult material" };
  }

  return null;
}

// Simple rate limiter (in-memory, replace with Redis for production)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  maxRequests: number = 20,
  windowMs: number = 60 * 60 * 1000 // 1 hour
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count };
}
