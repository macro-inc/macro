//! What Jev and the due date extractor read about a thread: the owner's profile
//! and the latest messages.

use chrono::{DateTime, NaiveDate};
use chrono_tz::Tz;
use serde_json::{Value, json};

use super::models::{DueDateInput, DueDateMessage, FocusMessage, FocusThread};

/// Messages shown to Jev, counting back from the latest.
const SHOWN_MESSAGES: usize = 3;
/// Characters of text per shown message.
const MESSAGE_CHARS: usize = 1_500;
/// New text shorter than this is a bump ("waiting to hear back"); Jev gets the
/// whole body instead, so the original request is still in view.
const BUMP_CHARS: usize = 200;
/// Characters of the owner's profile passed as context.
const PROFILE_CHARS: usize = 30_000;
/// Characters of the thread's subject the due date extractor reads.
const DUE_DATE_SUBJECT_CHARS: usize = 300;
/// To and Cc addresses shown per message; a distribution list stays readable.
const SHOWN_RECIPIENTS: usize = 20;
/// Replies longer than this are never brush-offs.
const BRUSH_OFF_WORDS: usize = 20;
/// Words that make a short reply a brush-off rather than a conversation.
const BRUSH_OFF_PHRASES: [&str; 5] = [
    "not interested",
    "no thanks",
    "no thank you",
    "unsubscribe",
    "remove me",
];

/// Messages that end the exchange ("Thanks!", "Got it"): nobody owes a reply to
/// one, though unlike a brush-off it says nothing bad about the relationship.
const CLOSING_PHRASES: [&str; 20] = [
    "thanks",
    "thanks so much",
    "thanks a lot",
    "thanks very much",
    "thank you",
    "thank you so much",
    "thank you very much",
    "many thanks",
    "thx",
    "ty",
    "cheers",
    "got it",
    "sounds good",
    "will do",
    "noted",
    "great",
    "perfect",
    "awesome",
    "ok",
    "okay",
];
/// Words a closing line can carry after its phrase: a name, as in "Thanks Ava!".
const CLOSING_LINE_EXTRA_WORDS: usize = 1;
/// Words a later line can have and still read as a signature.
const SIGNATURE_LINE_WORDS: usize = 3;

/// The part of a plain-text body above the quoted history.
pub fn new_text(body: &str) -> String {
    let mut kept = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if starts_quoted_history(trimmed) {
            break;
        }
        if trimmed.starts_with('>') {
            continue;
        }
        kept.push(trimmed);
    }
    kept.join("\n").trim().to_owned()
}

fn starts_quoted_history(line: &str) -> bool {
    (line.starts_with("On ") && line.ends_with("wrote:") && line.len() <= 250)
        || (line.starts_with("--") && line.contains("Original Message"))
        || line.starts_with("From: ")
        || line.starts_with("_____")
        || line.starts_with("Sent from my ")
}

/// Whether a reply only turns the sender away ("I'm not interested", "No thanks").
pub fn is_dismissive_reply(text: &str) -> bool {
    let lowered = text.to_lowercase();
    if lowered.split_whitespace().count() > BRUSH_OFF_WORDS {
        return false;
    }
    let bare = lowered.trim().trim_end_matches(['.', '!']);
    matches!(bare, "no" | "stop")
        || BRUSH_OFF_PHRASES
            .iter()
            .any(|phrase| contains_words(&lowered, phrase))
}

/// Whether a line after an acknowledgement reads as a name or title rather than
/// a request: short, with every word capitalized ("Alex Smith", not "Please
/// confirm").
fn reads_as_signature(line: &str) -> bool {
    line.split_whitespace().count() <= SIGNATURE_LINE_WORDS
        && line
            .split_whitespace()
            .all(|word| !word.starts_with(char::is_lowercase))
}

/// Whether a message only ends the exchange, so nobody owes a reply to it: a
/// brush-off, or an acknowledgement and nothing but a signature after it. When
/// in doubt it says no: a stray follow-up costs less than a missed one.
pub(super) fn is_closing_reply(text: &str) -> bool {
    if is_dismissive_reply(text) {
        return true;
    }
    if text.contains('?') {
        return false;
    }
    let mut lines = text.lines().map(str::trim).filter(|line| !line.is_empty());
    let Some(first_line) = lines.next() else {
        return false;
    };
    let first_line = first_line.to_lowercase();
    let first_line = first_line.trim_end_matches(['.', '!', ',']);
    let closes = CLOSING_PHRASES.iter().any(|phrase| {
        first_line.strip_prefix(phrase).is_some_and(|rest| {
            let is_whole_phrase = !rest.starts_with(char::is_alphanumeric);
            let extra_words = rest
                .trim_start_matches([',', '.', '!', '-', ' '])
                .split_whitespace()
                .count();
            is_whole_phrase && extra_words <= CLOSING_LINE_EXTRA_WORDS
        })
    });
    // Anything past a signature delimiter is signature, whatever it says.
    closes
        && lines
            .take_while(|line| !line.starts_with("--"))
            .all(reads_as_signature)
}

