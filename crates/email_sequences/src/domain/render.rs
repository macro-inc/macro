//! Sequence validation, and rendering a step for one person when it is created.

#[cfg(test)]
mod test;

use super::models::{Recipient, Step};
use lazy_regex::regex;

// The editor stops at these; the server refuses past them.
const MAX_NAME: usize = 200;
const MAX_STEPS: usize = 20;
const MAX_SUBJECT: usize = 300;
const MAX_BODY: usize = 50_000;
const MAX_FOOTER: usize = 300;
/// What a missing name personalizes to.
const FALLBACK_NAME: &str = "there";

/// What is wrong with a sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, strum::IntoStaticStr)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Problem {
    /// The name is blank.
    NameRequired,
    /// There are no steps.
    StepsRequired,
    /// A step that starts a thread has no subject.
    SubjectRequired,
    /// A body is blank.
    BodyRequired,
    /// A name, footer, subject or body is too long, or there are too many steps.
    OverLimit,
    /// Text uses a personalization token no contact can fill.
    UnknownToken,
    /// No inbox is chosen, or it isn't the owner's connected Gmail inbox.
    SenderUnavailable,
}

/// A validation failure, with the 1-based step it was found in.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid sequence: {problem:?}")]
pub struct InvalidSequence {
    /// What is wrong.
    pub problem: Problem,
    /// The step, when the problem is in one.
    pub position: Option<usize>,
    /// The unknown tokens, for [`Problem::UnknownToken`].
    pub tokens: Vec<String>,
}

impl InvalidSequence {
    pub(super) fn new(problem: Problem, position: Option<usize>) -> Self {
        Self {
            problem,
            position,
            tokens: Vec::new(),
        }
    }
}

/// Checks that hold on every save: limits and tokens. A draft may still be
/// incomplete.
pub fn check_limits(name: &str, footer: &str, steps: &[Step]) -> Result<(), InvalidSequence> {
    if name.chars().count() > MAX_NAME
        || footer.chars().count() > MAX_FOOTER
        || steps.len() > MAX_STEPS
    {
        return Err(InvalidSequence::new(Problem::OverLimit, None));
    }
    check_tokens(footer, None)?;
    for (index, step) in steps.iter().enumerate() {
        let position = Some(index + 1);
        if step.subject.chars().count() > MAX_SUBJECT || step.body.chars().count() > MAX_BODY {
            return Err(InvalidSequence::new(Problem::OverLimit, position));
        }
        check_tokens(&step.subject, position)?;
        check_tokens(&step.body, position)?;
    }
    Ok(())
}

/// Checks a sequence must also pass before it can send.
pub fn check_complete(name: &str, footer: &str, steps: &[Step]) -> Result<(), InvalidSequence> {
    check_limits(name, footer, steps)?;
    if name.trim().is_empty() {
        return Err(InvalidSequence::new(Problem::NameRequired, None));
    }
    if steps.is_empty() {
        return Err(InvalidSequence::new(Problem::StepsRequired, None));
    }
    for (index, step) in steps.iter().enumerate() {
        let position = Some(index + 1);
        if !step.as_reply && step.subject.trim().is_empty() {
            return Err(InvalidSequence::new(Problem::SubjectRequired, position));
        }
        if step.body.trim().is_empty() {
            return Err(InvalidSequence::new(Problem::BodyRequired, position));
        }
    }
    Ok(())
}

fn check_tokens(text: &str, position: Option<usize>) -> Result<(), InvalidSequence> {
    let tokens = unknown_tokens(text);
    if tokens.is_empty() {
        Ok(())
    } else {
        Err(InvalidSequence {
            problem: Problem::UnknownToken,
            position,
            tokens,
        })
    }
}

/// A personalization token, `{{ name }}`; the name is the first group.
static TOKEN: lazy_regex::Lazy<lazy_regex::Regex> = lazy_regex::lazy_regex!(r"\{\{\s*(\w+)\s*\}\}");

/// Tokens a contact can't fill in, including a stray `{{` or `}}`.
fn unknown_tokens(text: &str) -> Vec<String> {
    let mut unknown: Vec<String> = TOKEN
        .captures_iter(text)
        .filter(|token| !matches!(&token[1], "firstName" | "name" | "email"))
        .map(|token| token[0].to_owned())
        .collect();
    let rest = TOKEN.replace_all(text, " ");
    for stray in regex!(r"\{\{|\}\}").find_iter(&rest) {
        let line_start = rest[..stray.start()].rfind('\n').map_or(0, |at| at + 1);
        let line_end = rest[stray.end()..]
            .find('\n')
            .map_or(rest.len(), |at| stray.end() + at);
        let fragment: String = if stray.as_str() == "{{" {
            rest[stray.start()..line_end].chars().take(24).collect()
        } else {
            let before: Vec<char> = rest[line_start..stray.start()].chars().collect();
            let keep = before.len().saturating_sub(22);
            before[keep..].iter().collect::<String>() + "}}"
        };
        unknown.push(fragment.trim().to_owned());
    }
    let mut seen = std::collections::HashSet::new();
    unknown.retain(|token| seen.insert(token.clone()));
    unknown
}

