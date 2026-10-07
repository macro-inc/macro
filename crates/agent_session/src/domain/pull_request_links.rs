//! Pull requests associated with sessions: the one a session's agent opened, and any a person
//! linked afterwards.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, EntityType, RequiredPermission,
    ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use messages::domain::models::MessageParent;

use super::error::{AgentSessionError, Result};
use super::model::AgentSessionId;
use super::ports::SessionViewAccess;
use super::pull_request::canonical_url;

#[cfg(test)]
mod test;

/// Who associated a pull request with a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum PullRequestLinkSource {
    /// The session's agent opened it.
    Agent,
    /// A person linked it.
    User,
}

/// A pull request associated with a session.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SessionPullRequestLink {
    /// The pull request's `owner/repo/pull/number` key.
    pub github_key: String,
    /// The pull request's GitHub URL.
    pub url: String,
    /// Who associated the pull request with the session.
    pub source: PullRequestLinkSource,
    /// The Macro user who linked it, for links a person made.
    pub linked_by: Option<String>,
    /// When the pull request was associated with the session.
    pub created_at: DateTime<Utc>,
}

/// The most pull requests one batch lookup answers, one Reviews page.
pub const MAX_PULL_REQUESTS_PER_LOOKUP: usize = 100;

/// A stored link between a pull request and a session, with where the session started.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestSessionLinkRow {
    /// The pull request's `owner/repo/pull/number` key, as stored.
    pub github_key: String,
    /// The linked session.
    pub session: AgentSessionId,
    /// Who associated the pull request with the session.
    pub source: PullRequestLinkSource,
    /// The entity whose thread the session was started from, if any.
    pub thread_parent: Option<MessageParent>,
}

/// A session linked to a pull request, as a viewer of that session sees it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct PullRequestLinkedSession {
    /// The session id.
    #[cfg_attr(feature = "schema", schema(value_type = Uuid))]
    pub session_id: Uuid,
    /// Who associated the pull request with the session.
    pub source: PullRequestLinkSource,
    /// The channel, task, or CRM record whose thread the session was started from, if any.
    pub thread_parent: Option<MessageParent>,
}

/// The sessions linked to one pull request that the caller can view.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSessions {
    /// The requested pull request URL, canonicalized.
    pub url: String,
    /// The pull request's `owner/repo/pull/number` key.
    pub github_key: String,
    /// Linked sessions the caller can view, oldest link first.
    pub sessions: Vec<PullRequestLinkedSession>,
}

/// The `owner/repo/pull/number` key of a GitHub pull request URL.
pub(crate) fn pull_request_key(url: &str) -> Result<String> {
    let url = canonical_url(url)?;
    Ok(url.trim_start_matches("https://github.com/").to_owned())
}

