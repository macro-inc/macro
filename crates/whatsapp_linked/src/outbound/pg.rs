//! Postgres adapter for every linked-device repository port. DSS and the
//! session service each build one over the shared MacroDB pool.

use crate::domain::{events::SessionScope, models::*, ports::LinkedResult};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

mod accounts;
mod bindings;
mod effects;
mod groups;
mod ingest;
mod media;
mod sends;
mod session;
#[cfg(test)]
mod test;
mod timeline;

/// Signals between DSS and the session service. Each payload is a JSON
/// [`signals::Signal`] (or [`signals::ChangeSignal`] for `whatsapp_changed`)
/// carrying the sender's `traceparent`, so the receiver joins its trace.
pub mod signals {
    use serde::{Deserialize, Serialize};
    use uuid::Uuid;

    /// `<pairing_id>`: start, update or stop pairing.
    pub const PAIRING_REQUESTED: &str = "whatsapp_pairing_requested";
    /// `<account_id>`: claim pending sends.
    pub const SEND_REQUESTED: &str = "whatsapp_send_requested";
    /// `<account_id>`: re-read the account's groups.
    pub const GROUPS_REQUESTED: &str = "whatsapp_groups_requested";
    /// `<account_id>`: consent or adopted groups changed; re-read the account.
    pub const ACCOUNT_CHANGED: &str = "whatsapp_account_changed";
    /// `<account_id>`: a replica released the account (session service only).
    pub const ACCOUNT_RELEASED: &str = "whatsapp_account_released";
    /// `<document_id>`: attachment bytes are ready to import (DSS listens).
    pub const MEDIA_READY: &str = "whatsapp_media_ready";
    /// `<message_id>`: a standalone message notification is ready (DSS listens).
    pub const GROUP_EFFECTS: &str = "whatsapp_group_effects";
    /// A [`ChangeSignal`]: something a page shows changed (DSS listens and
    /// pushes `whatsapp_changed` to the people who see it).
    pub const CHANGED: &str = "whatsapp_changed";

    /// Payload of every signal except [`CHANGED`].
    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Signal {
        /// The id the channel documents.
        pub id: Uuid,
        /// The sender's W3C trace context.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub traceparent: Option<String>,
    }

    impl Signal {
        /// Read a payload; `None` when malformed.
        pub fn parse(payload: &str) -> Option<Self> {
            serde_json::from_str(payload).ok()
        }
    }

    /// What changed.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    #[serde(tag = "scope", rename_all = "snake_case")]
    pub enum Change {
        /// The account's own group list (roster) changed: its owner's add list.
        Groups {
            /// Account whose roster changed.
            account_id: Uuid,
        },
        /// A group entity's details, timeline or sends changed: everyone who
        /// can view it.
        Group {
            /// Group entity.
            group_id: Uuid,
        },
    }

    /// Payload of [`CHANGED`].
    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    pub struct ChangeSignal {
        /// What changed.
        #[serde(flatten)]
        pub change: Change,
        /// The sender's W3C trace context.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub traceparent: Option<String>,
    }

    impl ChangeSignal {
        /// Read a payload; `None` when malformed.
        pub fn parse(payload: &str) -> Option<Self> {
            serde_json::from_str(payload).ok()
        }
    }
}

/// Repository over MacroDB.
#[derive(Clone)]
pub struct PgLinkedRepository {
    pool: PgPool,
}