/// Longest name personalization uses.
const MAX_NAME_CHARS: usize = 100;

/// A CRM name made safe to put in an email: control and direction-override
/// characters removed and the length capped. A name that looks like a link or
/// an address (spoofed senders put text there) is treated as missing.
pub fn sanitize_name(name: &str) -> Option<String> {
    let cleaned: String = name
        .chars()
        .filter(|c| !c.is_control() && !is_invisible(*c))
        .take(MAX_NAME_CHARS)
        .collect();
    let cleaned = cleaned.trim();
    let looks_like_markup = cleaned.contains("://")
        || cleaned.contains("//")
        || cleaned.contains(['@', '[', ']', '<', '>', '*', '`', '|', '\\']);
    (!cleaned.is_empty() && !looks_like_markup).then(|| cleaned.to_owned())
}

/// Format characters that render as nothing or reorder text: zero-width
/// spaces, joiners other than the emoji joiner, direction marks and overrides,
/// word joiners, the byte-order mark and tag characters.
fn is_invisible(c: char) -> bool {
    matches!(
        c,
        '\u{00ad}'
            | '\u{061c}'
            | '\u{180e}'
            | '\u{200b}'
            | '\u{200c}'
            | '\u{200e}'
            | '\u{200f}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2060}'..='\u{206f}'
            | '\u{feff}'
            | '\u{fff9}'..='\u{fffb}'
            | '\u{e0000}'..='\u{e007f}'
    )
}

/// Text as it is stored: control characters other than line breaks and tabs
/// removed (Postgres rejects NUL, and none of them belong in an email).
pub fn clean_text(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t'))
        .collect()
}

/// A subject as it is stored: one header line.
pub fn clean_subject(subject: &str) -> String {
    clean_text(&regex!(r"[\r\n]+").replace_all(subject, " "))
}

/// The first name to greet someone by, from a display name.
fn first_name(name: &str) -> &str {
    if name.to_lowercase().starts_with("the ") {
        return name.trim_end_matches(',');
    }
    let trimmed = name.trim();
    // "Last, First [Middle]", as Outlook writes names. A comma after more
    // than one word starts a suffix instead: "Ada Lovelace, PhD".
    if let Some((last, rest)) = trimmed.split_once(',')
        && !last.trim().contains(char::is_whitespace)
        && let Some(first) = rest.split_whitespace().next()
    {
        return first.trim_end_matches(',');
    }
    trimmed
        .split(' ')
        .next()
        .unwrap_or_default()
        .trim_end_matches(',')
}

/// Fill `{{firstName}}`, `{{name}}` and `{{email}}` for a recipient.
fn personalize(text: &str, recipient: &Recipient) -> String {
    let name = recipient.name.as_deref().unwrap_or_default();
    let first = match first_name(name) {
        "" => FALLBACK_NAME,
        first => first,
    };
    let full = match name.trim() {
        "" => FALLBACK_NAME,
        full => full,
    };
    TOKEN
        .replace_all(text, |token: &lazy_regex::Captures| match &token[1] {
            "firstName" => first.to_owned(),
            "name" => full.to_owned(),
            "email" => recipient.email.clone(),
            _ => token[0].to_owned(),
        })
        .into_owned()
}

/// A subject replying in a thread.
pub fn reply_subject(subject: &str) -> String {
    let prefixed = subject
        .trim_start()
        .get(..3)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("re:"));
    if prefixed {
        subject.to_owned()
    } else {
        format!("Re: {subject}")
    }
}

/// The index of the step that starts `index`'s thread.
fn thread_root(steps: &[Step], index: usize) -> usize {
    let mut root = index.min(steps.len().saturating_sub(1));
    while root > 0 && steps.get(root).is_some_and(|step| step.as_reply) {
        root -= 1;
    }
    root
}

/// One email, rendered for its recipient.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rendered {
    /// The subject of the step's thread; a reply sent in that thread uses
    /// [`reply_subject`] of what was sent instead.
    pub subject: String,
    /// The body with the footer and unsubscribe link under it.
    pub body: String,
}

/// Step `index` as `recipient` gets it: personalized, with its thread's
/// subject, and the footer plus unsubscribe link under the body.
pub fn render(
    steps: &[Step],
    index: usize,
    footer: &str,
    recipient: &Recipient,
    unsubscribe_url: &str,
) -> Rendered {
    let footer = footer.trim();
    let signoff = if footer.is_empty() {
        format!("Unsubscribe: {unsubscribe_url}")
    } else {
        format!(
            "{}\nUnsubscribe: {unsubscribe_url}",
            personalize(footer, recipient)
        )
    };
    let subject = steps
        .get(thread_root(steps, index))
        .map_or("", |root| root.subject.as_str());
    let body = steps.get(index).map_or("", |step| step.body.as_str());
    Rendered {
        // A name can carry line breaks; a subject must stay one header line.
        subject: clean_subject(&personalize(subject, recipient)),
        body: format!("{}\n\n{signoff}", personalize(body, recipient)),
    }
}
