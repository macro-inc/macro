//! Picking a session back up once its owner connects the app it was waiting on.
//!
//! An agent that needs an app the owner has not connected asks for it with a
//! connect chip. When the owner finishes connecting, the harness produces an
//! `app.connected` system event that wakes the session: the agent is told the
//! app is there, and the transcript shows no message the owner did not type.

use std::future::Future;
use std::sync::Arc;

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_runtime_protocol::domain::notification::{Notification, NotificationEvent};
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::notifications::{NotificationService, ProduceNotification};
use agent_session::domain::ports::AgentSessionRepo;
use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

/// Whether a waking batch of events only continues the owner's own work:
/// every event in it is an `app.connected`, which
/// [`AppConnectedContinuation`] produces only once it has checked that the
/// session's owner reported the connection. Such a turn may act with the
/// owner's access (never as their word) when the turn before it acted for
/// them and ended offering those apps' connect buttons
/// ([`connect_buttons`]); a batch with any other event acts for nobody.
#[must_use]
pub fn continues_for_owner(notifications: &[Notification]) -> bool {
    !notifications.is_empty()
        && notifications.iter().all(|notification| {
            matches!(notification.event, NotificationEvent::AppConnected { .. })
        })
}

/// The app slugs of the connect buttons in an agent's reply: each
/// `<m-connect-app>{"appSlug": ..}</m-connect-app>` it includes.
#[must_use]
pub fn connect_buttons(reply: &str) -> Vec<String> {
    use agent_egress::domain::model::CONNECT_APP_TAG;
    let open = format!("<{CONNECT_APP_TAG}>");
    let close = format!("</{CONNECT_APP_TAG}>");
    reply
        .split(open.as_str())
        .skip(1)
        .filter_map(|rest| rest.split_once(close.as_str()))
        .filter_map(|(payload, _)| {
            serde_json::from_str::<serde_json::Value>(payload)
                .ok()?
                .get("appSlug")?
                .as_str()
                .map(str::to_owned)
        })
        .collect()
}

/// Who owns a session, and whether it can still take a turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionStanding {
    /// The owning user; `None` for a session a bot or team owns.
    pub owner: Option<MacroUserIdStr<'static>>,
    /// Archived sessions take no new turns.
    pub archived: bool,
}

/// Reads a session's [`SessionStanding`].
pub trait SessionStandings: Send + Sync + 'static {
    /// The standing of `session_id`.
    fn standing(
        &self,
        session_id: AgentSessionId,
    ) -> impl Future<Output = Result<SessionStanding, AgentSessionError>> + Send;
}

impl<Repo: AgentSessionRepo> SessionStandings for Repo {
    async fn standing(
        &self,
        session_id: AgentSessionId,
    ) -> Result<SessionStanding, AgentSessionError> {
        let session = self.get(session_id).await?;
        Ok(SessionStanding {
            owner: session.owner_user().ok().cloned(),
            archived: session.is_archived(),
        })
    }
}

/// Produces system events for a session.
pub trait SessionNotifications: Send + Sync + 'static {
    /// Persist `notification` idempotently.
    fn produce(
        &self,
        notification: ProduceNotification,
    ) -> impl Future<Output = Result<(), AgentSessionError>> + Send;
}

impl SessionNotifications for NotificationService {
    fn produce(
        &self,
        notification: ProduceNotification,
    ) -> impl Future<Output = Result<(), AgentSessionError>> + Send {
        NotificationService::produce(self, notification)
    }
}

/// The apps a user has connected.
pub trait ConnectedApps: Send + Sync + 'static {
    /// Error reading the user's connections.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The display name of `app_slug` when `user` has it connected and
    /// enabled for tool use.
    fn connected_app_name(
        &self,
        user: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;
}

/// Why a session could not be continued after a connection.
#[derive(Debug, thiserror::Error)]
pub enum AppConnectedError {
    /// Only the owner's connections reach the session's tools, so only the
    /// owner may say one was made.
    #[error("only the session's owner can continue it after connecting an app")]
    NotOwner,
    /// The session is archived.
    #[error("the session is archived")]
    Archived,
    /// The owner has no enabled connection to the app.
    #[error("{0} is not connected")]
    NotConnected(String),
    /// Reading or prompting the session failed.
    #[error(transparent)]
    Session(#[from] AgentSessionError),
    /// The owner's connections could not be read.
    #[error("could not read the owner's connections")]
    Internal(rootcause::Report),
}

/// Wakes a session with an `app.connected` event once its owner connects an app.
pub struct AppConnectedContinuation<Sessions, Apps, Notifications> {
    sessions: Arc<Sessions>,
    apps: Arc<Apps>,
    notifications: Arc<Notifications>,
}

impl<Sessions, Apps, Notifications> AppConnectedContinuation<Sessions, Apps, Notifications>
where
    Sessions: SessionStandings,
    Apps: ConnectedApps,
    Notifications: SessionNotifications,
{
    /// Build the service.
    pub fn new(
        sessions: Arc<Sessions>,
        apps: Arc<Apps>,
        notifications: Arc<Notifications>,
    ) -> Self {
        Self {
            sessions,
            apps,
            notifications,
        }
    }

    /// Tell `session_id` that `user` has connected `app_slug`.
    ///
    /// The event starts a turn once the session is idle, after any running
    /// one. `report_id` names the report, so a retried request produces the
    /// event once.
    #[tracing::instrument(skip(self), fields(%session_id, %app_slug), err)]
    pub async fn continue_session(
        &self,
        session_id: AgentSessionId,
        user: &MacroUserIdStr<'static>,
        app_slug: &str,
        report_id: Option<AgentActionId>,
    ) -> Result<(), AppConnectedError> {
        let standing = self.sessions.standing(session_id).await?;
        if standing.owner.as_ref() != Some(user) {
            return Err(AppConnectedError::NotOwner);
        }
        if standing.archived {
            return Err(AppConnectedError::Archived);
        }
        let app_name = self
            .apps
            .connected_app_name(user, app_slug)
            .await
            .map_err(|error| {
                AppConnectedError::Internal(rootcause::Report::new(error).into_dynamic())
            })?
            .ok_or_else(|| AppConnectedError::NotConnected(app_slug.to_owned()))?;
        let report_id = report_id.unwrap_or_else(AgentActionId::mint);
        self.notifications
            .produce(ProduceNotification {
                session_id,
                dedupe_key: Some(format!("app.connected:{app_slug}:{report_id}")),
                subject_id: app_slug.to_owned(),
                event: NotificationEvent::AppConnected { app: app_name },
                wake: true,
            })
            .await?;
        Ok(())
    }
}
