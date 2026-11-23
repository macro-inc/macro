//! Handler for reading one initiative's history.

use std::sync::Arc;

use activity::domain::ports::EntityActivityReads;
use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    routing,
};
use chrono::{DateTime, Utc};
use entity_access::domain::models::ViewAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::InitiativeAccessExtractor;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use uuid::Uuid;

use super::InitiativeIdParams;
use crate::domain::{
    history::{
        InitiativeActivityCursor, InitiativeActivityPage, InitiativeActivityRange,
        InitiativeHistory,
    },
    models::InitiativeError,
};

/// Router state for initiative history.
pub struct InitiativeActivityRouterState<R, Eas, Auth> {
    history: Arc<InitiativeHistory<R, Eas>>,
    entity_access_service: Arc<Eas>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<R, Eas, Auth> Clone for InitiativeActivityRouterState<R, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            history: self.history.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<R, Eas, Auth> InitiativeActivityRouterState<R, Eas, Auth> {
    /// Compose the history reader with access checks and authorization.
    pub fn new(
        history: Arc<InitiativeHistory<R, Eas>>,
        entity_access_service: Arc<Eas>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            history,
            entity_access_service,
            authorization_state,
        }
    }
}

impl<R, Eas, Auth> FromRef<InitiativeActivityRouterState<R, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &InitiativeActivityRouterState<R, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<R, Eas, Auth> FromRef<InitiativeActivityRouterState<R, Eas, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &InitiativeActivityRouterState<R, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the initiative history router, nested under `/initiatives` beside
/// [`super::initiative_router`].
pub fn initiative_activity_router<R, Eas, Auth, T>(
    state: InitiativeActivityRouterState<R, Eas, Auth>,
) -> Router<T>
where
    R: EntityActivityReads,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{initiative_id}/activity",
            routing::get(get_initiative_activity_handler::<R, Eas, Auth>),
        )
        .with_state(state)
}

/// Window and continuation of an initiative history page.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct InitiativeActivityParams {
    /// Only changes at or after this time.
    pub after: Option<DateTime<Utc>>,
    /// Only changes before this time.
    pub before: Option<DateTime<Utc>>,
    /// `occurredAt` of the previous page's `nextCursor`; send with `cursorId`.
    pub cursor_occurred_at: Option<DateTime<Utc>>,
    /// `id` of the previous page's `nextCursor`; send with `cursorOccurredAt`.
    pub cursor_id: Option<Uuid>,
    /// Events to scan, 1 through 100; defaults to 100.
    pub limit: Option<u32>,
}

/// Read an initiative's creation, edits, property changes and task membership
/// changes, newest first.
///
/// Task references require current view access to the task, so a page can hold
/// fewer records than `limit`, even none. Follow `nextCursor` with the same
/// window until it is absent.
#[utoipa::path(
    get,
    tag = "initiative",
    operation_id = "get_initiative_activity",
    path = "/initiatives/{initiative_id}/activity",
    params(InitiativeIdParams, InitiativeActivityParams),
    responses(
        (status = 200, body = InitiativeActivityPage),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all, fields(initiative_id = %access.entity_access_receipt.entity().entity_id))]
pub async fn get_initiative_activity_handler<R, Eas, Auth>(
    State(state): State<InitiativeActivityRouterState<R, Eas, Auth>>,
    access: InitiativeAccessExtractor<ViewAccessLevel, Eas, Auth>,
    Query(params): Query<InitiativeActivityParams>,
) -> Result<Json<InitiativeActivityPage>, InitiativeError>
where
    R: EntityActivityReads,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let cursor = match (params.cursor_occurred_at, params.cursor_id) {
        (Some(occurred_at), Some(id)) => Some(InitiativeActivityCursor { occurred_at, id }),
        (None, None) => None,
        _ => {
            return Err(InitiativeError::BadRequest(
                "cursorOccurredAt and cursorId must be sent together".into(),
            ));
        }
    };

    let page = state
        .history
        .read_range(
            access.entity_access_receipt,
            InitiativeActivityRange {
                after: params.after,
                before: params.before,
                cursor,
                limit: params.limit.unwrap_or(100),
            },
        )
        .await?;
    Ok(Json(page))
}
