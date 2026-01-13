pub(crate) mod add_attachment;
pub(crate) mod create;
pub(crate) mod delete;
pub(crate) mod remove_attachment;

use axum::Router;
use axum::routing::{delete, post};

use crate::api::ApiContext;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/", post(create::handler))
        .route("/:id", delete(delete::handler))
        .route("/:id/attachments", post(add_attachment::handler))
        .route(
            "/:id/attachments/:attachment_id",
            delete(remove_attachment::handler),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.email_service,
            crate::api::middleware::link::attach_link_context,
        ))
}

/// generate an S3 key for an attachment based on the draft_id and attachment_id.
#[macro_export]
macro_rules! generate_attachment_s3_key {
    ($draft_id:expr, $attachment_id:expr) => {
        format!("draft/{}/{}", $draft_id, $attachment_id)
    };
}
