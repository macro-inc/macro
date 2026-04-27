//! Internal HTTP surface for every search-event backfill.
//!
//! Every handler is a thin adapter: decode the per-entity request body, call
//! the matching method on [`BackfillService`], serialise the receipt. All
//! shared concerns (pagination, DB access, queue publishing) live in the
//! domain + outbound adapters — this file stays dumb on purpose so adding a
//! new entity is one handler + one `.route(...)`.

use std::sync::Arc;

use axum::{
    Router,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};

use crate::BackfillServiceImpl;
use crate::api::context::ApiContext;
use crate::domain::models::{
    BackfillError, BackfillReceipt, CallBackfillRequest, ChannelBackfillRequest,
    ChatBackfillRequest, DocumentBackfillRequest, EmailBackfillRequest,
};
use crate::domain::service::BackfillService;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/calls", post(calls))
        .route("/chats", post(chats))
        .route("/channels", post(channels))
        .route("/documents", post(documents))
        .route("/emails", post(emails))
}

#[tracing::instrument(skip(service, req))]
async fn calls(
    State(service): State<Arc<BackfillServiceImpl>>,
    extract::Json(req): extract::Json<CallBackfillRequest>,
) -> Response {
    receipt(service.backfill_calls(req).await)
}

#[tracing::instrument(skip(service, req))]
async fn chats(
    State(service): State<Arc<BackfillServiceImpl>>,
    extract::Json(req): extract::Json<ChatBackfillRequest>,
) -> Response {
    receipt(service.backfill_chats(req).await)
}

#[tracing::instrument(skip(service, req))]
async fn channels(
    State(service): State<Arc<BackfillServiceImpl>>,
    extract::Json(req): extract::Json<ChannelBackfillRequest>,
) -> Response {
    receipt(service.backfill_channels(req).await)
}

#[tracing::instrument(skip(service, req))]
async fn documents(
    State(service): State<Arc<BackfillServiceImpl>>,
    extract::Json(req): extract::Json<DocumentBackfillRequest>,
) -> Response {
    receipt(service.backfill_documents(req).await)
}

#[tracing::instrument(skip(service, req))]
async fn emails(
    State(service): State<Arc<BackfillServiceImpl>>,
    extract::Json(req): extract::Json<EmailBackfillRequest>,
) -> Response {
    receipt(service.backfill_emails(req).await)
}

fn receipt(result: Result<BackfillReceipt, BackfillError>) -> Response {
    match result {
        Ok(r) => axum::Json(r).into_response(),
        Err(e) => {
            tracing::error!(error=?e, "backfill failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "backfill failed").into_response()
        }
    }
}
