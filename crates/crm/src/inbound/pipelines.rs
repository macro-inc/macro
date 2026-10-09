//! Thin HTTP adapters for pipeline creation, navigation, sharing and lifecycle.

use crate::domain::{
    auth::CrmTeamReceipt,
    pipelines::{
        AccessiblePipeline, CreatePipeline, PipelineError, PipelineService, PipelineSharing,
    },
};
use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use entity_access::{
    domain::{
        models::{
            EditAccessLevel, EntityAccessReceipt, EntityType, MemberTeamRole, OwnerAccessLevel,
            RequiredPermission, ViewAccessLevel,
        },
        ports::EntityAccessService,
    },
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

/// Services used by pipeline routes.
pub struct PipelineRouterState<P, E, A> {
    /// Pipeline domain service.
    pub service: Arc<P>,
    /// Entity access receipt issuer.
    pub access: Arc<E>,
    /// Authentication state.
    pub authorization: MacroAuthorizationState<A>,
}

impl<P, E, A> Clone for PipelineRouterState<P, E, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access: self.access.clone(),
            authorization: self.authorization.clone(),
        }
    }
}
impl<P, E, A> FromRef<PipelineRouterState<P, E, A>> for Arc<E> {
    fn from_ref(state: &PipelineRouterState<P, E, A>) -> Self {
        state.access.clone()
    }
}
impl<P, E, A> FromRef<PipelineRouterState<P, E, A>> for MacroAuthorizationState<A> {
    fn from_ref(state: &PipelineRouterState<P, E, A>) -> Self {
        state.authorization.clone()
    }
}

/// Mount at `/crm/pipelines`.
pub fn router<P, E, A, S>(state: PipelineRouterState<P, E, A>) -> Router<S>
where
    P: PipelineService,
    E: EntityAccessService,
    A: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route("/", get(list::<P, E, A>).post(create::<P, E, A>))
        .route("/{id}", get(read::<P, E, A>))
        .route("/{id}/table", get(table::<P, E, A>))
        .route(
            "/{id}/rows",
            get(rows::<P, E, A>).post(query_rows::<P, E, A>),
        )
        .route("/{id}/ops", post(apply_ops::<P, E, A>))
        .route("/{id}/name", put(rename::<P, E, A>))
        .route("/{id}/sharing", put(share::<P, E, A>))
        .route("/{id}/trash", put(trash::<P, E, A>))
        .with_state(state)
}

/// Create a private or team-shared pipeline.
#[utoipa::path(post, path = "/crm/pipelines", operation_id = "create_crm_pipeline", request_body = CreatePipeline,
    responses((status = 200, body = AccessiblePipeline)))]
pub async fn create<P: PipelineService, E: EntityAccessService, A: MacroAuthorizationService>(
    team: MacroUserTeamExtractorV2<MemberTeamRole, E, A>,
    State(state): State<PipelineRouterState<P, E, A>>,
    Json(input): Json<CreatePipeline>,
) -> Result<Json<AccessiblePipeline>, PipelineError> {
    Ok(Json(
        state
            .service
            .create(
                CrmTeamReceipt::from_team_receipt(team.entity_access_receipt)?,
                input,
            )
            .await?,
    ))
}

/// List the caller's live pipelines in their CRM.
#[utoipa::path(get, path = "/crm/pipelines", operation_id = "list_crm_pipelines",
    responses((status = 200, body = Vec<AccessiblePipeline>)))]
pub async fn list<P: PipelineService, E: EntityAccessService, A: MacroAuthorizationService>(
    team: MacroUserTeamExtractorV2<MemberTeamRole, E, A>,
    State(state): State<PipelineRouterState<P, E, A>>,
) -> Result<Json<Vec<AccessiblePipeline>>, PipelineError> {
    Ok(Json(
        state
            .service
            .list(CrmTeamReceipt::from_team_receipt(
                team.entity_access_receipt,
            )?)
            .await?,
    ))
}

async fn receipt<T: RequiredPermission, E: EntityAccessService, A: MacroAuthorizationService>(
    access: &E,
    auth: MacroAuthorizationExtractor<A, UserOrInternal>,
    id: Uuid,
) -> Result<EntityAccessReceipt<T>, PipelineError> {
    Ok(access
        .generate_entity_access_receipt::<T>(
            &auth.authorization.user.macro_user_id,
            None,
            &id.to_string(),
            EntityType::CrmPipeline,
        )
        .await?)
}

