//! Mention chips for links to Macro app pages in agent-written markdown.
//!
//! Agents often paste an item's URL (or a markdown link to it) where the app
//! would put a mention chip. [`AppLinkChips::rewrite`] turns those links into
//! the chip the web app inserts when the same URL is pasted
//! (`parseMacroAppUrl` in the web app's text paste plugin), leaving code,
//! existing mention tags and every other link as written.

use std::borrow::Cow;
use std::collections::BTreeMap;

use crate::serialize::app_item_mention;

#[cfg(test)]
mod test;

/// App routes whose item a document mention chip opens, with the block it
/// names. Mirrors the web app's `BlockRegistry` and `BlockAliasRegistry`
/// (`apps/web/src/lib/constants/block-registry.ts`), less `pr` (pull requests
/// have their own chip) and `unknown`; the app routes agents at `/app/agents/`.
const ROUTE_BLOCKS: &[(&str, &str)] = &[
    ("agent", "agent"),
    ("agents", "agent"),
    ("ai", "ai"),
    ("calendar", "calendar"),
    ("call", "call"),
    ("canvas", "canvas"),
    ("channel", "channel"),
    ("chat", "chat"),
    ("code", "code"),
    ("company", "company"),
    ("contact", "contact"),
    ("csv", "csv"),
    ("database", "database"),
    ("email", "email"),
    ("fig", "fig"),
    ("form", "form"),
    ("image", "image"),
    ("initiative", "initiative"),
    ("md", "md"),
    ("pdf", "pdf"),
    ("pipeline", "pipeline"),
    ("pptx", "pptx"),
    ("project", "project"),
    ("psd", "psd"),
    ("routine", "routine"),
    ("skill", "skill"),
    ("snippet", "snippet"),
    ("spreadsheet", "spreadsheet"),
    ("task", "task"),
    ("video", "video"),
    ("write", "write"),
];

/// Query parameters that only track how a link was shared.
const IGNORED_PARAMS: &[&str] = &["referral_code"];

/// How much deeper than its opening fence a closing fence may be indented;
/// a fence indented further is code inside the block.
const MAX_CLOSING_INDENT: usize = 3;

/// The longest markdown, in bytes, the rewrite scans; a longer body is kept
/// as written. Far above any real task body, it bounds the work one request
/// can cause.
pub const MAX_REWRITE_BYTES: usize = 256 * 1024;

/// The column a tab advances to the next multiple of.
const TAB_STOP: usize = 4;

/// Characters that end a sentence after a bare URL rather than belong to it.
const TRAILING_PUNCTUATION: &[char] = &['.', ',', ';', ':', '!', '?', '\'', '"'];

/// Markdown with its app links chipped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rewritten<'a> {
    /// The markdown, borrowed when it had no app links.
    pub markdown: Cow<'a, str>,
    /// How many links became chips.
    pub chips: usize,
    /// Whether the markdown was longer than [`MAX_REWRITE_BYTES`] and so kept
    /// as written without a scan.
    pub skipped_oversize: bool,
}

/// Rewrites links to items in one Macro web app into mention chips.
#[derive(Debug, Clone)]
pub struct AppLinkChips {
    scheme: String,
    host: String,
    port: Option<u16>,
}

impl AppLinkChips {
    /// Recognize links to the app served at `app_url`, e.g. `https://macro.com`.
    pub fn new(app_url: &str) -> Result<Self, url::ParseError> {
        let url = url::Url::parse(app_url)?;
        let host = url.host_str().ok_or(url::ParseError::EmptyHost)?;
        Ok(Self {
            scheme: url.scheme().to_owned(),
            host: bare_host(host).to_owned(),
            port: url.port_or_known_default(),
        })
    }

