//! Paginated agent activity, authorized through session visibility alone.
use super::AgentSessionApiError;
use crate::domain::activity::{AgentActivityCursor, AgentActivityPage};
use activity::domain::ports::AgentActivityReads;
use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    routing::get,
};
use chrono::{DateTime, Utc};
use entity_access::{
    domain::{models::ViewAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::AgentSessionAccessLevelExtractor,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use serde::Deserialize;
use std::{num::NonZeroU32, sync::Arc};
use utoipa::IntoParams;
use uuid::Uuid;

/// Repository and the existing session access boundary.
pub struct AgentActivityState<R, Access, Auth> {
    repository: Arc<R>,
    access: Arc<Access>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<R, Access, Auth> AgentActivityState<R, Access, Auth> {
    /// Compose the session activity reader.
    pub fn new(
        repository: R,
        access: Arc<Access>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            repository: Arc::new(repository),
            access,
            authorization,
        }
    }
}

impl<R, Access, Auth> Clone for AgentActivityState<R, Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            repository: self.repository.clone(),
            access: self.access.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<R, Access, Auth> FromRef<AgentActivityState<R, Access, Auth>> for Arc<Access> {
    fn from_ref(state: &AgentActivityState<R, Access, Auth>) -> Self {
        state.access.clone()
    }
}

impl<R, Access, Auth> FromRef<AgentActivityState<R, Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &AgentActivityState<R, Access, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Filters and chronological cursor. Both cursor components must be supplied together.
#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(rename_all = "camelCase")]
pub struct AgentActivityQuery {
    /// Restrict activity to one code-mode invocation within this session.
    pub agent_correlation_id: Option<Uuid>,
    /// Cursor timestamp from the previous page.
    pub before_at: Option<DateTime<Utc>>,
    /// Cursor activity ID from the previous page.
    pub before_id: Option<Uuid>,
    /// Page size, from 1 to 100; defaults to 50.
    #[param(value_type = Option<u32>, minimum = 1, maximum = 100)]
    pub limit: Option<NonZeroU32>,
}

/// Nest under `/agent-sessions` with the other session routers; paths here are
/// relative to that prefix, as the OpenAPI path below states in full.
pub fn router<
    R: AgentActivityReads,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    state: AgentActivityState<R, Access, Auth>,
) -> Router {
    Router::new()
        .route(
            "/{session_id}/activity",
            get(get_agent_session_activity::<R, Access, Auth>),
        )
        .with_state(state)
}

/// Read activity using the same visibility capability as the session transcript.
#[utoipa::path(get, path = "/agent-sessions/{session_id}/activity", tag = "agent-sessions", operation_id = "get_agent_session_activity",
    params(("session_id" = Uuid, Path), AgentActivityQuery),
    responses((status = 200, body = AgentActivityPage), (status = 400), (status = 401), (status = 403)))]
pub async fn get_agent_session_activity<
    R: AgentActivityReads,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    State(state): State<AgentActivityState<R, Access, Auth>>,
    Query(query): Query<AgentActivityQuery>,
) -> Result<Json<AgentActivityPage>, AgentSessionApiError> {
    let cursor = match (query.before_at, query.before_id) {
        (Some(occurred_at), Some(id)) => Some(AgentActivityCursor { occurred_at, id }),
        (None, None) => None,
        _ => {
            return Err(
                crate::domain::error::AgentSessionError::InvalidActivityQuery(
                    "both activity cursor components are required",
                )
                .into(),
            );
        }
    };
    let limit = query
        .limit
        .unwrap_or(NonZeroU32::new(50).expect("nonzero default"));
    if limit.get() > 100 {
        return Err(
            crate::domain::error::AgentSessionError::InvalidActivityQuery(
                "activity limit must not exceed 100",
            )
            .into(),
        );
    }
    crate::domain::activity::read(
        state.repository.as_ref(),
        &access.entity_access_receipt,
        query.agent_correlation_id,
        cursor,
        limit,
    )
    .await
    .map(Json)
    .map_err(Into::into)
}
