use crate::api::context::ApiContext;
use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::document::FileType;
use sqs_client::search::{SearchQueueMessage, document::SearchExtractorMessage};
use uuid::Uuid;

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SyncDocument {
    pub document_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_version_id: Option<String>,
    pub file_type: FileType,
}

#[derive(serde::Deserialize)]
pub struct ExtractSyncRequest {
    /// Document ids to be populated
    pub documents: Vec<SyncDocument>,
}

fn documents_to_messages(documents: Vec<SyncDocument>) -> Vec<SearchQueueMessage> {
    documents
        .iter()
        .map(|doc| {
            // generate random UUIDv4 for DeduplicationId trait
            let document_version_id = if let Some(id) = &doc.document_version_id {
                Some(id.clone())
            } else {
                Some(Uuid::new_v4().to_string())
            };
            SearchQueueMessage::ExtractSync(SearchExtractorMessage {
                // HACK: we can leave this empty because we know that this code path doesn't use it
                // it is mainly needed for get_document_info()
                user_id: "".to_string(),
                document_id: doc.document_id.clone(),
                // NOTE: for now, we only expect markdown files from sync service. this could
                // change
                file_type: doc.file_type,
                document_version_id,
            })
        })
        .collect()
}

/// internal handler to batch queue messages to the worker queue
#[tracing::instrument(skip(ctx, req))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    extract::Json(req): extract::Json<ExtractSyncRequest>,
) -> Result<Response, Response> {
    let messages: Vec<SearchQueueMessage> = documents_to_messages(req.documents);
    ctx.sqs_client
        .bulk_send_message_to_search_event_queue(messages)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to enqueue documents");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to enqueue documents",
            )
                .into_response()
        })?;
    Ok(StatusCode::OK.into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_documents_to_messsages() {
        let documents: Vec<SyncDocument> = [
            ["AAA", "macro|nobody@macro.com", "md"],
            ["CCC", "macro|nobody@macro.com", "oops_not_a_file_format"],
            ["BBB", "macro|somebody@macro.com", "md"],
        ]
        .iter()
        .map(|v| SyncDocument {
            document_id: v[0].to_string(),
            file_type: FileType::Md,
            document_version_id: None,
        })
        .collect();
        let messages = documents_to_messages(documents);
        assert_eq!(messages.len(), 3);
        let messages: Vec<SearchExtractorMessage> = messages
            .into_iter()
            .filter_map(|m| match m {
                SearchQueueMessage::ExtractSync(body) => Some(body),
                _ => None,
            })
            .collect();
        assert_eq!(messages.len(), 3);
        assert_eq!(&messages[0].document_id, "AAA");
        assert_eq!(&messages[2].document_id, "BBB");
    }

    // Should be able to set it explicitly or have it auto-generated
    #[test]
    fn test_document_version_id() {
        let documents: Vec<SyncDocument> = [
            ["AAA", "macro|nobody@macro.com", "md", "zzz"],
            ["BBB", "macro|somebody@macro.com", "md", ""],
        ]
        .iter()
        .map(|v| SyncDocument {
            document_id: v[0].to_string(),
            //user_id: v[1].to_string(),
            file_type: FileType::Md,
            document_version_id: if v[3].is_empty() {
                None
            } else {
                Some(v[3].to_string())
            },
        })
        .collect();
        let messages = documents_to_messages(documents);
        assert_eq!(messages.len(), 2);
        let messages: Vec<SearchExtractorMessage> = messages
            .into_iter()
            .filter_map(|m| match m {
                SearchQueueMessage::ExtractSync(body) => Some(body),
                _ => None,
            })
            .collect();
        assert_eq!(messages.len(), 2);
        assert!(&messages[0].document_version_id.is_some());
        assert!(&messages[1].document_version_id.is_some());

        if let Some(id) = &messages[0].document_version_id {
            assert_eq!(id, "zzz");
        }
    }
}
