use axum::extract::{Request, State};
use axum::{middleware::Next, response::Response};
use macro_authorization::MacroAuthorizationExtractor;

use crate::api::context::ApiContext;
use email_service::util::gmail::auth::fetch_gmail_token_usercontext_response;

pub(in crate::api) async fn attach_gmail_token(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    let gmail_token = fetch_gmail_token_usercontext_response(
        &authorization.user_context,
        &ctx.redis_client,
        &ctx.auth_service_client,
    )
    .await?;

    req.extensions_mut().insert(gmail_token);
    Ok(next.run(req).await)
}
