#![deny(missing_docs)]
//! JWT decoding and validation for axum-based services.
//!
//! Provides an axum extractor ([`DecodedJwt`]) and middleware ([`handler`])
//! that decode a JWT from either the `Authorization` header or a
//! `macro-api-token` query parameter.

#[cfg(test)]
mod test;

use axum::{
    Json, RequestPartsExt,
    extract::{FromRef, FromRequestParts, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use axum_extra::either::Either;
use macro_auth::{
    error::MacroAuthError,
    headers::AccessTokenExtractor,
    middleware::decode_jwt::{JwtToken, JwtValidationArgs},
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_error_response::ErrorResponse;
use model_user::UserContext;
use serde::Deserialize;

/// Stores information about the JWT, this is used for the logout in particular call
#[derive(Clone)]
pub struct JwtContext {
    /// Macro access token The audience of the token
    pub audience: String,
    /// Macro access token The tenant id of the token
    pub tid: String,
}

/// the struct we use to extract api token from query parms
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct Params {
    macro_api_token: Option<String>,
}

/// The result of successfully decoding a JWT from a request.
pub struct DecodedJwt {
    /// The user context extracted from the token.
    pub user_context: UserContext,
    /// Present only when the token is a macro-access-token.
    pub jwt_context: Option<JwtContext>,

    /// the parsed macro user id of the user
    pub macro_user_id: MacroUserIdStr<'static>,
}

impl<S> FromRequestParts<S> for DecodedJwt
where
    S: Send + Sync,
    JwtValidationArgs: FromRef<S>,
{
    type Rejection = Either<DecodeJwtError, StatusCode>;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let args = JwtValidationArgs::from_ref(state);
        let (access_token, Query(params)): (
            Result<AccessTokenExtractor, StatusCode>,
            Query<Params>,
        ) = parts
            .extract()
            .await
            .map_err(|_| Either::E2(StatusCode::INTERNAL_SERVER_ERROR))?;

        Self::new(access_token, params, &args).map_err(Either::E1)
    }
}

impl DecodedJwt {
    /// Extract and decode a JWT from query params or headers.
    ///
    /// This is the core logic separated from the middleware so it can be called
    /// independently (e.g. from a non-middleware handler).
    pub fn new(
        access_token_header: Result<AccessTokenExtractor, StatusCode>,
        query_params: Params,
        jwt_validation_args: &JwtValidationArgs,
    ) -> Result<DecodedJwt, DecodeJwtError> {
        if cfg!(feature = "local_auth") && std::env::var("LOCAL_USER_ID").is_ok() {
            let user_id =
                std::env::var("LOCAL_USER_ID").unwrap_or("macro|orguser@org.com".to_string());
            let Ok(macro_user_id) =
                MacroUserIdStr::parse_from_str(&user_id).map(CowLike::into_owned)
            else {
                return Err(DecodeJwtError::InvalidUserId(user_id));
            };
            let org_id: i32 = std::env::var("LOCAL_ORG_ID")
                .unwrap_or("1".to_string())
                .parse()
                .map_err(|_| {
                    DecodeJwtError::InvalidUserId("LOCAL_ORG_ID is not a valid i32".to_string())
                })?;
            return Ok(DecodedJwt {
                user_context: UserContext {
                    user_id,
                    fusion_user_id: std::env::var("LOCAL_FUSION_USER_ID")
                        .unwrap_or("set me!".to_string()),
                    organization_id: Some(org_id),
                    permissions: None,
                },
                jwt_context: None,
                macro_user_id,
            });
        }

        let access_token = if let Params {
            macro_api_token: Some(macro_api_token),
        } = query_params
        {
            tracing::trace!("macro-api-token found in query params");
            macro_api_token
        } else {
            match access_token_header {
                Ok(extractor) => extractor.as_ref().to_string(),
                Err(e) => {
                    tracing::trace!(error=?e, "unable to get macro access token");
                    return Err(DecodeJwtError::NoToken);
                }
            }
        };

        let jwt = macro_auth::middleware::decode_jwt::handler(jwt_validation_args, &access_token)
            .map_err(|e| match e {
            MacroAuthError::JwtExpired => DecodeJwtError::Expired,
            other => DecodeJwtError::Invalid(other),
        })?;

        let (user_id, fusion_user_id, organization_id) = match &jwt {
            JwtToken::MacroAccessToken(token) => (
                token.macro_user_id.clone(),
                token
                    .root_macro_id
                    .clone()
                    .unwrap_or_else(|| token.fusion_user_id.clone()),
                token.macro_organization_id,
            ),
            JwtToken::MacroApiToken(token) => (
                token.macro_user_id.clone(),
                token.fusion_user_id.clone(),
                token.macro_organization_id,
            ),
        };

        let jwt_context = if let JwtToken::MacroAccessToken(token) = jwt {
            Some(JwtContext {
                audience: token.aud,
                tid: token.tid,
            })
        } else {
            None
        };

        let Ok(macro_user_id) = MacroUserIdStr::parse_from_str(&user_id).map(CowLike::into_owned)
        else {
            return Err(DecodeJwtError::InvalidUserId(user_id));
        };

        Ok(DecodedJwt {
            user_context: UserContext {
                user_id,
                fusion_user_id,
                organization_id,
                permissions: None,
            },
            jwt_context,
            macro_user_id,
        })
    }
}

/// Errors that can occur when decoding a JWT from a request.
#[derive(Debug)]
pub enum DecodeJwtError {
    /// No token was found in query params or headers.
    NoToken,
    /// The token was present but expired.
    Expired,
    /// The token was present but validation failed.
    Invalid(MacroAuthError),
    /// The macro user id could not be parsed
    InvalidUserId(String),
}

impl IntoResponse for DecodeJwtError {
    fn into_response(self) -> Response {
        match self {
            DecodeJwtError::NoToken => (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    message: "unauthorized".into(),
                }),
            )
                .into_response(),
            DecodeJwtError::Expired => (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    message: "jwt expired".into(),
                }),
            )
                .into_response(),
            DecodeJwtError::Invalid(e) => {
                tracing::error!(error=?e, "unable to decode jwt");
                (
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        message: "unauthorized".into(),
                    }),
                )
                    .into_response()
            }
            DecodeJwtError::InvalidUserId(id) => {
                tracing::error!(error=%id, "invalid macro user id");
                (
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        message: "invalid user id".into(),
                    }),
                )
                    .into_response()
            }
        }
    }
}
