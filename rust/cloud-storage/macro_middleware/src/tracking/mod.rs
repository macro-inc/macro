use anyhow::Context;
use axum::{
    Json,
    extract::Request,
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

use model::{response::ErrorResponse, tracking::IPContext};

/// Attempts to decode the JWT and attach user to the request context
/// If there is no JWT to decode, the user context remains empty
pub async fn attach_ip_context_handler(mut req: Request, next: Next) -> Result<Response, Response> {
    if cfg!(feature = "local_auth") {
        req.extensions_mut().insert(IPContext {
            client_ip: std::env::var("LOCAL_IP").unwrap_or("127.0.0.1".to_string()),
        });
        return Ok(next.run(req).await);
    }

    let headers = req.headers();
    let client_ip = get_ip_from_x_forwarded_for(headers)
        .context("no ip provided")
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "no ip provided",
                }),
            )
                .into_response()
        })?;

    // Attach user to the UserContext and to the request
    req.extensions_mut().insert(IPContext { client_ip });

    Ok(next.run(req).await)
}

fn get_ip_from_x_forwarded_for(headers: &HeaderMap) -> Option<String> {
    let x_forwarded_for = headers
        .get("x-forwarded-for")
        .and_then(|header| header.to_str().ok());

    if let Some(x_forwarded_for) = x_forwarded_for {
        let ip = x_forwarded_for
            .split(',')
            .next()
            .map(|ip| ip.trim().to_string());
        return ip;
    }

    None
}
