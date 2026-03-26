use crate::api::context::ApiContext;
use crate::api::util::count_occurrences;
use axum::Json;
use axum::extract::State;
use axum::response::Response;
use axum::{Extension, extract::Path, http::StatusCode, response::IntoResponse};
#[allow(unused_imports)]
use futures::stream::TryStreamExt;
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::document::DocumentBasic;
use model::response::{
    ErrorResponse, GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
};
use model::user::UserContext;
use models_permissions::share_permission::access_level::OwnerAccessLevel;
use serde::Deserialize;
use sqs_client::search::{SearchQueueMessage, document::DocumentId};

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Permanently deletes a document.
#[utoipa::path(
        tag = "document",
        delete,
        operation_id = "permanently_delete_document",
        path = "/documents/{document_id}/permanent",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=SuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(state, user_context), fields(user_id=?user_context.user_id))]
pub async fn permanently_delete_document_handler(
    access: DocumentAccessExtractor<OwnerAccessLevel>,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Response, Response> {
    tracing::info!("permanently_delete_document");

    // Decrement sha counts for docx files
    if let Some(file_type) = document_context.file_type.as_deref()
        && file_type == "docx"
    {
        let bom_parts = macro_db_client::document::get_bom_parts(&state.db, &document_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get bom parts");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to get bom parts".into(),
                    }),
                )
                    .into_response()
            })?;

        // Transform bom parts into Vec<(sha, count)>
        let sha_counts = count_occurrences(
            bom_parts
                .iter()
                .map(|bp| bp.sha.clone())
                .collect::<Vec<String>>(),
        );

        tracing::trace!("decrementing sha ref count");
        state
            .redis_client
            .decrement_counts(&sha_counts)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to decrement sha ref counts");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to decrement sha ref counts".into(),
                    }),
                )
                    .into_response()
            })?;
    }

    // Delete document info from db
    macro_db_client::document::delete_document(&state.db, &document_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to delete document");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to delete document".into(),
                }),
            )
                .into_response()
        })?;

    // Delete entity mentions where this doc is the source
    if let Err(e) = comms_db_client::entity_mentions::delete_entity_mentions_by_source(
        &state.db,
        vec![document_id.clone()],
    )
    .await
    {
        tracing::error!(error=?e, "unable to delete entity mentions");
    }

    // Queue document for deletion
    state
        .sqs_client
        .enqueue_document_delete(document_context.owner.as_ref(), &document_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to enqueue document delete");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to enqueue document delete".into(),
                }),
            )
                .into_response()
        })?;

    state
        .sqs_client
        .send_message_to_search_event_queue(SearchQueueMessage::RemoveDocument(DocumentId {
            document_id,
        }))
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to send message to search extractor queue");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to send message to search extractor queue".into(),
                }),
            )
                .into_response()
        })?;

    let response_data = GenericSuccessResponse { success: true };

    Ok(GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK))
}
