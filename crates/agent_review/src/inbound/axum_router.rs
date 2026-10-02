//! Browser review routes. Standard session extractors mint typed permission receipts.

use crate::domain::{model::*, service::Reviews};
use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use entity_access::{
    domain::{
        models::{EditAccessLevel, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::AgentSessionAccessLevelExtractor,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

/// Authenticated review routing dependencies, constructed by the harness service.
pub struct ReviewRouterState<A, Auth> {
    reviews: Arc<dyn Reviews>,
    access: Arc<A>,
    authorization: MacroAuthorizationState<Auth>,
}
impl<A, Auth> ReviewRouterState<A, Auth> {
    /// Bind domain service and standard session extractors.
    pub fn new(
        reviews: Arc<dyn Reviews>,
        access: Arc<A>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            reviews,
            access,
            authorization,
        }
    }
}
impl<A, Auth> Clone for ReviewRouterState<A, Auth> {
    fn clone(&self) -> Self {
        Self {
            reviews: self.reviews.clone(),
            access: self.access.clone(),
            authorization: self.authorization.clone(),
        }
    }
}
impl<A, Auth> FromRef<ReviewRouterState<A, Auth>> for Arc<A> {
    fn from_ref(state: &ReviewRouterState<A, Auth>) -> Self {
        state.access.clone()
    }
}
impl<A, Auth> FromRef<ReviewRouterState<A, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ReviewRouterState<A, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Mount under `/agent-sessions`, beside the existing session control routes.
pub fn router<A: EntityAccessService, Auth: MacroAuthorizationService>(
    state: ReviewRouterState<A, Auth>,
) -> Router {
    Router::new()
        .route("/{session_id}/review", get(view::<A, Auth>))
        .route("/{session_id}/review/file", get(file::<A, Auth>))
        .route("/{session_id}/review/capture", post(capture::<A, Auth>))
        .route("/{session_id}/review/comment", post(comment::<A, Auth>))
        .route("/{session_id}/review/link", post(link::<A, Auth>))
        .route("/{session_id}/review/resolve", post(resolve::<A, Auth>))
        .with_state(state)
}

/// Review metadata envelope. An empty review is distinct from a failed read.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct ReviewResponse {
    /// Published review, when this session has one.
    pub review: Option<Review>,
}

#[derive(Deserialize, utoipa::ToSchema, utoipa::IntoParams)]
struct ViewQuery {
    revision: Option<u32>,
}
#[derive(Deserialize, utoipa::ToSchema, utoipa::IntoParams)]
struct FileQuery {
    revision: u32,
    path: String,
}
#[derive(Deserialize, utoipa::ToSchema, utoipa::IntoParams)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LinkBody {
    revision: u32,
    location: Location,
}
#[derive(Deserialize, utoipa::ToSchema, utoipa::IntoParams)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResolveBody {
    thread: Uuid,
    resolved: bool,
}

/// Result of changing a thread's resolution state.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct ResolveResponse {
    /// The saved state.
    pub resolved: bool,
}

struct ApiError(ReviewError);
impl From<ReviewError> for ApiError {
    fn from(error: ReviewError) -> Self {
        Self(error)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            ReviewError::Forbidden => StatusCode::FORBIDDEN,
            ReviewError::NotFound => StatusCode::NOT_FOUND,
            ReviewError::Conflict => StatusCode::CONFLICT,
            ReviewError::Invalid(_) => StatusCode::BAD_REQUEST,
            ReviewError::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            ReviewError::Infrastructure(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = ?self.0, "review request failed");
        }
        (
            status,
            Json(serde_json::json!({"message": self.0.to_string()})),
        )
            .into_response()
    }
}

