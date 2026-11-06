//! Code-aware Slack mrkdwn to Macro markdown. Source markup is never trusted as
//! Macro entities. Links and mapped users use native nodes; channel/message
//! references carry source evidence for later authorized resolution. Broadcasts
//! and subteams remain historical display text, not notifications.

use std::collections::BTreeMap;

use macro_user_id::user_id::MacroUserIdStr;
use mention_utils::serialize::ExternalLink;

use crate::domain::models::{ConversationId, SlackUserId};

use super::{
    export::MessageContent,
    references::{
        ConvertedText, MAX_REFERENCES, MAX_SOURCE_BYTES, ReferenceError, ReferenceIntent,
        SourceReference, parse_permalink,
    },
    users::UserDirectory,
};

#[cfg(test)]
mod test;

/// A skip is a counted source message, not a conversion error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkippedMessage {
    /// Channel/group housekeeping, pin, deletion or tombstone event.
    Housekeeping,
    /// No text after conversion; files/attachments/blocks do not supply a body.
    Empty,
}

/// Workers increment messages_skipped once for each `Skipped` result (including
/// `Empty`), and pass only `Text` to the historical sink.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageConversion {
    /// Nonempty Macro markdown.
    Text(String),
    /// Intentionally ignored source message.
    Skipped(SkippedMessage),
}

/// Metadata-bounded conversion context; no history map or network lookup.
pub struct MrkdwnConverter<'a> {
    /// Archive user directory for mention attribution.
    pub users: &'a UserDirectory,
    /// Source channel names for tokens without a label. No Macro channel IDs.
    pub channels: &'a BTreeMap<ConversationId, String>,
}

