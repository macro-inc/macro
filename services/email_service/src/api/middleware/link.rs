use axum::{
    extract::Request,
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum_extra::extract::Cached;
use email::{domain::ports::EmailService, inbound::axum::axum_impls::EmailLinkExtractor};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};

pub(in crate::api) async fn attach_link_context<U, Auth>(
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<U, Auth>>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response>
where
    U: EmailService,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: axum::extract::FromRef<crate::api::ApiContext>,
{
    let provider = match link.provider.as_str() {
        "GMAIL" => models_email::email::service::link::UserProvider::Gmail,
        other => {
            tracing::error!(provider = other, "unknown provider in link");
            return Err((
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "unknown provider",
            )
                .into_response());
        }
    };
    req.extensions_mut()
        .insert(models_email::email::service::link::Link {
            id: link.id,
            macro_id: link.macro_id.clone(),
            fusionauth_user_id: link.fusionauth_user_id.clone(),
            email_address: link.email_address.clone(),
            provider,
            is_sync_active: link.is_sync_active,
            is_primary: link.is_primary,
            // Health fields aren't part of the request-scoped link context the hex
            // extractor resolves; they're only read from the persisted link.
            needs_reauth: false,
            last_sync_error_at: None,
            created_at: link.created_at,
            updated_at: link.updated_at,
        });
    // Also insert the hex Link for use by hex crate handlers.
    req.extensions_mut().insert(link);
    Ok(next.run(req).await)
}
