//! Public open-tracking pixel and the authorized per-thread read path.
use super::context::{ApiContext, AuthorizationService, EmailEntityAccessService};
use axum::{
    Json,
    extract::{Path, State},
    http::{StatusCode, header},
    response::IntoResponse,
};
use email::domain::read_receipts::{MessageReadReceipt, ReadReceiptError};
use entity_access::{
    domain::models::ViewAccessLevel, inbound::axum_extractors::ThreadAccessLevelExtractor,
};

/// A 1×1 transparent GIF.
const PIXEL_GIF: &[u8] = &[
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
];

/// Every request gets the same uncacheable pixel so the response reveals nothing
/// about the token, and each open reaches the server.
#[utoipa::path(get, path = "/opens/{token}", tag = "email",
    operation_id = "get_read_receipt_pixel",
    params(("token" = String, Path, description = "Opaque pixel token")),
    responses((status = 200, content_type = "image/gif", description = "Transparent pixel, for any token")))]
pub(crate) async fn pixel(
    State(state): State<ApiContext>,
    Path(token): Path<String>,
) -> impl IntoResponse {
    let _ = state.read_receipts.record_open(&token).await;
    (
        [
            (header::CONTENT_TYPE, "image/gif"),
            (
                header::CACHE_CONTROL,
                "no-store, no-cache, must-revalidate, private, max-age=0",
            ),
            (header::PRAGMA, "no-cache"),
            (header::EXPIRES, "0"),
        ],
        PIXEL_GIF,
    )
}

/// Open state of the caller's tracked, sent messages in one thread.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub(crate) struct ThreadReadReceipts {
    receipts: Vec<MessageReadReceipt>,
}

#[utoipa::path(get, path = "/email/threads/{thread_id}/read-receipts", tag = "email",
    operation_id = "get_thread_read_receipts",
    params(("thread_id" = uuid::Uuid, Path, description = "Authorized email thread")),
    responses((status = 200, body = ThreadReadReceipts), (status = 401), (status = 403)))]
pub(crate) async fn thread(
    State(state): State<ApiContext>,
    access: ThreadAccessLevelExtractor<
        ViewAccessLevel,
        EmailEntityAccessService,
        AuthorizationService,
    >,
) -> Result<Json<ThreadReadReceipts>, StatusCode> {
    state
        .read_receipts
        .thread_receipts(access.entity_access_receipt)
        .await
        .map(|receipts| Json(ThreadReadReceipts { receipts }))
        .map_err(|error| match error {
            ReadReceiptError::Unauthorized => StatusCode::UNAUTHORIZED,
            ReadReceiptError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        })
}
