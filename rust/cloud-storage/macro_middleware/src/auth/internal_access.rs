use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts, Request},
    http::{HeaderMap, StatusCode, request::Parts},
    middleware::Next,
    response::Response,
};
use macro_env_var::env_var;
use model::user::UserContext;
use remote_env_var::LocalOrRemoteSecret;
use std::borrow::Cow;

/// The header key for the internal api key
static INTERNAL_API_KEY_HEADER: &str = "x-internal-auth-key";
static INTERNAL_MACRO_USER_ID_HEADER: &str = "x-internal-macro-user-id";
static INTERNAL_MACRO_ORGANIZATION_ID_HEADER: &str = "x-internal-macro-organization-id";
static INTERNAL_FUSIONAUTH_USER_ID_HEADER: &str = "x-internal-fusionauth-user-id";

env_var!(
    #[derive(Clone)]
    pub struct InternalApiSecretKey;
);

/// Sentinel value which represensts that we were able to validate the internal auth key in the header of the request
#[derive(Debug)]
pub struct ValidInternalKey(());

#[async_trait]
impl<S> FromRequestParts<S> for ValidInternalKey
where
    LocalOrRemoteSecret<InternalApiSecretKey>: FromRef<S>,
    S: Send + Sync + 'static,
{
    type Rejection = (StatusCode, Cow<'static, str>);

    #[tracing::instrument(ret, err(Debug), skip(parts, state))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Some(auth_token) = parts
            .headers
            .get(INTERNAL_API_KEY_HEADER)
            .and_then(|header| header.to_str().ok())
        else {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("missing {} header", INTERNAL_API_KEY_HEADER).into(),
            ));
        };

        let expected_key = <LocalOrRemoteSecret<InternalApiSecretKey>>::from_ref(state);

        // TODO: this should be constant time eq to prevent DOS attacks
        (expected_key.as_ref() == auth_token)
            .then_some(ValidInternalKey(()))
            .ok_or((StatusCode::UNAUTHORIZED, Cow::Borrowed("Unauthorized")))
    }
}

/// Validates that the INTERNAL_API_KEY_HEADER header is
/// provided and valid
#[axum::debug_middleware(state = LocalOrRemoteSecret<InternalApiSecretKey>)]
pub async fn handler(
    _valid_internal_key: ValidInternalKey,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    let headers = req.headers();

    let user_context_components = get_user_context_components(headers);

    if let Some(user_context_components) = user_context_components {
        tracing::trace!(
            user_id=?user_context_components.user_id,
            fusion_user_id=?user_context_components.fusion_user_id,
            organization_id=?user_context_components.organization_id,
            "attaching user context"
        );

        req.extensions_mut().insert(UserContext {
            user_id: user_context_components.user_id.unwrap_or_default(),
            fusion_user_id: user_context_components.fusion_user_id.unwrap_or_default(),
            organization_id: user_context_components.organization_id,
            ..Default::default()
        });
    }

    Ok(next.run(req).await)
}

struct UserContextComponents {
    user_id: Option<String>,
    fusion_user_id: Option<String>,
    organization_id: Option<i32>,
}

fn get_user_context_components(headers: &HeaderMap) -> Option<UserContextComponents> {
    let user_id = headers
        .get(INTERNAL_MACRO_USER_ID_HEADER)
        .and_then(|header| header.to_str().ok());
    let fusion_user_id = headers
        .get(INTERNAL_FUSIONAUTH_USER_ID_HEADER)
        .and_then(|header| header.to_str().ok());
    let organization_id = headers
        .get(INTERNAL_MACRO_ORGANIZATION_ID_HEADER)
        .and_then(|header| header.to_str().ok())
        .and_then(|header| header.parse::<i32>().ok());

    if user_id.is_none() && fusion_user_id.is_none() && organization_id.is_none() {
        return None;
    }

    Some(UserContextComponents {
        user_id: user_id.map(|user_id| user_id.to_string()),
        fusion_user_id: fusion_user_id.map(|fusion_user_id| fusion_user_id.to_string()),
        organization_id,
    })
}
