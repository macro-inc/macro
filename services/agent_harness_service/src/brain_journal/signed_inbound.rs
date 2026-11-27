use std::{sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{FromRef, OriginalUri, Path, RawQuery, State, rejection::PathRejection},
    http::{HeaderMap, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationExtractor,
    MacroAuthorizationRejection, MacroAuthorizationServiceImpl, MacroAuthorizationState,
    NoBotAuthorizer, NoUserApiKeyAuthorizer, UserOnly,
};
use tokio::sync::Semaphore;

use super::{Journal, ReadError, Scope, Uuid, pg::PgAuthority, signed::SignedRead};

type Authorization = MacroAuthorizationServiceImpl<MacroAuthJwtValidator>;

#[derive(Clone)]
struct SignedState {
    service: Arc<SignedRead<PgAuthority>>,
    authorization: MacroAuthorizationState<Authorization>,
    in_flight: Arc<Semaphore>,
}

impl FromRef<SignedState> for MacroAuthorizationState<Authorization> {
    fn from_ref(state: &SignedState) -> Self {
        state.authorization.clone()
    }
}

pub(super) fn router(
    authority: PgAuthority,
    allowed_team: Uuid,
    jwt: JwtValidationArgs,
    journal: Option<(Scope, Journal)>,
) -> Router {
    let authorization = MacroAuthorizationServiceImpl::new(
        MacroAuthJwtValidator::new(jwt),
        InternalAuthConfig {
            api_key: "disabled-for-signed-brain".into(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    );
    Router::new()
        .route("/teams/{team}/agents/{agent}/brain/read", get(read))
        .with_state(SignedState {
            service: Arc::new(SignedRead {
                authority,
                allowed_team,
                journal,
            }),
            authorization: MacroAuthorizationState::new(Arc::new(authorization)),
            in_flight: Arc::new(Semaphore::new(4)),
        })
}

fn canonical_key(raw: &str) -> Option<Uuid> {
    let key = raw.parse::<Uuid>().ok()?;
    (!key.is_nil() && key.hyphenated().to_string() == raw).then_some(key)
}

#[tracing::instrument(skip_all)]
async fn read(
    State(state): State<SignedState>,
    path: Result<Path<(String, String)>, PathRejection>,
    OriginalUri(uri): OriginalUri,
    RawQuery(query): RawQuery,
    method: Method,
    headers: HeaderMap,
    auth: Result<MacroAuthorizationExtractor<Authorization, UserOnly>, MacroAuthorizationRejection>,
) -> Response {
    // Even builds that enable local auth must authenticate a signed
    // bearer for this endpoint. An ambient development identity is insufficient.
    let has_bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split_once(' '))
        .is_some_and(|(scheme, token)| {
            scheme.eq_ignore_ascii_case("bearer") && !token.trim().is_empty()
        });
    if !has_bearer {
        return response(StatusCode::UNAUTHORIZED);
    }
    let Ok(auth) = auth else {
        return response(StatusCode::UNAUTHORIZED);
    };
    let Some((team, agent)) = path
        .ok()
        .and_then(|Path((team, agent))| Some((canonical_key(&team)?, canonical_key(&agent)?)))
    else {
        return response(StatusCode::NOT_FOUND);
    };
    if method != Method::GET
        || query.is_some()
        || headers.contains_key(header::TRANSFER_ENCODING)
        || headers
            .get(header::CONTENT_LENGTH)
            .is_some_and(|length| length != "0")
        || uri.path() != format!("/teams/{team}/agents/{agent}/brain/read")
        || !auth.authorization.is_human_session()
    {
        return response(StatusCode::NOT_FOUND);
    }

    let Ok(_permit) = state.in_flight.try_acquire() else {
        return response(StatusCode::SERVICE_UNAVAILABLE);
    };
    let read = state
        .service
        .read(&auth.authorization.macro_user_id, team, agent);
    let result = tokio::time::timeout(Duration::from_secs(3), read).await;
    match result {
        Ok(Ok(view)) => ([(header::CACHE_CONTROL, "no-store")], Json(view)).into_response(),
        Ok(Err(ReadError::Unavailable)) => response(StatusCode::NOT_FOUND),
        Ok(Err(ReadError::AuthorityFailed)) | Err(_) => response(StatusCode::SERVICE_UNAVAILABLE),
    }
}

fn response(status: StatusCode) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], status).into_response()
}