impl PgLinkedRepository {
    /// Wrap the shared pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Map an infrastructure error, keeping its cause for logs.
pub(crate) fn failure(
    error: impl std::error::Error + Send + Sync + 'static,
) -> rootcause::Report<LinkedError> {
    rootcause::Report::new(error).context(LinkedError::Unavailable)
}

/// Map an `anyhow` error from another domain's transactional helper.
pub(crate) fn helper_failure(error: impl std::fmt::Display) -> rootcause::Report<LinkedError> {
    rootcause::report!("{error:#}").context(LinkedError::Unavailable)
}

/// Decode a JSON column written by this crate.
pub(crate) fn decode<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> LinkedResult<T> {
    serde_json::from_value(value).map_err(failure)
}

pub(crate) fn account_state(value: &str) -> LinkedResult<AccountState> {
    AccountState::parse(value).ok_or_else(|| LinkedError::Unavailable.into())
}

/// Signal `channel` when the transaction commits, carrying the current trace.
pub(crate) async fn notify(
    tx: &mut Transaction<'_, Postgres>,
    channel: &str,
    id: Uuid,
) -> LinkedResult<()> {
    let payload = serde_json::to_string(&signals::Signal {
        id,
        traceparent: super::trace_context::current(),
    })
    .map_err(failure)?;
    sqlx::query!("SELECT pg_notify($1, $2)", channel, payload)
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    Ok(())
}

/// Tell DSS, when the transaction commits, that pages showing this changed.
pub(crate) async fn notify_change(
    tx: &mut Transaction<'_, Postgres>,
    change: signals::Change,
) -> LinkedResult<()> {
    let payload = serde_json::to_string(&signals::ChangeSignal {
        change,
        traceparent: super::trace_context::current(),
    })
    .map_err(failure)?;
    sqlx::query!("SELECT pg_notify($1, $2)", signals::CHANGED, payload)
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    Ok(())
}

/// Serialize mutations of a group's messages, membership and sends before
/// locking any child row. Accounts, when needed, must be locked first.
async fn lock_group_in(tx: &mut Transaction<'_, Postgres>, group: Uuid) -> LinkedResult<()> {
    sqlx::query!(
        "SELECT id FROM whatsapp_group WHERE id = $1 FOR UPDATE",
        group
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

/// The account a lease holder acts for, locked for the rest of the transaction.
pub(crate) struct Fenced {
    pub id: Uuid,
    pub user_id: String,
    pub identity_jid: Option<String>,
    pub state: AccountState,
    pub generation: i64,
}

/// Lock the account in share mode at this lease epoch, or fail with `Fenced`.
pub(crate) async fn fence_in(
    tx: &mut Transaction<'_, Postgres>,
    scope: SessionScope,
) -> LinkedResult<Fenced> {
    let row = sqlx::query!(
        "SELECT id, user_id, identity_jid, state, generation FROM whatsapp_linked_account WHERE id = $1 AND lease_epoch = $2 FOR SHARE",
        scope.account_id,
        scope.lease_epoch
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?
    .ok_or(LinkedError::Fenced)?;
    Ok(Fenced {
        id: row.id,
        user_id: row.user_id,
        identity_jid: row.identity_jid,
        state: account_state(&row.state)?,
        generation: row.generation,
    })
}

/// Lock the account exclusively at this lease epoch, for transitions that
/// update the account row itself.
pub(crate) async fn fence_exclusive_in(
    tx: &mut Transaction<'_, Postgres>,
    scope: SessionScope,
) -> LinkedResult<Fenced> {
    let row = sqlx::query!(
        "SELECT id, user_id, identity_jid, state, generation FROM whatsapp_linked_account WHERE id = $1 AND lease_epoch = $2 FOR NO KEY UPDATE",
        scope.account_id,
        scope.lease_epoch
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?
    .ok_or(LinkedError::Fenced)?;
    Ok(Fenced {
        id: row.id,
        user_id: row.user_id,
        identity_jid: row.identity_jid,
        state: account_state(&row.state)?,
        generation: row.generation,
    })
}

/// End consent for the account's current generation: lifecycle state, a new
/// generation, cancelled pairings, ended memberships and failed undispatched sends.
pub(crate) async fn end_consent_in(
    tx: &mut Transaction<'_, Postgres>,
    account: Uuid,
    state: AccountState,
    error_code: &str,
) -> LinkedResult<()> {
    sqlx::query!(
        "UPDATE whatsapp_linked_account SET state = $2, generation = generation + 1, updated_at = now() WHERE id = $1",
        account,
        state.as_str()
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        "UPDATE whatsapp_pairing SET state = 'cancelled', consumed_at = clock_timestamp(), qr_code = NULL, pair_code = NULL, passkey_challenge = NULL, passkey_response = NULL, updated_at = now() WHERE account_id = $1 AND consumed_at IS NULL",
        account
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        "UPDATE whatsapp_group_membership SET consent_ended_at = COALESCE(consent_ended_at, now()) WHERE account_id = $1",
        account
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        "UPDATE whatsapp_send SET state = 'failed', error_code = $2, claimed_epoch = NULL, updated_at = now() WHERE account_id = $1 AND dispatch_started_at IS NULL AND state IN ('pending', 'sending')",
        account,
        error_code
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}