    /// Replace every link to an app item in `markdown` with its chip. Code
    /// blocks, code spans and existing mention tags are left as written, and
    /// so is markdown longer than [`MAX_REWRITE_BYTES`].
    pub fn rewrite<'a>(&self, markdown: &'a str) -> Rewritten<'a> {
        if markdown.len() > MAX_REWRITE_BYTES {
            return Rewritten {
                markdown: Cow::Borrowed(markdown),
                chips: 0,
                skipped_oversize: true,
            };
        }
        let mut out = String::new();
        let mut chips = 0;
        let mut open_fence: Option<Fence> = None;
        for line in markdown.split_inclusive('\n') {
            match (open_fence, fence(line)) {
                (None, Some(opening)) => {
                    open_fence = Some(opening);
                    out.push_str(line);
                    continue;
                }
                (Some(opening), Some(closing))
                    if !closing.item
                        && closing.quotes == opening.quotes
                        && closing.indent <= opening.indent + MAX_CLOSING_INDENT
                        && closing.run.starts_with(opening.run)
                        && closing.info.trim().is_empty() =>
                {
                    open_fence = None;
                    out.push_str(line);
                    continue;
                }
                (Some(_), _) => {
                    out.push_str(line);
                    continue;
                }
                (None, None) => {}
            }
            let mut written = 0;
            for protected in protected_spans(line) {
                chips += self.rewrite_text(&line[written..protected.start], &mut out);
                out.push_str(&line[protected.clone()]);
                written = protected.end;
            }
            chips += self.rewrite_text(&line[written..], &mut out);
        }
        Rewritten {
            markdown: if chips > 0 {
                Cow::Owned(out)
            } else {
                Cow::Borrowed(markdown)
            },
            chips,
            skipped_oversize: false,
        }
    }

    /// Append `text` to `out` with its app links chipped; how many were.
    fn rewrite_text(&self, text: &str, out: &mut String) -> usize {
        let mut chips = 0;
        let mut written = 0;
        for captures in lazy_regex::regex!(
            r"\[[^\[\]\n]*\]\((?P<inline>[^()\s]+)\)|<(?P<auto>https?://[^<>\s]+)>|(?P<bare>https?://[^\s<>()\[\]`]+)"
        )
        .captures_iter(text)
        {
            let Some(whole) = captures.get(0) else {
                continue;
            };
            let (url, trailing) = if let Some(inline) = captures.name("inline") {
                // An image is not a link to the item.
                if text[..whole.start()].ends_with('!') {
                    continue;
                }
                (inline.as_str(), "")
            } else if let Some(auto) = captures.name("auto") {
                (auto.as_str(), "")
            } else if let Some(bare) = captures.name("bare") {
                // A link the inline pattern refused (one with a title), a
                // reference definition or an HTML attribute: chipping the URL
                // would break the syntax around it.
                let before = &text[..whole.start()];
                if ["](", "]: ", "=\"", "='"].iter().any(|opening| before.ends_with(opening)) {
                    continue;
                }
                let url = bare.as_str().trim_end_matches(TRAILING_PUNCTUATION);
                (url, &bare.as_str()[url.len()..])
            } else {
                continue;
            };
            let Some(chip) = self.chip(url) else {
                continue;
            };
            out.push_str(&text[written..whole.start()]);
            out.push_str(&chip);
            out.push_str(trailing);
            written = whole.end();
            chips += 1;
        }
        out.push_str(&text[written..]);
        chips
    }

    /// The chip for `url` when it opens an item of this app.
    fn chip(&self, url: &str) -> Option<String> {
        let url = url::Url::parse(url).ok()?;
        if url.scheme() != self.scheme
            || bare_host(url.host_str()?) != self.host
            || url.port_or_known_default() != self.port
        {
            return None;
        }
        let mut segments: Vec<&str> = url.path_segments()?.collect();
        if segments.last() == Some(&"") {
            segments.pop();
        }
        let ["app", route, id] = segments.as_slice() else {
            return None;
        };
        let block = ROUTE_BLOCKS
            .iter()
            .find_map(|(name, block)| (name == route).then_some(*block))?;
        if !lazy_regex::regex_is_match!(
            r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
            id
        ) {
            return None;
        }
        let params: BTreeMap<String, String> = url
            .query_pairs()
            .filter(|(key, _)| !IGNORED_PARAMS.contains(&key.as_ref()))
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        // Serializing strings into JSON cannot fail.
        app_item_mention(id, block, &params).ok()
    }
}

