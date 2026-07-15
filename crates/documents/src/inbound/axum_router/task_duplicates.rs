//! Task duplicate detection endpoints.

use std::sync::Arc;

use axum::{
    Extension, Json,
    extract::{Path, State},
};
use entity_access::domain::models::MemberTeamRole;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::{
    DocumentAccessExtractor, OptionalMacroUserTeamExtractorV2,
};
use lexical_client::LexicalClient;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService};
use model::document::DocumentBasic;
use model::response::GenericSuccessResponse;
use models_permissions::share_permission::access_level::{OwnerAccessLevel, ViewAccessLevel};
use serde::{Deserialize, Serialize};
use task_dedup::{
    EmbeddingMarkdown, NewTask, PgTaskDedupService, TaskDedupError, TaskDuplicate,
    TaskSimilarityResult,
};
use uuid::Uuid;

use super::{DocumentRouterState, Params};
use crate::domain::models::DocumentError;
use crate::domain::ports::DocumentService;

/// Response for duplicate task lookup.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TaskDuplicatesResponse {
    /// Active duplicate matches for the requested task.
    pub duplicates: Vec<TaskDuplicate>,
}

/// Request body for dismissing duplicate matches.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DismissTaskDuplicatesRequest {
    /// Match ids to dismiss.
    pub match_ids: Vec<Uuid>,
}

/// Request body for searching tasks similar to an unsaved draft.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TaskSimilaritySearchRequest {
    /// Draft task title.
    pub task_name: String,
    /// Draft task body as embedding-format markdown. The composer produces it
    /// client-side with lexical-core's `markdownToEmbeddingText` (the same
    /// format lexical-service's `/markdown/{id}?target=embedding` renders), so
    /// this latency-sensitive endpoint embeds the text as-is without a
    /// lexical-service round trip.
    pub markdown: Option<String>,
}

/// Response for searching tasks similar to an unsaved draft.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TaskSimilaritySearchResponse {
    /// Existing tasks similar to the draft.
    pub results: Vec<TaskSimilarityResult>,
}

/// Handler for `GET /documents/{document_id}/duplicates`.
#[tracing::instrument(skip(state, _access), err)]
pub async fn get_task_duplicates_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    _access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<TaskDuplicatesResponse>, DocumentError> {
    let duplicates = state
        .task_dedup_service
        .active_duplicates(&document_id)
        .await
        .map_err(task_dedup_error)?;

    Ok(Json(TaskDuplicatesResponse { duplicates }))
}

/// Handler for `POST /documents/similarity_search`.
///
/// Returns existing tasks similar to an unsaved draft. Runs vector retrieval +
/// rerank only and persists nothing.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents/similarity_search",
    request_body = TaskSimilaritySearchRequest,
    responses(
        (status = 200, body = inline(TaskSimilaritySearchResponse)),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user, optional_team, request), fields(user_id=?user.macro_user_id), err)]
pub async fn task_similarity_search_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth>,
    optional_team: OptionalMacroUserTeamExtractorV2<MemberTeamRole, Svc, Auth>,
    Json(request): Json<TaskSimilaritySearchRequest>,
) -> Result<Json<TaskSimilaritySearchResponse>, DocumentError> {
    // Search the user's whole team, not just their own tasks: a duplicate is a
    // duplicate no matter which teammate filed it. Users without a team fall
    // back to owner-only scope.
    let team_id = optional_team
        .entity_access_receipt
        .map(|team| macro_uuid::string_to_uuid(&team.entity().entity_id).unwrap());
    // The composer renders the draft body with lexical-core's
    // `markdownToEmbeddingText`, so we trust it as embedding-format here rather
    // than round-tripping through lexical-service on this latency-sensitive path.
    let markdown = EmbeddingMarkdown::from_client_trusted(request.markdown.unwrap_or_default());

    let results = state
        .task_dedup_service
        .similarity_search(
            user.macro_user_id.as_ref(),
            team_id,
            &request.task_name,
            &markdown,
        )
        .await
        .map_err(task_dedup_error)?;

    Ok(Json(TaskSimilaritySearchResponse { results }))
}

/// Handler for `POST /documents/{document_id}/duplicates/dismiss`.
#[tracing::instrument(skip(state, _access, user), err)]
pub async fn dismiss_task_duplicates_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    _access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth>,
    Path(Params { document_id }): Path<Params>,
    Json(request): Json<DismissTaskDuplicatesRequest>,
) -> Result<Json<GenericSuccessResponse>, DocumentError> {
    state
        .task_dedup_service
        .dismiss_matches(
            &document_id,
            &request.match_ids,
            user.macro_user_id.as_ref(),
        )
        .await
        .map_err(task_dedup_error)?;

    Ok(Json(GenericSuccessResponse { success: true }))
}

/// Handler for `POST /documents/{document_id}/duplicates/{match_id}/delete_this`.
#[tracing::instrument(skip(state, access, doc), err)]
pub async fn delete_this_duplicate_task_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<OwnerAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    doc: Extension<DocumentBasic>,
    Path((document_id, match_id)): Path<(String, Uuid)>,
) -> Result<Json<GenericSuccessResponse>, DocumentError> {
    state
        .task_dedup_service
        .ensure_match_contains(&document_id, match_id)
        .await
        .map_err(task_dedup_error)?;
    state
        .service
        .delete_document(access.entity_access_receipt, doc.project_id.clone())
        .await?;
    state
        .task_dedup_service
        .dismiss_match_by_id(match_id)
        .await
        .map_err(task_dedup_error)?;

    Ok(Json(GenericSuccessResponse { success: true }))
}

/// Spawn duplicate detection for a newly created task.
///
/// The created document's body is fetched from lexical-service rendered as
/// embedding-format markdown so the stored embedding matches the format the
/// composer's similarity search sends. `task` arrives with a title-only body
/// ([`EmbeddingMarkdown::empty`]); when the fetch fails we keep that and embed
/// the title alone rather than embed wrong-format text.
pub fn spawn_task_duplicate_detection(
    task_dedup_service: Arc<PgTaskDedupService>,
    lexical_client: Arc<LexicalClient>,
    mut task: NewTask,
) {
    tokio::spawn(async move {
        match lexical_client
            .get_embedding_markdown(&task.document_id)
            .await
        {
            Ok(markdown) => task.markdown = markdown,
            Err(error) => tracing::warn!(
                error=?error,
                document_id=%task.document_id,
                "failed to fetch embedding markdown for task dedup; embedding title only"
            ),
        }
        let _ = task_dedup_service
            .detect_new_task(task)
            .await
            .inspect_err(|error| tracing::error!(error=?error, "task duplicate detection failed"));
    });
}

fn task_dedup_error(error: TaskDedupError) -> DocumentError {
    match error {
        TaskDedupError::MatchNotFound => {
            DocumentError::NotFound("duplicate match not found".to_string())
        }
        TaskDedupError::Storage(error) => DocumentError::Internal(error.into()),
        TaskDedupError::Dependency(error) => DocumentError::Internal(error),
    }
}
