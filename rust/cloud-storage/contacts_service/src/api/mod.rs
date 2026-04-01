use crate::api::context::AppState;
use anyhow::Context;
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
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tracing::instrument;
use utoipa::{OpenApi, ToSchema};
use utoipa_swagger_ui::SwaggerUi;

pub(crate) mod context;
mod health;
pub(crate) mod swagger;

pub async fn setup_and_serve(state: context::AppState) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let port = state.config.port;
    let app = api_router(state)
        .layer(cors.clone())
        .merge(health::router().layer(cors))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();

    tracing::info!("contacts service is up and running on port {}", &port);

    axum::serve(listener, app.into_make_service())
        .await
        .context("error starting service")
}

#[derive(Deserialize, Serialize, Debug, ToSchema)]
pub struct GetContactsResponse {
    contacts: Vec<String>,
}

#[derive(Deserialize, Serialize, Debug, ToSchema)]
pub struct AddContactRequest {
    #[schema(value_type = String)]
    user_id: MacroUserIdStr<'static>,
}

pub trait ContactsService: Send + Sync + 'static {
    fn query_contacts(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Option<Vec<String>>> + Send;

    fn add_contact(
        &self,
        caller: MacroUserIdStr<'_>,
        recipient: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), anyhow::Error>> + Send;
}

#[cfg(test)]
#[derive(Clone, Debug)]
pub struct MockService;

#[derive(Clone, Debug)]
pub struct Service(pub PgPool);

#[cfg(test)]
impl ContactsService for MockService {
    async fn query_contacts(&self, user_id: MacroUserIdStr<'_>) -> Option<Vec<String>> {
        if user_id.as_ref() == "macro|found@test.com" {
            let contacts = [
                "0bcabd1a-1bf5-48d7-b334-5f7e59e8a9ff",
                "3a90b186-0288-4819-8e1a-8e10cb685c0c",
                "e3cf7c46-60c9-413a-8f27-57c91c3297cf",
            ]
            .into_iter()
            .map(String::from)
            .collect();

            return Some(contacts);
        } else if user_id.as_ref() == "macro|many@test.com" {
            let contacts = [
                "d44caada-98c0-49eb-ab20-6851b824983a",
                "5ab8c770-f2cb-4c6c-bc08-ae64569e324c",
                "79a5557b-7827-4e2e-a6ae-f0935cdb762e",
                "c3f4d826-f8fd-478a-aa66-b5b6bb370cbc",
                "ff038d36-1aef-461a-8aa8-34001fa1abad",
                "c3b1970f-18ee-4dfa-b5fb-e8240e28e51d",
                "9effe035-bb12-4fcc-b479-800e1c2551a8",
            ]
            .into_iter()
            .map(String::from)
            .collect();

            return Some(contacts);
        }

        None
    }

    async fn add_contact(
        &self,
        _caller: MacroUserIdStr<'_>,
        _recipient: MacroUserIdStr<'_>,
    ) -> Result<(), anyhow::Error> {
        Ok(())
    }
}

impl ContactsService for Service {
    async fn query_contacts(&self, user_id: MacroUserIdStr<'_>) -> Option<Vec<String>> {
        let contacts = contacts_db_client::get_contacts(&self.0, user_id.as_ref()).await;
        contacts.ok()
    }

    async fn add_contact(
        &self,
        caller: MacroUserIdStr<'_>,
        recipient: MacroUserIdStr<'_>,
    ) -> Result<(), anyhow::Error> {
        contacts_db_client::create_connections(
            &self.0,
            vec![(caller.as_ref().to_string(), recipient.as_ref().to_string())],
        )
        .await?;
        Ok(())
    }
}

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
#[instrument(skip(macro_user_id, contacts), level = "info", fields(user_id = macro_user_id.as_ref()))]
pub async fn handler<S: ContactsService>(
    State(contacts): State<Arc<S>>,
    MacroUserExtractor { macro_user_id, .. }: MacroUserExtractor,
) -> impl IntoResponse {
    let contacts = contacts.query_contacts(macro_user_id).await;
    if contacts.is_none() {
        return (StatusCode::NOT_FOUND, Json(None));
    }

    let contacts = contacts.unwrap();

    (StatusCode::OK, Json(Some(GetContactsResponse { contacts })))
}

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
        .add_contact(macro_user_id, body.user_id)
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

