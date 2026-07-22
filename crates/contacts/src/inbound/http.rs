use crate::domain::models::messages::ContactsNodes;
use crate::domain::ports::ContactsService;
use axum::extract::{FromRef, FromRequestParts, Json, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{RequestPartsExt, Router};
use axum_extra::extract::Cached;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use rate_limit::domain::models::RateLimitOk;
use rate_limit::inbound::{RateLimitExtractable, rate_limit_middleware};
use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitResult, RateLimitService};
use rootcause::Report;
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
#[instrument(
    skip(authorization, contacts),
    fields(actor = %authorization.acting_entity())
)]
pub async fn handler<S: ContactsService, Auth: MacroAuthorizationService>(
    State(contacts): State<Arc<S>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> impl IntoResponse {
    let user = authorization.authorization.user;

    match contacts.query_contacts(user.macro_user_id.clone()).await {
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
#[instrument(
    skip(service, authorization),
    fields(actor = %authorization.acting_entity()),
    err
)]
pub async fn add_contact_handler<S: ContactsService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<S>>,
    Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Json(body): Json<AddContactRequest>,
) -> Result<StatusCode, StatusCode> {
    let user = authorization.authorization.user;

    service
        .add_contact_nodes(ContactsNodes {
            users: HashSet::from([user.macro_user_id.clone(), body.user_id]),
        })
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to create contact connection");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(StatusCode::NO_CONTENT)
}

/// Rate limit for adding contacts: 50 requests per user per hour.
pub struct PerUserAddContactRateLimit<Auth>(MacroAuthorizationExtractor<Auth, UserOrInternal>);

impl<S, Auth> RateLimitExtractable<S> for PerUserAddContactRateLimit<Auth>
where
    S: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<S>,
{
    fn config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: 50,
            window: Duration::from_mins(60),
        }
    }

    fn key(&self) -> RateLimitKey {
        RateLimitKey::builder(&"per-user-add-contact")
            .append(&self.0.authorization.user.macro_user_id.as_ref())
            .finish()
    }
}

impl<S, Auth> FromRequestParts<S> for PerUserAddContactRateLimit<Auth>
where
    S: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<S>,
{
    type Rejection = macro_authorization::MacroAuthorizationRejection;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>> =
            parts.extract_with_state(state).await?;
        Ok(Self(authorization))
    }
}

/// State required by the contacts HTTP router.
pub struct ContactsRouterState<S, R, Auth> {
    /// The contacts service implementation.
    pub contacts_service: Arc<S>,
    /// The rate-limit service implementation.
    pub rate_limit_service: R,
    /// State for request authorization.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, R: Clone, Auth> Clone for ContactsRouterState<S, R, Auth> {
    fn clone(&self) -> Self {
        Self {
            contacts_service: self.contacts_service.clone(),
            rate_limit_service: self.rate_limit_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, R, Auth> FromRef<ContactsRouterState<S, R, Auth>> for Arc<S> {
    fn from_ref(state: &ContactsRouterState<S, R, Auth>) -> Self {
        state.contacts_service.clone()
    }
}

impl<S, R, Auth> FromRef<ContactsRouterState<S, R, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ContactsRouterState<S, R, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

struct AddContactRateLimitState<R, Auth> {
    rate_limit_service: R,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<R: Clone, Auth> Clone for AddContactRateLimitState<R, Auth> {
    fn clone(&self) -> Self {
        Self {
            rate_limit_service: self.rate_limit_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<R, Auth> FromRef<AddContactRateLimitState<R, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AddContactRateLimitState<R, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

impl<R, Auth> RateLimitService for AddContactRateLimitState<R, Auth>
where
    R: RateLimitService,
    Auth: MacroAuthorizationService,
{
    async fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        self.rate_limit_service.check_rate_limit(key, config).await
    }

    async fn rollback_ticket(&self, ticket: RateLimitOk) -> Result<(), Report> {
        self.rate_limit_service.rollback_ticket(ticket).await
    }
}

/// Builds the contacts API router with authorization and POST rate limiting.
pub fn contacts_router<S, R, Auth, T>(state: ContactsRouterState<S, R, Auth>) -> Router<T>
where
    S: ContactsService,
    R: RateLimitService + Clone,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    let rate_limit_state = AddContactRateLimitState {
        rate_limit_service: state.rate_limit_service.clone(),
        authorization_state: state.authorization_state.clone(),
    };
    let post_route = Router::new()
        .route(
            "/contacts",
            axum::routing::post(add_contact_handler::<S, Auth>),
        )
        .layer(axum::middleware::from_fn_with_state(
            rate_limit_state,
            rate_limit_middleware::<
                AddContactRateLimitState<R, Auth>,
                PerUserAddContactRateLimit<Auth>,
                AddContactRateLimitState<R, Auth>,
            >,
        ));

    Router::new()
        .route("/contacts", get(handler::<S, Auth>))
        .merge(post_route)
        .with_state(state)
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
