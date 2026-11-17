//! The population requests a mailbox's mail implies.

use crate::domain::mailbox::inbox_sync::CrmContactRecipient;
use models_email::service::backfill::PopulateCrmContactPayload;
use models_email::service::{link::Link, message::Message};
use std::collections::HashSet;

/// The trimmed, lower-cased form of a `local@domain` address, or `None` for
/// anything else.
pub(super) fn normalized_address(raw: &str) -> Option<String> {
    let email = raw.trim().to_ascii_lowercase();
    let (local, domain) = email.split_once('@')?;
    (!local.is_empty() && !domain.is_empty() && !domain.contains('@')).then_some(email)
}

/// One request per distinct, well-formed correspondent other than the mailbox
/// itself, in input order. `self_email` is the mailbox's lower-cased address.
pub fn population_requests(
    self_email: &str,
    contacts: impl IntoIterator<Item = CrmContactRecipient>,
    is_sent: bool,
) -> Vec<PopulateCrmContactPayload> {
    let mut seen = HashSet::new();
    contacts
        .into_iter()
        .filter_map(|(raw_email, contact_name, first_at, last_at)| {
            let contact_email = normalized_address(&raw_email)?;
            (contact_email != self_email && seen.insert(contact_email.clone())).then_some(
                PopulateCrmContactPayload {
                    contact_email,
                    contact_name,
                    first_at,
                    last_at,
                    is_sent,
                },
            )
        })
        .collect()
}

/// The requests one stored message implies: its recipients when the mailbox
/// sent it, its sender when the mailbox received it, and none for a draft,
/// which is not correspondence yet. A message without a provider date counts
/// as happening now.
pub fn message_requests(link: &Link, message: &Message) -> Vec<PopulateCrmContactPayload> {
    if message.is_draft {
        return Vec::new();
    }
    let self_email = link.email_address.0.as_ref().to_ascii_lowercase();
    let at = message.internal_date_ts.unwrap_or_else(chrono::Utc::now);
    let correspondents: Vec<_> = if message.is_sent {
        message
            .to
            .iter()
            .chain(&message.cc)
            .chain(&message.bcc)
            .collect()
    } else {
        message.from.iter().collect()
    };
    population_requests(
        &self_email,
        correspondents
            .into_iter()
            .map(|contact| (contact.email.clone(), contact.name.clone(), at, at)),
        message.is_sent,
    )
}
