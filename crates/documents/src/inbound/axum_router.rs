//! Axum router for document endpoints.
//!
//! Provides routes:
//! - `POST /` — create a new document
//! - `GET /{document_id}` — get document metadata
//! - `GET /slug/{slug}` - get document by team slug
//! - `POST /{document_id}/ai-edit` — edit a markdown document by instructions
//! - `POST /{document_id}/spreadsheet/read`, `/calculate`, `/edits`, `/ai-edit` —
//!   read, calculate and edit a native spreadsheet, by operations or instructions
//! - `POST /create_spreadsheet` — create a native spreadsheet
//! - `GET /{document_id}/presentation`, `POST .../presentation/edits`,
//!   `POST .../presentation/copy` — read, edit, or copy a PowerPoint deck
//! - `GET /{document_id}/word`, `POST .../word/edits` — read or edit an uploaded
//!   Word document's live copy
//! - `GET /{document_id}/design`, `/photoshop`, `/illustrator` — read a design
//!   file as text
//! - `GET /{document_id}/location_v3` — get document content location (presigned URL)
//! - `GET /{document_id}/branch_name` — get short ID + task-aware git branch name (when the document is a task)
//! - `GET /{document_id}/github_prs` — get GitHub pull requests associated with a task document
//! - `POST /github_prs/tasks` — get the tasks linked to each of a batch of GitHub pull requests
//! - `GET /{document_id}/short_id` — get document short ID
//! - `GET`/`PUT /{document_id}/team_share` — get/set the document's team-share state
//! - `GET`/`PUT /{document_id}/skill_description` — get/set when to use a skill
//! - `POST /upload` — create a document from the request body's raw bytes
//! - `POST /create_markdown` — create and initialize a markdown document
//! - `POST /create_snippet` — create and initialize a snippet document
//! - `POST /create_skill` — create and initialize a skill document
//! - `GET /system_skills` — list the built-in system skills
//! - `DELETE /{document_id}` — soft-delete a document

#[cfg(test)]
mod tests;

#[cfg(feature = "ai_tools")]
pub mod ai_edit;
pub mod appearance;
pub mod content_uploaded;
pub mod copy_document;
#[cfg(feature = "document_create")]
pub mod create_canvas;
pub mod create_document;
pub mod create_markdown;
#[cfg(feature = "document_create")]
pub mod create_skill;
#[cfg(feature = "document_create")]
pub mod create_snippet;
pub mod create_task;
pub mod delete_document;
#[cfg(feature = "ai_tools")]
pub mod design_files;
pub mod edit_document;
pub mod get_branch_name;
pub mod get_cached_snapshot_url;
pub mod get_document;
pub mod get_document_by_team_slug;
pub mod get_github_pull_request_tasks;
pub mod get_github_pull_requests;
pub mod get_location;
pub mod get_short_id;
pub mod get_text;
#[cfg(feature = "ai_tools")]
pub mod presentation;
pub mod put_interaction;
pub mod put_snapshot;
pub mod skill_description;
#[cfg(feature = "ai_tools")]
pub mod spreadsheet;
pub mod sync_content_updated;
pub mod system_skills;
pub mod task_duplicates;
pub mod team_share;
#[cfg(feature = "document_create")]
pub mod upload_file;
#[cfg(feature = "ai_tools")]
pub mod word_document;

use std::sync::Arc;

use axum::{
    Json, Router,
    body::Body,
    extract::{FromRef, Path, State},
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::IntoResponse,
};
use entity_access::domain::ports::EntityAccessService;
use entity_registry::NonUserOwners;
use lexical_client::LexicalClient;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;
use serde::Deserialize;
// Existing router composition state; the text handler uses domain services, never SQL.
// ast-grep-ignore: rust-no-sqlx-in-inbound
use sqlx::PgPool;
use task_dedup::PgTaskDedupService;

#[cfg(feature = "document_create")]
use self::create_canvas::create_canvas_handler;
use self::create_markdown::create_markdown_handler;
#[cfg(feature = "document_create")]
use self::create_skill::create_skill_handler;
#[cfg(feature = "document_create")]
use self::create_snippet::create_snippet_handler;
use self::{
    copy_document::copy_document_handler,
    create_document::create_document_handler,
    create_task::create_task_handler,
    delete_document::delete_document_handler,
    edit_document::edit_document_handler,
    get_branch_name::get_branch_name_handler,
    get_cached_snapshot_url::get_cached_snapshot_url_handler,
    get_document::get_document_handler,
    get_document_by_team_slug::get_document_by_team_slug_handler,
    get_github_pull_request_tasks::get_github_pull_request_tasks_handler,
    get_github_pull_requests::get_github_pull_requests_handler,
    get_location::get_location_v3_handler,
    get_short_id::get_short_id_handler,
    put_snapshot::put_snapshot_handler,
    skill_description::{get_skill_description_handler, set_skill_description_handler},
    system_skills::get_system_skills_handler,
    task_duplicates::{
        delete_this_duplicate_task_handler, dismiss_task_duplicates_handler,
        get_task_duplicates_handler, task_similarity_search_handler,
    },
    team_share::{get_team_share_handler, set_team_share_handler},
};