impl MrkdwnConverter<'_> {
    /// Convert only retained text. Unknown subtypes and file_share are imported;
    /// thread_broadcast is not filtered and its existing thread_ts lookup remains
    /// authoritative. This does not inspect attachments or manufacture a root.
    pub fn message(&self, message: &MessageContent) -> MessageConversion {
        if message.subtype.as_deref().is_some_and(is_housekeeping) {
            return MessageConversion::Skipped(SkippedMessage::Housekeeping);
        }
        let content = self
            .convert_with_italics(
                &message.text,
                message.subtype.as_deref() == Some("me_message"),
                None,
            )
            .expect("legacy conversion has no limits")
            .body;
        if content.trim().is_empty() {
            return MessageConversion::Skipped(SkippedMessage::Empty);
        }
        MessageConversion::Text(content)
    }

    /// Bounded worker conversion retaining only actively emitted mention identities.
    /// Housekeeping and empty messages remain counted skips.
    pub fn message_with_references(
        &self,
        message: &MessageContent,
    ) -> Result<Option<ConvertedText>, ReferenceError> {
        if message.subtype.as_deref().is_some_and(is_housekeeping) {
            return Ok(None);
        }
        let converted = self.convert_with_references(
            &message.text,
            message.subtype.as_deref() == Some("me_message"),
        )?;
        Ok((!converted.body.trim().is_empty()).then_some(converted))
    }

    /// Preserve single-tick spans and line-start triple fences byte-for-byte;
    /// malformed/unsupported code delimiters fall back to escaped text. Elsewhere
    /// decode Slack's three entities once and translate recognized tokens. Encoded
    /// angle brackets never become active Slack or Macro mention syntax.
    pub fn convert(&self, source: &str) -> String {
        self.convert_with_italics(source, false, None)
            .expect("legacy conversion has no limits")
            .body
    }

    /// Additive bounded conversion with explicit reference/mention evidence.
    /// `italic` supports Slack me_message without changing baseline worker APIs.
    pub fn convert_with_references(
        &self,
        source: &str,
        italic: bool,
    ) -> Result<ConvertedText, ReferenceError> {
        if source.len() > MAX_SOURCE_BYTES {
            return Err(ReferenceError::LimitExceeded);
        }
        self.convert_with_italics(source, italic, Some(ConversionBudget::default()))
    }

    fn convert_with_italics(
        &self,
        source: &str,
        italic: bool,
        mut budget: Option<ConversionBudget>,
    ) -> Result<ConvertedText, ReferenceError> {
        let mut tokens = Vec::new();
        let mut openers = Vec::new();
        let mut user_mentions = Vec::new();
        let mut offset = 0;
        while offset < source.len() {
            let rest = &source[offset..];
            let ch = rest.chars().next().expect("nonempty suffix");
            if ch == '`' {
                let mut line_start = offset;
                while line_start > 0
                    && offset - line_start < 3
                    && source.as_bytes()[line_start - 1] == b' '
                {
                    line_start -= 1;
                }
                let fence_position = line_start == 0 || source.as_bytes()[line_start - 1] == b'\n';
                if let Some((length, block)) = code_span(rest, fence_position) {
                    if block {
                        openers.clear();
                        tokens.push(Token::Boundary(rest[..length].to_owned()));
                    } else {
                        push_text(&mut tokens, &rest[..length]);
                    }
                    offset += length;
                    continue;
                }
                // Malformed inline code is literal text, not a safe container for
                // raw entity markup. Consume once to keep adversarial input bounded.
                push_text(&mut tokens, &escape_text(rest));
                break;
            }
            if ch == '\\'
                && let Some(next) = rest[1..].chars().next().filter(char::is_ascii_punctuation)
            {
                push_text(&mut tokens, &escape_text(&next.to_string()));
                offset += 1 + next.len_utf8();
                continue;
            }
            if ch == '\n' {
                openers.clear();
                tokens.push(Token::Boundary("\n".to_owned()));
                offset += 1;
                continue;
            }
            if ch == '<' {
                if let Some(length) = source_macro_tag_span(rest) {
                    push_text(&mut tokens, &escape_text(&unescape(&rest[..length])));
                    offset += length;
                    continue;
                }
                // Stop at nested openers/newlines as well, so malformed input is
                // linear-time rather than repeatedly scanning the entire suffix.
                if let Some(end) = rest[1..].find(['<', '>', '\n']) {
                    let end = end + 1;
                    if rest.as_bytes()[end] == b'>' {
                        let token = self.angle(&rest[1..end], &mut user_mentions);
                        if let Some(budget) = &mut budget {
                            budget.record(&token, user_mentions.len())?;
                        }
                        tokens.push(token);
                        offset += end + 1;
                        continue;
                    }
                    push_text(&mut tokens, &escape_text(&rest[..end]));
                    offset += end;
                    continue;
                }
                push_text(&mut tokens, &escape_text(rest));
                break;
            }
            let before = source[..offset].chars().next_back();
            if (before.is_none_or(|c| {
                !c.is_alphanumeric() && !matches!(c, '_' | '/' | '@' | ':' | '.' | '-')
            }) || matches!(tokens.last(), Some(Token::Delimiter { open: true, .. })))
                && let Some(length) = bare_url_length(rest, &openers)
            {
                let token = self.link(&unescape(&rest[..length]), None);
                if let Some(budget) = &mut budget {
                    budget.record(&token, user_mentions.len())?;
                }
                tokens.push(token);
                offset += length;
                continue;
            }
            let line_start = offset == 0 || source.as_bytes()[offset - 1] == b'\n';
            if line_start && (ch == '>' || rest.starts_with("&gt;")) {
                let mut quote = String::new();
                while source[offset..].starts_with('>') || source[offset..].starts_with("&gt;") {
                    quote.push('>');
                    offset += if source[offset..].starts_with('>') {
                        1
                    } else {
                        4
                    };
                }
                openers.clear();
                tokens.push(Token::Boundary(quote));
                continue;
            }
            if let Some((entity, value)) = slack_entity(rest) {
                push_text(&mut tokens, &escape_text(value));
                offset += entity.len();
                continue;
            }
            if matches!(ch, '*' | '_' | '~') {
                let before = source[..offset].chars().next_back();
                let after = rest[1..].chars().next();
                let open = after.is_some_and(|c| !c.is_whitespace() && c != ch)
                    && before.is_none_or(|c| !c.is_alphanumeric() && c != ch);
                let close = before.is_some_and(|c| !c.is_whitespace() && c != ch)
                    && after.is_none_or(|c| !c.is_alphanumeric() && c != ch);
                push_delimiter(&mut tokens, &mut openers, ch, open, close);
            } else {
                push_text(&mut tokens, &escape_text(&ch.to_string()));
            }
            offset += ch.len_utf8();
        }
        let (body, references) = render(tokens, italic);
        Ok(ConvertedText {
            body,
            references,
            user_mentions,
        })
    }

    fn angle(&self, token: &str, user_mentions: &mut Vec<MacroUserIdStr<'static>>) -> Token {
        let (target, label) = token
            .split_once('|')
            .map_or((token, None), |(a, b)| (a, Some(b)));
        if let Some(raw_id) = target.strip_prefix('@')
            && let Ok(id) = raw_id.parse::<SlackUserId>()
        {
            if let Some(user) = self.users.participant(&id) {
                let mention = mention_utils::serialize::user_mention(&user)
                    .expect("serializing a validated user ID cannot fail");
                user_mentions.push(user);
                return Token::Text(mention);
            }
            let name = label
                .map(unescape)
                .unwrap_or_else(|| self.users.display_name(&id).to_owned());
            return Token::Text(format!("@{}", escape_text(&name)));
        }
        if let Some(raw_id) = target.strip_prefix('#') {
            let name = label
                .or_else(|| {
                    raw_id
                        .parse::<ConversationId>()
                        .ok()
                        .and_then(|id| self.channels.get(&id).map(String::as_str))
                })
                .unwrap_or(raw_id);
            let fallback = format!("#{}", escape_text(&unescape(name)));
            return match raw_id.parse::<ConversationId>() {
                Ok(channel) => Token::Reference {
                    source: SourceReference::Channel { channel },
                    fallback,
                },
                Err(_) => Token::Text(fallback),
            };
        }
        if matches!(target, "!here" | "!channel" | "!everyone") {
            return Token::Text(format!("@{}", &target[1..]));
        }
        if let Some(id) = target.strip_prefix("!subteam^") {
            let name = unescape(label.unwrap_or(id));
            return Token::Text(format!("@{}", escape_text(name.trim_start_matches('@'))));
        }
        if target.starts_with("!date^") {
            return Token::Text(escape_text(&unescape(label.unwrap_or(target))));
        }
        let url = unescape(target);
        let label = label.map(unescape);
        if ExternalLink::new(&url, "").is_ok() {
            return self.link(&url, label.as_deref());
        }
        // Unsafe/unknown links and arbitrary Macro/HTML tags are display text only.
        if let Some(label) = label {
            return Token::Text(escape_text(&label));
        }
        Token::Text(escape_text(&format!("<{}>", unescape(token))))
    }

    fn link(&self, url: &str, label: Option<&str>) -> Token {
        let text = label.unwrap_or_else(|| {
            if url
                .get(..7)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("mailto:"))
            {
                &url[7..]
            } else {
                url
            }
        });
        let Ok(link) = ExternalLink::new(url, text) else {
            return Token::Text(escape_text(text));
        };
        let fallback = link
            .serialize()
            .expect("serializing string fields cannot fail");
        match parse_permalink(url) {
            Some(source) => Token::Reference { source, fallback },
            None => Token::Text(fallback),
        }
    }
}

