//! Thin transport adapters for auto-archive settings.

use axum::{Json, Router, extract::State, routing::get};
use chrono::{DateTime, Utc};
use entity_access::{
    domain::{
        models::{OwnerAccessLevel, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::AgentSessionAccessLevelExtractor,
};
use macro_authorization::{ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{AgentSessionApiError, AgentSessionRouterState};
use crate::domain::auto_archive::{
    AutoArchive, AutoArchiveOverrides, AutoArchivePreferences, AutoArchiveReason,
    SessionAutoArchive,
};

/// The caller's defaults and per-session auto-archive routes. Mount at the root.
pub fn agent_auto_archive_router<T, Access, Auth, S>(
    state: AgentSessionRouterState<T, Access, Auth>,
) -> Router<S>
where
    T: AutoArchive,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/agent-auto-archive-preferences",
            get(get_auto_archive_preferences::<T, Access, Auth>)
                .put(put_auto_archive_preferences::<T, Access, Auth>),
        )
        .route(
            "/agent-sessions/{session_id}/auto-archive",
            get(get_session_auto_archive::<T, Access, Auth>)
                .put(put_session_auto_archive::<T, Access, Auth>),
        )
        .with_state(state)
}

/// Which triggers archive the caller's sessions when a session has no choice of its own.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AutoArchivePreferencesBody {
    /// Archive a session once every pull request linked to it is closed and at least one merged.
    pub on_pull_request_merged: bool,
    /// Archive a session once the runtime session backing it is deliberately closed.
    pub on_runtime_closed: bool,
}

impl From<AutoArchivePreferences> for AutoArchivePreferencesBody {
    fn from(preferences: AutoArchivePreferences) -> Self {
        Self {
            on_pull_request_merged: preferences.on_pull_request_merged,
            on_runtime_closed: preferences.on_runtime_closed,
        }
    }
}

impl From<AutoArchivePreferencesBody> for AutoArchivePreferences {
    fn from(body: AutoArchivePreferencesBody) -> Self {
        Self {
            on_pull_request_merged: body.on_pull_request_merged,
            on_runtime_closed: body.on_runtime_closed,
        }
    }
}

/// One session's choices over its owner's defaults. `null` follows the owner.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AutoArchiveOverridesBody {
    /// Archive once the session's pull requests merge, or `null` to follow the owner.
    pub on_pull_request_merged: Option<bool>,
    /// Archive once the session's runtime session is deliberately closed, or `null` to follow
    /// the owner.
    pub on_runtime_closed: Option<bool>,
}

impl From<AutoArchiveOverrides> for AutoArchiveOverridesBody {
    fn from(overrides: AutoArchiveOverrides) -> Self {
        Self {
            on_pull_request_merged: overrides.on_pull_request_merged,
            on_runtime_closed: overrides.on_runtime_closed,
        }
    }
}

impl From<AutoArchiveOverridesBody> for AutoArchiveOverrides {
    fn from(body: AutoArchiveOverridesBody) -> Self {
        Self {
            on_pull_request_merged: body.on_pull_request_merged,
            on_runtime_closed: body.on_runtime_closed,
        }
    }
}

/// The time a session archived itself.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AutoArchivedBody {
    /// What finished the session's work.
    pub reason: AutoArchiveReason,
    /// When it archived.
    pub archived_at: DateTime<Utc>,
    /// When a person restored it, after which the archive no longer stands.
    pub restored_at: Option<DateTime<Utc>>,
}

/// A session's auto-archive settings and history.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionAutoArchiveResponse {
    /// The session's own choices.
    pub overrides: AutoArchiveOverridesBody,
    /// The owner's defaults, which apply where the session has no choice of its own.
    pub defaults: AutoArchivePreferencesBody,
    /// The archive a trigger made, if one did. A session archives itself at most once.
    pub archived: Option<AutoArchivedBody>,
}

impl From<SessionAutoArchive> for SessionAutoArchiveResponse {
    fn from(settings: SessionAutoArchive) -> Self {
        Self {
            overrides: settings.overrides.into(),
            defaults: settings.defaults.into(),
            archived: settings.archived.map(|record| AutoArchivedBody {
                reason: record.reason,
                archived_at: record.archived_at,
                restored_at: record.restored_at,
            }),
        }
    }
}

#[utoipa::path(
    get,
    path = "/agent-auto-archive-preferences",
    tag = "agent-sessions",
    operation_id = "get_agent_auto_archive_preferences",
    responses(
        (status = 200, body = AutoArchivePreferencesBody),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// Read which triggers archive the caller's sessions by default.
#[tracing::instrument(skip_all, fields(actor = %caller.acting_entity()), err(Debug))]
pub async fn get_auto_archive_preferences<
    T: AutoArchive,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
) -> Result<Json<AutoArchivePreferencesBody>, AgentSessionApiError> {
    let preferences = state
        .service
        .preferences(&caller.authorization.user.macro_user_id)
        .await?;
    Ok(Json(preferences.into()))
}

#[utoipa::path(
    put,
    path = "/agent-auto-archive-preferences",
    tag = "agent-sessions",
    operation_id = "put_agent_auto_archive_preferences",
    request_body = AutoArchivePreferencesBody,
    responses(
        (status = 200, body = AutoArchivePreferencesBody),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// Replace which triggers archive the caller's sessions by default.
#[tracing::instrument(
    skip_all,
    fields(
        actor = %caller.acting_entity(),
        on_pull_request_merged = request.on_pull_request_merged,
        on_runtime_closed = request.on_runtime_closed,
    ),
    err(Debug)
)]
pub async fn put_auto_archive_preferences<
    T: AutoArchive,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    Json(request): Json<AutoArchivePreferencesBody>,
) -> Result<Json<AutoArchivePreferencesBody>, AgentSessionApiError> {
    state
        .service
        .set_preferences(&caller.authorization.user.macro_user_id, request.into())
        .await?;
    Ok(Json(request))
}

#[utoipa::path(
    get,
    path = "/agent-sessions/{session_id}/auto-archive",
    tag = "agent-sessions",
    operation_id = "get_agent_session_auto_archive",
    params(("session_id" = uuid::Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 200, body = SessionAutoArchiveResponse),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// Read a session's auto-archive settings and whether a trigger archived it.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn get_session_auto_archive<
    T: AutoArchive,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
) -> Result<Json<SessionAutoArchiveResponse>, AgentSessionApiError> {
    let settings = state
        .service
        .session_auto_archive(&access.entity_access_receipt)
        .await?;
    Ok(Json(settings.into()))
}

#[utoipa::path(
    put,
    path = "/agent-sessions/{session_id}/auto-archive",
    tag = "agent-sessions",
    operation_id = "put_agent_session_auto_archive",
    params(("session_id" = uuid::Uuid, Path, description = "ID of the agent session")),
    request_body = AutoArchiveOverridesBody,
    responses(
        (status = 200, body = AutoArchiveOverridesBody),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// Replace a session's own auto-archive choices. Owner only.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn put_session_auto_archive<
    T: AutoArchive,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<OwnerAccessLevel, Access, Auth>,
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    Json(request): Json<AutoArchiveOverridesBody>,
) -> Result<Json<AutoArchiveOverridesBody>, AgentSessionApiError> {
    state
        .service
        .set_session_overrides(&access.entity_access_receipt, request.into())
        .await?;
    Ok(Json(request))
}
