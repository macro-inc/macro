use crate::domain::models::messages::ContactsNodes;
use crate::domain::ports::ContactsService;
use axum::extract::{FromRequestParts, Json, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{RequestPartsExt, Router};
use axum_extra::extract::Cached;
use macro_user_id::user_id::MacroUserIdStr;
use model_user::axum_extractor::MacroUserExtractor;
use rate_limit::inbound::{RateLimitExtractable, rate_limit_middleware};
use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitService};
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
#[instrument(skip(macro_user_id, contacts), fields(user_id = macro_user_id.as_ref()))]
pub async fn handler<S: ContactsService>(
    State(contacts): State<Arc<S>>,
    MacroUserExtractor { macro_user_id, .. }: MacroUserExtractor,
) -> impl IntoResponse {
    match contacts.query_contacts(macro_user_id).await {
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
#[instrument(skip(service, macro_user_id), err)]
pub async fn add_contact_handler<S: ContactsService>(
    State(service): State<Arc<S>>,
    MacroUserExtractor { macro_user_id, .. }: MacroUserExtractor,
    Json(body): Json<AddContactRequest>,
) -> Result<StatusCode, StatusCode> {
    service
        .add_contact_nodes(ContactsNodes {
            users: HashSet::from([macro_user_id, body.user_id]),
        })
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to create contact connection");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(StatusCode::NO_CONTENT)
}

/// Rate limit for adding contacts: 50 requests per user per hour.
pub struct PerUserAddContactRateLimit(MacroUserExtractor);

impl<S> RateLimitExtractable<S> for PerUserAddContactRateLimit
where
    S: Send + Sync,
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
    S: Send + Sync,
{
    type Rejection = <MacroUserExtractor as FromRequestParts<S>>::Rejection;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let Cached(user): Cached<MacroUserExtractor> = parts.extract_with_state(state).await?;
        Ok(Self(user))
    }
}

/// Builds the contacts API router with rate limiting applied to POST.
pub fn contacts_router<R: RateLimitService + Clone, S: ContactsService>(
    rate_limiter: R,
) -> Router<Arc<S>> {
    let post_route = Router::new()
        .route("/contacts", axum::routing::post(add_contact_handler))
        .layer(axum::middleware::from_fn_with_state(
            rate_limiter,
            rate_limit_middleware::<R, PerUserAddContactRateLimit, R>,
        ));

    Router::new()
        .route("/contacts", get(handler))
        .merge(post_route)
}

/// Builds the full API router with JWT auth middleware and rate limiting.
pub fn api_router<S: ContactsService>(app_state: AppState<S>) -> Router {
    contacts_router(app_state.rate_limit_service.clone())
        .layer(axum::middleware::from_fn_with_state(
            app_state.jwt_args.clone(),
            macro_middleware::auth::decode_jwt::handler,
        ))
        .with_state(app_state.contacts_service)
}

/// Application state for the contacts HTTP service.
pub struct AppState<S> {
    /// The port to listen on.
    pub port: usize,
    /// JWT validation arguments.
    pub jwt_args: macro_auth::middleware::decode_jwt::JwtValidationArgs,
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
