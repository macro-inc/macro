//! What Jev reads about a thread: the owner's profile and the latest messages.

use serde_json::{Value, json};

use super::models::{FocusMessage, FocusThread};

/// Messages shown to Jev, counting back from the latest.
const SHOWN_MESSAGES: usize = 3;
/// Characters of text per shown message.
const MESSAGE_CHARS: usize = 1_500;
/// New text shorter than this is a bump ("waiting to hear back"); Jev gets the
/// whole body instead, so the original request is still in view.
const BUMP_CHARS: usize = 200;
/// Characters of the owner's profile passed as context.
const PROFILE_CHARS: usize = 30_000;
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

/// The JSON state Jev classifies: the owner's profile and the thread's latest messages.
pub(super) fn jev_input(thread: &FocusThread, profile: Option<&str>) -> Value {
    let mut recipient = format!("The recipient's address is {}.", thread.owner_email);
    if let Some(profile) = profile.map(str::trim).filter(|profile| !profile.is_empty()) {
        recipient.push_str("\n\n");
        recipient.push_str(truncate(profile, PROFILE_CHARS));
    }
    let shown = &thread.messages[thread.messages.len().saturating_sub(SHOWN_MESSAGES)..];
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

#[cfg(test)]
mod test;