#[utoipa::path(get, path = "/agent-sessions/{session_id}/review", params(("session_id" = Uuid, Path, description = "Session identifier"), ViewQuery), responses((status = 200, description = "Published review and revision metadata", body = ReviewResponse)))]
async fn view<A: EntityAccessService, Auth: MacroAuthorizationService>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, A, Auth>,
    State(state): State<ReviewRouterState<A, Auth>>,
    Query(query): Query<ViewQuery>,
) -> std::result::Result<Json<ReviewResponse>, ApiError> {
    Ok(Json(ReviewResponse {
        review: state
            .reviews
            .view(
                ReviewAccess::View(access.entity_access_receipt),
                query.revision,
            )
            .await?,
    }))
}
#[utoipa::path(get, path = "/agent-sessions/{session_id}/review/file", params(("session_id" = Uuid, Path, description = "Session identifier"), FileQuery), responses((status = 200, description = "Source and diff for the selected revision file", body = ReviewFile)))]
async fn file<A: EntityAccessService, Auth: MacroAuthorizationService>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, A, Auth>,
    State(state): State<ReviewRouterState<A, Auth>>,
    Query(query): Query<FileQuery>,
) -> std::result::Result<Json<ReviewFile>, ApiError> {
    Ok(Json(
        state
            .reviews
            .file(
                ReviewAccess::View(access.entity_access_receipt),
                query.revision,
                &query.path,
            )
            .await?,
    ))
}
#[utoipa::path(post, path = "/agent-sessions/{session_id}/review/capture", params(("session_id" = Uuid, Path, description = "Session identifier")), request_body = Comparison, responses((status = 200, description = "Captured review revision", body = ReviewLink)))]
async fn capture<A: EntityAccessService, Auth: MacroAuthorizationService>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, A, Auth>,
    State(state): State<ReviewRouterState<A, Auth>>,
    Json(comparison): Json<Comparison>,
) -> std::result::Result<Json<ReviewLink>, ApiError> {
    Ok(Json(
        state
            .reviews
            .capture(
                ReviewAccess::Edit(access.entity_access_receipt),
                comparison,
                Presentation::default(),
            )
            .await?,
    ))
}
#[utoipa::path(post, path = "/agent-sessions/{session_id}/review/comment", params(("session_id" = Uuid, Path, description = "Session identifier")), request_body = Comment, responses((status = 200, description = "Saved review comment and thread link", body = ReviewLink)))]
async fn comment<A: EntityAccessService, Auth: MacroAuthorizationService>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, A, Auth>,
    State(state): State<ReviewRouterState<A, Auth>>,
    Json(body): Json<Comment>,
) -> std::result::Result<Json<ReviewLink>, ApiError> {
    Ok(Json(
        state
            .reviews
            .comment(ReviewAccess::Edit(access.entity_access_receipt), body)
            .await?,
    ))
}
#[utoipa::path(post, path = "/agent-sessions/{session_id}/review/link", params(("session_id" = Uuid, Path, description = "Session identifier")), request_body = LinkBody, responses((status = 200, description = "Immutable code citation", body = ReviewLink)))]
async fn link<A: EntityAccessService, Auth: MacroAuthorizationService>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, A, Auth>,
    State(state): State<ReviewRouterState<A, Auth>>,
    Json(body): Json<LinkBody>,
) -> std::result::Result<Json<ReviewLink>, ApiError> {
    Ok(Json(
        state
            .reviews
            .link(
                ReviewAccess::View(access.entity_access_receipt),
                body.revision,
                body.location,
            )
            .await?,
    ))
}
#[utoipa::path(post, path = "/agent-sessions/{session_id}/review/resolve", params(("session_id" = Uuid, Path, description = "Session identifier")), request_body = ResolveBody, responses((status = 200, description = "Updated thread resolution", body = ResolveResponse)))]
async fn resolve<A: EntityAccessService, Auth: MacroAuthorizationService>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, A, Auth>,
    State(state): State<ReviewRouterState<A, Auth>>,
    Json(body): Json<ResolveBody>,
) -> std::result::Result<Json<ResolveResponse>, ApiError> {
    state
        .reviews
        .resolve(
            ReviewAccess::Edit(access.entity_access_receipt),
            body.thread,
            body.resolved,
        )
        .await?;
    Ok(Json(ResolveResponse {
        resolved: body.resolved,
    }))
}

/// Review endpoints and their shared wire models, for the service schema exporter.
#[derive(utoipa::OpenApi)]
#[openapi(paths(view, file, capture, comment, link, resolve))]
pub struct ReviewApiDoc;

/// Export the review endpoints and their shared wire models.
pub fn openapi() -> utoipa::openapi::OpenApi {
    use utoipa::OpenApi;
    ReviewApiDoc::openapi()
}
