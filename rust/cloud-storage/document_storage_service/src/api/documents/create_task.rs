use axum::{Json, extract::State, http::StatusCode};
use documents_hex::domain::models::CreateDocumentRepoArgs;
use documents_hex::domain::ports::DocumentService;
use macro_middleware::cloud_storage::ensure_access::project::ProjectBodyAccessLevelExtractor;
use model::document::FileType;
use model::response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_permissions::share_permission::access_level::EditAccessLevel;
use models_properties::EntityType as PropertyEntityType;
use models_properties::api::requests::SetPropertyValue;
use properties::PropertiesService;
use uuid::Uuid;

use crate::api::context::ApiContext;

/// SHA256 hash of empty string - for an empty markdown document
const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/// Property input for setting a property value on the task
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PropertyInput {
    /// The property definition ID
    pub property_id: String,
    /// The value to set for the property
    pub value: SetPropertyValue,
}

/// Request body for create_task
#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    /// The name of the task
    pub task_name: String,
    /// Optional project id to associate the task with
    pub project_id: Option<uuid::Uuid>,
    /// Optional property values to set on the task
    pub property_values: Option<Vec<PropertyInput>>,
}

/// Response for create_task
#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskResponse {
    /// The document id of the created task
    pub document_id: String,
}

/// Creates a task document with properties in a single call.
///
/// This endpoint creates task metadata and sets properties atomically.
/// Task content should be set separately via the sync service.
///
/// NOTE: Ideally content initialization would happen here on the backend, but that requires
/// adding Loro/Lexical support to initialize sync service documents server-side. Deferring
/// for now — client must call `syncServiceClient.initializeFromSnapshot()` after this returns.
#[utoipa::path(
        post,
        tag = "document",
        path = "/documents/create_task",
        request_body = CreateTaskRequest,
        responses(
            (status = 200, body=inline(CreateTaskResponse)),
            (status = 401, body=ErrorResponse),
            (status = 403, body=ErrorResponse),
            (status = 400, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(state, user_context, project), fields(user_id=?user_context.macro_user_id))]
#[axum::debug_handler(state = ApiContext)]
pub(in crate::api) async fn create_task_handler(
    State(state): State<ApiContext>,
    user_context: MacroUserExtractor,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, CreateTaskRequest>,
) -> Result<Json<CreateTaskResponse>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let req = project.into_inner();
    let user_id = user_context.user_context.user_id.clone();

    let macro_user_id = user_context.macro_user_id;

    // Create task document metadata (empty content - client sets via sync service)
    let response_data = state
        .documents_state
        .service
        .create_document(
            macro_user_id.clone(),
            CreateDocumentRepoArgs {
                id: None,
                sha: EMPTY_SHA256.to_string(),
                document_name: req.task_name,
                user_id: macro_user_id,
                file_type: Some(FileType::Md),
                project_id: req.project_id,
                email_attachment_id: None,
                created_at: None,
                is_task: true,
                skip_history: false,
            },
            None,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to create task document");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to create task document",
                }),
            )
        })?;

    let document_id = response_data
        .document_response
        .document_metadata
        .document_id
        .clone();

    // Apply properties to the task (partial failure is OK)
    if let Some(properties) = req.property_values {
        for property_input in properties {
            let Ok(property_uuid) = Uuid::parse_str(&property_input.property_id) else {
                tracing::warn!(property_id=?property_input.property_id, "invalid property_id UUID, skipping");
                continue;
            };

            let _ = state
                .properties_service
                .set_entity_property(
                    &user_id,
                    &document_id,
                    PropertyEntityType::Task,
                    property_uuid,
                    Some(property_input.value.clone()),
                )
                .await
                .inspect_err(|e| {
                    tracing::warn!(
                        property_id=?property_uuid,
                        error=?e,
                        "failed to set property on task, continuing"
                    );
                });
        }
    }

    Ok(Json(CreateTaskResponse { document_id }))
}
