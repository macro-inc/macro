//! REST adapter for saved-view definitions, with the same contract as the
//! GraphQL one: consumer kinds, revision-guarded writes, team sharing, and the
//! viewer's own order. API clients such as the SDK use it; the legacy personal
//! routes beside it are unchanged.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::extract::{FromRef, Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use chrono::{DateTime, Utc};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationState, UserOrInternal};
use model::response::ErrorResponse;
use saved_views::View;
use saved_views::domain::{Cursor, Error, SavedViewApi, ShareChange, Update};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::api::context::AuthorizationService;

const DEFAULT_PAGE_SIZE: u32 = 25;
const MAX_PAGE_SIZE: u32 = 50;

/// The saved-view domain service these routes act through.
#[derive(Clone)]
pub struct SavedViewDefinitionsState(pub Arc<dyn SavedViewApi>);

/// Routes nested under `/saved_views/definitions`.
pub fn router<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    SavedViewDefinitionsState: FromRef<S>,
    MacroAuthorizationState<AuthorizationService>: FromRef<S>,
{
    Router::new()
        .route("/", get(list_handler).post(create_handler))
        .route("/order", put(reorder_handler))
        .route(
            "/{saved_view_id}",
            get(get_handler)
                .patch(update_handler)
                .delete(delete_handler),
        )
}

type Viewer = MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>;

/// A saved filter definition, not a snapshot of matching entities.
#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SavedViewDefinition {
    /// Stable identity of this definition.
    id: Uuid,
    /// User who owns and can edit this definition.
    owner_id: String,
    /// Display name chosen by the owner.
    name: String,
    /// Versioned configuration interpreted by the consuming feature, with its
    /// `kind` (such as `email` or `task`) and `version`.
    #[schema(value_type = Object)]
    config: serde_json::Value,
    /// Team with access, or absent when the definition is private.
    shared_team_id: Option<Uuid>,
    /// Current revision, required by updates and deletion.
    revision: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<View> for SavedViewDefinition {
    fn from(view: View) -> Self {
        Self {
            id: view.id,
            owner_id: view.user_id,
            name: view.name,
            config: view.config,
            shared_team_id: view.shared_team_id,
            revision: view.revision,
            created_at: view.created_at,
            updated_at: view.updated_at,
        }
    }
}

/// A page in the viewer's own order, then by creation time and ID.
#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SavedViewDefinitionPage {
    /// Definitions the viewer can currently access.
    views: Vec<SavedViewDefinition>,
    /// Opaque cursor for the next page, absent when the listing is complete.
    next_cursor: Option<String>,
}

#[derive(Deserialize, Debug, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct ListSavedViewDefinitionsParams {
    /// Only definitions of this consumer kind, such as `email`.
    kind: Option<String>,
    /// Page size, 1 to 50; defaults to 25.
    first: Option<u32>,
    /// `nextCursor` from the previous page.
    after: Option<String>,
}

#[derive(Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSavedViewDefinitionRequest {
    /// Client-chosen ID, reused to retry the same creation; generated when absent.
    id: Option<Uuid>,
    /// Nonempty display name, at most 120 characters.
    name: String,
    /// Consumer configuration with its `kind` and `version`, at most 32 KiB.
    #[schema(value_type = Object)]
    config: serde_json::Value,
    /// Team to share with, which the creator must belong to.
    shared_team_id: Option<Uuid>,
}

/// An explicit sharing change: a team, or `null` to make the definition private.
#[derive(Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SavedViewSharingRequest {
    team_id: Option<Uuid>,
}

#[derive(Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSavedViewDefinitionRequest {
    /// Revision that must still be current when the update commits.
    expected_revision: i64,
    /// Replacement name; absent keeps the current one.
    name: Option<String>,
    /// Complete replacement configuration; absent keeps the current one.
    #[schema(value_type = Option<Object>)]
    config: Option<serde_json::Value>,
    /// Sharing change; absent keeps the current share.
    sharing: Option<SavedViewSharingRequest>,
}

#[derive(Deserialize, Debug, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSavedViewDefinitionParams {
    /// Revision that must still be current when the deletion commits.
    expected_revision: i64,
}