/// Read one pipeline by its entity identity.
#[utoipa::path(get, path = "/crm/pipelines/{id}", operation_id = "get_crm_pipeline",
    params(("id" = Uuid, Path)), responses((status = 200, body = AccessiblePipeline)))]
pub async fn read<P: PipelineService, E: EntityAccessService, A: MacroAuthorizationService>(
    auth: MacroAuthorizationExtractor<A, UserOrInternal>,
    State(state): State<PipelineRouterState<P, E, A>>,
    Path(id): Path<Uuid>,
) -> Result<Json<AccessiblePipeline>, PipelineError> {
    Ok(Json(
        state
            .service
            .get(receipt::<ViewAccessLevel, _, _>(&*state.access, auth, id).await?)
            .await?,
    ))
}

/// Read the host-owned table schema.
#[utoipa::path(get, path = "/crm/pipelines/{id}/table", operation_id = "get_crm_pipeline_table",
    params(("id" = Uuid, Path)), responses((status = 200, body = databases::domain::models::TableDetail)))]
pub async fn table<P: PipelineService, E: EntityAccessService, A: MacroAuthorizationService>(
    auth: MacroAuthorizationExtractor<A, UserOrInternal>,
    State(state): State<PipelineRouterState<P, E, A>>,
    Path(id): Path<Uuid>,
) -> Result<Json<databases::domain::models::TableDetail>, PipelineError> {
    Ok(Json(
        state
            .service
            .table(receipt::<ViewAccessLevel, _, _>(&*state.access, auth, id).await?)
            .await?,
    ))
}

/// Pagination through pipeline records.
#[derive(Deserialize, utoipa::IntoParams)]
pub struct RowsQuery {
    /// Continue after this row identity.
    pub after: Option<Uuid>,
}

/// Read pipeline records through pipeline access.
#[utoipa::path(get, path = "/crm/pipelines/{id}/rows", operation_id = "get_crm_pipeline_rows",
    params(("id" = Uuid, Path), RowsQuery), responses((status = 200, body = databases::domain::storage::StorageRows)))]
pub async fn rows<P: PipelineService, E: EntityAccessService, A: MacroAuthorizationService>(
    auth: MacroAuthorizationExtractor<A, UserOrInternal>,
    State(state): State<PipelineRouterState<P, E, A>>,
    Path(id): Path<Uuid>,
    Query(query): Query<RowsQuery>,
) -> Result<Json<databases::domain::storage::StorageRows>, PipelineError> {
    Ok(Json(
        state
            .service
            .rows(
                receipt::<ViewAccessLevel, _, _>(&*state.access, auth, id).await?,
                query.after.map(models_databases::RowId::from_uuid),
            )
            .await?,
    ))
}

/// Query rows through pipeline access using the shared view protocol.
#[utoipa::path(post, path = "/crm/pipelines/{id}/rows", operation_id = "query_crm_pipeline_rows",
    request_body = databases::domain::storage::StorageRowsQuery, params(("id" = Uuid, Path)), responses((status = 200, body = databases::domain::storage::StorageRows)))]
pub async fn query_rows<
    P: PipelineService,
    E: EntityAccessService,
    A: MacroAuthorizationService,
>(
    auth: MacroAuthorizationExtractor<A, UserOrInternal>,
    State(state): State<PipelineRouterState<P, E, A>>,
    Path(id): Path<Uuid>,
    Json(query): Json<databases::domain::storage::StorageRowsQuery>,
) -> Result<Json<databases::domain::storage::StorageRows>, PipelineError> {
    Ok(Json(
        state
            .service
            .query_rows(
                receipt::<ViewAccessLevel, _, _>(&*state.access, auth, id).await?,
                query,
            )
            .await?,
    ))
}

/// Edit pipeline schema or records with the common typed operations.
#[utoipa::path(post, path = "/crm/pipelines/{id}/ops", operation_id = "apply_crm_pipeline_ops",
    request_body = databases::domain::models::OpBatch, params(("id" = Uuid, Path)), responses((status = 200, body = databases::domain::models::AppliedOps)))]
pub async fn apply_ops<P: PipelineService, E: EntityAccessService, A: MacroAuthorizationService>(
    auth: MacroAuthorizationExtractor<A, UserOrInternal>,
    State(state): State<PipelineRouterState<P, E, A>>,
    Path(id): Path<Uuid>,
    Json(batch): Json<databases::domain::models::OpBatch>,
) -> Result<Json<databases::domain::models::AppliedOps>, PipelineError> {
    Ok(Json(
        state
            .service
            .apply_ops(
                receipt::<EditAccessLevel, _, _>(&*state.access, auth, id).await?,
                batch,
            )
            .await?,
    ))
}

