use axum::{
    Extension, Router,
    http::{Method, Request, StatusCode},
};
use cool_asserts::assert_matches;
use email::domain::{
    models::{EmailErr, PreviewView, PreviewViewStandardLabel, UserProvider},
    ports::EmailService,
};
use http_body_util::BodyExt;
use item_filters::EntityFilters;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use model_user::UserContext;
use models_pagination::{
    Cursor, CursorVal, Frecency, FrecencyValue, Identify, PaginateOn, Query, SimpleSortMethod,
    SortOn, TypeEraseCursor,
};
use serde::Serialize;
use serde_json::json;
use std::sync::Arc;
use tower::util::ServiceExt;
use uuid::Uuid;

use crate::{
    domain::{
        models::{FrecencyQueryInner, SimpleQueryInner, SoupErr, SoupQuery, SoupRequest, SoupType},
        ports::{SoupOutput, SoupService},
    },
    inbound::axum_router::{SoupRouterState, soup_router},
};

static CURSOR: &str = "eyJpZCI6ImUzNmM5MTJlLTU2M2MtNDIxZS1iMTAzLWE0YjAwY2ZmMzBlZSIsImxpbWl0IjoxMDAsInZhbCI6eyJzb3J0X3R5cGUiOiJ1cGRhdGVkX2F0IiwibGFzdF92YWwiOiIyMDI1LTExLTA3VDE5OjEyOjU5Ljc4MFoifSwiZmlsdGVyIjp7fX0=";

#[derive(Clone)]
struct MockSoup {
    called: Arc<std::sync::Mutex<Vec<SoupRequest<EntityFilters>>>>,
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
        req: crate::domain::models::SoupRequest<EntityFilters>,
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

#[tokio::test]
async fn it_loads_email_all_view() {
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
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({
                "emailView": "all"
            }))
            .unwrap(),
        ))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let guard = inner_counter.lock().unwrap();
    let arg = guard.first().unwrap();
    assert_matches!(
        arg,
        SoupRequest {
            soup_type: SoupType::Expanded,
            limit: _,
            cursor: _,
            user: _,
            email_preview_view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
            link_id: _
        }
    )
}

#[tokio::test]
async fn it_loads_email_sent_view() {
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
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({
                "emailView": "sent"
            }))
            .unwrap(),
        ))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let guard = inner_counter.lock().unwrap();
    let arg = guard.first().unwrap();
    assert_matches!(
        arg,
        SoupRequest {
            soup_type: SoupType::Expanded,
            limit: _,
            cursor: _,
            user: _,
            email_preview_view: PreviewView::StandardLabel(PreviewViewStandardLabel::Sent),
            link_id: _
        }
    )
}

#[tokio::test]
async fn it_parses_file_assoc_filters() {
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
        .uri("/soup")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({
                "document_filters": {
                    "file_types": ["assoc:other"]
                }
            }))
            .unwrap(),
        ))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let guard = inner_counter.lock().unwrap();
    let arg = guard.first().unwrap();
    assert_matches!(
        arg,
        SoupRequest {
            soup_type: SoupType::Expanded,
            limit: _,
            cursor: SoupQuery::Simple(SimpleQueryInner(Query::Sort(
                SimpleSortMethod::ViewedAt,
                _filters
            ))),
            user: _,
            email_preview_view: _,
            link_id: _
        }
    )
}

#[tokio::test]
async fn cursor_with_assoc_works() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = soup_router(SoupRouterState::new(
        soup.clone(),
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
        .uri("/soup")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({
                "document_filters": {
                    "file_types": ["assoc:other"]
                }
            }))
            .unwrap(),
        ))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let arg = {
        let mut guard = inner_counter.lock().unwrap();
        guard.pop().unwrap()
    };

    #[derive(Serialize)]
    struct Data(usize, Uuid);

    impl Identify for Data {
        type Id = Uuid;

        fn id(&self) -> Uuid {
            self.1
        }
    }

    impl SortOn<Frecency> for Data {
        fn sort_on(_sort: Frecency) -> impl FnMut(&Self) -> models_pagination::CursorVal<Frecency> {
            |v| CursorVal {
                sort_type: Frecency,
                last_val: FrecencyValue::FrecencyScore(v.0 as f64),
            }
        }
    }

    // create arbitrary pagination data
    let res = (0..1000)
        .map(|x| Data(x, Uuid::new_v4()))
        .paginate_on(100, Frecency)
        .filter_on(arg.cursor.filter().clone())
        .into_page();

    let cursor = res.type_erase().next_cursor.unwrap();

    let request2 = Request::builder()
        .uri(format!("/soup?cursor={cursor}"))
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({})).unwrap(),
        ))
        .unwrap();

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

    let _res = router.oneshot(request2).await.unwrap();
    let guard2 = inner_counter.lock().unwrap();
    let req = guard2.first().unwrap();
    assert_matches!(
        req,
        SoupRequest {
            cursor: SoupQuery::Frecency(FrecencyQueryInner(Query::Cursor(Cursor {
                filter: _f,
                ..
            }))),
            ..
        }
    )
}

