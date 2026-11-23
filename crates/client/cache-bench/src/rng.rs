//! Deterministic, dependency-free randomness so a dataset is reproducible from
//! its seed on every machine.

/// SplitMix64: small, fast, and good enough for synthetic data.
#[derive(Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// Uniform in `0..n` (n > 0).
    pub fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n.max(1)
    }

    /// Uniform in `lo..=hi`.
    pub fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.below(hi.saturating_sub(lo) + 1)
    }

    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    pub fn chance(&mut self, p: f64) -> bool {
        self.unit() < p
    }

    /// Log-normal-ish size around `median`, clamped to `[min, max]`.
    pub fn size_around(&mut self, median: f64, spread: f64, min: usize, max: usize) -> usize {
        // Sum of uniforms approximates a normal; exponentiate for a long tail.
        let normal = (0..4).map(|_| self.unit()).sum::<f64>() - 2.0;
        let value = median * (normal * spread).exp();
        (value as usize).clamp(min, max)
    }

    /// A UUID-formatted (version 4 bits) identifier.
    pub fn uuid(&mut self) -> String {
        let hi = self.next_u64();
        let lo = self.next_u64();
        let bytes = [hi.to_be_bytes(), lo.to_be_bytes()].concat();
        let mut b = [0u8; 16];
        b.copy_from_slice(&bytes);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        uuid::Uuid::from_bytes(b).to_string()
    }
}

/// Stable hash of a seed and a label (FNV-1a over both).
pub fn mix(seed: u64, label: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64 ^ seed;
    for byte in label.bytes().chain(seed.to_le_bytes()) {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    // Finalize so nearby seeds diverge.
    Rng::new(hash).next_u64()
}

const WORDS: &[&str] = &[
    "project",
    "update",
    "review",
    "meeting",
    "notes",
    "plan",
    "quarter",
    "launch",
    "design",
    "budget",
    "draft",
    "proposal",
    "invoice",
    "contract",
    "follow",
    "up",
    "weekly",
    "sync",
    "team",
    "roadmap",
    "customer",
    "feedback",
    "release",
    "hiring",
    "onboarding",
    "report",
    "metrics",
    "growth",
    "sales",
    "pipeline",
    "partner",
    "agenda",
    "summary",
    "action",
    "items",
    "travel",
    "offsite",
    "research",
    "spec",
    "api",
    "migration",
    "incident",
    "postmortem",
    "q3",
    "q4",
    "renewal",
    "pricing",
    "deck",
    "memo",
    "brief",
    "kickoff",
    "status",
    "approval",
    "request",
    "schedule",
    "calendar",
    "invite",
    "thanks",
    "question",
    "the",
    "and",
    "for",
    "with",
    "from",
    "about",
    "this",
    "next",
    "week",
    "today",
    "please",
    "regarding",
    "attached",
    "latest",
    "version",
    "call",
    "team",
    "office",
    "product",
];

pub fn words(rng: &mut Rng, count: usize) -> String {
    let mut out = String::new();
    for index in 0..count {
        if index > 0 {
            out.push(' ');
        }
        out.push_str(WORDS[rng.below(WORDS.len() as u64) as usize]);
    }
    out
}

/// Prose of roughly `bytes` length.
pub fn prose(rng: &mut Rng, bytes: usize) -> String {
    let mut out = String::with_capacity(bytes + 16);
    while out.len() < bytes {
        let sentence = rng.range(6, 18) as usize;
        let mut first = true;
        for _ in 0..sentence {
            if !first {
                out.push(' ');
            }
            first = false;
            out.push_str(WORDS[rng.below(WORDS.len() as u64) as usize]);
        }
        out.push_str(". ");
        if rng.chance(0.15) {
            out.push('\n');
        }
    }
    out.truncate(bytes);
    out
}

/// Email-like HTML of roughly `bytes` length: markup-heavy, like real mail.
pub fn html(rng: &mut Rng, bytes: usize) -> String {
    let mut out = String::with_capacity(bytes + 256);
    out.push_str("<div dir=\"ltr\"><table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222\">");
    while out.len() < bytes {
        let style = rng.below(4);
        match style {
            0 => out.push_str("<tr><td style=\"padding:8px 16px;line-height:20px\"><p style=\"margin:0 0 12px 0\">"),
            1 => out.push_str("<div class=\"gmail_quote\"><blockquote style=\"margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex\">"),
            2 => out.push_str("<p><span style=\"font-size:13px;color:#555555\">"),
            _ => out.push_str("<tr><td align=\"left\"><a href=\"https://example.com/track?u=abcdef0123456789&amp;id=42\" style=\"color:#1a73e8;text-decoration:none\">"),
        }
        let len = rng.range(80, 400) as usize;
        out.push_str(&prose(rng, len));
        match style {
            0 => out.push_str("</p></td></tr>"),
            1 => out.push_str("</blockquote></div>"),
            2 => out.push_str("</span></p>"),
            _ => out.push_str("</a></td></tr>"),
        }
    }
    out.push_str("</table></div>");
    out
}
