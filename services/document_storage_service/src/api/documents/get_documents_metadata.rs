use crate::api::context::ApiContext;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use macro_db_client::notification::get_basic_cloud_storage_documents_metadata;
use model::document_storage_service_internal::{
    DocumentMetadata, GetDocumentsMetadataRequest, GetDocumentsMetadataResponse,
};
use model::response::GenericResponse;

#[tracing::instrument(skip(ctx), fields(document_count = ?request.document_ids.len()))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Json(request): Json<GetDocumentsMetadataRequest>,
) -> impl IntoResponse {
    // Validate input
    if request.document_ids.is_empty() {
        return GenericResponse::builder()
            .message("No document IDs provided")
            .is_error(true)
            .send(StatusCode::BAD_REQUEST);
    }

    // Retrieve document metadata for the provided IDs
    let metadata_result =
        get_basic_cloud_storage_documents_metadata(&ctx.db, &request.document_ids).await;

    match metadata_result {
        Ok(db_metadata_list) => {
            // Map the database model to the service model
            let service_metadata: Vec<DocumentMetadata> = db_metadata_list
                .into_iter()
                .map(|db_metadata| DocumentMetadata {
                    item_id: db_metadata.item_id,
                    item_name: db_metadata.item_name,
                    item_owner: db_metadata.item_owner,
                    file_type: db_metadata.file_type,
                })
                .collect();

            let response_data = GetDocumentsMetadataResponse {
                documents: service_metadata,
            };

            (StatusCode::OK, Json(response_data)).into_response()
        }
        Err(e) => {
            tracing::error!(error=?e, "Failed to retrieve document metadata");
            GenericResponse::builder()
                .message("Failed to retrieve document metadata")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
