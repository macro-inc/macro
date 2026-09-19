//! Completing and revoking Pipedream-managed MCP connections.
//!
//! The hosted Connect UI reports a connected-account ID to the frontend on
//! success; nothing about that ID proves it belongs to the calling user.
//! [`complete_pipedream_connection`] owns that policy: it verifies with
//! Pipedream that the account exists and was connected for this user before
//! any local record is written.

use crate::domain::models::{MacroUserIdStr, PipedreamConnection};
use crate::domain::ports::{ConnectionStore, PipedreamConnect};

#[cfg(test)]
mod test;

/// Errors from completing a Pipedream connection.
#[derive(Debug, thiserror::Error)]
pub enum PipedreamConnectError {
    /// The account doesn't exist, or wasn't connected for this user.
    #[error("connected account not found for this user")]
    NotFound,
    /// Anything else.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

/// Verify a finished Connect flow and persist the connected app.
///
/// Confirms with Pipedream that `account_id` exists and belongs to `user_id`
/// (accounts are minted for our user IDs via the Connect token), then
/// upserts the app record. Reconnecting an app the user already has simply
/// points its record at the new account.
#[tracing::instrument(skip(store, pipedream), err)]
pub async fn complete_pipedream_connection<S, P>(
    store: &S,
    pipedream: &P,
    user_id: &MacroUserIdStr<'static>,
    account_id: &str,
    server_name: Option<&str>,
) -> Result<PipedreamConnection, PipedreamConnectError>
where
    S: ConnectionStore,
    P: PipedreamConnect,
    anyhow::Error: From<S::Err>,
{
    let account = pipedream
        .get_account(account_id)
        .await?
        .ok_or(PipedreamConnectError::NotFound)?;

    // The account must have been connected for this user. Connect tokens are
    // minted per user, so a mismatch means the caller is trying to attach
    // someone else's account (or a stale/foreign ID).
    if account.external_user_id.as_deref() != Some(user_id.as_ref()) {
        return Err(PipedreamConnectError::NotFound);
    }

    let existing = store
        .load(user_id, &account.app_slug)
        .await
        .map_err(anyhow::Error::from)?;

    let record = PipedreamConnection {
        user_id: user_id.clone(),
        app_slug: account.app_slug.clone(),
        server_name: server_name
            .map(str::to_owned)
            .or_else(|| existing.as_ref().map(|r| r.server_name.clone()))
            .unwrap_or(account.app_name),
        account_id: account.id,
        enabled: existing.as_ref().is_none_or(|r| r.enabled),
    };

    store.save(&record).await.map_err(anyhow::Error::from)?;

    Ok(record)
}

/// Remove a connected app, revoking its Pipedream account.
///
/// The Pipedream deletion is best effort: failing to clean up remotely must
/// not strand the local row, so remote failures are logged and the local
/// delete proceeds.
#[tracing::instrument(skip(store, pipedream), err)]
pub async fn disconnect_mcp_server<S, P>(
    store: &S,
    pipedream: &P,
    user_id: &MacroUserIdStr<'static>,
    app_slug: &str,
) -> anyhow::Result<()>
where
    S: ConnectionStore,
    P: PipedreamConnect,
    anyhow::Error: From<S::Err>,
{
    let record = store
        .load(user_id, app_slug)
        .await
        .map_err(anyhow::Error::from)?;
    if let Some(record) = record
        && let Err(e) = pipedream.delete_account(&record.account_id).await
    {
        tracing::warn!(error = ?e, account_id = %record.account_id, "failed to delete Pipedream account");
    }

    store
        .delete(user_id, app_slug)
        .await
        .map_err(anyhow::Error::from)?;

    Ok(())
}
