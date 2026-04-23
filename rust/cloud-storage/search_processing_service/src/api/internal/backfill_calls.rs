use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use sqs_client::search::{SearchQueueMessage, call::CallRecordMessage};

use crate::api::context::ApiContext;

/// Request body for [`handler`].
#[derive(serde::Deserialize, Default)]
#[serde(default)]
pub struct BackfillCallsRequest {
    /// Optional explicit list of call record ids. When empty, every archived
    /// call record is enqueued for reindexing.
    pub call_ids: Vec<String>,
}

/// Response describing how many records were enqueued.
#[derive(serde::Serialize)]
pub struct BackfillCallsResponse {
    pub enqueued: usize,
}

const BACKFILL_PAGE: i64 = 2000;

/// Enqueues every archived call record (or the explicitly provided subset)
/// onto the search event queue for indexing.
#[tracing::instrument(skip(ctx, req))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    extract::Json(req): extract::Json<BackfillCallsRequest>,
) -> Result<Response, Response> {
    if !req.call_ids.is_empty() {
        let messages: Vec<SearchQueueMessage> = req
            .call_ids
            .iter()
            .map(|id| {
                SearchQueueMessage::CallRecord(CallRecordMessage {
                    call_id: id.clone(),
                })
            })
            .collect();

        let count = messages.len();
        ctx.sqs_client
            .bulk_send_message_to_search_event_queue(messages)
            .await
            .map_err(internal_error)?;

        return Ok(axum::Json(BackfillCallsResponse { enqueued: count }).into_response());
    }

    let mut offset = 0i64;
    let mut enqueued = 0usize;

    loop {
        let batch = macro_db_client::call_record::get::get_call_records_for_search_backfill(
            &ctx.db,
            BACKFILL_PAGE,
            offset,
        )
        .await
        .map_err(internal_error)?;

        if batch.is_empty() {
            break;
        }

        let messages: Vec<SearchQueueMessage> = batch
            .iter()
            .map(|r| {
                SearchQueueMessage::CallRecord(CallRecordMessage {
                    call_id: r.call_id.to_string(),
                })
            })
            .collect();

        enqueued += messages.len();

        ctx.sqs_client
            .bulk_send_message_to_search_event_queue(messages)
            .await
            .map_err(internal_error)?;

        offset += BACKFILL_PAGE;
    }

    Ok(axum::Json(BackfillCallsResponse { enqueued }).into_response())
}

fn internal_error(e: impl std::fmt::Debug) -> Response {
    tracing::error!(error=?e, "call records backfill failed");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "failed to enqueue call records",
    )
        .into_response()
}
