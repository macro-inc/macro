pub mod create;
pub mod delete;

use axum::Router;
use axum::routing::{delete, post};

use crate::api::ApiContext;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    let hex_list_labels_routes = email::inbound::axum::list_labels_router::list_labels_router::<
        ApiContext,
        crate::api::context::EmailSvc,
        crate::api::context::AuthorizationService,
    >();

    Router::new()
        .route("/", post(create::handler))
        .route("/{id}", delete(delete::handler))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::api::middleware::link::attach_link_context,
        ))
        .merge(hex_list_labels_routes)
}

pub(crate) fn settings_error(
    error: email::domain::mailbox::MailboxError,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let (status, headers) = match &error {
        email::domain::mailbox::MailboxError::InvalidInput(_) => {
            (axum::http::StatusCode::BAD_REQUEST, Default::default())
        }
        email::domain::mailbox::MailboxError::Provider(error) => (
            super::provider_error::provider_error_status(error),
            super::provider_error::provider_error_headers(error),
        ),
        email::domain::mailbox::MailboxError::Stale => {
            (axum::http::StatusCode::CONFLICT, Default::default())
        }
        _ => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Default::default(),
        ),
    };
    (
        status,
        headers,
        axum::Json(model::response::ErrorResponse {
            message: error.to_string().into(),
        }),
    )
        .into_response()
}
