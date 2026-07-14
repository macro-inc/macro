use lazy_static::lazy_static;
use regex::Regex;
use scraper::Selector;

// Using lazy_static to compile regexes and selectors only once for performance.
lazy_static! {
    // --- Regexes ---

    // Regex for "On [Date], [Sender] wrote:" lines. Case-insensitive.
    pub static ref ON_WROTE_RE: Regex = Regex::new(
        r#"(?i)On (Mon|Tue|Wed|Thu|Fri|Sat|Sun), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4} at \d{1,2}:\d{2} (AM|PM),? .* wrote:"#
    ).unwrap();

    // Regex for "From: ... Sent: ..." blocks, common in Outlook.
    // MODIFIED: Use non-greedy `.*?` to match the shortest possible block and avoid over-matching in long threads.
    pub static ref FROM_SENT_RE: Regex = Regex::new(
        r#"(?is)From:.*(Sent:|Date:).*To:.*Subject:.*"#
    ).unwrap();

    // Regex for other common text splitters.
    pub static ref GENERIC_SPLITTER_RE: Regex = Regex::new(
        r#"(?i)(^\s*--+original message--+)|(^\s*from:)|(^\s*on .*wrote:)"#
    ).unwrap();

    // Regex for common signature lines.
    // (?im) -> i: case-insensitive, m: multiline mode (^ and $ match line start/end)
    pub static ref SIGNATURE_RE: Regex = Regex::new(
        r#"(?im)(^\s*(--|––|—)\s*$)|(^\s*(thanks|best|regards|cheers|sincerely),?\s*$)"#
    ).unwrap();

    /// A comprehensive regex for finding splitters in plaintext emails.
    /// It combines multiple common reply header patterns.
    ///
    /// Flags used:
    ///   - `i`: Case-insensitive matching.
    ///   - `x`: Extended mode, allows whitespace and comments for readability.
    ///   - `m`: Multiline mode, `^` and `$` match start/end of lines.
    pub static ref PLAINTEXT_SPLITTER_RE: Regex = Regex::new(
        r#"(?ixm)
        ( # Group 1: "On Date, Name wrote:" - a common, specific format
            ^On\s+
            (Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+
            (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+
            .*
            wrote:
        )
        | # OR
        ( # Group 2: Dashed lines like ---original message---
            ^--+\s*original\s+message\s*--+
        )
        | # OR
        ( # Group 3: Forwarded headers like > From: or From:
            ^>?>?\s*From:
        )
        | # OR
        ( # Group 4: A more generic "On...wrote" as a fallback
            ^>?>?\s*On\s+.*wrote:
        )
        "#
    ).unwrap();

    // --- Selectors ---
    // Pre-compiling selectors to avoid parsing them repeatedly at runtime.

    pub static ref GMAIL_QUOTE_SELECTOR: Selector = Selector::parse("div.gmail_quote").unwrap();
    pub static ref GMAIL_ATTR_SELECTOR: Selector = Selector::parse(".gmail_attr").unwrap();
    pub static ref YAHOO_SEPARATOR_SELECTOR: Selector = Selector::parse(r#"div[data-test-id="message-viewer-reply-separator"]"#).unwrap();
    pub static ref OUTLOOK_HR_SELECTOR: Selector = Selector::parse("hr#stop_reply_editing").unwrap();
    pub static ref OUTLOOK_DIV_SELECTOR: Selector = Selector::parse("div").unwrap();
    pub static ref OUTLOOK_REPLY_CONTAINER_SELECTOR: Selector = Selector::parse("div#mail-editor-reference-message-container").unwrap();
    pub static ref OUTLOOK_APPENDONSEND_SELECTOR: Selector = Selector::parse("div#appendonsend").unwrap();
    pub static ref BLOCKQUOTE_SELECTOR: Selector = Selector::parse("blockquote").unwrap();
    pub static ref ANY_ELEMENT_SELECTOR: Selector = Selector::parse("*").unwrap();
    pub static ref BODY_SELECTOR: Selector = Selector::parse("body").unwrap();
    pub static ref BLOCK_LEVEL_ELEMENTS_SELECTOR: Selector = Selector::parse("p, div, li, h1, h2, h3, h4, h5, h6").unwrap();
}