/// Source-supplied Macro markup is one inert region, including any URLs or Slack
/// tokens inside it. This only identifies literal tag boundaries, never decodes
/// their payload. Unclosed regions remain inert through EOF. Nested tags are
/// counted in one pass so hostile input cannot cause repeated suffix scans.
fn source_macro_tag_span(rest: &str) -> Option<usize> {
    let (first_end, closing, self_closing) = source_macro_tag(rest)?;
    if closing || self_closing {
        return Some(first_end);
    }
    let mut depth = 1usize;
    let mut offset = first_end;
    while let Some(next) = rest[offset..].find('<') {
        offset += next;
        if let Some((length, closing, self_closing)) = source_macro_tag(&rest[offset..]) {
            if closing {
                depth -= 1;
            } else if !self_closing {
                depth += 1;
            }
            offset += length;
            if depth == 0 {
                return Some(offset);
            }
        } else {
            offset += 1;
        }
    }
    Some(rest.len())
}

fn source_macro_tag(rest: &str) -> Option<(usize, bool, bool)> {
    let tag = rest.strip_prefix('<')?;
    let closing = tag.starts_with('/');
    let name = tag.strip_prefix('/').unwrap_or(tag);
    if !name
        .get(..2)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("m-"))
    {
        return None;
    }
    let name_length = name
        .bytes()
        .take_while(|b| b.is_ascii_alphanumeric() || *b == b'-')
        .count();
    let tail = &name[name_length..];
    let self_closing = tail.starts_with("/>");
    if name_length <= 2 || !(tail.starts_with('>') || self_closing) {
        return None;
    }
    Some((
        1 + usize::from(closing) + name_length + 1 + usize::from(self_closing),
        closing,
        self_closing,
    ))
}

