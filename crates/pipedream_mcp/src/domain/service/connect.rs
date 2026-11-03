//! Completing and revoking Pipedream-managed MCP connections.
//!
//! The hosted Connect UI reports a connected-account ID to the frontend on
//! success; nothing about that ID proves it belongs to the calling user.
//! [`complete_pipedream_connection`] owns that policy: it verifies with
//! Pipedream that the account exists and was connected for this user before
//! any local record is written.
//!
//! Apps Macro Connect serves connect through Connect instead, when the
//! `macro-connect` rollout is on for the user: [`start_connect_session`]
//! picks the backend and [`complete_connect_connection`] records the
//! connection once Connect confirms it.

use crate::domain::models::{ConnectApp, ConnectionProvider, MacroUserIdStr, PipedreamConnection};
use crate::domain::ports::{ConnectionStore, ConnectorOverlays, MacroConnect, PipedreamConnect};

#[cfg(test)]
mod test;

/// Errors from completing a Pipedream connection.
#[derive(Debug, thiserror::Error)]
pub enum PipedreamConnectError {
    /// The account doesn't exist, or wasn't connected for this user.
    #[error("connected account not found for this user")]
    NotFound,
    /// The app is overlaid: it connects through the native MCP stack at
    /// `server_url`, never through Pipedream.
    #[error("{app_slug} connects through its own MCP server, not Pipedream")]
    Overlaid {
        /// The overlaid app.
        app_slug: String,
        /// The MCP server to connect instead.
        server_url: String,
    },
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
///
/// An overlaid app is refused and its new Pipedream account deleted, so no
/// Pipedream grant for it outlives the attempt.
#[tracing::instrument(skip(store, overlays, pipedream), err)]
pub async fn complete_pipedream_connection<S, O, P>(
    store: &S,
    overlays: &O,
    pipedream: &P,
    user_id: &MacroUserIdStr<'static>,
    account_id: &str,
    server_name: Option<&str>,
) -> Result<PipedreamConnection, PipedreamConnectError>
where
    S: ConnectionStore,
    O: ConnectorOverlays,
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

    if let Some(overlay) = overlays.overlay(&account.app_slug).await? {
        if let Err(error) = pipedream.delete_account(&account.id).await {
            tracing::warn!(error = ?error, account_id = %account.id, "failed to delete Pipedream account for an overlaid app");
        }
        return Err(PipedreamConnectError::Overlaid {
            app_slug: overlay.app_slug,
            server_url: overlay.server_url,
        });
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
        provider: ConnectionProvider::Pipedream,
    };

    store.save(&record).await.map_err(anyhow::Error::from)?;

    Ok(record)
}

/// How far back [`recover_pipedream_connection`] looks for an account the
/// Connect UI failed to report. Longer than the native consent timeout.
pub const RECOVERY_WINDOW: chrono::TimeDelta = chrono::TimeDelta::minutes(15);

