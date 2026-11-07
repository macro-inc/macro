//! The owner's history with a thread's senders, read from stored mail.

use std::collections::HashSet;

use chrono::Duration;

use super::{
    calendar::notice_in_message,
    input::{is_closing_reply, is_dismissive_reply, new_text},
    models::{FocusSignals, FocusThread},
};

/// How far back from a thread's latest message the owner's writing to someone
/// still makes them a recent contact.
pub const RECENT_CONTACT_DAYS: i64 = 90;

/// Consumer mail providers; sharing one of these is not being teammates.
const FREEMAIL_DOMAINS: [&str; 11] = [
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "yahoo.com",
    "icloud.com",
    "me.com",
    "aol.com",
    "protonmail.com",
    "proton.me",
];

/// Local parts of addresses that send mail no person wrote, e.g. `no-reply@`.
const AUTOMATED_LOCAL_PARTS: [&str; 30] = [
    "noreply",
    "no-reply",
    "donotreply",
    "do-not-reply",
    "donot-reply",
    "do-notreply",
    "notification",
    "notifications",
    "notify",
    "alert",
    "alerts",
    "mailer",
    "bounce",
    "update",
    "updates",
    "news",
    "newsletter",
    "info",
    "hello",
    "support",
    "team",
    "billing",
    "receipt",
    "receipts",
    "invoice",
    "digest",
    "calendar-notification",
    "comment",
    "comments",
    "mailer-daemon",
];

/// Local parts of addresses nobody answers from. Narrower than
/// [`AUTOMATED_LOCAL_PARTS`]: a person does reply from `support@` or `hello@`.
const UNANSWERED_LOCAL_PARTS: [&str; 8] = [
    "noreply",
    "no-reply",
    "donotreply",
    "do-not-reply",
    "donot-reply",
    "do-notreply",
    "bounce",
    "mailer-daemon",
];

fn domain(address: &str) -> &str {
    address.rsplit_once('@').map_or("", |(_, domain)| domain)
}

fn local_part_ends_with(address: &str, parts: &[&str]) -> bool {
    let local = address.split_once('@').map_or(address, |(local, _)| local);
    parts.iter().any(|part| local.ends_with(part))
}

/// An address that sends automated mail; matches the end of the local part,
/// so `team@` and `product-updates@` both count.
fn is_automated_sender(address: &str) -> bool {
    local_part_ends_with(address, &AUTOMATED_LOCAL_PARTS)
}

fn is_substantive(body: Option<&str>) -> bool {
    !is_dismissive_reply(&new_text(body.unwrap_or_default()))
}

/// Derive the owner's relationship with a thread from its messages and the
/// owner's sent mail.
pub(super) fn signals(thread: &FocusThread) -> FocusSignals {
    let owner = thread.owner_email.to_lowercase();
    let latest = thread.messages.last();
    let incoming = thread
        .messages
        .iter()
        .filter(|message| !message.is_sent)
        .collect::<Vec<_>>();
    let senders = incoming
        .iter()
        .filter_map(|message| message.from_email.as_deref())
        .map(str::to_lowercase)
        .filter(|sender| *sender != owner)
        .collect::<HashSet<_>>();
    let first_incoming = incoming.first().map(|message| message.at);
    let replies = thread
        .messages
        .iter()
        .filter(|message| message.is_sent && first_incoming.is_some_and(|first| message.at > first))
        .collect::<Vec<_>>();
    let replied = !replies.is_empty();
    let replied_for_real = replies
        .iter()
        .any(|message| is_substantive(message.body.as_deref()));

    let owner_domain = domain(&owner);
    let teammate = !owner_domain.is_empty()
        && !FREEMAIL_DOMAINS.contains(&owner_domain)
        && senders.iter().any(|sender| domain(sender) == owner_domain);

    let notes_to_senders = thread
        .sent_notes
        .iter()
        .filter(|note| senders.contains(&note.recipient))
        .collect::<Vec<_>>();
    let written_to = notes_to_senders
        .iter()
        .any(|note| is_substantive(note.body.as_deref()));

    let primary = incoming
        .first()
        .and_then(|message| message.from_email.as_deref())
        .map(str::to_lowercase)
        .unwrap_or_default();
    let notes_to_primary = notes_to_senders
        .iter()
        .filter(|note| note.recipient == primary)
        .collect::<Vec<_>>();
    let brushed_off = !notes_to_primary.is_empty()
        && notes_to_primary
            .iter()
            .all(|note| !is_substantive(note.body.as_deref()));
    let bulk = incoming.iter().any(|message| message.bulk) || is_automated_sender(&primary);

    let contact = !brushed_off && (replied_for_real || written_to || (teammate && !bulk));

    // Measured from the thread's latest message, so re-deciding a thread later
    // gives the same answer.
    let recent_since = latest.map(|message| message.at - Duration::days(RECENT_CONTACT_DAYS));
    let is_recent = |at| recent_since.is_some_and(|since| at >= since);
    let replied_recently = replies
        .iter()
        .any(|message| is_recent(message.at) && is_substantive(message.body.as_deref()));
    let wrote_recently = notes_to_senders
        .iter()
        .any(|note| is_recent(note.at) && is_substantive(note.body.as_deref()));
    let recent_contact = !brushed_off && !bulk && (replied_recently || wrote_recently);

    // Only a notice nobody has written after: a person replying to one is a
    // conversation, and the owner answering one has seen it.
    let calendar = latest
        .filter(|message| !message.is_sent)
        .and_then(notice_in_message);

    // Only threads with mail from the other side: the owner's own unanswered
    // sends are not inbox threads, and nothing here can judge them.
    let awaiting_reply = !incoming.is_empty()
        && latest.is_some_and(|message| {
            message.is_sent
                && notice_in_message(message).is_none()
                && !is_closing_reply(&new_text(message.body.as_deref().unwrap_or_default()))
                && message.to.iter().any(|recipient| {
                    let recipient = recipient.to_lowercase();
                    recipient != owner && !local_part_ends_with(&recipient, &UNANSWERED_LOCAL_PARTS)
                })
        });

    FocusSignals {
        contact,
        recent_contact,
        brushed_off,
        replied,
        teammate,
        latest_from_owner: latest.is_some_and(|message| message.is_sent),
        calendar,
        awaiting_reply,
    }
}

#[cfg(test)]
mod test;
