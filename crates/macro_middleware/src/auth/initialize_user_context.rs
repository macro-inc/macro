use axum::{extract::Request, middleware::Next, response::Response};

use model::user::UserContext;

/// Initializes the UserContext.
pub async fn handler(mut req: Request, next: Next) -> Result<Response, Response> {
    req.extensions_mut().insert(UserContext::default());
    Ok(next.run(req).await)
}