/// `www.macro.com` serves the same app as `macro.com`.
fn bare_host(host: &str) -> &str {
    host.strip_prefix("www.").unwrap_or(host)
}

/// A line that opens or closes a fenced code block.
#[derive(Debug, Clone, Copy)]
struct Fence<'a> {
    /// How many `>` quote markers come before it: a fence closes only at the
    /// quote depth it opened at.
    quotes: usize,
    /// Its column inside its quote, list marker included, with tabs
    /// advancing to the next tab stop.
    indent: usize,
    /// Whether a list item's marker comes before it; such a line opens a
    /// fence but never closes one.
    item: bool,
    /// Its run of backticks or tildes.
    run: &'a str,
    /// The rest of the line after the run.
    info: &'a str,
}

/// The fence `line` opens or closes a fenced code block with. Fences in list
/// items are indented or follow the item's marker, and fences in quotes follow
/// `>`, so all of those count. A backtick run followed by another backtick is
/// a code span, not a fence.
fn fence(line: &str) -> Option<Fence<'_>> {
    let captures = lazy_regex::regex!(
        r"^(?P<prefix>[ \t>]*)(?P<item>(?:[-*+]|[0-9]{1,9}[.)])[ \t]+)?(?P<run>`{3,}|~{3,})(?P<info>[^\n]*)"
    )
    .captures(line)?;
    let prefix = captures.name("prefix")?.as_str();
    let item = captures.name("item").map_or("", |item| item.as_str());
    let run = captures.name("run")?.as_str();
    let info = captures.name("info")?.as_str();
    if run.starts_with('`') && info.contains('`') {
        return None;
    }
    let quoted = prefix.rfind('>').map_or(0, |at| at + 1);
    let indent = prefix
        .get(quoted..)
        .unwrap_or_default()
        .chars()
        .chain(item.chars())
        .fold(0, |column, c| {
            if c == '\t' {
                column + TAB_STOP - column % TAB_STOP
            } else {
                column + 1
            }
        });
    Some(Fence {
        quotes: prefix.matches('>').count(),
        indent,
        item: !item.is_empty(),
        run,
        info,
    })
}

/// The byte ranges of `line` to leave as written: mention tags, from an
/// opening tag to the next closing one, and code spans, which close only on a
/// backtick run as long as the one they open with. Whichever opens first wins;
/// an opening with no close is literal text. Linear in the line: every token
/// is short, and each one's close is found in one pass from the right.
fn protected_spans(line: &str) -> Vec<std::ops::Range<usize>> {
    let tokens: Vec<_> = lazy_regex::regex!(r"</?m-[a-z-]+>|`+")
        .find_iter(line)
        .collect();
    let mut next_run_of_length = std::collections::HashMap::new();
    let mut next_closing_tag = None;
    let mut closes_at: Vec<Option<usize>> = tokens
        .iter()
        .enumerate()
        .rev()
        .map(|(at, token)| match token.as_str().as_bytes() {
            [b'`', ..] => next_run_of_length.insert(token.len(), at),
            [b'<', b'/', ..] => {
                next_closing_tag = Some(at);
                None
            }
            _ => next_closing_tag,
        })
        .collect();
    closes_at.reverse();
    let mut spans = Vec::new();
    let mut at = 0;
    while let Some(token) = tokens.get(at) {
        let close = closes_at
            .get(at)
            .copied()
            .flatten()
            .and_then(|close| Some((close, tokens.get(close)?)));
        match close {
            Some((close, close_token)) => {
                spans.push(token.start()..close_token.end());
                at = close + 1;
            }
            None => at += 1,
        }
    }
    spans
}