/// Return only spans the target markdown parser can also recognize as code.
fn code_span(rest: &str, fence_position: bool) -> Option<(usize, bool)> {
    let run = rest.bytes().take_while(|b| *b == b'`').count();
    // Slack uses single ticks or triple fences. Macro does not recognize arbitrary
    // CommonMark code-span runs, so passing those through could activate <m-*> tags.
    if run != 1 && !(run == 3 && fence_position) {
        return None;
    }
    let mut first_line_end = run;
    // Scan only as far as the next closing run/newline, not the entire remaining
    // line for every span. Exact runs cannot close on part of a longer run.
    while let Some(index) = rest[first_line_end..].find(['`', '\n']) {
        first_line_end += index;
        if rest.as_bytes()[first_line_end] == b'\n' {
            break;
        }
        let closing_run = rest[first_line_end..]
            .bytes()
            .take_while(|b| *b == b'`')
            .count();
        first_line_end += closing_run;
        if closing_run == run {
            return Some((first_line_end, run == 3));
        }
        if run == 1 {
            return None;
        }
    }
    if !rest[first_line_end..].starts_with('\n') {
        first_line_end = rest.len();
    }
    if run < 3 || !fence_position {
        return None;
    }
    let mut offset = first_line_end;
    for line in rest[first_line_end..].split_inclusive('\n') {
        let trimmed = line.trim_start_matches([' ', '\t']);
        let closing_run = trimmed.bytes().take_while(|b| *b == b'`').count();
        // Match Macro's closing fences, including arbitrary space/tab indentation.
        // Missing an accepted close would pass subsequent source tags through raw.
        if closing_run >= run && trimmed[closing_run..].trim().is_empty() {
            return Some((offset + line.trim_end_matches('\n').len(), true));
        }
        offset += line.len();
    }
    // A fence at line start extends through EOF when no closing fence exists.
    Some((rest.len(), true))
}

fn is_housekeeping(subtype: &str) -> bool {
    subtype.starts_with("group_")
        || matches!(
            subtype,
            "channel_join"
                | "channel_leave"
                | "channel_name"
                | "channel_topic"
                | "channel_purpose"
                | "channel_archive"
                | "channel_unarchive"
                | "pinned_item"
                | "unpinned_item"
                | "tombstone"
                | "message_deleted"
        )
}

