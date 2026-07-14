use crate::domain::models::messages::ContactsNodes;
use crate::domain::ports::ContactsService;
use axum::extract::{FromRef, FromRequestParts, Json, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{RequestPartsExt, Router};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationServiceHandle};
use macro_user_id::user_id::MacroUserIdStr;
use rate_limit::domain::models::RateLimitOk;
use rate_limit::inbound::{RateLimitExtractable, rate_limit_middleware};
use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitResult, RateLimitService};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tracing::instrument;
use utoipa::{OpenApi, ToSchema};

/// Response body for GET /contacts.
#[derive(Deserialize, Serialize, Debug, ToSchema)]
pub struct GetContactsResponse {
    /// The list of contact user IDs.
    #[schema(value_type = Vec<String>)]
    pub contacts: Vec<MacroUserIdStr<'static>>,
}

/// Request body for POST /contacts.
#[derive(Deserialize, Serialize, Debug, ToSchema)]
pub struct AddContactRequest {
    /// The user ID to add as a contact.
    #[schema(value_type = String)]
    pub user_id: MacroUserIdStr<'static>,
}

/// GET /contacts handler.
#[utoipa::path(get,
    tag = "contacts",
    operation_id = "get_contacts",
    path = "/contacts",
    responses(
    (status = 200, body=GetContactsResponse),
    (status = 401, body=String),
    (status = 404, body=String),
    (status = 500, body=String)))
]
#[instrument(skip(user, contacts), fields(user_id = user.macro_user_id.as_ref()))]
pub async fn handler<S: ContactsService>(
    State(contacts): State<Arc<S>>,
    user: MacroAuthorizationExtractor,
) -> impl IntoResponse {
    match contacts.query_contacts(user.macro_user_id).await {
        Ok(contacts) if !contacts.is_empty() => {
            (StatusCode::OK, Json(Some(GetContactsResponse { contacts })))
        }
        Ok(_) => (StatusCode::NOT_FOUND, Json(None)),
        Err(_e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(None)),
    }
}

/// POST /contacts handler.
#[utoipa::path(post,
    tag = "contacts",
    operation_id = "add_contact",
    path = "/contacts",
    request_body = AddContactRequest,
    responses(
    (status = 204),
    (status = 401, body=String),
    (status = 500, body=String)))
]
#[instrument(skip(service, user), fields(user_id = user.macro_user_id.as_ref()), err)]
pub async fn add_contact_handler<S: ContactsService>(
    State(service): State<Arc<S>>,
    user: MacroAuthorizationExtractor,
    Json(body): Json<AddContactRequest>,
) -> Result<StatusCode, StatusCode> {
    service
        .add_contact_nodes(ContactsNodes {
            users: HashSet::from([user.macro_user_id, body.user_id]),
        })
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to create contact connection");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(StatusCode::NO_CONTENT)
}

/// Rate limit for adding contacts: 50 requests per user per hour.
pub struct PerUserAddContactRateLimit(MacroAuthorizationExtractor);

impl<S> RateLimitExtractable<S> for PerUserAddContactRateLimit
where
    MacroAuthorizationServiceHandle: FromRef<S>,
    S: Send + Sync + 'static,
{
    fn config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: 50,
            window: Duration::from_mins(60),
        }
    }

    fn key(&self) -> RateLimitKey {
        RateLimitKey::builder(&"per-user-add-contact")
            .append(&self.0.macro_user_id.as_ref())
            .finish()
    }
}

impl<S> FromRequestParts<S> for PerUserAddContactRateLimit
where
    MacroAuthorizationServiceHandle: FromRef<S>,
    S: Send + Sync + 'static,
{
    type Rejection = <MacroAuthorizationExtractor as FromRequestParts<S>>::Rejection;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let user = parts.extract_with_state(state).await?;
        Ok(Self(user))
    }
}

/// State shared by contacts handlers and middleware.
pub struct ContactsRouterState<S, R> {
    /// The contacts service instance.
    pub service: Arc<S>,
    /// The rate limiter service.
    pub rate_limiter: R,
    /// The authorization service used to authenticate callers.
    pub authorization: MacroAuthorizationServiceHandle,
}

impl<S, R: Clone> Clone for ContactsRouterState<S, R> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            rate_limiter: self.rate_limiter.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<S, R> FromRef<ContactsRouterState<S, R>> for Arc<S> {
    fn from_ref(state: &ContactsRouterState<S, R>) -> Self {
        state.service.clone()
    }
}

impl<S, R> FromRef<ContactsRouterState<S, R>> for MacroAuthorizationServiceHandle {
    fn from_ref(state: &ContactsRouterState<S, R>) -> Self {
        state.authorization.clone()
    }
}

// A nominal wrapper avoids overlapping `FromRef` implementations when the
// service and rate limiter are both generic.
#[derive(Clone)]
struct ContactsRateLimiter<R>(R);

impl<S, R: Clone> FromRef<ContactsRouterState<S, R>> for ContactsRateLimiter<R> {
    fn from_ref(state: &ContactsRouterState<S, R>) -> Self {
        Self(state.rate_limiter.clone())
    }
}

impl<R: RateLimitService> RateLimitService for ContactsRateLimiter<R> {
    async fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, rootcause::Report> {
        self.0.check_rate_limit(key, config).await
    }

    async fn rollback_ticket(&self, ticket: RateLimitOk) -> Result<(), rootcause::Report> {
        self.0.rollback_ticket(ticket).await
    }
}

/// Builds the contacts API router with rate limiting applied to POST.
pub fn contacts_router<R, S>(state: ContactsRouterState<S, R>) -> Router
where
    R: RateLimitService + Clone,
    S: ContactsService,
{
    let post_route = Router::new()
        .route("/contacts", axum::routing::post(add_contact_handler))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            rate_limit_middleware::<
                ContactsRouterState<S, R>,
                PerUserAddContactRateLimit,
                ContactsRateLimiter<R>,
            >,
        ));

    Router::new()
        .route("/contacts", get(handler))
        .merge(post_route)
        .with_state(state)
}

/// Builds the full API router with authentication and rate limiting.
pub fn api_router<S: ContactsService>(app_state: AppState<S>) -> Router {
    contacts_router(ContactsRouterState {
        service: app_state.contacts_service,
        rate_limiter: app_state.rate_limit_service,
        authorization: app_state.authorization,
    })
}

/// Application state for the contacts HTTP service.
pub struct AppState<S> {
    /// The port to listen on.
    pub port: usize,
    /// The authorization service used to authenticate callers.
    pub authorization: MacroAuthorizationServiceHandle,
    /// The contacts service instance.
    pub contacts_service: Arc<S>,
    /// The rate limiter service.
    pub rate_limit_service:
        rate_limit::RateLimitServiceImpl<rate_limit::RedisRateLimitAdapter<redis::Client>>,
}

/// OpenAPI documentation.
#[derive(OpenApi)]
#[openapi(
        info(
            terms_of_service = "https://macro.com/terms",
        ),
        paths(
            handler,
            add_contact_handler,
        ),
        components(
            schemas(
                GetContactsResponse,
                AddContactRequest,
            ),
        ),
        tags(
            (name = "macro contacts service", description = "Contacts Service")
        )
    )]
pub struct ApiDoc;

#[cfg(test)]
mod test;
