use axum::{
    extract::{Query, Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
pub use decode_jwt::{DecodeJwtError, DecodedJwt, JwtContext, Params};
use macro_auth::{headers::AccessTokenExtractor, middleware::decode_jwt::JwtValidationArgs};

/// Axum middleware that decodes the JWT and attaches the user context to the request.
///
/// If in your request the user requires to be authenticated for all use cases, you can use this
/// middleware. Otherwise, you should be using the `attach_user` middleware.
pub async fn handler(
    access_token: Result<AccessTokenExtractor, StatusCode>,
    jwt_validation_args: State<JwtValidationArgs>,
    Query(params): Query<Params>,
    mut req: Request,
    next: Next,
) -> Result<Response, DecodeJwtError> {
    let decoded = DecodedJwt::new(access_token, params, &jwt_validation_args)?;

    req.extensions_mut().insert(decoded.user_context);
    if let Some(jwt_context) = decoded.jwt_context {
        req.extensions_mut().insert(jwt_context);
    }

    Ok(next.run(req).await)
}