/// Rename input.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RenamePipeline {
    /// New display name.
    pub name: String,
}
/// Sharing input.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SharePipeline {
    /// Desired team grant.
    pub sharing: PipelineSharing,
}
/// Trash/restore input.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TrashPipeline {
    /// True to trash; false to restore.
    pub trashed: bool,
}

/// Rename a pipeline.
#[utoipa::path(put, path = "/crm/pipelines/{id}/name", operation_id = "rename_crm_pipeline", request_body = RenamePipeline,
    params(("id" = Uuid, Path)), responses((status = 204)))]
pub async fn rename<P: PipelineService, E: EntityAccessService, A: MacroAuthorizationService>(
    auth: MacroAuthorizationExtractor<A, UserOrInternal>,
    State(state): State<PipelineRouterState<P, E, A>>,
    Path(id): Path<Uuid>,
    Json(input): Json<RenamePipeline>,
) -> Result<StatusCode, PipelineError> {
    state
        .service
        .rename(
            receipt::<EditAccessLevel, _, _>(&*state.access, auth, id).await?,
            input.name,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
/// Update sharing.
#[utoipa::path(put, path = "/crm/pipelines/{id}/sharing", operation_id = "share_crm_pipeline", request_body = SharePipeline,
    params(("id" = Uuid, Path)), responses((status = 204)))]
pub async fn share<P: PipelineService, E: EntityAccessService, A: MacroAuthorizationService>(
    auth: MacroAuthorizationExtractor<A, UserOrInternal>,
    State(state): State<PipelineRouterState<P, E, A>>,
    Path(id): Path<Uuid>,
    Json(input): Json<SharePipeline>,
) -> Result<StatusCode, PipelineError> {
    state
        .service
        .share(
            receipt::<OwnerAccessLevel, _, _>(&*state.access, auth, id).await?,
            input.sharing,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
/// Trash or restore a pipeline.
#[utoipa::path(put, path = "/crm/pipelines/{id}/trash", operation_id = "trash_crm_pipeline", request_body = TrashPipeline,
    params(("id" = Uuid, Path)), responses((status = 204)))]
pub async fn trash<P: PipelineService, E: EntityAccessService, A: MacroAuthorizationService>(
    auth: MacroAuthorizationExtractor<A, UserOrInternal>,
    State(state): State<PipelineRouterState<P, E, A>>,
    Path(id): Path<Uuid>,
    Json(input): Json<TrashPipeline>,
) -> Result<StatusCode, PipelineError> {
    state
        .service
        .set_trashed(
            receipt::<OwnerAccessLevel, _, _>(&*state.access, auth, id).await?,
            input.trashed,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

impl IntoResponse for PipelineError {
    fn into_response(self) -> Response {
        match self {
            Self::Invalid(message) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"message": message})),
            )
                .into_response(),
            Self::NotFound => StatusCode::NOT_FOUND.into_response(),
            Self::Access(error) => {
                entity_access::inbound::axum_extractors::ExtractorError::from(error).into_response()
            }
            Self::Crm(error) => error.into_response(),
            Self::Database(error) => {
                use databases::domain::models::DatabaseError;
                let status = match error {
                    DatabaseError::InvalidOp(refusal) => {
                        return (
                            StatusCode::BAD_REQUEST,
                            Json(serde_json::json!({
                                "message": refusal.reason,
                                "op": refusal.op,
                                "row": refusal.row,
                                "column": refusal.column,
                                "taken": refusal.taken,
                            })),
                        )
                            .into_response();
                    }
                    DatabaseError::NotFound => StatusCode::NOT_FOUND,
                    DatabaseError::Unauthorized => StatusCode::FORBIDDEN,
                    DatabaseError::InvalidSchemaOperation(_) | DatabaseError::InvalidSharing(_) => {
                        StatusCode::BAD_REQUEST
                    }
                    DatabaseError::RowInUse
                    | DatabaseError::OptionInUse
                    | DatabaseError::VersionConflict => StatusCode::CONFLICT,
                    DatabaseError::Repo(error) => {
                        tracing::error!(error = ?error, "pipeline database request failed");
                        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                    }
                };
                (
                    status,
                    Json(serde_json::json!({"message": error.to_string()})),
                )
                    .into_response()
            }
            error => {
                tracing::error!(error = ?error, "pipeline request failed");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        }
    }
}
