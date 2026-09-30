//! Code-aware Slack mrkdwn to Macro markdown. Source markup is never trusted as
//! Macro entities. Only mapped Slack user tokens emit internal mention markup;
//! broadcasts, channels and subteams are historical display text, not notifications.

use std::collections::BTreeMap;

use crate::domain::models::{ConversationId, SlackUserId};

use super::{export::MessageContent, users::UserDirectory};

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
        let content = self.convert_with_italics(
            &message.text,
            message.subtype.as_deref() == Some("me_message"),
        );
        if content.trim().is_empty() {
            return MessageConversion::Skipped(SkippedMessage::Empty);
        }
        MessageConversion::Text(content)
    }

    /// Preserve single-tick spans and line-start triple fences byte-for-byte;
    /// malformed/unsupported code delimiters fall back to escaped text. Elsewhere
    /// decode Slack's three entities once and translate recognized tokens. Encoded
    /// angle brackets never become active Slack or Macro mention syntax.
    pub fn convert(&self, source: &str) -> String {
        self.convert_with_italics(source, false)
    }

    fn convert_with_italics(&self, source: &str, italic: bool) -> String {
        let mut tokens = Vec::new();
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
                tokens.push(Token::Boundary("\n".to_owned()));
                offset += 1;
                continue;
            }
            if ch == '<' {
                // Stop at nested openers/newlines as well, so malformed input is
                // linear-time rather than repeatedly scanning the entire suffix.
                if let Some(end) = rest[1..].find(['<', '>', '\n']) {
                    let end = end + 1;
                    if rest.as_bytes()[end] == b'>' {
                        push_text(&mut tokens, &self.angle(&rest[1..end]));
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
                tokens.push(Token::Delimiter {
                    marker: ch,
                    open: after.is_some_and(|c| !c.is_whitespace() && c != ch)
                        && before.is_none_or(|c| !c.is_alphanumeric() && c != ch),
                    close: before.is_some_and(|c| !c.is_whitespace() && c != ch)
                        && after.is_none_or(|c| !c.is_alphanumeric() && c != ch),
                    matched: false,
                });
            } else {
                push_text(&mut tokens, &escape_text(&ch.to_string()));
            }
            offset += ch.len_utf8();
        }
        render(tokens, italic)
    }

    fn angle(&self, token: &str) -> String {
        let (target, label) = token
            .split_once('|')
            .map_or((token, None), |(a, b)| (a, Some(b)));
        if let Some(raw_id) = target.strip_prefix('@')
            && let Ok(id) = raw_id.parse::<SlackUserId>()
        {
            if let Some(user) = self.users.participant(&id) {
                return mention_utils::serialize::user_mention(&user)
                    .expect("serializing a validated user ID cannot fail");
            }
            let name = label
                .map(unescape)
                .unwrap_or_else(|| self.users.display_name(&id).to_owned());
            return format!("@{}", escape_text(&name));
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
            return format!("#{}", escape_text(&unescape(name)));
        }
        if matches!(target, "!here" | "!channel" | "!everyone") {
            return format!("@{}", &target[1..]);
        }
        if let Some(id) = target.strip_prefix("!subteam^") {
            let name = unescape(label.unwrap_or(id));
            return format!("@{}", escape_text(name.trim_start_matches('@')));
        }
        if target.starts_with("!date^") {
            return escape_text(&unescape(label.unwrap_or(target)));
        }
        let url = unescape(target);
        if safe_url(&url) {
            if let Some(label) = label {
                return format!(
                    "[{}]({})",
                    escape_text(&unescape(label)),
                    link_destination(&url)
                );
            }
            if url.to_ascii_lowercase().starts_with("mailto:") {
                return format!("[{}]({})", escape_text(&url[7..]), link_destination(&url));
            }
            return escape_text(&url);
        }
        // Unsafe/unknown links and arbitrary Macro/HTML tags are display text only.
        if let Some(label) = label {
            return escape_text(&unescape(label));
        }
        escape_text(&format!("<{}>", unescape(token)))
    }
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

fn safe_url(url: &str) -> bool {
    if url.chars().any(|c| {
        c.is_whitespace() || c.is_control() || matches!(c, '<' | '>' | '\\' | '"' | '\'' | '`')
    }) {
        return false;
    }
    let Some((scheme, rest)) = url.split_once(':') else {
        return false;
    };
    match scheme.to_ascii_lowercase().as_str() {
        "http" | "https" => rest
            .strip_prefix("//")
            .is_some_and(|host| !host.is_empty() && !host.starts_with('/')),
        "mailto" => !rest.is_empty(),
        _ => false,
    }
}

fn link_destination(url: &str) -> String {
    url.replace('(', "%28")
        .replace(')', "%29")
        .replace('[', "%5B")
        .replace(']', "%5D")
}

#[derive(Debug)]
enum Token {
    Text(String),
    // Quotes, newlines and code blocks cannot be enclosed by emphasis.
    Boundary(String),
    Delimiter {
        marker: char,
        open: bool,
        close: bool,
        matched: bool,
    },
}

fn push_text(tokens: &mut Vec<Token>, text: &str) {
    if let Some(Token::Text(previous)) = tokens.last_mut() {
        previous.push_str(text);
    } else {
        tokens.push(Token::Text(text.to_owned()));
    }
}

fn render(mut tokens: Vec<Token>, italic: bool) -> String {
    // At most one opener per style. No recursion or unbounded nesting on input.
    let mut openers: Vec<(char, usize)> = Vec::new();
    for i in 0..tokens.len() {
        if matches!(tokens[i], Token::Boundary(_)) {
            openers.clear();
        }
        let Token::Delimiter {
            marker,
            open,
            close,
            ..
        } = tokens[i]
        else {
            continue;
        };
        if close && openers.last().is_some_and(|(style, _)| *style == marker) {
            let (_, start) = openers.pop().expect("matching opener");
            for index in [start, i] {
                if let Token::Delimiter { matched, .. } = &mut tokens[index] {
                    *matched = true;
                }
            }
        } else if open && !openers.iter().any(|(style, _)| *style == marker) {
            openers.push((marker, i));
        }
    }
    let mut out = String::new();
    let mut segment = String::new();
    for token in tokens {
        match token {
            Token::Boundary(text) => {
                append_segment(&mut out, &segment, italic);
                segment.clear();
                out.push_str(&text);
            }
            Token::Text(text) => segment.push_str(&text),
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
    append_segment(&mut out, &segment, italic);
    out
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
