use std::convert::Infallible;

use axum::{
    extract::{FromRef, FromRequestParts, Query},
    http::request::Parts,
};
use decode_jwt::{DecodedJwt, JwtContext, Params};
use macro_auth::{headers::AccessTokenExtractor, middleware::decode_jwt::JwtValidationArgs};
#[allow(deprecated)]
use macro_authorization::{INTERNAL_API_KEY_HEADER, LEGACY_DSS_INTERNAL_API_KEY_HEADER};

/// The FusionAuth session associated with an authorized request, when present.
///
/// This extractor must follow the primary authorization extractor in handler
/// arguments. Authorization rejects invalid credentials before session decoding
/// errors are treated as an absent FusionAuth session here.
pub(crate) struct JwtSessionContext(pub(crate) Option<JwtContext>);

impl<S> FromRequestParts<S> for JwtSessionContext
where
    S: Send + Sync,
    JwtValidationArgs: FromRef<S>,
{
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        if is_internal_request(parts) {
            return Ok(Self(None));
        }

        let access_token = AccessTokenExtractor::from_request_parts(parts, state).await;
        let Ok(Query(params)) = Query::<Params>::from_request_parts(parts, state).await else {
            return Ok(Self(None));
        };
        let jwt_args = JwtValidationArgs::from_ref(state);
        let jwt_context = DecodedJwt::new(access_token, params, &jwt_args)
            .ok()
            .and_then(|decoded| decoded.jwt_context);

        Ok(Self(jwt_context))
    }
}

#[allow(deprecated)]
fn is_internal_request(parts: &Parts) -> bool {
    parts.headers.contains_key(INTERNAL_API_KEY_HEADER)
        || parts
            .headers
            .contains_key(LEGACY_DSS_INTERNAL_API_KEY_HEADER)
}