#[derive(Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReorderSavedViewDefinitionsRequest {
    /// Consumer kind whose order is replaced, such as `email`.
    kind: String,
    /// Visible definitions of that kind in their new order, at most 200;
    /// definitions left out follow them by creation time.
    ids: Vec<Uuid>,
}

#[derive(Deserialize)]
pub struct SavedViewDefinitionPath {
    saved_view_id: Uuid,
}

/// Domain failures as stable statuses; another owner's view reads as missing.
#[derive(Debug, thiserror::Error)]
pub enum SavedViewDefinitionErr {
    /// The saved view domain refused or failed.
    #[error(transparent)]
    Domain(#[from] Error),
    /// A share from a session whose scope shares nothing.
    #[error(transparent)]
    SharingRefused(#[from] agent_correlation::context::SharingRefused),
}

impl IntoResponse for SavedViewDefinitionErr {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::Domain(Error::NotFound | Error::NotOwner) => StatusCode::NOT_FOUND,
            Self::Domain(Error::Conflict) => StatusCode::CONFLICT,
            Self::Domain(Error::Invalid) => StatusCode::BAD_REQUEST,
            Self::Domain(Error::NotMember) | Self::SharingRefused(_) => StatusCode::FORBIDDEN,
            Self::Domain(Error::Internal(error)) => {
                tracing::error!(error = ?error, "saved view failure");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        let message = match self {
            Self::Domain(Error::NotOwner) => Error::NotFound.to_string(),
            other => other.to_string(),
        };
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// Cursors use the GraphQL adapter's encoding, so either transport can resume
/// the other's listing.
fn decode_cursor(raw: &str) -> Result<Cursor, Error> {
    serde_json::from_str::<(Option<i32>, DateTime<Utc>, Uuid)>(raw)
        .map(|(position, created_at, id)| Cursor {
            position,
            created_at,
            id,
        })
        .map_err(|_| Error::Invalid)
}

fn encode_cursor(cursor: &Cursor) -> Result<String, Error> {
    serde_json::to_string(&(cursor.position, cursor.created_at, cursor.id))
        .map_err(|error| Error::Internal(rootcause::Report::new(error).into_dynamic()))
}

#[utoipa::path(
    tag = "saved_views",
    get,
    path = "/saved_views/definitions",
    operation_id = "list_saved_view_definitions",
    params(ListSavedViewDefinitionsParams),
    responses(
        (status = 200, body = SavedViewDefinitionPage),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(kind = params.kind.as_deref()), err)]
pub async fn list_handler(
    State(SavedViewDefinitionsState(service)): State<SavedViewDefinitionsState>,
    user: Viewer,
    Query(params): Query<ListSavedViewDefinitionsParams>,
) -> Result<Json<SavedViewDefinitionPage>, SavedViewDefinitionErr> {
    let first = params.first.unwrap_or(DEFAULT_PAGE_SIZE);
    if !(1..=MAX_PAGE_SIZE).contains(&first) {
        return Err(Error::Invalid.into());
    }
    let after = params.after.as_deref().map(decode_cursor).transpose()?;
    let page = service
        .list(
            user.authorization.user.macro_user_id.as_ref(),
            params.kind.as_deref(),
            after,
            first,
        )
        .await?;
    Ok(Json(SavedViewDefinitionPage {
        views: page.views.into_iter().map(Into::into).collect(),
        next_cursor: page.next.as_ref().map(encode_cursor).transpose()?,
    }))
}

#[utoipa::path(
    tag = "saved_views",
    get,
    path = "/saved_views/definitions/{saved_view_id}",
    operation_id = "get_saved_view_definition",
    params(("saved_view_id" = Uuid, Path, description = "The saved view to read")),
    responses(
        (status = 200, body = SavedViewDefinition),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(saved_view_id = %path.saved_view_id), err)]
pub async fn get_handler(
    State(SavedViewDefinitionsState(service)): State<SavedViewDefinitionsState>,
    user: Viewer,
    Path(path): Path<SavedViewDefinitionPath>,
) -> Result<Json<SavedViewDefinition>, SavedViewDefinitionErr> {
    let view = service
        .get(
            user.authorization.user.macro_user_id.as_ref(),
            path.saved_view_id,
        )
        .await?;
    Ok(Json(view.into()))
}

#[utoipa::path(
    tag = "saved_views",
    post,
    path = "/saved_views/definitions",
    operation_id = "create_saved_view_definition",
    request_body = CreateSavedViewDefinitionRequest,
    responses(
        (status = 201, body = SavedViewDefinition),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub async fn create_handler(
    State(SavedViewDefinitionsState(service)): State<SavedViewDefinitionsState>,
    user: Viewer,
    Json(request): Json<CreateSavedViewDefinitionRequest>,
) -> Result<(StatusCode, Json<SavedViewDefinition>), SavedViewDefinitionErr> {
    // A saved view's team share is its own column, which the grant
    // writers never see.
    agent_correlation::context::refuse_sharing(request.shared_team_id.is_some())?;
    let view = service
        .create(
            user.authorization.user.macro_user_id.as_ref(),
            request.id.unwrap_or_else(Uuid::now_v7),
            request.name,
            request.config,
            request.shared_team_id,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

#[utoipa::path(
    tag = "saved_views",
    patch,
    path = "/saved_views/definitions/{saved_view_id}",
    operation_id = "update_saved_view_definition",
    params(("saved_view_id" = Uuid, Path, description = "The saved view to update")),
    request_body = UpdateSavedViewDefinitionRequest,
    responses(
        (status = 200, body = SavedViewDefinition),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(saved_view_id = %path.saved_view_id), err)]
pub async fn update_handler(
    State(SavedViewDefinitionsState(service)): State<SavedViewDefinitionsState>,
    user: Viewer,
    Path(path): Path<SavedViewDefinitionPath>,
    Json(request): Json<UpdateSavedViewDefinitionRequest>,
) -> Result<Json<SavedViewDefinition>, SavedViewDefinitionErr> {
    // A scoped session shares nothing; this route's path can't say whether
    // its body does.
    agent_correlation::context::refuse_sharing(request.sharing.is_some())?;
    let share = match request.sharing {
        None => ShareChange::Unchanged,
        Some(SavedViewSharingRequest { team_id: None }) => ShareChange::Private,
        Some(SavedViewSharingRequest {
            team_id: Some(team),
        }) => ShareChange::Team(team),
    };
    let view = service
        .update(
            user.authorization.user.macro_user_id.as_ref(),
            path.saved_view_id,
            request.expected_revision,
            Update {
                name: request.name,
                config: request.config,
                share,
            },
        )
        .await?;
    Ok(Json(view.into()))
}

#[utoipa::path(
    tag = "saved_views",
    delete,
    path = "/saved_views/definitions/{saved_view_id}",
    operation_id = "delete_saved_view_definition",
    params(
        ("saved_view_id" = Uuid, Path, description = "The saved view to delete"),
        DeleteSavedViewDefinitionParams
    ),
    responses(
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(saved_view_id = %path.saved_view_id), err)]
pub async fn delete_handler(
    State(SavedViewDefinitionsState(service)): State<SavedViewDefinitionsState>,
    user: Viewer,
    Path(path): Path<SavedViewDefinitionPath>,
    Query(params): Query<DeleteSavedViewDefinitionParams>,
) -> Result<StatusCode, SavedViewDefinitionErr> {
    service
        .delete(
            user.authorization.user.macro_user_id.as_ref(),
            path.saved_view_id,
            params.expected_revision,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    tag = "saved_views",
    put,
    path = "/saved_views/definitions/order",
    operation_id = "reorder_saved_view_definitions",
    request_body = ReorderSavedViewDefinitionsRequest,
    responses(
        (status = 200, body = Vec<SavedViewDefinition>),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(kind = %request.kind, count = request.ids.len()), err)]
pub async fn reorder_handler(
    State(SavedViewDefinitionsState(service)): State<SavedViewDefinitionsState>,
    user: Viewer,
    Json(request): Json<ReorderSavedViewDefinitionsRequest>,
) -> Result<Json<Vec<SavedViewDefinition>>, SavedViewDefinitionErr> {
    let views = service
        .reorder(
            user.authorization.user.macro_user_id.as_ref(),
            &request.kind,
            request.ids,
        )
        .await?;
    Ok(Json(views.into_iter().map(Into::into).collect()))
}
