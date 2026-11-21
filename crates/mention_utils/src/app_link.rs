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

/// Characters that end a sentence after a bare URL rather than belong to it.
const TRAILING_PUNCTUATION: &[char] = &['.', ',', ';', ':', '!', '?', '\'', '"'];

/// Markdown with its app links chipped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rewritten<'a> {
    /// The markdown, borrowed when it had no app links.
    pub markdown: Cow<'a, str>,
    /// How many links became chips.
    pub chips: usize,
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
    /// blocks, code spans and existing mention tags are left as written.
    pub fn rewrite<'a>(&self, markdown: &'a str) -> Rewritten<'a> {
        let mut out = String::new();
        let mut chips = 0;
        let mut open_fence: Option<&str> = None;
        for line in markdown.split_inclusive('\n') {
            match (open_fence, fence(line)) {
                (None, Some((opening, _))) => {
                    open_fence = Some(opening);
                    out.push_str(line);
                    continue;
                }
                (Some(opening), Some((closing, info)))
                    if closing.starts_with(opening) && info.trim().is_empty() =>
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

/// The fence (its run of backticks or tildes) a line opens or closes a fenced
/// code block with, and the rest of the line after it. Fences in list items
/// are indented and fences in quotes follow `>`, so both count.
fn fence(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.trim_start_matches(|c: char| c == '>' || c.is_whitespace());
    let marker = trimmed.chars().next().filter(|c| matches!(c, '`' | '~'))?;
    let rest = trimmed.trim_start_matches(marker);
    let run = &trimmed[..trimmed.len() - rest.len()];
    (run.len() >= 3).then_some((run, rest))
}

/// The byte ranges of `line` to leave as written: mention tags, and code
/// spans, which close only on a backtick run as long as the one they open
/// with. A run with no match is a literal backtick, not a span.
fn protected_spans(line: &str) -> Vec<std::ops::Range<usize>> {
    let mut spans = Vec::new();
    let mut from = 0;
    while let Some(found) = lazy_regex::regex!(r"<m-[a-z-]+>.*?</m-[a-z-]+>|`+").find_at(line, from)
    {
        if !found.as_str().starts_with('`') {
            spans.push(found.range());
            from = found.end();
            continue;
        }
        let closing = lazy_regex::regex!(r"`+")
            .find_iter(&line[found.end()..])
            .find(|run| run.len() == found.len());
        match closing {
            Some(closing) => {
                let end = found.end() + closing.end();
                spans.push(found.start()..end);
                from = end;
            }
            None => from = found.end(),
        }
    }
    spans
}
