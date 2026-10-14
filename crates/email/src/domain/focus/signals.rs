//! The owner's history with a thread's senders, read from stored mail.

use std::collections::HashSet;

use super::{
    input::{is_dismissive_reply, new_text},
    models::{FocusSignals, FocusThread},
    rule::is_calendar_subject,
};

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

fn domain(address: &str) -> &str {
    address.rsplit_once('@').map_or("", |(_, domain)| domain)
}

/// An address that sends automated mail; matches the end of the local part,
/// so `team@` and `product-updates@` both count.
fn is_automated_sender(address: &str) -> bool {
    let local = address.split_once('@').map_or(address, |(local, _)| local);
    AUTOMATED_LOCAL_PARTS
        .iter()
        .any(|part| local.ends_with(part))
}

fn is_substantive(body: Option<&str>) -> bool {
    !is_dismissive_reply(&new_text(body.unwrap_or_default()))
}

/// Derive the owner's relationship with a thread from its messages and the
/// owner's sent mail.
pub(super) fn signals(thread: &FocusThread) -> FocusSignals {
    let owner = thread.owner_email.to_lowercase();
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

    FocusSignals {
        contact,
        replied,
        teammate,
        latest_from_owner: thread
            .messages
            .last()
            .is_some_and(|message| message.is_sent),
        calendar_subject: thread
            .messages
            .first()
            .and_then(|message| message.subject.as_deref())
            .is_some_and(is_calendar_subject),
    }
}

#[cfg(test)]
mod test;
