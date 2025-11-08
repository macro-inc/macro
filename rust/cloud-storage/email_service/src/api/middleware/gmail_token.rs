use axum::extract::State;
use axum::{Extension, extract::Request, middleware::Next, response::Response};
use model::user::UserContext;

use crate::api::context::ApiContext;
use crate::util::gmail::auth::fetch_gmail_token_usercontext_response;

pub(in crate::api) async fn attach_gmail_token(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    let gmail_token = fetch_gmail_token_usercontext_response(
        &user_context,
        &ctx.redis_client,
        &ctx.auth_service_client,
    )
    .await?;

    req.extensions_mut().insert(gmail_token);
    Ok(next.run(req).await)
}