fn slack_entity(text: &str) -> Option<(&'static str, &'static str)> {
    [("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">")]
        .into_iter()
        .find(|(entity, _)| text.starts_with(entity))
}

fn unescape(text: &str) -> String {
    // Ampersand last prevents recursive decoding of &amp;lt; into an opener.
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn escape_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            '\\' | '`' | '*' | '_' | '~' | '[' | ']' | '(' | ')' | '!' | '#' | '+' | '-' | '.'
            | '|' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

/// Protocol-mode autolinks, like the frontend's default linkify mode. Balanced
/// path parentheses belong to the URL; unmatched closing punctuation does not.
fn bare_url_length(rest: &str, openers: &[(char, usize)]) -> Option<usize> {
    if !["https://", "http://", "mailto:"].iter().any(|prefix| {
        rest.get(..prefix.len())
            .is_some_and(|s| s.eq_ignore_ascii_case(prefix))
    }) {
        return None;
    }
    let authority_start = rest.find("://").map_or(0, |index| index + 3);
    let path_start = rest[authority_start..]
        .find(['/', '?', '#'])
        .map(|index| authority_start + index);
    let mut end = 0;
    let mut parentheses = 0usize;
    for (index, ch) in rest.char_indices() {
        if ch.is_whitespace()
            || ch.is_control()
            || matches!(ch, '<' | '>' | '"' | '\'' | '`' | '\\' | '[' | ']')
        {
            break;
        }
        if path_start.is_none_or(|start| index < start)
            && (matches!(ch, '*' | '~' | ',' | ';' | '!' | '(' | ')')
                || rest[index..].starts_with(".."))
        {
            break;
        }
        if ch == '(' {
            parentheses += 1;
        }
        if ch == ')' {
            if parentheses == 0 {
                break;
            }
            parentheses -= 1;
        }
        end = index + ch.len_utf8();
    }
    let mut candidate = &rest[..end];
    while candidate.ends_with(['.', ',', '!', '?', ':', ';'])
        || openers
            .iter()
            .any(|(marker, _)| candidate.ends_with(*marker))
    {
        // Slack entities belong to the URL and must be decoded before URL
        // validation; their final semicolon is not sentence punctuation.
        if ["&amp;", "&lt;", "&gt;"]
            .iter()
            .any(|entity| candidate.ends_with(entity))
        {
            break;
        }
        candidate = &candidate[..candidate.len() - 1];
    }
    ExternalLink::new(&unescape(candidate), "").ok()?;
    Some(candidate.len())
}

#[derive(Debug)]
enum Token {
    Text(String),
    Reference {
        source: SourceReference,
        fallback: String,
    },
    // Quotes, newlines and code blocks cannot be enclosed by emphasis.
    Boundary(String),
    Delimiter {
        marker: char,
        open: bool,
        matched: bool,
    },
}

/// Bound generated metadata before retaining more tokens, rather than allocating
/// the whole body and only then rejecting it. Source text escaping expands by at
/// most a constant factor; repeated archive names need this independent budget.
#[derive(Default)]
struct ConversionBudget {
    generated_bytes: usize,
    references: usize,
}

impl ConversionBudget {
    fn record(&mut self, token: &Token, user_mentions: usize) -> Result<(), ReferenceError> {
        match token {
            Token::Text(text) => self.generated_bytes += text.len(),
            Token::Reference { fallback, .. } => {
                self.generated_bytes += fallback.len();
                self.references += 1;
            }
            _ => unreachable!("only generated text and references consume this budget"),
        }
        if self.generated_bytes > MAX_SOURCE_BYTES
            || self.references > MAX_REFERENCES
            || user_mentions > MAX_REFERENCES
        {
            return Err(ReferenceError::LimitExceeded);
        }
        Ok(())
    }
}

fn push_text(tokens: &mut Vec<Token>, text: &str) {
    if let Some(Token::Text(previous)) = tokens.last_mut() {
        previous.push_str(text);
    } else {
        tokens.push(Token::Text(text.to_owned()));
    }
}

fn push_delimiter(
    tokens: &mut Vec<Token>,
    openers: &mut Vec<(char, usize)>,
    marker: char,
    open: bool,
    close: bool,
) {
    let index = tokens.len();
    tokens.push(Token::Delimiter {
        marker,
        open,
        matched: false,
    });
    // At most one opener per style. Match while tokenizing so URL boundaries
    // know which trailing style markers belong to surrounding Slack formatting.
    if close && openers.last().is_some_and(|(style, _)| *style == marker) {
        let (_, start) = openers.pop().expect("matching opener");
        for index in [start, index] {
            if let Token::Delimiter { matched, .. } = &mut tokens[index] {
                *matched = true;
            }
        }
    } else if open && !openers.iter().any(|(style, _)| *style == marker) {
        openers.push((marker, index));
    }
}

fn render(tokens: Vec<Token>, italic: bool) -> (String, Vec<ReferenceIntent>) {
    let mut out = String::new();
    let mut segment = String::new();
    let mut references = Vec::new();
    let mut segment_references = Vec::new();
    for token in tokens {
        match token {
            Token::Boundary(text) => {
                flush_segment(
                    &mut out,
                    &segment,
                    italic,
                    &mut segment_references,
                    &mut references,
                );
                segment.clear();
                out.push_str(&text);
            }
            Token::Text(text) => segment.push_str(&text),
            Token::Reference { source, fallback } => {
                let start = segment.len();
                segment.push_str(&fallback);
                segment_references.push(ReferenceIntent {
                    source,
                    range: start..segment.len(),
                    fallback,
                });
            }
            Token::Delimiter {
                marker,
                matched: false,
                ..
            } => segment.push_str(&escape_text(&marker.to_string())),
            Token::Delimiter { marker, .. } => segment.push_str(match marker {
                '*' => "**",
                '_' => "*",
                '~' => "~~",
                _ => unreachable!("only Slack style delimiters are tokenized"),
            }),
        }
    }
    flush_segment(
        &mut out,
        &segment,
        italic,
        &mut segment_references,
        &mut references,
    );
    (out, references)
}

fn flush_segment(
    out: &mut String,
    segment: &str,
    italic: bool,
    pending: &mut Vec<ReferenceIntent>,
    references: &mut Vec<ReferenceIntent>,
) {
    // References have non-whitespace fallbacks, so the action's opening underscore
    // always precedes them (even when leading segment whitespace is preserved).
    let offset = out.len() + usize::from(italic && !segment.trim().is_empty());
    references.extend(pending.drain(..).map(|mut intent| {
        intent.range.start += offset;
        intent.range.end += offset;
        intent
    }));
    append_segment(out, segment, italic);
}

fn append_segment(out: &mut String, text: &str, italic: bool) {
    let trimmed = text.trim();
    if !italic || trimmed.is_empty() {
        out.push_str(text);
        return;
    }
    let leading = text.len() - text.trim_start().len();
    out.push_str(&text[..leading]);
    // A distinct delimiter avoids turning existing *italic* into **bold**.
    out.push('_');
    out.push_str(trimmed);
    out.push('_');
    out.push_str(&text[leading + trimmed.len()..]);
}
