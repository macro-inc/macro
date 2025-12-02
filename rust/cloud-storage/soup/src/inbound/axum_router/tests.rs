use axum::{
    Extension, Router,
    http::{Request, StatusCode},
};
use cool_asserts::assert_matches;
use email::domain::{
    models::{EmailErr, UserProvider},
    ports::EmailService,
};
use http_body_util::BodyExt;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use model_user::UserContext;
use serde_json::json;
use std::sync::Arc;
use tower::util::ServiceExt;
use uuid::Uuid;

use crate::{
    domain::{
        models::{SoupErr, SoupRequest},
        ports::{SoupOutput, SoupService},
    },
    inbound::axum_router::{SoupRouterState, soup_router},
};

static CURSOR: &str = "eyJpZCI6ImUzNmM5MTJlLTU2M2MtNDIxZS1iMTAzLWE0YjAwY2ZmMzBlZSIsImxpbWl0IjoxMDAsInZhbCI6eyJzb3J0X3R5cGUiOiJ1cGRhdGVkX2F0IiwibGFzdF92YWwiOiIyMDI1LTExLTA3VDE5OjEyOjU5Ljc4MFoifX0=";

struct MockSoup {
    called: Arc<std::sync::Mutex<Vec<SoupRequest>>>,
}

impl MockSoup {
    fn new() -> Self {
        MockSoup {
            called: Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }
}

impl SoupService for MockSoup {
    async fn get_user_soup(
        &self,
        req: crate::domain::models::SoupRequest,
    ) -> Result<SoupOutput, SoupErr> {
        let mut guard = self.called.lock().unwrap();
        guard.push(req);
        Err(SoupErr::SoupDbErr(anyhow::anyhow!("Not implemented")))
    }
}

struct MockEmail;

impl EmailService for MockEmail {
    async fn get_email_thread_previews(
        &self,
        _req: email::domain::models::GetEmailsRequest,
    ) -> Result<
        models_pagination::PaginatedCursor<
            email::domain::models::EnrichedEmailThreadPreview,
            uuid::Uuid,
            models_pagination::SimpleSortMethod,
            (),
        >,
        email::domain::models::EmailErr,
    > {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn get_link_by_auth_id_and_macro_id(
        &self,
        _auth_id: &str,
        _macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Option<email::domain::models::Link>, email::domain::models::EmailErr> {
        Ok(Some(email::domain::models::Link {
            id: Uuid::new_v4(),
            macro_id: MacroUserIdStr::parse_from_str("macro|example@test.com").unwrap(),
            fusionauth_user_id: String::new(),
            email_address: EmailStr::try_from("example@test.com".to_string()).unwrap(),
            provider: UserProvider::Gmail,
            is_sync_active: true,
            created_at: Default::default(),
            updated_at: Default::default(),
        }))
    }
}

fn mock_router() -> Router {
    soup_router(SoupRouterState::new(MockSoup::new(), MockEmail)).layer(Extension(UserContext {
        user_id: "macro|test@example.com".to_string(),
        fusion_user_id: "1234".to_string(),
        permissions: None,
        organization_id: None,
    }))
}

#[tokio::test]
async fn it_should_deserialize_empty_filter() {
    let router = mock_router();

    let request = Request::builder()
        .uri(format!("/soup?cursor={CURSOR}"))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(bytes.as_ref()).unwrap();
    assert_eq!(
        json,
        json!({
            "message": "An internal server error has occurred"
        })
    );
}

struct MockEmailLinkResult {
    get_link_result: Arc<
        dyn Fn() -> Result<Option<email::domain::models::Link>, email::domain::models::EmailErr>
            + Send
            + Sync,
    >,
}

impl EmailService for MockEmailLinkResult {
    async fn get_email_thread_previews(
        &self,
        _req: email::domain::models::GetEmailsRequest,
    ) -> Result<
        models_pagination::PaginatedCursor<
            email::domain::models::EnrichedEmailThreadPreview,
            uuid::Uuid,
            models_pagination::SimpleSortMethod,
            (),
        >,
        email::domain::models::EmailErr,
    > {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn get_link_by_auth_id_and_macro_id(
        &self,
        _auth_id: &str,
        _macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Option<email::domain::models::Link>, email::domain::models::EmailErr> {
        (self.get_link_result)()
    }
}

#[tokio::test]
async fn it_calls_soup_with_missing_link() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = soup_router(SoupRouterState::new(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    ))
    .layer(Extension(UserContext {
        user_id: "macro|test@example.com".to_string(),
        fusion_user_id: "1234".to_string(),
        permissions: None,
        organization_id: None,
    }));

    let request = Request::builder()
        .uri(format!("/soup?cursor={CURSOR}"))
        .body(axum::body::Body::empty())
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let guard = inner_counter.lock().unwrap();

    assert_eq!(guard.len(), 1);
    assert_matches!(guard.first().unwrap(), SoupRequest { link_id: None, .. })
}

#[tokio::test]
async fn it_does_not_call_soup_with_db_err() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = soup_router(SoupRouterState::new(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| {
                Err(EmailErr::RepoErr(anyhow::anyhow!("failed to fetch")))
            }),
        },
    ))
    .layer(Extension(UserContext {
        user_id: "macro|test@example.com".to_string(),
        fusion_user_id: "1234".to_string(),
        permissions: None,
        organization_id: None,
    }));

    let request = Request::builder()
        .uri(format!("/soup?cursor={CURSOR}"))
        .body(axum::body::Body::empty())
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let guard = inner_counter.lock().unwrap();

    assert_eq!(guard.len(), 0);
}
