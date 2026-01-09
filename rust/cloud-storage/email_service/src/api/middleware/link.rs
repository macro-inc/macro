use axum::{extract::Request, middleware::Next, response::Response};
use axum_extra::extract::Cached;
use doppleganger::Mirror;
use email::{domain::ports::EmailService, inbound::EmailLinkExtractor};

pub(in crate::api) async fn attach_link_context<U: EmailService>(
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<U>>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    req.extensions_mut()
        .insert(models_email::email::service::link::Link::mirror(link));
    Ok(next.run(req).await)
}
