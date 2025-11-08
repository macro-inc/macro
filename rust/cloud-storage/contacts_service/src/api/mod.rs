use crate::api::context::AppState;
use anyhow::Context;
use async_trait::async_trait;
use axum::extract::{Json, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Extension, Router};
use model::user::UserContext;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use tracing::instrument;
use utoipa::{OpenApi, ToSchema};
use utoipa_swagger_ui::SwaggerUi;

pub(crate) mod context;
mod health;
mod swagger;

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

#[async_trait]
pub trait ContactsService: Send + Sync + std::fmt::Debug + 'static {
    async fn query_contacts(&self, db: &PgPool, user_id: &str) -> Option<Vec<String>>;
}

#[cfg(test)]
#[derive(Clone, Debug)]
pub struct MockService;

#[derive(Clone, Debug, Default)]
pub struct Service;

#[cfg(test)]
#[async_trait]
impl ContactsService for MockService {
    async fn query_contacts(&self, _db: &PgPool, user_id: &str) -> Option<Vec<String>> {
        if user_id == "a2b9b60f-a7f0-4bee-bcf1-0851eeec1c05" {
            let contacts = [
                "0bcabd1a-1bf5-48d7-b334-5f7e59e8a9ff",
                "3a90b186-0288-4819-8e1a-8e10cb685c0c",
                "e3cf7c46-60c9-413a-8f27-57c91c3297cf",
            ]
            .into_iter()
            .map(String::from)
            .collect();

            return Some(contacts);
        } else if user_id == "ae2c090c-e478-4454-a001-3df458bf1fe4" {
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
}

#[async_trait]
impl ContactsService for Service {
    async fn query_contacts(&self, db: &PgPool, user_id: &str) -> Option<Vec<String>> {
        let contacts = contacts_db_client::get_contacts(db, user_id).await;
        contacts.ok()
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
#[instrument(skip(db, user_context), level = "info")]
pub async fn handler(
    State(db): State<PgPool>,
    State(contacts): State<Arc<dyn ContactsService>>,
    user_context: Extension<UserContext>,
) -> impl IntoResponse {
    let user_id = &user_context.user_id.to_lowercase();
    tracing::info!("retrieving contacts for user {}", user_id);
    let contacts = contacts.query_contacts(&db, user_id).await;
    if contacts.is_none() {
        return (StatusCode::NOT_FOUND, Json(None));
    }

    let contacts = contacts.unwrap();

    (StatusCode::OK, Json(Some(GetContactsResponse { contacts })))
}

fn api_router(app_state: AppState) -> Router {
    contacts_router()
        .layer(axum::middleware::from_fn_with_state(
            app_state.jwt_args.clone(),
            macro_middleware::auth::decode_jwt::handler,
        ))
        .with_state(app_state)
}

#[cfg(test)]
fn test_api_router() -> Router {
    contacts_router().with_state(AppState::new_testing())
}

fn contacts_router() -> Router<AppState> {
    Router::new().route("/contacts", get(handler))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use std::collections::HashSet;
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_get_contact() {
        let user_id = "a2b9b60f-a7f0-4bee-bcf1-0851eeec1c05";
        let api = test_api_router().layer(Extension(UserContext {
            user_id: user_id.to_string(),
            permissions: None,
            organization_id: None,
            fusion_user_id: "".to_string(),
        }));

        let contact_list: HashSet<String> = [
            "0bcabd1a-1bf5-48d7-b334-5f7e59e8a9ff",
            "3a90b186-0288-4819-8e1a-8e10cb685c0c",
            "e3cf7c46-60c9-413a-8f27-57c91c3297cf",
        ]
        .into_iter()
        .map(String::from)
        .collect();

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
    async fn test_get_contact_notfound() {
        let nonexistent_user_id = "d1eff0b9-e1d5-4fb5-a656-1a238323245c";
        let api = test_api_router().layer(Extension(UserContext {
            user_id: nonexistent_user_id.to_string(),
            permissions: None,
            organization_id: None,
            fusion_user_id: "".to_string(),
        }));

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

    async fn run_with_id(_pool: PgPool, user_id: &str) -> GetContactsResponse {
        let api = test_api_router().layer(Extension(UserContext {
            user_id: user_id.to_string(),
            permissions: None,
            organization_id: None,
            fusion_user_id: "".to_string(),
        }));

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
        body
    }
    // Some integration tests using an actual database query
    #[sqlx::test(fixtures(path = "../fixtures", scripts("user_list")))]
    // Skipped by default because you have to spin up a db,
    // Run with: `cargo test test_get_contacts_with_db -- --ignored`
    #[ignore]
    async fn test_integration_get_contacts_with_db(pool: PgPool) -> sqlx::Result<()> {
        let user_id = "51028bda-67f0-44df-aa21-5853963524f1";
        let body = run_with_id(pool.clone(), user_id).await;
        assert_eq!(body.contacts.len(), 3, "Not enough contacts");

        let expectations: HashSet<String> = [
            "1af59c26-c5b3-480c-9ad1-b87c2a69e72c",
            "80c0effd-1b9d-4eba-ad86-bc52c4a63294",
            "654df835-bb97-48e0-9b5b-0ad71a608dbd",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        let reality: HashSet<String> = body.contacts.into_iter().collect();

        assert_eq!(&expectations, &reality);

        // Now try it with a different case
        let user_id = "51028BDA-67F0-44DF-AA21-5853963524F1";
        let body = run_with_id(pool, user_id).await;
        let reality: HashSet<String> = body.contacts.into_iter().collect();
        assert_eq!(&expectations, &reality);

        Ok(())
    }
}