use crate::domain::models::DocumentError;
use crate::domain::ports::DocumentService;
#[cfg(feature = "document_create")]
use crate::domain::ports::create::DocumentCreationService;

/// Stable machine-readable error code for an over-length document name. Clients
/// branch on this instead of the human message and render their own copy.
pub const DOCUMENT_NAME_TOO_LONG_CODE: &str = "DOCUMENT_NAME_TOO_LONG";

/// Structured 422 body for [`DocumentError::NameTooLong`]. Carries the limit so
/// clients can show it without hardcoding a value that could drift from the API.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NameTooLongErrorResponse {
    code: &'static str,
    max_length: usize,
    message: &'static str,
}

impl IntoResponse for DocumentError {
    fn into_response(self) -> axum::response::Response {
        if let DocumentError::NameTooLong { max } = &self {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(NameTooLongErrorResponse {
                    code: DOCUMENT_NAME_TOO_LONG_CODE,
                    max_length: *max,
                    message: "name too long",
                }),
            )
                .into_response();
        }

        let status_code = match &self {
            DocumentError::NotFound(_) => StatusCode::NOT_FOUND,
            DocumentError::Unauthorized => StatusCode::UNAUTHORIZED,
            DocumentError::Gone => StatusCode::GONE,
            DocumentError::Conflict(_) => StatusCode::CONFLICT,
            DocumentError::BadRequest(_) => StatusCode::BAD_REQUEST,
            DocumentError::NameTooLong { .. } => StatusCode::UNPROCESSABLE_ENTITY,
            DocumentError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            DocumentError::JwtEncoding(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status_code.is_server_error() {
            tracing::error!(error=?self, "internal server error");
        }

        let message = self.to_string();
        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// Default backend-owned document creation use case for the document router.
#[cfg(feature = "document_create_adapters")]
pub type DefaultDocumentCreator<T> = crate::domain::create::DocumentCreator<
    Arc<T>,
    crate::outbound::markdown_init::LexicalSyncMarkdownInitializer,
    crate::outbound::document_bytes_upload::ReqwestDocumentBytesUploader,
    crate::outbound::mention_tracker::LexicalCommsMentionTracker,
>;

/// Editing worker behind the AI edit route.
#[cfg(feature = "ai_tools")]
pub type DefaultEditingWorker = crate::outbound::editing_worker_client::ReqwestEditingWorkerClient;

/// Router state containing document router dependencies.
pub struct DocumentRouterState<T, Svc, Auth> {
    /// The document service implementation.
    pub service: Arc<T>,
    /// The entity access service for authorization.
    pub access_service: Arc<Svc>,
    /// State for request authorization.
    pub authorization_state: MacroAuthorizationState<Auth>,
    /// The database pool (used by middleware for document lookups).
    pub pool: PgPool,
    /// Task duplicate detection service.
    pub task_dedup_service: Arc<PgTaskDedupService>,
    /// Lexical service client, used to fetch embedding-format markdown for
    /// task duplicate detection.
    pub lexical_client: Arc<LexicalClient>,
    /// Backend-owned document creation use case.
    #[cfg(feature = "document_create_adapters")]
    pub creator: DefaultDocumentCreator<T>,
    /// EditDocument's AI-editing use case, with the host's admission and metering.
    #[cfg(feature = "ai_tools")]
    pub ai_editing: Arc<crate::domain::ai_editing::AiEditingService<DefaultEditingWorker>>,
    /// The spreadsheet tools' read, calculate and edit workflows.
    #[cfg(feature = "ai_tools")]
    pub spreadsheet: Arc<crate::domain::spreadsheet::SpreadsheetService<T, DefaultEditingWorker>>,
    /// Spreadsheet edits by instructions, with the host's admission and metering.
    #[cfg(feature = "ai_tools")]
    pub spreadsheet_ai_edit:
        Arc<crate::domain::spreadsheet::SpreadsheetAiEditService<T, DefaultEditingWorker>>,
    /// The presentation tools' read, edit and copy use cases.
    #[cfg(feature = "ai_tools")]
    pub presentations: Arc<crate::domain::presentation::PresentationService>,
    /// The Word document tools' live-copy read and edit use cases.
    #[cfg(feature = "ai_tools")]
    pub word_documents: Arc<
        crate::domain::word_document::WordDocumentService<
            T,
            DefaultEditingWorker,
            sync_service_client::SyncServiceClient,
        >,
    >,
    /// The design tool's Figma reader.
    #[cfg(feature = "ai_tools")]
    pub designs: Arc<crate::domain::design::DesignService>,
    /// The Photoshop tool's reader.
    #[cfg(feature = "ai_tools")]
    pub photoshop_documents: Arc<crate::domain::photoshop::PhotoshopService>,
    /// The Illustrator tool's reader.
    #[cfg(feature = "ai_tools")]
    pub illustrator_documents: Arc<crate::domain::illustrator::IllustratorService>,
    /// JWT secret for signing document permission tokens.
    pub document_permission_jwt_secret: String,
    /// Whether a team bot with no acting user may own what it creates.
    pub non_user_owners: NonUserOwners,
}

// Manual Clone impl so T, Svc, and Auth don't need to be Clone.
impl<T, Svc, Auth> Clone for DocumentRouterState<T, Svc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
            authorization_state: self.authorization_state.clone(),
            pool: self.pool.clone(),
            task_dedup_service: self.task_dedup_service.clone(),
            lexical_client: self.lexical_client.clone(),
            #[cfg(feature = "document_create_adapters")]
            creator: self.creator.clone(),
            #[cfg(feature = "ai_tools")]
            ai_editing: self.ai_editing.clone(),
            #[cfg(feature = "ai_tools")]
            spreadsheet: self.spreadsheet.clone(),
            #[cfg(feature = "ai_tools")]
            spreadsheet_ai_edit: self.spreadsheet_ai_edit.clone(),
            #[cfg(feature = "ai_tools")]
            presentations: self.presentations.clone(),
            #[cfg(feature = "ai_tools")]
            word_documents: self.word_documents.clone(),
            #[cfg(feature = "ai_tools")]
            designs: self.designs.clone(),
            #[cfg(feature = "ai_tools")]
            photoshop_documents: self.photoshop_documents.clone(),
            #[cfg(feature = "ai_tools")]
            illustrator_documents: self.illustrator_documents.clone(),
            document_permission_jwt_secret: self.document_permission_jwt_secret.clone(),
            non_user_owners: self.non_user_owners,
        }
    }
}

