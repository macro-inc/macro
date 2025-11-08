use std::collections::HashMap;

use axum::{
    Json,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use macro_auth::{
    error::MacroAuthError,
    middleware::decode_jwt::{JwtToken, JwtValidationArgs},
};

use model::{response::ErrorResponse, user::UserContext};

/// Attempts to decode the JWT and attach user to the request context
/// If there is no JWT to decode, the user context remains empty
pub async fn handler(
    State(jwt_validation_args): State<JwtValidationArgs>, // used for macro-access-token validation
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    if cfg!(feature = "local_auth") {
        req.extensions_mut().insert(UserContext {
            user_id: std::env::var("LOCAL_USER_ID").unwrap_or("macro|orguser@org.com".to_string()),
            fusion_user_id: std::env::var("LOCAL_FUSION_USER_ID").unwrap_or("set me!".to_string()),
            organization_id: Some(1),
            permissions: None,
        });

        return Ok(next.run(req).await);
    }

    let query_params: HashMap<String, String> = req
        .uri()
        .query()
        .map(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .into_owned()
                .collect()
        })
        .unwrap_or_default();

    let access_token = if let Some(macro_api_token) = query_params.get("macro-api-token") {
        tracing::trace!("macro-api-token found in query params");
        macro_api_token.to_string()
    } else {
        let headers = req.headers();

        match macro_auth::headers::extract_access_token_from_request_headers(headers) {
            Ok(access_token) => access_token,
            Err(e) => {
                tracing::trace!(error=?e, "unable to get macro access token");
                return Ok(next.run(req).await);
            }
        }
    };

    let jwt = macro_auth::middleware::decode_jwt::handler(&jwt_validation_args, &access_token)
        .map_err(|e| match e {
            MacroAuthError::JwtExpired => (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    message: "jwt expired",
                }),
            )
                .into_response(),
            _ => {
                tracing::error!(error=?e, "unable to decode jwt");
                (
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        message: "unauthorized",
                    }),
                )
                    .into_response()
            }
        })?;

    let (user_id, fusion_user_id, organization_id) = match jwt {
        JwtToken::MacroAccessToken(token) => (
            token.macro_user_id,
            token.root_macro_id.unwrap_or(token.fusion_user_id),
            token.macro_organization_id,
        ),
        JwtToken::MacroApiToken(token) => (
            token.macro_user_id,
            token.fusion_user_id,
            token.macro_organization_id,
        ),
    };

    // Attach user to the UserContext and to the request
    req.extensions_mut().insert(UserContext {
        user_id,
        fusion_user_id,
        organization_id,
        permissions: None,
    });

    Ok(next.run(req).await)
}
