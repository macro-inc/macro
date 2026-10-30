//! Archiving a session on its own once its work is done: when its pull requests merge, or when
//! the runtime session backing it is deliberately closed.
//!
//! Each trigger is opt-in. A user sets a default for their sessions, and a session's owner can
//! override it for one session. A session archives itself at most once: the record of that
//! archive stays when a person restores the session, so later triggers leave it visible.

use chrono::{DateTime, Utc};
use entity_access::domain::models::{
    EntityAccessReceipt, EntityType, OwnerAccessLevel, RequiredPermission, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::error::{AgentSessionError, Result};
use super::model::AgentSessionId;
use super::ports::AgentSessionRealtime;

#[cfg(test)]
mod test;

/// What finished a session's work.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    strum::AsRefStr,
    strum::EnumString,
    serde::Serialize,
    serde::Deserialize,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum AutoArchiveReason {
    /// Every pull request linked to the session is closed, and at least one merged.
    PullRequestMerged,
    /// The person or agent ended the runtime session backing it.
    RuntimeClosed,
}

/// Which triggers archive a session. Each is off unless chosen.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AutoArchivePreferences {
    /// Archive once the session's pull requests merge.
    pub on_pull_request_merged: bool,
    /// Archive once the session's runtime session is deliberately closed.
    pub on_runtime_closed: bool,
}

/// One session's choices over its owner's defaults. `None` follows the owner.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AutoArchiveOverrides {
    /// Archive once the session's pull requests merge.
    pub on_pull_request_merged: Option<bool>,
    /// Archive once the session's runtime session is deliberately closed.
    pub on_runtime_closed: Option<bool>,
}

/// The time a session archived itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AutoArchiveRecord {
    /// What finished the session's work.
    pub reason: AutoArchiveReason,
    /// When it archived.
    pub archived_at: DateTime<Utc>,
    /// When a person restored it, after which the archive no longer stands.
    pub restored_at: Option<DateTime<Utc>>,
}

/// A session's auto-archive settings and history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionAutoArchive {
    /// The session's own choices.
    pub overrides: AutoArchiveOverrides,
    /// The owner's defaults the session follows where it has no choice of its own.
    pub defaults: AutoArchivePreferences,
    /// The archive a trigger made, if one did. A session archives itself at most once.
    pub archived: Option<AutoArchiveRecord>,
}

