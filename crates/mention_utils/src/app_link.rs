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
    pub fn rewrite<'a>(&self, markdown: &'a str) -> Cow<'a, str> {
        let mut out = String::new();
        let mut changed = false;
        let mut in_fence = false;
        for line in markdown.split_inclusive('\n') {
            if is_fence(line) {
                in_fence = !in_fence;
                out.push_str(line);
                continue;
            }
            if in_fence {
                out.push_str(line);
                continue;
            }
            let mut written = 0;
            for protected in
                lazy_regex::regex!(r"<(m-[a-z-]+)>.*?</m-[a-z-]+>|`+[^`]*`+").find_iter(line)
            {
                changed |= self.rewrite_text(&line[written..protected.start()], &mut out);
                out.push_str(protected.as_str());
                written = protected.end();
            }
            changed |= self.rewrite_text(&line[written..], &mut out);
        }
        if changed {
            Cow::Owned(out)
        } else {
            Cow::Borrowed(markdown)
        }
    }

    /// Append `text` to `out` with its app links chipped; whether any were.
    fn rewrite_text(&self, text: &str, out: &mut String) -> bool {
        let mut changed = false;
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
            changed = true;
        }
        out.push_str(&text[written..]);
        changed
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
fn is_fence(line: &str) -> bool {
    let trimmed = line.trim_start_matches(' ');
    line.len() - trimmed.len() <= 3 && (trimmed.starts_with("```") || trimmed.starts_with("~~~"))
}