/// `phrase` appears in `text` as whole words.
fn contains_words(text: &str, phrase: &str) -> bool {
    text.match_indices(phrase).any(|(start, matched)| {
        let before = text[..start].chars().next_back();
        let after = text[start + matched.len()..].chars().next();
        !before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric)
    })
}

fn truncate(text: &str, chars: usize) -> &str {
    text.char_indices()
        .nth(chars)
        .map_or(text, |(end, _)| &text[..end])
}

/// The text Jev reads for one message: the new part, or the whole body when
/// the new part is only a bump.
fn message_text(message: &FocusMessage) -> String {
    let body = message.body.as_deref().unwrap_or_default();
    let new = new_text(body);
    let text = if new.chars().count() < BUMP_CHARS {
        match body.trim() {
            "" => message.snippet.clone().unwrap_or_default(),
            whole => whole.to_owned(),
        }
    } else {
        new
    };
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate(&collapsed, MESSAGE_CHARS).to_owned()
}

fn sender(message: &FocusMessage) -> String {
    let address = message.from_email.as_deref().unwrap_or_default();
    match message.from_name.as_deref().map(str::trim) {
        Some(name) if !name.is_empty() => format!("{name} <{address}>"),
        _ => format!("<{address}>"),
    }
}

fn message_json(message: &FocusMessage) -> Value {
    let to = &message.to[..message.to.len().min(SHOWN_RECIPIENTS)];
    let cc = &message.cc[..message.cc.len().min(SHOWN_RECIPIENTS)];
    let mut json = json!({
        "from": sender(message),
        "sent_by_recipient": message.is_sent,
        "to": to,
        "cc": cc,
        "date": message.at.format("%Y-%m-%dT%H:%M").to_string(),
        "has_attachments": message.has_attachments,
        "bulk_mail_headers": message.bulk,
        "text": message_text(message),
    });
    let omitted = message.to.len() + message.cc.len() - to.len() - cc.len();
    if omitted > 0 {
        json["other_recipients"] = json!(omitted);
    }
    json
}

/// The messages shown, counting back from the latest.
fn shown_messages(thread: &FocusThread) -> &[FocusMessage] {
    &thread.messages[thread.messages.len().saturating_sub(SHOWN_MESSAGES)..]
}

/// The JSON state Jev classifies: the owner's profile and the thread's latest messages.
pub(super) fn jev_input(thread: &FocusThread, profile: Option<&str>) -> Value {
    let mut recipient = format!("The recipient's address is {}.", thread.owner_email);
    if let Some(profile) = profile.map(str::trim).filter(|profile| !profile.is_empty()) {
        recipient.push_str("\n\n");
        recipient.push_str(truncate(profile, PROFILE_CHARS));
    }
    let shown = shown_messages(thread);
    json!({
        "recipient": recipient,
        "thread": {
            "subject": thread.messages.first().and_then(|message| message.subject.as_deref()),
            "message_count": thread.messages.len(),
            "earlier_messages_omitted": thread.messages.len() - shown.len(),
            "messages": shown.iter().map(message_json).collect::<Vec<_>>(),
        },
    })
}

/// The day a message was written: in the owner's time zone when one is stored,
/// else at the offset its `Date` header gives, else in UTC.
fn written_on(message: &FocusMessage, time_zone: Option<Tz>) -> NaiveDate {
    if let Some(time_zone) = time_zone {
        return message.at.with_timezone(&time_zone).date_naive();
    }
    let header_offset = message
        .date_header
        .as_deref()
        .and_then(|header| DateTime::parse_from_rfc2822(header).ok())
        .map(|date| *date.offset());
    match header_offset {
        Some(offset) => message.at.with_timezone(&offset).date_naive(),
        None => message.at.date_naive(),
    }
}

/// A message's own words: never its quoted history, whose relative dates belong
/// to an older message. Unlike Jev's text, a short reply doesn't fall back to the
/// whole body. A message with no body has only its snippet to go on.
fn own_words(message: &FocusMessage) -> String {
    let body = message.body.as_deref().unwrap_or_default();
    let text = match body.trim() {
        "" => message.snippet.clone().unwrap_or_default(),
        _ => new_text(body),
    };
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate(&collapsed, MESSAGE_CHARS).to_owned()
}

/// What the due date extractor reads: the messages Jev is shown, each dated, with
/// no sender's name or address. A message with no words of its own is left out.
pub(super) fn due_date_input(thread: &FocusThread, time_zone: Option<Tz>) -> DueDateInput {
    let messages = shown_messages(thread)
        .iter()
        .map(|message| DueDateMessage {
            written_on: written_on(message, time_zone),
            from_owner: message.is_sent,
            text: own_words(message),
        })
        .filter(|message| !message.text.is_empty())
        .collect();
    DueDateInput {
        subject: thread
            .messages
            .first()
            .and_then(|message| message.subject.as_deref())
            .map(|subject| truncate(subject, DUE_DATE_SUBJECT_CHARS).to_owned()),
        messages,
    }
}

#[cfg(test)]
mod test;