impl<T, Svc, Auth> FromRef<DocumentRouterState<T, Svc, Auth>> for Arc<Svc> {
    fn from_ref(state: &DocumentRouterState<T, Svc, Auth>) -> Self {
        state.access_service.clone()
    }
}

impl<T, Svc, Auth> FromRef<DocumentRouterState<T, Svc, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &DocumentRouterState<T, Svc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

impl<T, Svc, Auth> FromRef<DocumentRouterState<T, Svc, Auth>> for NonUserOwners {
    fn from_ref(state: &DocumentRouterState<T, Svc, Auth>) -> Self {
        state.non_user_owners
    }
}

/// Path parameters for document endpoints (document_id extraction).
#[derive(Deserialize)]
pub struct Params {
    document_id: String,
}

/// Build the documents router with all endpoints.
pub fn documents_router<T, Svc, Auth, S>(state: DocumentRouterState<T, Svc, Auth>) -> Router<S>
where
    T: DocumentService + DocumentCreationService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    // Routes that need ensure_document_exists middleware
    let document_id_routes = Router::new()
        .route(
            "/{document_id}/appearance",
            axum::routing::put(appearance::set_appearance::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}",
            axum::routing::get(get_document_handler::<T, Svc, Auth>)
                .patch(edit_document_handler::<T, Svc, Auth>)
                .delete(delete_document_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/text-content",
            axum::routing::get(get_text::get_text_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/location_v3",
            axum::routing::get(get_location_v3_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/branch_name",
            axum::routing::get(get_branch_name_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/github_prs",
            axum::routing::get(get_github_pull_requests_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/short_id",
            axum::routing::get(get_short_id_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/copy",
            axum::routing::post(copy_document_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/duplicates",
            axum::routing::get(get_task_duplicates_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/duplicates/dismiss",
            axum::routing::post(dismiss_task_duplicates_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/duplicates/{match_id}/delete_this",
            axum::routing::post(delete_this_duplicate_task_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/cached_snapshot_url",
            axum::routing::get(get_cached_snapshot_url_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/snapshot",
            axum::routing::put(put_snapshot_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/team_share",
            axum::routing::get(get_team_share_handler::<T, Svc, Auth>)
                .put(set_team_share_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/skill_description",
            axum::routing::get(get_skill_description_handler::<T, Svc, Auth>)
                .put(set_skill_description_handler::<T, Svc, Auth>),
        );

    #[cfg(feature = "ai_tools")]
    let document_id_routes = document_id_routes
        .route(
            "/{document_id}/ai-edit",
            axum::routing::post(ai_edit::ai_edit_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/spreadsheet/read",
            axum::routing::post(spreadsheet::read_spreadsheet_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/spreadsheet/calculate",
            axum::routing::post(spreadsheet::calculate_spreadsheet_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/spreadsheet/edits",
            axum::routing::post(spreadsheet::edit_spreadsheet_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/spreadsheet/ai-edit",
            axum::routing::post(spreadsheet::ai_edit_spreadsheet_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/presentation",
            axum::routing::get(presentation::read_presentation_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/presentation/edits",
            axum::routing::post(presentation::edit_presentation_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/presentation/copy",
            axum::routing::post(presentation::copy_presentation_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/word",
            axum::routing::get(word_document::read_word_document_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/word/edits",
            axum::routing::post(word_document::edit_word_document_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/design",
            axum::routing::get(design_files::read_design_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/photoshop",
            axum::routing::get(design_files::read_photoshop_document_handler::<T, Svc, Auth>),
        )
        .route(
            "/{document_id}/illustrator",
            axum::routing::get(design_files::read_illustrator_document_handler::<T, Svc, Auth>),
        );

    let document_id_routes = document_id_routes.layer(middleware::from_fn_with_state(
        state.clone(),
        ensure_document_exists::<T, Svc, Auth>,
    ));

    let router = Router::new()
        .merge(document_id_routes)
        .route(
            "/slug/{slug}",
            axum::routing::get(get_document_by_team_slug_handler::<T, Svc, Auth>),
        )
        .route(
            "/",
            axum::routing::post(create_document_handler::<T, Svc, Auth>),
        )
        .route(
            "/create_task",
            axum::routing::post(create_task_handler::<T, Svc, Auth>),
        )
        .route(
            "/github_prs/tasks",
            axum::routing::post(get_github_pull_request_tasks_handler::<T, Svc, Auth>),
        )
        .route(
            "/similarity_search",
            axum::routing::post(task_similarity_search_handler::<T, Svc, Auth>),
        )
        .route(
            "/system_skills",
            axum::routing::get(get_system_skills_handler::<Auth>),
        );

    #[cfg(feature = "document_create")]
    let router = router
        .route(
            "/create_canvas",
            axum::routing::post(create_canvas_handler::<T, Svc, Auth>),
        )
        .route(
            "/create_markdown",
            axum::routing::post(create_markdown_handler::<T, Svc, Auth>),
        )
        .route(
            "/create_snippet",
            axum::routing::post(create_snippet_handler::<T, Svc, Auth>),
        )
        .route(
            "/create_skill",
            axum::routing::post(create_skill_handler::<T, Svc, Auth>),
        )
        .route(
            "/upload",
            axum::routing::post(upload_file::upload_file_handler::<T, Svc, Auth>).layer(
                axum::extract::DefaultBodyLimit::max(
                    crate::domain::create::upload::MAX_INLINE_UPLOAD_BYTES,
                ),
            ),
        );

    #[cfg(feature = "ai_tools")]
    let router = router.route(
        "/create_spreadsheet",
        axum::routing::post(spreadsheet::create_spreadsheet_handler::<T, Svc, Auth>),
    );

    router.with_state(state)
}

/// Path parameters for document endpoints.
pub struct DocumentIdPathParams {
    /// The document ID.
    pub document_id: String,
}

/// Middleware that loads [`DocumentBasic`](model::document::DocumentBasic) into request extensions.
///
/// Extracts `document_id` from the path and queries the database.
/// Returns 404 if the document does not exist.
#[tracing::instrument(skip(state, request, next))]
async fn ensure_document_exists<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    Path(Params { document_id }): Path<Params>,
    request: Request<Body>,
    next: Next,
) -> impl IntoResponse {
    let document_basic = match state
        .service
        .internal_get_basic_document(&document_id)
        .await
    {
        Ok(doc) => doc,
        Err(e) => {
            match e {
                DocumentError::NotFound(_) => {
                    return (
                        StatusCode::NOT_FOUND,
                        Json(ErrorResponse {
                            message: format!("document with id \"{}\" was not found", document_id)
                                .into(),
                        }),
                    )
                        .into_response();
                }
                _ => {
                    // Only other type that we return here is DocumentError::Internal
                    tracing::error!(error=?e, document_id=?document_id, "unable to check if document exists");
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            message: "unknown error occurred".into(),
                        }),
                    )
                        .into_response();
                }
            }
        }
    };

    let mut request = request;
    request.extensions_mut().insert(document_basic);
    next.run(request).await.into_response()
}
