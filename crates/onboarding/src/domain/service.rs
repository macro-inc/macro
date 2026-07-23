//! The onboarding orchestrator: assembles the aggregate and keeps the
//! import pipeline moving while the flow is active.
//!
//! Reconciliation is level-triggered and idempotent: every tick lists the
//! user's MCP connections and asks the import service to start a gather for
//! each authenticated connector with automatic import enabled.
//! `start_gather` is a CAS that only wins when no run has ever started, so
//! ticking on every read (and on the MCP post-auth hook) is safe.

use super::models::{ConnectedServer, OnboardingRow, OnboardingState, OnboardingStatus};
use super::ports::{OnboardingError, OnboardingRepo, Result};
use import::domain::models::{ImportSource, Initiator};
use import::domain::service::ImportService;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::ports::McpServerStore;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// The API the onboarding router (and host-service hooks) talk to.
pub trait OnboardingService: Send + Sync + 'static {
    /// The full aggregate for the user. While the flow is active this also
    /// starts any gather runs that are due, so reading the state is what
    /// keeps onboarding moving.
    fn get_state(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<OnboardingState>> + Send;

    /// An explicit reconcile tick, for host hooks that observed a real state
    /// change (e.g. an MCP OAuth completion). A no-op for users who never
    /// entered the flow or already finished it — connecting an MCP server
    /// outside onboarding must not start gathers.
    fn reconcile(&self, user: MacroUserIdStr<'static>) -> impl Future<Output = Result<()>> + Send;

    /// Finish the flow (`skipped` records how). Unreserved leftover
    /// onboarding-staged import candidates are deleted — never reviewed is
    /// not declined, so they stay re-stageable by later gathers or chat.
    /// Candidates reserved by configured automatic runs remain until their
    /// run settles.
    fn complete(
        &self,
        user: MacroUserIdStr<'static>,
        skipped: bool,
    ) -> impl Future<Output = Result<OnboardingRow>> + Send;
}

/// Concrete orchestrator wiring the repo, the user's MCP servers, and the
/// import service together.
pub struct OnboardingServiceImpl<R, S, I> {
    repo: R,
    mcp_store: Arc<S>,
    import: Arc<I>,
}

impl<R, S, I> OnboardingServiceImpl<R, S, I> {
    /// Build the orchestrator.
    pub fn new(repo: R, mcp_store: Arc<S>, import: Arc<I>) -> Self {
        Self {
            repo,
            mcp_store,
            import,
        }
    }
}

impl<R, S, I> OnboardingServiceImpl<R, S, I>
where
    R: OnboardingRepo,
    S: McpServerStore,
    I: ImportService,
{
    async fn connected_servers(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ConnectedServer>> {
        let servers = self
            .mcp_store
            .list(user)
            .await
            .map_err(|e| OnboardingError::Other(anyhow::anyhow!("mcp store: {e:?}")))?;
        Ok(servers
            .into_iter()
            .map(|record| ConnectedServer {
                name: record.server_name,
                url: record.url,
                authenticated: record.credentials.is_some(),
            })
            .collect())
    }

    /// Start an auto-importing gather run for every authenticated connector
    /// that never had one. A failing source must not block the others (or
    /// the read).
    async fn start_due_gathers(&self, user: &MacroUserIdStr<'static>, servers: &[ConnectedServer]) {
        for source in ImportSource::all() {
            let connected = servers
                .iter()
                .any(|server| server.authenticated && server.url == source.mcp_server_url());
            if !connected {
                continue;
            }
            if let Err(e) = self.import.start_gather(user.clone(), source, true).await {
                tracing::warn!(source = source.as_ref(), error = ?e, "failed to start gather run");
            }
        }
    }
}

impl<R, S, I> OnboardingService for OnboardingServiceImpl<R, S, I>
where
    R: OnboardingRepo,
    S: McpServerStore,
    I: ImportService,
{
    #[tracing::instrument(skip(self, user), err)]
    async fn get_state(&self, user: MacroUserIdStr<'static>) -> Result<OnboardingState> {
        let row = self.repo.ensure_row(&user).await?;
        let connected_servers = self.connected_servers(&user).await?;
        if row.status == OnboardingStatus::Active {
            self.start_due_gathers(&user, &connected_servers).await;
        }
        Ok(OnboardingState {
            row,
            connected_servers,
        })
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn reconcile(&self, user: MacroUserIdStr<'static>) -> Result<()> {
        // get_row, NOT ensure_row: this runs from the generic MCP post-auth
        // hook, and a user connecting a server outside onboarding must not
        // be pulled into the flow (or have gathers started).
        let Some(row) = self.repo.get_row(&user).await? else {
            return Ok(());
        };
        if row.status != OnboardingStatus::Active {
            // Self-heal the completion race: a reconcile (or a gather
            // session it started) can outlive complete()'s cleanup and
            // stage rows after it ran. Any later tick for a finished flow
            // sweeps those leftovers, best-effort.
            let _ = self
                .import
                .delete_staged_by_initiator(user, Initiator::Onboarding)
                .await
                .inspect_err(|e| {
                    tracing::warn!(error = ?e, "failed to sweep post-completion staged rows");
                });
            return Ok(());
        }
        let servers = self.connected_servers(&user).await?;
        self.start_due_gathers(&user, &servers).await;
        Ok(())
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn complete(
        &self,
        user: MacroUserIdStr<'static>,
        skipped: bool,
    ) -> Result<OnboardingRow> {
        let row = self.repo.complete(&user, skipped).await?;
        // Unreserved candidates the user never acted on are removed from the
        // ledger, not discarded: discard means "the user said no" and blocks
        // re-staging forever, which is wrong for items they never looked at
        // ("Set up later" skips the whole review). Candidates reserved by an
        // active or retryable configured auto-import run survive this cleanup.
        // Explicit declines (a section toggled off) were already discarded by
        // run_import.
        // Chat-staged rows are untouched. Best-effort: the completion above
        // is durable, so a cleanup failure must not fail the call — the
        // next reconcile tick sweeps leftovers anyway.
        let _ = self
            .import
            .delete_staged_by_initiator(user, Initiator::Onboarding)
            .await
            .inspect_err(|e| {
                tracing::warn!(error = ?e, "failed to delete leftover onboarding-staged candidates");
            });
        Ok(row)
    }
}