/// Register an account Pipedream created but the Connect UI never reported.
///
/// Pipedream's hosted Connect UI loses its success message when an OAuth
/// provider severs the consent popup's opener: the account exists, but the
/// UI reports only `close`. The caller asks here after such a close. The
/// newest account for this user and app created within [`RECOVERY_WINDOW`]
/// of `now` is verified and stored exactly as a reported one would be.
/// Returns `None` when there is no such account, or when it is already the
/// stored one.
#[tracing::instrument(skip(store, overlays, pipedream), err)]
pub async fn recover_pipedream_connection<S, O, P>(
    store: &S,
    overlays: &O,
    pipedream: &P,
    user_id: &MacroUserIdStr<'static>,
    app_slug: &str,
    server_name: Option<&str>,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<Option<PipedreamConnection>, PipedreamConnectError>
where
    S: ConnectionStore,
    O: ConnectorOverlays,
    P: PipedreamConnect,
    anyhow::Error: From<S::Err>,
{
    let accounts = pipedream.list_accounts(user_id.as_ref(), app_slug).await?;
    let Some(newest) = accounts
        .into_iter()
        .filter(|account| {
            account
                .created_at
                .is_some_and(|created_at| created_at >= now - RECOVERY_WINDOW)
        })
        .max_by_key(|account| account.created_at)
    else {
        tracing::info!(found = false, "no recent Pipedream account to recover");
        return Ok(None);
    };

    let existing = store
        .load(user_id, app_slug)
        .await
        .map_err(anyhow::Error::from)?;
    if existing.is_some_and(|record| record.account_id == newest.id) {
        tracing::info!(
            found = true,
            already_stored = true,
            "Pipedream account already stored"
        );
        return Ok(None);
    }

    tracing::info!(found = true, account_id = %newest.id, "recovering unreported Pipedream account");
    complete_pipedream_connection(store, overlays, pipedream, user_id, &newest.id, server_name)
        .await
        .map(Some)
}

/// Remove a connected app, revoking its grant with whichever backend holds
/// it. Returns the connection that was removed, or `None` when the app was
/// not connected.
///
/// The remote deletion is best effort: failing to clean up remotely must
/// not strand the local row, so remote failures are logged and the local
/// delete proceeds.
#[tracing::instrument(skip(store, backends), err)]
pub async fn disconnect_mcp_server<S, P>(
    store: &S,
    backends: &P,
    user_id: &MacroUserIdStr<'static>,
    app_slug: &str,
) -> anyhow::Result<Option<PipedreamConnection>>
where
    S: ConnectionStore,
    P: PipedreamConnect + MacroConnect,
    anyhow::Error: From<S::Err>,
{
    let record = store
        .load(user_id, app_slug)
        .await
        .map_err(anyhow::Error::from)?;
    if let Some(record) = &record {
        revoke(backends, record).await;
    }

    store
        .delete(user_id, app_slug)
        .await
        .map_err(anyhow::Error::from)?;

    Ok(record)
}

/// Best-effort removal of `record`'s grant from the backend holding it.
async fn revoke<P: PipedreamConnect + MacroConnect>(backends: &P, record: &PipedreamConnection) {
    let result = match record.provider {
        ConnectionProvider::Pipedream => backends.delete_account(&record.account_id).await,
        ConnectionProvider::Connect => {
            backends
                .delete_connection(&record.user_id, &record.account_id)
                .await
        }
    };
    if let Err(error) = result {
        tracing::warn!(
            error = ?error,
            account_id = %record.account_id,
            provider = record.provider.as_str(),
            "failed to delete remote connection"
        );
    }
}

/// Apps whose integrations need a Pipedream grant even when Connect serves
/// them: Granola sync calls Granola's REST API, which takes API keys only,
/// through Pipedream's proxy.
const PIPEDREAM_ONLY_APPS: &[&str] = &["granola"];

/// The Connect app to connect `app_slug` through, or `None` when it stays on
/// Pipedream: Connect does not serve it, it is overlaid onto the native MCP
/// stack, or an integration needs its Pipedream grant.
///
/// Callers check the `macro-connect` rollout first; this is the per-app half
/// of the choice.
#[tracing::instrument(skip(overlays, connect), err)]
pub async fn connect_app_for<O, C>(
    overlays: &O,
    connect: &C,
    app_slug: &str,
) -> anyhow::Result<Option<ConnectApp>>
where
    O: ConnectorOverlays,
    C: MacroConnect,
{
    if PIPEDREAM_ONLY_APPS.contains(&app_slug) || overlays.overlay(app_slug).await?.is_some() {
        return Ok(None);
    }
    connect.app_for_slug(app_slug).await
}

/// Start connecting `app_slug` through Connect. Returns the URL for the
/// user's browser, or `None` when the app stays on Pipedream (see
/// [`connect_app_for`]).
#[tracing::instrument(skip(overlays, connect), err)]
pub async fn start_connect_session<O, C>(
    overlays: &O,
    connect: &C,
    user_id: &MacroUserIdStr<'static>,
    app_slug: &str,
) -> anyhow::Result<Option<String>>
where
    O: ConnectorOverlays,
    C: MacroConnect,
{
    let Some(app) = connect_app_for(overlays, connect, app_slug).await? else {
        return Ok(None);
    };
    connect
        .create_connect_session(user_id, &app)
        .await
        .map(Some)
}

/// Record a connection Connect holds for `user_id` to the app replacing
/// `app_slug`.
///
/// Nothing the browser reports is trusted: Connect itself must list an
/// active connection for this user before a record is written. A Pipedream
/// grant the record replaces is revoked, so only one backend holds the app.
#[tracing::instrument(skip(store, overlays, backends), err)]
pub async fn complete_connect_connection<S, O, P>(
    store: &S,
    overlays: &O,
    backends: &P,
    user_id: &MacroUserIdStr<'static>,
    app_slug: &str,
    server_name: Option<&str>,
) -> Result<PipedreamConnection, PipedreamConnectError>
where
    S: ConnectionStore,
    O: ConnectorOverlays,
    P: PipedreamConnect + MacroConnect,
    anyhow::Error: From<S::Err>,
{
    let app = connect_app_for(overlays, backends, app_slug)
        .await?
        .ok_or(PipedreamConnectError::NotFound)?;
    if !backends.is_connected(user_id, &app.app_id).await? {
        return Err(PipedreamConnectError::NotFound);
    }

    let existing = store
        .load(user_id, app_slug)
        .await
        .map_err(anyhow::Error::from)?;
    let record = PipedreamConnection {
        user_id: user_id.clone(),
        app_slug: app.app_slug,
        server_name: server_name
            .map(str::to_owned)
            .or_else(|| existing.as_ref().map(|r| r.server_name.clone()))
            .unwrap_or(app.name),
        account_id: app.app_id,
        enabled: existing.as_ref().is_none_or(|r| r.enabled),
        provider: ConnectionProvider::Connect,
    };
    store.save(&record).await.map_err(anyhow::Error::from)?;

    if let Some(previous) = existing
        && previous.provider == ConnectionProvider::Pipedream
    {
        revoke(backends, &previous).await;
    }

    Ok(record)
}