/// Storage for auto-archive settings and the archive itself.
pub trait AutoArchiveRepo: Send + Sync + 'static {
    /// The user's defaults; a user who never chose has every trigger off.
    fn user_auto_archive_preferences(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<AutoArchivePreferences>> + Send;

    /// Replace the user's defaults.
    fn set_user_auto_archive_preferences(
        &self,
        user: &MacroUserIdStr<'static>,
        preferences: AutoArchivePreferences,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The session's settings and the archive a trigger made.
    fn session_auto_archive(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<SessionAutoArchive>> + Send;

    /// Replace the session's own choices.
    fn set_session_auto_archive_overrides(
        &self,
        session: AgentSessionId,
        overrides: AutoArchiveOverrides,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The sessions linked to `github_key` whose linked pull requests are now all closed with
    /// at least one merged.
    fn sessions_with_merged_pull_requests(
        &self,
        github_key: &str,
    ) -> impl Future<Output = Result<Vec<AgentSessionId>>> + Send;

    /// Archive the session for `reason` and record why, in one step, when the trigger is on
    /// for it and nothing still needs it: it is not archived, has never been archived by a
    /// trigger, has no turn starting, running, stopping, or waiting for input, has no queued prompts, and
    /// does not answer a conversation. Whether it archived.
    fn auto_archive(
        &self,
        session: AgentSessionId,
        reason: AutoArchiveReason,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// Auto-archive settings and triggers.
pub trait AutoArchive: Send + Sync + 'static {
    /// The caller's defaults.
    fn preferences(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<AutoArchivePreferences>> + Send;

    /// Replace the caller's defaults.
    fn set_preferences(
        &self,
        user: &MacroUserIdStr<'static>,
        preferences: AutoArchivePreferences,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The settings and history of the session `access` covers.
    fn session_auto_archive(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<SessionAutoArchive>> + Send;

    /// Replace the choices of the session `access` covers.
    fn set_session_overrides(
        &self,
        access: &EntityAccessReceipt<OwnerAccessLevel>,
        overrides: AutoArchiveOverrides,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The pull request `github_key` changed: archive the sessions whose linked pull requests
    /// are now all done. Safe to repeat for the same change. The sessions archived.
    fn pull_request_changed(
        &self,
        github_key: &str,
    ) -> impl Future<Output = Result<Vec<AgentSessionId>>> + Send;

    /// The runtime session backing `session` was deliberately closed. Safe to repeat. Whether
    /// the session archived.
    fn runtime_closed(&self, session: AgentSessionId) -> impl Future<Output = Result<bool>> + Send;
}

/// Auto-archive over the session store, telling viewers when a session archives.
pub struct AutoArchiveService<R, Rt> {
    repo: R,
    realtime: Rt,
}

impl<R, Rt> AutoArchiveService<R, Rt> {
    /// Build the service over the session store and the realtime publisher.
    pub fn new(repo: R, realtime: Rt) -> Self {
        Self { repo, realtime }
    }
}

impl<R, Rt> AutoArchiveService<R, Rt>
where
    R: AutoArchiveRepo,
    Rt: AgentSessionRealtime + Send + Sync + 'static,
{
    async fn archive(&self, session: AgentSessionId, reason: AutoArchiveReason) -> Result<bool> {
        let archived = self.repo.auto_archive(session, reason).await?;
        if archived {
            tracing::info!(%session, reason = reason.as_ref(), "auto-archived agent session");
            self.realtime
                .publish_updated(session)
                .await
                .inspect_err(|error| {
                    tracing::warn!(error = ?error, %session, "failed to publish agent session auto-archive");
                })
                .ok();
        }
        Ok(archived)
    }
}

impl<R, Rt> AutoArchive for AutoArchiveService<R, Rt>
where
    R: AutoArchiveRepo,
    Rt: AgentSessionRealtime + Send + Sync + 'static,
{
    async fn preferences(&self, user: &MacroUserIdStr<'static>) -> Result<AutoArchivePreferences> {
        self.repo.user_auto_archive_preferences(user).await
    }

    async fn set_preferences(
        &self,
        user: &MacroUserIdStr<'static>,
        preferences: AutoArchivePreferences,
    ) -> Result<()> {
        self.repo
            .set_user_auto_archive_preferences(user, preferences)
            .await
    }

    async fn session_auto_archive(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<SessionAutoArchive> {
        self.repo.session_auto_archive(session_id(access)?).await
    }

    async fn set_session_overrides(
        &self,
        access: &EntityAccessReceipt<OwnerAccessLevel>,
        overrides: AutoArchiveOverrides,
    ) -> Result<()> {
        self.repo
            .set_session_auto_archive_overrides(session_id(access)?, overrides)
            .await
    }

    #[tracing::instrument(
        name = "agent_session.auto_archive.pull_request",
        err,
        skip(self),
        fields(sessions, archived)
    )]
    async fn pull_request_changed(&self, github_key: &str) -> Result<Vec<AgentSessionId>> {
        let sessions = self
            .repo
            .sessions_with_merged_pull_requests(github_key)
            .await?;
        tracing::Span::current().record("sessions", sessions.len());
        let mut archived = Vec::new();
        for session in sessions {
            // One session failing to archive must not keep the others visible.
            match self
                .archive(session, AutoArchiveReason::PullRequestMerged)
                .await
            {
                Ok(true) => archived.push(session),
                Ok(false) => {}
                Err(error) => {
                    tracing::warn!(error = ?error, %session, "failed to auto-archive agent session");
                }
            }
        }
        tracing::Span::current().record("archived", archived.len());
        Ok(archived)
    }

    #[tracing::instrument(
        name = "agent_session.auto_archive.runtime_closed",
        err,
        skip(self),
        fields(archived)
    )]
    async fn runtime_closed(&self, session: AgentSessionId) -> Result<bool> {
        let archived = self
            .archive(session, AutoArchiveReason::RuntimeClosed)
            .await?;
        tracing::Span::current().record("archived", archived);
        Ok(archived)
    }
}

fn session_id<T: RequiredPermission>(access: &EntityAccessReceipt<T>) -> Result<AgentSessionId> {
    if access.entity().entity_type != EntityType::AgentSession {
        return Err(AgentSessionError::Forbidden);
    }
    let id = Uuid::parse_str(&access.entity().entity_id)
        .map_err(|error| anyhow::anyhow!("invalid agent session access receipt: {error}"))?;
    Ok(AgentSessionId::new_from_uuid(id))
}