#[tokio::test]
async fn cursor_with_all_works() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = soup_router(SoupRouterState::new(
        soup.clone(),
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
        .uri("/soup")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({
                "document_filters": {
                    "file_types": ["assoc:code", "assoc:other", "assoc:image", "md", "pdf", "canvas"]
                }
            }))
            .unwrap(),
        ))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let arg = {
        let mut guard = inner_counter.lock().unwrap();
        guard.pop().unwrap()
    };

    #[derive(Serialize)]
    struct Data(usize, Uuid);

    impl Identify for Data {
        type Id = Uuid;

        fn id(&self) -> Uuid {
            self.1
        }
    }

    impl SortOn<Frecency> for Data {
        fn sort_on(_sort: Frecency) -> impl FnMut(&Self) -> models_pagination::CursorVal<Frecency> {
            |v| CursorVal {
                sort_type: Frecency,
                last_val: FrecencyValue::FrecencyScore(v.0 as f64),
            }
        }
    }

    // create arbitrary pagination data
    let res = (0..1000)
        .map(|x| Data(x, Uuid::new_v4()))
        .paginate_on(100, Frecency)
        .filter_on(arg.cursor.filter().clone())
        .into_page();

    let cursor = res.type_erase().next_cursor.unwrap();

    let request2 = Request::builder()
        .uri(format!("/soup?cursor={cursor}"))
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({})).unwrap(),
        ))
        .unwrap();

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

    let _res = router.oneshot(request2).await.unwrap();
    let guard2 = inner_counter.lock().unwrap();
    let req = guard2.first().unwrap();
    assert_matches!(
        req,
        SoupRequest {
            cursor: SoupQuery::Frecency(FrecencyQueryInner(Query::Cursor(Cursor {
                filter: _f,
                ..
            }))),
            ..
        }
    )
}

#[tokio::test]
async fn it_parses_channel_filters() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = soup_router(SoupRouterState::new(
        soup.clone(),
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

    let uuid1 = Uuid::new_v4();
    let uuid2 = Uuid::new_v4();
    let request = Request::builder()
        .uri("/soup")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({
                "channel_filters": {
                    "channel_ids": [uuid1, uuid2]
                }
            }))
            .unwrap(),
        ))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let arg = {
        let mut guard = inner_counter.lock().unwrap();
        guard.pop().unwrap()
    };

    // Check that channel_filters were parsed correctly
    assert_matches!(
        arg,
        SoupRequest {
            cursor: SoupQuery::Simple(SimpleQueryInner(Query::Sort(
                _,
                EntityFilters {
                    channel_filters,
                    ..
                },
            ))),
            ..
        } => {
            assert!(!channel_filters.channel_ids.is_empty());
        }
    )
}

#[tokio::test]
async fn it_parses_notification_and_task_filters() {
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
        .uri("/soup")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({
                "document_filters": {
                    "notification_filters": { "done": false, "seen": false },
                    "task_filters": { "include_cbm_atm_nc": true }
                },
                "chat_filters": {
                    "notification_filters": { "done": false, "seen": false }
                },
                "project_filters": {
                    "notification_filters": { "done": false, "seen": false }
                },
                "channel_filters": {
                    "notification_filters": { "done": false, "seen": false }
                }
            }))
            .unwrap(),
        ))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let arg = {
        let mut guard = inner_counter.lock().unwrap();
        guard.pop().unwrap()
    };

    assert_matches!(
        arg,
        SoupRequest {
            cursor: SoupQuery::Simple(SimpleQueryInner(Query::Sort(
                _,
                EntityFilters {
                    document_filters,
                    chat_filters,
                    project_filters,
                    channel_filters,
                    ..
                },
            ))),
            ..
        } => {
            assert_eq!(document_filters.notification_filters.done, Some(false));
            assert_eq!(document_filters.notification_filters.seen, Some(false));
            assert_eq!(document_filters.task_filters.include_cbm_atm_nc, Some(true));
            assert_eq!(chat_filters.notification_filters.done, Some(false));
            assert_eq!(chat_filters.notification_filters.seen, Some(false));
            assert_eq!(project_filters.notification_filters.done, Some(false));
            assert_eq!(project_filters.notification_filters.seen, Some(false));
            assert_eq!(channel_filters.notification_filters.done, Some(false));
            assert_eq!(channel_filters.notification_filters.seen, Some(false));
        }
    )
}