/// Stores the pull requests associated with sessions.
pub trait SessionPullRequestLinkRepo: Send + Sync + 'static {
    /// Link `github_key` to `session` on behalf of `linked_by`. An existing link is kept as is.
    fn link_pull_request(
        &self,
        session: AgentSessionId,
        github_key: &str,
        linked_by: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Remove a link a person made; the pull request the session's agent opened stays. Returns
    /// whether a link was removed.
    fn unlink_pull_request(
        &self,
        session: AgentSessionId,
        github_key: &str,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// The pull requests associated with `session`, oldest first.
    fn session_pull_requests(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<SessionPullRequestLink>>> + Send;

    /// The sessions associated with the pull request `github_key`, compared case-insensitively.
    fn sessions_for_pull_request(
        &self,
        github_key: &str,
    ) -> impl Future<Output = Result<Vec<AgentSessionId>>> + Send;

    /// Every link to the pull requests `github_keys`, compared case-insensitively, oldest
    /// first, with the thread each linked session was started from.
    fn links_for_pull_requests(
        &self,
        github_keys: &[String],
    ) -> impl Future<Output = Result<Vec<PullRequestSessionLinkRow>>> + Send;
}

/// Associating pull requests with sessions and finding them again.
pub trait SessionPullRequestLinks: Send + Sync + 'static {
    /// Link the pull request at `url` to the session `access` covers. Linking a pull request
    /// that is already linked changes nothing.
    fn link_pull_request(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        url: &str,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Unlink a pull request a person linked to the session `access` covers.
    fn unlink_pull_request(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        url: &str,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The pull requests associated with the session `access` covers.
    fn session_pull_requests(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Vec<SessionPullRequestLink>>> + Send;

    /// The sessions associated with the pull request at `url` that `viewer` may view.
    fn sessions_for_pull_request(
        &self,
        viewer: &MacroUserIdStr<'static>,
        url: &str,
    ) -> impl Future<Output = Result<Vec<AgentSessionId>>> + Send;

    /// The sessions linked to each pull request in `urls` that `viewer` may view, in request
    /// order. At most [`MAX_PULL_REQUESTS_PER_LOOKUP`] URLs.
    fn sessions_for_pull_requests(
        &self,
        viewer: &MacroUserIdStr<'static>,
        urls: &[String],
    ) -> impl Future<Output = Result<Vec<PullRequestSessions>>> + Send;
}

/// Pull request links over the session store, answering session visibility with `view_access`.
pub struct SessionPullRequestLinkService<R> {
    repo: R,
    view_access: Arc<dyn SessionViewAccess>,
}

impl<R> SessionPullRequestLinkService<R> {
    /// Build the service over the session store and the access check read routes use.
    pub fn new(repo: R, view_access: Arc<dyn SessionViewAccess>) -> Self {
        Self { repo, view_access }
    }
}

impl<R: SessionPullRequestLinkRepo> SessionPullRequestLinks for SessionPullRequestLinkService<R> {
    #[tracing::instrument(err, skip(self, access))]
    async fn link_pull_request(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        url: &str,
    ) -> Result<()> {
        let session = session_id(access)?;
        let EntityAccessAuth::Authenticated(user) = access.auth() else {
            return Err(AgentSessionError::Forbidden);
        };
        let github_key = pull_request_key(url)?;
        self.repo
            .link_pull_request(session, &github_key, user)
            .await
    }

    #[tracing::instrument(err, skip(self, access))]
    async fn unlink_pull_request(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        url: &str,
    ) -> Result<()> {
        let session = session_id(access)?;
        let github_key = pull_request_key(url)?;
        self.repo.unlink_pull_request(session, &github_key).await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self, access))]
    async fn session_pull_requests(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<SessionPullRequestLink>> {
        self.repo.session_pull_requests(session_id(access)?).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn sessions_for_pull_request(
        &self,
        viewer: &MacroUserIdStr<'static>,
        url: &str,
    ) -> Result<Vec<AgentSessionId>> {
        let github_key = pull_request_key(url)?;
        let mut visible = Vec::new();
        for session in self.repo.sessions_for_pull_request(&github_key).await? {
            if self.view_access.can_view(viewer, session).await? {
                visible.push(session);
            }
        }
        Ok(visible)
    }

    #[tracing::instrument(err, skip(self, urls), fields(urls = urls.len()))]
    async fn sessions_for_pull_requests(
        &self,
        viewer: &MacroUserIdStr<'static>,
        urls: &[String],
    ) -> Result<Vec<PullRequestSessions>> {
        if urls.len() > MAX_PULL_REQUESTS_PER_LOOKUP {
            return Err(AgentSessionError::TooManyPullRequests(
                MAX_PULL_REQUESTS_PER_LOOKUP,
            ));
        }
        let mut requested = Vec::with_capacity(urls.len());
        for url in urls {
            let url = canonical_url(url)?;
            let github_key = url.trim_start_matches("https://github.com/").to_owned();
            requested.push(PullRequestSessions {
                url,
                github_key,
                sessions: Vec::new(),
            });
        }
        if requested.is_empty() {
            return Ok(requested);
        }

        let mut keys: Vec<String> = requested
            .iter()
            .map(|pull_request| pull_request.github_key.to_lowercase())
            .collect();
        keys.sort();
        keys.dedup();
        let rows = self.repo.links_for_pull_requests(&keys).await?;

        // One access check per session, however many pull requests it links.
        let mut viewable = HashMap::<AgentSessionId, bool>::new();
        let mut by_key = HashMap::<String, Vec<PullRequestLinkedSession>>::new();
        for row in rows {
            let can_view = match viewable.get(&row.session) {
                Some(can_view) => *can_view,
                None => {
                    let can_view = self.view_access.can_view(viewer, row.session).await?;
                    viewable.insert(row.session, can_view);
                    can_view
                }
            };
            if !can_view {
                continue;
            }
            by_key
                .entry(row.github_key.to_lowercase())
                .or_default()
                .push(PullRequestLinkedSession {
                    session_id: row.session.as_uuid(),
                    source: row.source,
                    thread_parent: row.thread_parent,
                });
        }
        for pull_request in &mut requested {
            if let Some(sessions) = by_key.get(&pull_request.github_key.to_lowercase()) {
                pull_request.sessions = sessions.clone();
            }
        }
        Ok(requested)
    }
}

fn session_id<T: RequiredPermission>(access: &EntityAccessReceipt<T>) -> Result<AgentSessionId> {
    if access.entity().entity_type != EntityType::AgentSession {
        return Err(AgentSessionError::Unknown(anyhow::anyhow!(
            "session pull request links received access for another entity type"
        )));
    }
    Ok(AgentSessionId::new_from_uuid(
        Uuid::parse_str(&access.entity().entity_id)
            .map_err(|error| anyhow::anyhow!("invalid agent session access receipt: {error}"))?,
    ))
}
