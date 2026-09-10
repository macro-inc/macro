use crate::api::context::{ApiContext, AuthorizationService};
use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use documents::domain::events::{DocumentMacroEvent, DocumentSyncContentUpdatedMetadata};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use macro_event_broker::MacroEventBroker as _;
use model::document::FileType;

#[cfg(test)]
mod test;

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SyncDocument {
    pub document_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_version_id: Option<String>,
    pub file_type: FileType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct ExtractSyncRequest {
    /// Document ids to be populated
    pub documents: Vec<SyncDocument>,
}

fn documents_to_events(documents: Vec<SyncDocument>) -> Vec<DocumentMacroEvent> {
    documents
        .into_iter()
        .map(|document| {
            let document_id = document.document_id;
            DocumentMacroEvent::sync_content_updated(
                document_id.clone(),
                DocumentSyncContentUpdatedMetadata::from_extract(
                    document_id,
                    document.file_type,
                    document.document_version_id,
                    document.actor,
                    document.on_behalf_of,
                ),
            )
        })
        .collect()
}

/// Internal handler to publish sync-content extraction events.
#[tracing::instrument(skip(ctx, _internal_authorization, req))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<ExtractSyncRequest>,
) -> Result<Response, Response> {
    let document_ids: Vec<&str> = req
        .documents
        .iter()
        .map(|d| d.document_id.as_str())
        .collect();
    tracing::info!(?document_ids, "extract_sync received");
    let events = documents_to_events(req.documents);
    for event in events {
        drop(ctx.macro_event_broker.send_event(&event).map_err(|error| {
            tracing::error!(error=?error, "failed to publish document sync event");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to enqueue documents",
            )
                .into_response()
        })?);
    }

    Ok(StatusCode::OK.into_response())
}
