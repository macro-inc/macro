//! Which incoming messages stop an enrollment, and why.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use uuid::Uuid;

/// What an incoming message means for a sequence.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Response {
    /// A person answered: stop. Anything not clearly automatic reads as this.
    #[default]
    Reply,
    /// Delivery failed: stop.
    Bounce,
    /// An out-of-office or similar automatic answer: keep going.
    AutoReply,
}

/// An incoming message as the matcher needs it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Incoming {
    /// When the inbox received it.
    pub received_at: Option<DateTime<Utc>>,
    /// Sender address, lowercased.
    pub from: Option<String>,
    /// The stored message it replies to, as inbox sync resolved it.
    pub replying_to_id: Option<Uuid>,
    /// Message-IDs from In-Reply-To and References, without angle brackets.
    pub references: Vec<String>,
    /// Local messages in the same inbox those Message-IDs name.
    pub referenced_message_ids: Vec<Uuid>,
    /// Addresses from `X-Failed-Recipients`, lowercased.
    pub failed_recipients: Vec<String>,
    /// A bounce's text, lowercased; remote servers often name the failed
    /// address only there.
    pub bounce_text: Option<String>,
    /// How it reads, from its headers.
    pub response: Response,
}

/// An enrollment as the matcher needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Enrolled<'a> {
    /// The enrolled address, lowercased.
    pub email: &'a str,
    /// Messages after this answer the sequence; `None` before anything sent.
    pub replies_after: Option<DateTime<Utc>>,
    /// Every step email: local id and the Message-IDs it went out with.
    pub steps: &'a [SentIdentity],
}

/// A step email's identities.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SentIdentity {
    /// Local message id.
    pub message_id: Uuid,
    /// Message-ID Macro minted for the send.
    pub delivery_message_id: Option<String>,
    /// Message-ID inbox sync stored for the sent copy.
    pub provider_message_id: Option<String>,
}

/// Read a message's headers (`[{name, value}]`, names in any case).
pub fn classify(headers: &[(String, String)], from: Option<&str>) -> Response {
    let header = |name| header_values(headers, name);
    let delivery_report = header("content-type").any(|value| {
        let value: String = value
            .to_ascii_lowercase()
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '"')
            .collect();
        value.starts_with("multipart/report") && value.contains("report-type=delivery-status")
    });
    let daemon = from.is_some_and(|from| {
        let from = from.to_ascii_lowercase();
        from.starts_with("mailer-daemon@") || from.starts_with("postmaster@")
    });
    if delivery_report || header("x-failed-recipients").any(|v| !v.is_empty()) || daemon {
        return Response::Bounce;
    }
    // `Auto-Submitted: auto-replied (vacation)`; anything but an `auto-` value
    // (including `no`) is a person.
    let automatic = header("auto-submitted").any(|v| {
        v.split([';', '(', ' '])
            .next()
            .is_some_and(|token| token.to_ascii_lowercase().starts_with("auto-"))
    }) || header("x-autoreply").next().is_some()
        || header("x-autorespond").next().is_some()
        || header("precedence").any(|v| v.eq_ignore_ascii_case("auto_reply"));
    if automatic {
        Response::AutoReply
    } else {
        Response::Reply
    }
}

fn header_values<'a>(
    headers: &'a [(String, String)],
    name: &'a str,
) -> impl Iterator<Item = &'a str> + 'a {
    headers
        .iter()
        .filter(move |(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.trim())
}

/// Message-IDs named by `In-Reply-To` and `References`.
pub fn references(headers: &[(String, String)]) -> Vec<String> {
    let mut ids: Vec<String> = headers
        .iter()
        .filter(|(key, _)| {
            key.eq_ignore_ascii_case("in-reply-to") || key.eq_ignore_ascii_case("references")
        })
        .flat_map(|(_, value)| {
            value
                .replace(['<', '>'], " ")
                .split_whitespace()
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

/// Addresses a bounce names in `X-Failed-Recipients`.
pub fn failed_recipients(headers: &[(String, String)]) -> Vec<String> {
    headers
        .iter()
        .filter(|(key, _)| key.eq_ignore_ascii_case("x-failed-recipients"))
        .flat_map(|(_, value)| {
            value
                .split(',')
                .map(|address| address.trim().to_lowercase())
                .filter(|address| !address.is_empty())
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Whether `incoming` answers `enrolled`'s emails, and how. `None` when it
/// doesn't answer them or is an automatic reply.
pub fn stop_reason(enrolled: &Enrolled<'_>, incoming: &Incoming) -> Option<Response> {
    if incoming.response == Response::AutoReply {
        return None;
    }
    if let (Some(after), Some(received)) = (enrolled.replies_after, incoming.received_at)
        && received <= after
    {
        return None;
    }
    let names_a_step = enrolled.steps.iter().any(|step| {
        incoming.referenced_message_ids.contains(&step.message_id)
            || incoming.replying_to_id == Some(step.message_id)
            || [&step.delivery_message_id, &step.provider_message_id]
                .into_iter()
                .flatten()
                .any(|id| {
                    incoming
                        .references
                        .iter()
                        .any(|reference| reference.eq_ignore_ascii_case(id))
                })
    });
    let after_first_send = enrolled.replies_after.is_some();
    let from_contact = after_first_send && incoming.from.as_deref() == Some(enrolled.email);
    let bounced_contact = after_first_send
        && incoming.response == Response::Bounce
        && (incoming
            .failed_recipients
            .iter()
            .any(|address| address == enrolled.email)
            || incoming
                .bounce_text
                .as_deref()
                .is_some_and(|text| mentions_address(text, enrolled.email)));
    (names_a_step || from_contact || bounced_contact).then_some(incoming.response)
}

/// Whether `text` names `address` as a whole address, not inside a longer one.
fn mentions_address(text: &str, address: &str) -> bool {
    let part_of_address = |c: char| c.is_alphanumeric() || "._%+-@".contains(c);
    text.match_indices(address).any(|(at, found)| {
        let before = text[..at].chars().next_back();
        let after = text[at + found.len()..].chars().next();
        !before.is_some_and(part_of_address)
            && !after.is_some_and(|c| c.is_alphanumeric() || c == '-' || c == '_')
    })
}
