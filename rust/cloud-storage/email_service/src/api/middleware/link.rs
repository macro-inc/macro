use axum::{extract::Request, middleware::Next, response::Response};
use axum_extra::extract::Cached;
use doppleganger::Mirror;
use email::inbound::OptionalEmailLinkExtractor;
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

pub(in crate::api) async fn attach_optional_link_context<U: EmailService>(
    Cached(OptionalEmailLinkExtractor(link, _)): Cached<OptionalEmailLinkExtractor<U>>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    req.extensions_mut()
        .insert(link.map(models_email::email::service::link::Link::mirror));
    Ok(next.run(req).await)
}
