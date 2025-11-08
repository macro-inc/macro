use crate::{api::context::ApiContext, model::internal::ExtractTextFromAllDocumentsQueryParams};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_db_client::{
    dcs::get_documents::{
        DocWithOwnerAndType, PaginatedResponse, get_paginated_documents,
        get_paginated_documents_without_text,
    },
    dcs::get_documents_count::get_documents_count,
};
use model::document::build_cloud_storage_bucket_document_key;

#[tracing::instrument(skip(state))]
pub async fn extract_text_from_all_documents_handler(
    State(state): State<ApiContext>,
    Query(params): Query<ExtractTextFromAllDocumentsQueryParams>,
) -> impl IntoResponse {
    let document_limit = state.config.document_batch_limit;
    let total_count = match get_documents_count(&state.db).await {
        Ok(total_count) => total_count,
        Err(err) => {
            tracing::error!(error = %err, "error getting document count");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get document count",
            );
        }
    };

    if total_count == 0 {
        tracing::warn!("no documents where found");
        return (StatusCode::OK, "no documents where found");
    }

    let mut prev_response: Option<PaginatedResponse<DocWithOwnerAndType>> = None;

    // vec of (document id, bucket, key)
    let mut documents_to_enqueue: Vec<(String, String, String)> = vec![];

    loop {
        let maybe_paginated_response = match params.force {
            Some(true) => get_paginated_documents(&state.db, document_limit, prev_response).await,
            _ => {
                get_paginated_documents_without_text(&state.db, document_limit, prev_response).await
            }
        };

        let paginated_response = match maybe_paginated_response {
            Ok(paginated_response) => paginated_response,
            Err(err) => {
                tracing::error!(error = %err, "failed to get documents");
                return (StatusCode::INTERNAL_SERVER_ERROR, "unable to get documents");
            }
        };

        if paginated_response.items.is_empty() {
            tracing::info!("no documents to process");
            return (StatusCode::OK, "no documents to process");
        }

        for DocWithOwnerAndType {
            id,
            owner,
            file_type,
            document_version_id,
            ..
        } in paginated_response.items.clone().into_iter()
        {
            if file_type != "pdf" {
                continue;
            }

            let version_id = match document_version_id {
                Some(version_id) => version_id,
                None => continue,
            };

            let document_key =
                build_cloud_storage_bucket_document_key(&owner, &id, version_id, Some("pdf"));
            documents_to_enqueue.push((
                id,
                state.config.document_storage_bucket.clone(),
                document_key,
            ));
        }

        if !paginated_response.has_more {
            break;
        }

        prev_response = Some(paginated_response);
    }

    tracing::info!(
        document_count = documents_to_enqueue.len(),
        "enqueuing documents for extraction"
    );

    for chunk in documents_to_enqueue.chunks(10) {
        if let Err(err) = state
            .sqs_client
            .enqueue_documents_for_extraction(chunk.to_vec())
            .await
        {
            tracing::error!(error = %err, "failed to enqueue documents for extraction");

            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to enqueue documents for extraction",
            );
        }
    }

    return (StatusCode::OK, "text extraction complete");
}
