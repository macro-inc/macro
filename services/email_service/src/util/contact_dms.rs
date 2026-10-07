//! Direct messages for people a new user already works with.
//!
//! The contacts a user's Google account shares are the best signal for who they
//! collaborate with, so a connected inbox starts with direct messages to
//! colleagues at their work domain and to the people they email most. Creation
//! is idempotent and best-effort: a failure never fails the sync that triggered it.

use channels::{
    domain::{dm::ensure_dms_for_joining_member, ports::ChannelService, service::ChannelServiceImpl},
    outbound::pg_channels_repo::PgChannelsRepo,
};
use generic_email_domains::is_generic_email_domain;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::link::Link;
use sqlx::PgPool;

#[cfg(test)]
mod test;

/// Colleagues a single inbox opens direct messages with.
const MAX_COLLEAGUE_DMS: usize = 200;

/// The most-emailed contacts a single inbox opens direct messages with.
const MAX_TOP_CONTACT_DMS: usize = 10;

/// The lowercased domain of `email`.
fn domain_of(email: &str) -> Option<String> {
    email
        .rsplit_once('@')
        .map(|(_, domain)| domain.to_ascii_lowercase())
}

/// Addresses in `emails` on the work domain of `own_email`, excluding `own_email`.
///
/// Returns nothing when `own_email` is on a consumer domain such as gmail.com,
/// where sharing a domain says nothing about working together.
pub(crate) fn colleague_emails(own_email: &str, emails: &[String]) -> Vec<String> {
    let Some(own_domain) = domain_of(own_email).filter(|domain| !is_generic_email_domain(domain))
    else {
        return Vec::new();
    };
    let own_email = own_email.to_ascii_lowercase();
    emails
        .iter()
        .filter(|email| **email != own_email)
        .filter(|email| domain_of(email).as_deref() == Some(own_domain.as_str()))
        .take(MAX_COLLEAGUE_DMS)
        .cloned()
        .collect()
}

/// Opens direct messages from the link's owner to each address. Invalid
/// addresses and the owner's own address are skipped.
async fn ensure_dms_with(db: &PgPool, link: &Link, emails: impl IntoIterator<Item = String>) {
    let own_email = link.email_address.0.as_ref().to_ascii_lowercase();
    let roster: Vec<MacroUserIdStr<'static>> = emails
        .into_iter()
        .filter(|email| *email != own_email)
        .filter_map(|email| MacroUserIdStr::try_from_email(&email).ok())
        .filter(|contact| *contact != link.macro_id)
        .collect();
    if roster.is_empty() {
        return;
    }

    let channels = ChannelServiceImpl::new(PgChannelsRepo::new(db.clone()));
    match channels
        .ensure_dms(ensure_dms_for_joining_member(link.macro_id.clone(), roster))
        .await
    {
        Ok(summary) => tracing::info!(
            link_id = %link.id,
            created = summary.created,
            existing = summary.existing,
            failed = summary.failed,
            "ensured direct messages from synced contacts"
        ),
        Err(error) => tracing::warn!(
            link_id = %link.id,
            error = ?error,
            "unable to ensure direct messages from synced contacts"
        ),
    }
}

/// Opens direct messages with the colleagues in the inbox's synced address book.
///
/// Only the primary inbox counts; a secondary inbox's address book is not the
/// user's work circle.
#[tracing::instrument(skip(db, link), fields(link_id = %link.id))]
pub async fn ensure_colleague_dms(db: &PgPool, link: &Link) {
    if !link.is_primary {
        return;
    }
    let emails =
        match email_db_client::contacts::get::fetch_address_book_emails_by_link_id(db, link.id)
            .await
        {
            Ok(emails) => emails,
            Err(error) => {
                tracing::warn!(error = ?error, "unable to read the address book for colleague DMs");
                return;
            }
        };
    let colleagues = colleague_emails(link.email_address.0.as_ref(), &emails);
    ensure_dms_with(db, link, colleagues).await;
}

/// Opens direct messages with the people the user emails most. It runs after
/// the mailbox backfill, once there is sent mail to rank.
#[tracing::instrument(skip(db, link), fields(link_id = %link.id))]
pub async fn ensure_top_contact_dms(db: &PgPool, link: &Link) {
    if !link.is_primary {
        return;
    }
    let emails = match email_db_client::contacts::get::fetch_top_sent_contact_emails_by_link_id(
        db,
        link.id,
        MAX_TOP_CONTACT_DMS,
    )
    .await
    {
        Ok(emails) => emails,
        Err(error) => {
            tracing::warn!(error = ?error, "unable to rank contacts for top-contact DMs");
            return;
        }
    };
    ensure_dms_with(db, link, emails).await;
}
