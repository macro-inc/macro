use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;
use axum::{Extension, Router};
use email::domain::ports::EmailService;
use email::inbound::EmailPreviewState;
use tower::ServiceBuilder;

use crate::api::ApiContext;

pub fn router<S, T>(state: EmailPreviewState<T>, api_context: ApiContext) -> Router<S>
where
    S: Send + Sync + Clone + 'static,
    T: EmailService,
{
    email::inbound::router(state).layer(
        ServiceBuilder::new()
            .layer(axum::middleware::from_fn_with_state(
                api_context,
                crate::api::middleware::link::attach_link_context,
            ))
            .layer(axum::middleware::from_fn(link_to_link_uuid_extension)),
    )
}

/// the email inbound router currently depends on a [email::inbound::LinkUuid] extension
/// the service itself should be able to extract this but thats too much of a rework for right now
/// this middleware is used to take a [models_email::service::link::Link] extension and create a [email::inbound::LinkUuid] extension
async fn link_to_link_uuid_extension(
    link: Extension<models_email::service::link::Link>,
    mut req: Request,
    next: Next,
) -> Response {
    let link_uuid = link.0.id;
    req.extensions_mut()
        .insert(email::inbound::LinkUuid(link_uuid));
    next.run(req).await
}
