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

pub fn generate_attachment_s3_key(draft_id: uuid::Uuid, attachment_id: uuid::Uuid) -> String {
    format!("draft/{}/{}", draft_id, attachment_id)
}