fn api_router(app_state: AppState) -> Router {
    contacts_router(app_state.rate_limit_service.clone())
        .layer(axum::middleware::from_fn_with_state(
            app_state.jwt_args.clone(),
            macro_middleware::auth::decode_jwt::handler,
        ))
        .with_state(app_state.contacts_service)
}

fn contacts_router<R: RateLimitService + Clone, S: ContactsService>(
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Extension, body::Body, http::Request};
    use http_body_util::BodyExt;
    use model_user::UserContext;
    use rate_limit::{
        RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitResult, RateLimitServiceImpl,
        domain::models::RateLimitOk,
    };
    use rootcause::Report;
    use std::collections::HashSet;
    use tower::ServiceExt;

    #[derive(Clone)]
    struct MockRateLimitPort {
        should_exceed: bool,
    }

    impl rate_limit::RateLimitPort for MockRateLimitPort {
        async fn check(
            &self,
            key: RateLimitKey,
            config: RateLimitConfig,
        ) -> Result<RateLimitResult, Report> {
            if self.should_exceed {
                Ok(Err(RateLimitExceeded {
                    current_count: config.max_count.saturating_add(1),
                    max_count: config.max_count,
                    retry_after: config.window,
                }))
            } else {
                Ok(Ok(RateLimitOk::new_testing_value(0, key, config)))
            }
        }

        async fn decrement(&self, _key: &RateLimitKey) -> Result<(), Report> {
            Ok(())
        }
    }

    fn allowing_rate_limiter() -> RateLimitServiceImpl<MockRateLimitPort> {
        RateLimitServiceImpl {
            repo: MockRateLimitPort {
                should_exceed: false,
            },
        }
    }

    fn exceeding_rate_limiter() -> RateLimitServiceImpl<MockRateLimitPort> {
        RateLimitServiceImpl {
            repo: MockRateLimitPort {
                should_exceed: true,
            },
        }
    }

    fn mock_service() -> Arc<MockService> {
        Arc::new(MockService)
    }

    fn test_user_context(user_id: &str) -> UserContext {
        UserContext {
            user_id: user_id.to_string(),
            permissions: None,
            organization_id: None,
            fusion_user_id: "".to_string(),
        }
    }

    fn build_test_router(
        rate_limiter: RateLimitServiceImpl<MockRateLimitPort>,
        user_id: &str,
    ) -> Router {
        contacts_router(rate_limiter)
            .with_state(mock_service())
            .layer(Extension(test_user_context(user_id)))
    }

    #[tokio::test]
    async fn test_get_contact() {
        let user_id = "macro|found@test.com";
        let api = build_test_router(allowing_rate_limiter(), user_id);

        let response = api
            .oneshot(
                Request::builder()
                    .uri("/contacts")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body: GetContactsResponse = serde_json::from_slice(&body).unwrap();

        let contact_list: HashSet<String> = [
            "0bcabd1a-1bf5-48d7-b334-5f7e59e8a9ff",
            "3a90b186-0288-4819-8e1a-8e10cb685c0c",
            "e3cf7c46-60c9-413a-8f27-57c91c3297cf",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        assert_eq!(body.contacts.len(), 3, "Not enough contacts");
        for contact in &body.contacts {
            assert!(
                contact_list.contains(contact),
                "Could not find contact: {}",
                contact
            );
        }
    }

    #[tokio::test]
    async fn test_get_contact_not_found() {
        let user_id = "macro|notfound@test.com";
        let api = build_test_router(allowing_rate_limiter(), user_id);

        let response = api
            .oneshot(
                Request::builder()
                    .uri("/contacts")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_add_contact() {
        let user_id = "macro|sender@test.com";
        let api = build_test_router(allowing_rate_limiter(), user_id);

        let response = api
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/contacts")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({"user_id": "macro|recipient@example.com"}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn test_add_contact_rate_limited() {
        let user_id = "macro|sender@test.com";
        let api = build_test_router(exceeding_rate_limiter(), user_id);

        let response = api
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/contacts")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({"user_id": "macro|recipient@example.com"}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn test_get_not_affected_by_rate_limit() {
        let user_id = "macro|found@test.com";
        let api = build_test_router(exceeding_rate_limiter(), user_id);

        let response = api
            .oneshot(
                Request::builder()
                    .uri("/contacts")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}
