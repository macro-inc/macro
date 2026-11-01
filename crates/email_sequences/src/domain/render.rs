//! Sequence validation and the per-contact rendering frozen into enrollments.

#[cfg(test)]
mod test;

use super::models::{Recipient, Step};
use lazy_regex::regex;

/// Longest sequence name.
pub const MAX_NAME: usize = 200;
/// Most steps in a sequence.
pub const MAX_STEPS: usize = 20;
/// Longest subject template.
pub const MAX_SUBJECT: usize = 300;
/// Longest body template.
pub const MAX_BODY: usize = 50_000;
/// Longest footer line.
pub const MAX_FOOTER: usize = 300;
/// Longest delay between two steps.
pub const MAX_DELAY_DAYS: u16 = 365;
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
    /// The name is too long.
    NameTooLong,
    /// The footer is too long.
    FooterTooLong,
    /// There are no steps.
    StepsRequired,
    /// There are too many steps.
    TooManySteps,
    /// The first step can't reply to anything.
    FirstStepIsReply,
    /// A step that starts a thread has no subject.
    SubjectRequired,
    /// A subject has a line break.
    SubjectSingleLine,
    /// A subject is too long.
    SubjectTooLong,
    /// A body is blank.
    BodyRequired,
    /// A body is too long.
    BodyTooLong,
    /// A delay is out of range.
    DelayRange,
    /// Text uses a personalization token no contact can fill.
    UnknownToken,
    /// No sending inbox is chosen.
    SenderRequired,
    /// The chosen inbox isn't the owner's connected Gmail inbox.
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
    fn new(problem: Problem, position: Option<usize>) -> Self {
        Self {
            problem,
            position,
            tokens: Vec::new(),
        }
    }
}

/// Checks that hold on every save: limits, single-line subjects and tokens.
/// A draft may still be incomplete.
pub fn check_limits(name: &str, footer: &str, steps: &[Step]) -> Result<(), InvalidSequence> {
    if name.chars().count() > MAX_NAME {
        return Err(InvalidSequence::new(Problem::NameTooLong, None));
    }
    if footer.chars().count() > MAX_FOOTER {
        return Err(InvalidSequence::new(Problem::FooterTooLong, None));
    }
    check_tokens(footer, None)?;
    if steps.len() > MAX_STEPS {
        return Err(InvalidSequence::new(Problem::TooManySteps, None));
    }
    for (index, step) in steps.iter().enumerate() {
        let position = Some(index + 1);
        if index == 0 && step.as_reply {
            return Err(InvalidSequence::new(Problem::FirstStepIsReply, position));
        }
        if step.subject.contains(['\r', '\n']) {
            return Err(InvalidSequence::new(Problem::SubjectSingleLine, position));
        }
        if step.subject.chars().count() > MAX_SUBJECT {
            return Err(InvalidSequence::new(Problem::SubjectTooLong, position));
        }
        if step.body.chars().count() > MAX_BODY {
            return Err(InvalidSequence::new(Problem::BodyTooLong, position));
        }
        if step.delay_days > MAX_DELAY_DAYS {
            return Err(InvalidSequence::new(Problem::DelayRange, position));
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

/// Tokens a contact can't fill in, including a stray `{{` or `}}`.
fn unknown_tokens(text: &str) -> Vec<String> {
    let mut unknown: Vec<String> = regex!(r"\{\{\s*(\w+)\s*\}\}")
        .captures_iter(text)
        .filter(|token| !matches!(&token[1], "firstName" | "name" | "email"))
        .map(|token| token[0].to_owned())
        .collect();
    let rest = regex!(r"\{\{\s*\w+\s*\}\}").replace_all(text, " ");
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
        .filter(|c| !c.is_control() && !matches!(c, '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'))
        .take(MAX_NAME_CHARS)
        .collect();
    let cleaned = cleaned.trim();
    (!cleaned.is_empty() && !cleaned.contains("://") && !cleaned.contains('@'))
        .then(|| cleaned.to_owned())
}

/// The first name to greet someone by, from a display name.
fn first_name(name: &str) -> &str {
    if name.to_lowercase().starts_with("the ") {
        return name.trim_end_matches(',');
    }
    let trimmed = name.trim();
    // "Last, First [Middle]", as Outlook writes names.
    if let Some((_, rest)) = trimmed.split_once(',')
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
    regex!(r"\{\{\s*(\w+)\s*\}\}")
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
    if has_reply_prefix(subject.trim_start()) {
        subject.to_owned()
    } else {
        format!("Re: {subject}")
    }
}

/// A reply step's subject when it has nothing to reply to and starts its own thread.
pub fn standalone_subject(subject: &str) -> &str {
    let trimmed = subject.trim_start();
    if has_reply_prefix(trimmed) {
        trimmed[REPLY_PREFIX.len()..].trim_start()
    } else {
        subject
    }
}

const REPLY_PREFIX: &str = "re:";

fn has_reply_prefix(subject: &str) -> bool {
    subject
        .get(..REPLY_PREFIX.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(REPLY_PREFIX))
}

/// The index of the step that starts `index`'s thread.
pub fn thread_root(steps: &[Step], index: usize) -> usize {
    let mut root = index.min(steps.len().saturating_sub(1));
    while root > 0 && steps.get(root).is_some_and(|step| step.as_reply) {
        root -= 1;
    }
    root
}

/// The steps as one recipient gets them: personalized, reply subjects derived
/// from their thread, and the footer plus unsubscribe link under every body.
pub fn render_steps(
    steps: &[Step],
    footer: &str,
    recipient: &Recipient,
    unsubscribe_url: &str,
) -> Vec<Step> {
    let footer = footer.trim();
    let signoff = if footer.is_empty() {
        format!("Unsubscribe: {unsubscribe_url}")
    } else {
        format!(
            "{}\nUnsubscribe: {unsubscribe_url}",
            personalize(footer, recipient)
        )
    };
    steps
        .iter()
        .enumerate()
        .map(|(index, step)| {
            let as_reply = index > 0 && step.as_reply;
            // A name can carry line breaks; a subject must stay one header line.
            let subject = regex!(r"[\r\n]+")
                .replace_all(
                    &personalize(
                        steps
                            .get(thread_root(steps, index))
                            .map_or("", |root| root.subject.as_str()),
                        recipient,
                    ),
                    " ",
                )
                .into_owned();
            Step {
                delay_days: step.delay_days,
                subject: if as_reply {
                    reply_subject(&subject)
                } else {
                    subject
                },
                body: format!("{}\n\n{signoff}", personalize(&step.body, recipient)),
                as_reply,
            }
        })
        .collect()
}
