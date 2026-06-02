use axum::{
    Extension, Router,
    http::{Method, Request, StatusCode},
};
use chrono::{Duration, Utc};
use email::domain::{
    models::{EmailErr, PreviewView, PreviewViewStandardLabel, UserProvider},
    ports::EmailService,
};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use http_body_util::BodyExt;
use item_filters::EntityFilters;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use model_user::UserContext;
use models_pagination::{
    CursorVal, CursorWithValAndFilter, Frecency, FrecencyValue, Identify, PaginateOn, Query,
    SimpleSortMethod, SortOn, TypeEraseCursor,
};
use serde::Serialize;
use serde_json::json;
use std::sync::Arc;
use tower::util::ServiceExt;
use uuid::Uuid;

use item_filters::ast::EntityFilterAst;

use crate::{
    domain::{
        models::{
            FrecencyQueryInner, GroupedSortRequest, GroupedSoupItem, IntoSoupReqAst,
            SimpleQueryInner, SoupErr, SoupQuery, SoupRequest, SoupType,
        },
        ports::{SoupOutput, SoupService},
    },
    inbound::axum_router::ApiEntityFilterAst,
    inbound::axum_router::{SoupRouterState, soup_router},
};

static CURSOR: &str = "eyJpZCI6ImUzNmM5MTJlLTU2M2MtNDIxZS1iMTAzLWE0YjAwY2ZmMzBlZSIsImxpbWl0IjoxMDAsInZhbCI6eyJzb3J0X3R5cGUiOiJ1cGRhdGVkX2F0IiwibGFzdF92YWwiOiIyMDI1LTExLTA3VDE5OjEyOjU5Ljc4MFoifSwiZmlsdGVyIjp7fX0=";

#[derive(Debug)]
enum MockCursorKind {
    SimpleSort,
    SimpleCursor,
    FrecencySort,
    FrecencyCursor,
}

#[derive(Debug)]
struct MockSoupCall {
    soup_type: SoupType,
    email_preview_view: PreviewView,
    link_ids: Vec<Uuid>,
    cursor_kind: MockCursorKind,
    filter: serde_json::Value,
    expanded_filter: serde_json::Value,
}

#[derive(Clone)]
struct MockSoup {
    called: Arc<std::sync::Mutex<Vec<MockSoupCall>>>,
}

impl MockSoup {
    fn new() -> Self {
        MockSoup {
            called: Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }
}

impl SoupService for MockSoup {
    async fn get_user_soup<T>(
        &self,
        req: SoupRequest<T>,
        _team_receipt: Option<
            entity_access::domain::models::EntityAccessReceipt<
                entity_access::domain::models::MemberTeamRole,
            >,
        >,
    ) -> Result<SoupOutput<T>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        let cursor_kind = match &req.cursor {
            SoupQuery::Simple(SimpleQueryInner(Query::Sort(..))) => MockCursorKind::SimpleSort,
            SoupQuery::Simple(SimpleQueryInner(Query::Cursor(..))) => MockCursorKind::SimpleCursor,
            SoupQuery::Frecency(FrecencyQueryInner(Query::Sort(..))) => {
                MockCursorKind::FrecencySort
            }
            SoupQuery::Frecency(FrecencyQueryInner(Query::Cursor(..))) => {
                MockCursorKind::FrecencyCursor
            }
        };
        let soup_type = req.soup_type;
        let email_preview_view = req.email_preview_view.clone();
        let link_ids = req.link_ids.clone();
        let filter = serde_json::to_value(req.cursor.filter()).unwrap();
        let expanded_filter = serde_json::to_value(req.into_ast()?.cursor.filter()).unwrap();
        let mut guard = self.called.lock().unwrap();
        guard.push(MockSoupCall {
            soup_type,
            email_preview_view,
            link_ids,
            cursor_kind,
            filter,
            expanded_filter,
        });
        Err(SoupErr::SoupDbErr(anyhow::anyhow!("Not implemented")))
    }

    async fn get_user_soup_grouped(
        &self,
        _req: GroupedSortRequest<'_>,
    ) -> Result<Vec<GroupedSoupItem>, SoupErr> {
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

    async fn get_link_by_macro_id(
        &self,
        _macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Option<email::domain::models::Link>, email::domain::models::EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn get_inboxes_for_macro_id(
        &self,
        _macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Vec<email::domain::models::Link>, email::domain::models::EmailErr> {
        Ok(Vec::new())
    }

    async fn get_links_by_fusionauth_user_id(
        &self,
        _auth_id: &str,
    ) -> Result<Vec<email::domain::models::Link>, email::domain::models::EmailErr> {
        Ok(Vec::new())
    }

    async fn get_owned_link_for_thread(
        &self,
        _auth_id: &str,
        _thread_id: uuid::Uuid,
    ) -> Result<Option<email::domain::models::Link>, email::domain::models::EmailErr> {
        Ok(None)
    }

    async fn get_thread_with_messages(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _offset: i64,
        _limit: i64,
    ) -> Result<Option<email::domain::models::Thread>, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn get_thread_parsed(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _offset: i64,
        _limit: i64,
    ) -> Result<Option<email::domain::models::ParsedThread>, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn create_draft(
        &self,
        _link: &email::domain::models::Link,
        _input: email::domain::models::CreateDraftInput,
    ) -> Result<email::domain::models::CreatedDraft, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn send_message(
        &self,
        _link: &email::domain::models::Link,
        _input: email::domain::models::CreateDraftInput,
    ) -> Result<email::domain::models::CreatedDraft, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn list_labels(
        &self,
        _link: &email::domain::models::Link,
    ) -> Result<Vec<email::domain::models::LinkLabel>, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn update_thread_labels(
        &self,
        _access_token: &str,
        _link: &email::domain::models::Link,
        _thread_id: uuid::Uuid,
        _label_id: uuid::Uuid,
        _add: bool,
    ) -> Result<email::domain::models::UpdateThreadLabelsResult, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn update_thread_project(
        &self,
        _thread_receipt: EntityAccessReceipt<entity_access::domain::models::EditAccessLevel>,
        _project_receipt: Option<
            EntityAccessReceipt<entity_access::domain::models::EditAccessLevel>,
        >,
    ) -> Result<Option<String>, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn upsert_email_filter(
        &self,
        _link: &email::domain::models::Link,
        _input: email::domain::models::UpsertEmailFilterInput,
    ) -> Result<email::domain::models::EmailFilter, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn delete_email_filter(
        &self,
        _link: &email::domain::models::Link,
        _filter_id: Uuid,
    ) -> Result<bool, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn list_email_filters(
        &self,
        _link: &email::domain::models::Link,
    ) -> Result<Vec<email::domain::models::EmailFilter>, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }
}

#[derive(Clone)]
struct MockEntityAccess;

impl entity_access::domain::ports::EntityAccessService for MockEntityAccess {
    async fn generate_entity_access_receipt<
        T: entity_access::domain::models::RequiredPermission,
    >(
        &self,
        _user_id: &macro_user_id::user_id::MacroUserId<macro_user_id::lowercased::Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: entity_access::domain::models::EntityType,
    ) -> Result<
        entity_access::domain::models::EntityAccessReceipt<T>,
        entity_access::domain::models::AccessError,
    > {
        unimplemented!()
    }

    async fn get_access_level(
        &self,
        _user_id: Option<
            &macro_user_id::user_id::MacroUserId<macro_user_id::lowercased::Lowercase<'_>>,
        >,
        _entity_id: &str,
        _entity_type: entity_access::domain::models::EntityType,
    ) -> Result<
        Option<entity_access::domain::models::AccessLevel>,
        entity_access::domain::models::AccessError,
    > {
        unimplemented!()
    }

    async fn check_access(
        &self,
        _user_id: Option<
            &macro_user_id::user_id::MacroUserId<macro_user_id::lowercased::Lowercase<'_>>,
        >,
        _entity_id: &str,
        _entity_type: entity_access::domain::models::EntityType,
        _required_level: entity_access::domain::models::AccessLevel,
    ) -> Result<
        entity_access::domain::models::AccessLevel,
        entity_access::domain::models::AccessError,
    > {
        unimplemented!()
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: entity_access::domain::models::EntityType,
        _required_level: entity_access::domain::models::AccessLevel,
    ) -> Result<
        entity_access::domain::models::AccessLevel,
        entity_access::domain::models::AccessError,
    > {
        unimplemented!()
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<
            &macro_user_id::user_id::MacroUserId<macro_user_id::lowercased::Lowercase<'_>>,
        >,
        _entity_id: &str,
        _entity_type: entity_access::domain::models::EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<
        entity_access::domain::models::EntityPermission,
        entity_access::domain::models::AccessError,
    > {
        unimplemented!()
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: entity_access::domain::models::EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, entity_access::domain::models::AccessError> {
        unimplemented!()
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<
        Option<entity_access::domain::models::CallChannelInfo>,
        entity_access::domain::models::AccessError,
    > {
        unimplemented!()
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<
        Option<entity_access::domain::models::CallChannelInfo>,
        entity_access::domain::models::AccessError,
    > {
        unimplemented!()
    }

    async fn get_user_team(
        &self,
        _user_id: &macro_user_id::user_id::MacroUserId<macro_user_id::lowercased::Lowercase<'_>>,
    ) -> Result<
        Option<entity_access::domain::models::UserTeamInfo>,
        entity_access::domain::models::AccessError,
    > {
        Ok(None)
    }
}

fn mock_router() -> Router {
    soup_router(SoupRouterState::new(
        MockSoup::new(),
        MockEmail,
        Arc::new(MockEntityAccess),
    ))
    .layer(Extension(UserContext {
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

    async fn get_link_by_macro_id(
        &self,
        _macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Option<email::domain::models::Link>, email::domain::models::EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn get_inboxes_for_macro_id(
        &self,
        _macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Vec<email::domain::models::Link>, email::domain::models::EmailErr> {
        (self.get_link_result)().map(|opt| opt.into_iter().collect())
    }

    async fn get_links_by_fusionauth_user_id(
        &self,
        _auth_id: &str,
    ) -> Result<Vec<email::domain::models::Link>, email::domain::models::EmailErr> {
        (self.get_link_result)().map(|opt| opt.into_iter().collect())
    }

    async fn get_owned_link_for_thread(
        &self,
        _auth_id: &str,
        _thread_id: uuid::Uuid,
    ) -> Result<Option<email::domain::models::Link>, email::domain::models::EmailErr> {
        (self.get_link_result)()
    }

    async fn get_thread_with_messages(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _offset: i64,
        _limit: i64,
    ) -> Result<Option<email::domain::models::Thread>, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn get_thread_parsed(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _offset: i64,
        _limit: i64,
    ) -> Result<Option<email::domain::models::ParsedThread>, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn create_draft(
        &self,
        _link: &email::domain::models::Link,
        _input: email::domain::models::CreateDraftInput,
    ) -> Result<email::domain::models::CreatedDraft, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn send_message(
        &self,
        _link: &email::domain::models::Link,
        _input: email::domain::models::CreateDraftInput,
    ) -> Result<email::domain::models::CreatedDraft, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn list_labels(
        &self,
        _link: &email::domain::models::Link,
    ) -> Result<Vec<email::domain::models::LinkLabel>, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn update_thread_labels(
        &self,
        _access_token: &str,
        _link: &email::domain::models::Link,
        _thread_id: uuid::Uuid,
        _label_id: uuid::Uuid,
        _add: bool,
    ) -> Result<email::domain::models::UpdateThreadLabelsResult, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn update_thread_project(
        &self,
        _thread_receipt: EntityAccessReceipt<entity_access::domain::models::EditAccessLevel>,
        _project_receipt: Option<
            EntityAccessReceipt<entity_access::domain::models::EditAccessLevel>,
        >,
    ) -> Result<Option<String>, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn upsert_email_filter(
        &self,
        _link: &email::domain::models::Link,
        _input: email::domain::models::UpsertEmailFilterInput,
    ) -> Result<email::domain::models::EmailFilter, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn delete_email_filter(
        &self,
        _link: &email::domain::models::Link,
        _filter_id: Uuid,
    ) -> Result<bool, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn list_email_filters(
        &self,
        _link: &email::domain::models::Link,
    ) -> Result<Vec<email::domain::models::EmailFilter>, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
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
        Arc::new(MockEntityAccess),
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
    assert!(guard.first().unwrap().link_ids.is_empty())
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
        Arc::new(MockEntityAccess),
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
        Arc::new(MockEntityAccess),
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
    assert!(matches!(arg.soup_type, SoupType::Expanded));
    assert_eq!(
        arg.email_preview_view,
        PreviewView::StandardLabel(PreviewViewStandardLabel::All)
    );
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
        Arc::new(MockEntityAccess),
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
    assert!(matches!(arg.soup_type, SoupType::Expanded));
    assert_eq!(
        arg.email_preview_view,
        PreviewView::StandardLabel(PreviewViewStandardLabel::Sent)
    );
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
        Arc::new(MockEntityAccess),
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
    assert!(matches!(arg.soup_type, SoupType::Expanded));
    assert!(matches!(arg.cursor_kind, MockCursorKind::SimpleSort));
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
        Arc::new(MockEntityAccess),
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

    let filter: EntityFilters = serde_json::from_value(arg.filter).unwrap();

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
        .filter_on(filter)
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
        Arc::new(MockEntityAccess),
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
    assert!(matches!(req.cursor_kind, MockCursorKind::FrecencyCursor));
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
        Arc::new(MockEntityAccess),
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

    let filter: EntityFilters = serde_json::from_value(arg.filter).unwrap();

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
        .filter_on(filter)
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
        Arc::new(MockEntityAccess),
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
    assert!(matches!(req.cursor_kind, MockCursorKind::FrecencyCursor));
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
        Arc::new(MockEntityAccess),
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

    let filter: EntityFilters = serde_json::from_value(arg.filter).unwrap();
    assert!(!filter.channel_filters.channel_ids.is_empty());
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
        Arc::new(MockEntityAccess),
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

    let filter: EntityFilters = serde_json::from_value(arg.filter).unwrap();
    assert_eq!(
        filter.document_filters.notification_filters.done,
        Some(false)
    );
    assert_eq!(
        filter.document_filters.notification_filters.seen,
        Some(false)
    );
    assert_eq!(
        filter.document_filters.task_filters.include_cbm_atm_nc,
        Some(true)
    );
    assert_eq!(filter.chat_filters.notification_filters.done, Some(false));
    assert_eq!(filter.chat_filters.notification_filters.seen, Some(false));
    assert_eq!(
        filter.project_filters.notification_filters.done,
        Some(false)
    );
    assert_eq!(
        filter.project_filters.notification_filters.seen,
        Some(false)
    );
    assert_eq!(
        filter.channel_filters.notification_filters.done,
        Some(false)
    );
    assert_eq!(
        filter.channel_filters.notification_filters.seen,
        Some(false)
    );
}

#[tokio::test]
async fn it_can_filter_chat_owners() {
    let json = r#"{
"channel_filters": {
"channel_ids": [
"00000000-0000-0000-0000-000000000000"
]
},
"document_filters": {
"document_ids": [
"00000000-0000-0000-0000-000000000000"
]
},
"email_filters": {
"recipients": [
"00000000-0000-0000-0000-000000000000"
]
},
"project_filters": {
"project_ids": [
"00000000-0000-0000-0000-000000000000"
]
},
"chat_filters": {
"owners": [
"macro|rahul@macro.com"
]
},
"emailView": "all",
"limit": 100,
"sort_method": "updated_at"
}"#;

    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = soup_router(SoupRouterState::new(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
        Arc::new(MockEntityAccess),
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
        .body(axum::body::Body::from(json))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let arg = {
        let mut guard = inner_counter.lock().unwrap();
        guard.pop().unwrap()
    };

    let filter: EntityFilters = serde_json::from_value(arg.filter).unwrap();
    assert_eq!(
        filter.chat_filters.owners,
        vec!["macro|rahul@macro.com".to_string()]
    );
}

#[tokio::test]
async fn ast_endpoint_expands_file_assoc_pdf() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = soup_router(SoupRouterState::new(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
        Arc::new(MockEntityAccess),
    ))
    .layer(Extension(UserContext {
        user_id: "macro|test@example.com".to_string(),
        fusion_user_id: "1234".to_string(),
        permissions: None,
        organization_id: None,
    }));

    let request = Request::builder()
        .uri("/soup/ast")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&json!({
                "df": { "l": { "fa": "assoc:pdf" } }
            }))
            .unwrap(),
        ))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let arg = {
        let mut guard = inner_counter.lock().unwrap();
        guard
            .pop()
            .expect("SoupService::handle should have been called")
    };

    let filter: EntityFilterAst = serde_json::from_value(arg.expanded_filter).unwrap();
    let doc_tree = filter
        .document_filter
        .expect("document_filter should be set");
    let doc_json = serde_json::to_value(doc_tree.as_ref()).unwrap();
    assert_eq!(doc_json, json!({ "l": { "ft": "pdf" } }));
}

#[tokio::test]
async fn ast_endpoint_passes_through_plain_document_literal() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = soup_router(SoupRouterState::new(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
        Arc::new(MockEntityAccess),
    ))
    .layer(Extension(UserContext {
        user_id: "macro|test@example.com".to_string(),
        fusion_user_id: "1234".to_string(),
        permissions: None,
        organization_id: None,
    }));

    let doc_id = Uuid::new_v4();
    let request = Request::builder()
        .uri("/soup/ast")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&json!({
                "df": { "l": { "id": doc_id.to_string() } }
            }))
            .unwrap(),
        ))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let arg = {
        let mut guard = inner_counter.lock().unwrap();
        guard
            .pop()
            .expect("SoupService::handle should have been called")
    };

    let filter: EntityFilterAst = serde_json::from_value(arg.expanded_filter).unwrap();
    let doc_tree = filter
        .document_filter
        .expect("document_filter should be set");
    let doc_json = serde_json::to_value(doc_tree.as_ref()).unwrap();
    assert_eq!(doc_json, json!({ "l": { "id": doc_id.to_string() } }));
}

#[tokio::test]
async fn ast_endpoint_passes_through_foreign_entity_filter() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = soup_router(SoupRouterState::new(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
        Arc::new(MockEntityAccess),
    ))
    .layer(Extension(UserContext {
        user_id: "macro|test@example.com".to_string(),
        fusion_user_id: "1234".to_string(),
        permissions: None,
        organization_id: None,
    }));

    let request = Request::builder()
        .uri("/soup/ast")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&json!({
                "fef": { "l": { "feid": "github:123" } }
            }))
            .unwrap(),
        ))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let arg = {
        let mut guard = inner_counter.lock().unwrap();
        guard
            .pop()
            .expect("SoupService::handle should have been called")
    };

    let filter: EntityFilterAst = serde_json::from_value(arg.expanded_filter).unwrap();
    let foreign_entity_tree = filter
        .foreign_entity_filter
        .expect("foreign_entity_filter should be set");
    let foreign_entity_json = serde_json::to_value(foreign_entity_tree.as_ref()).unwrap();
    assert_eq!(
        foreign_entity_json,
        json!({ "l": { "feid": "github:123" } })
    );
}

#[test]
fn ast_cursor_without_foreign_entity_filter_deserializes() {
    let cursor_json = json!({
        "id": Uuid::new_v4(),
        "limit": 20,
        "val": {
            "sort_type": "updated_at",
            "last_val": Utc::now(),
        },
        "filter": {
            "df": { "l": { "id": Uuid::new_v4().to_string() } }
        }
    });

    let cursor: CursorWithValAndFilter<Uuid, SimpleSortMethod, ApiEntityFilterAst> =
        serde_json::from_value(cursor_json).unwrap();

    assert!(cursor.filter.foreign_entity_filter.is_none());
}

#[tokio::test]
async fn ast_endpoint_expands_file_assoc_image_to_or_tree() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = soup_router(SoupRouterState::new(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
        Arc::new(MockEntityAccess),
    ))
    .layer(Extension(UserContext {
        user_id: "macro|test@example.com".to_string(),
        fusion_user_id: "1234".to_string(),
        permissions: None,
        organization_id: None,
    }));

    let request = Request::builder()
        .uri("/soup/ast")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&json!({
                "df": { "l": { "fa": "assoc:image" } }
            }))
            .unwrap(),
        ))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    let arg = {
        let mut guard = inner_counter.lock().unwrap();
        guard
            .pop()
            .expect("SoupService::handle should have been called")
    };

    let filter: EntityFilterAst = serde_json::from_value(arg.expanded_filter).unwrap();
    let doc_tree = filter
        .document_filter
        .expect("document_filter should be set");

    // collect all file type strings from the expanded OR-tree
    fn collect_file_types(
        expr: &filter_ast::Expr<item_filters::ast::document::DocumentLiteral>,
        out: &mut Vec<String>,
    ) {
        match expr {
            filter_ast::Expr::Or(a, b) => {
                collect_file_types(a, out);
                collect_file_types(b, out);
            }
            filter_ast::Expr::Literal(item_filters::ast::document::DocumentLiteral::FileType(
                ft,
            )) => {
                out.push(
                    serde_json::to_value(ft)
                        .unwrap()
                        .as_str()
                        .unwrap()
                        .to_string(),
                );
            }
            other => panic!("unexpected node in expanded image tree: {other:?}"),
        }
    }

    let mut actual: Vec<String> = Vec::new();
    collect_file_types(doc_tree.as_ref(), &mut actual);
    actual.sort();

    let mut expected: Vec<String> = item_filters::ast::document::resolve_file_types("assoc:image")
        .into_iter()
        .map(|ft| {
            serde_json::to_value(ft)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    expected.sort();

    assert_eq!(actual, expected);
    assert!(
        actual.len() > 1,
        "image association should expand to multiple file types"
    );
}

#[tokio::test]
async fn it_can_expand_assoc_ast() {
    let js = json!({
        "df": {
            "&": [
                {
                    "l": {
                        "fa": "assoc:code"
                    }
                },
                {
                    "!": {
                        "l": {
                            "dst": "task"
                        }
                    }
                }
            ]
        },
        "ef": {
            "l": {
                "ThreadId": "00000000-0000-0000-0000-000000000000"
            }
        },
        "chanf": {
            "l": {
                "ChannelId": "00000000-0000-0000-0000-000000000000"
            }
        },
        "cf": {
            "l": {
                "cid": "00000000-0000-0000-0000-000000000000"
            }
        },
        "pf": {
            "l": {
                "pid": "00000000-0000-0000-0000-000000000000"
            }
        },
        "callf": {
            "l": {
                "ChannelId": "00000000-0000-0000-0000-000000000000"
            }
        },
        "limit": 100,
        "sort_method": "updated_at"
    });

    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = soup_router(SoupRouterState::new(
        soup.clone(),
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
        Arc::new(MockEntityAccess),
    ))
    .layer(Extension(UserContext {
        user_id: "macro|test@example.com".to_string(),
        fusion_user_id: "1234".to_string(),
        permissions: None,
        organization_id: None,
    }));

    let request = Request::builder()
        .uri("/soup/ast")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(serde_json::to_vec(&js).unwrap()))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();

    {
        let mut guard = inner_counter.lock().unwrap();
        guard
            .pop()
            .expect("SoupService::handle should have been called");
    }

    let filter: ApiEntityFilterAst = serde_json::from_value(js.clone()).unwrap();

    #[derive(Serialize)]
    struct Data(chrono::DateTime<Utc>, Uuid);

    impl Identify for Data {
        type Id = Uuid;

        fn id(&self) -> Uuid {
            self.1
        }
    }

    impl SortOn<SimpleSortMethod> for Data {
        fn sort_on(
            sort_type: SimpleSortMethod,
        ) -> impl FnMut(&Self) -> CursorVal<SimpleSortMethod> {
            move |v| CursorVal {
                sort_type,
                last_val: v.0,
            }
        }
    }

    let now = Utc::now();
    let res = (0..1000)
        .map(|x| Data(now - Duration::seconds(x), Uuid::new_v4()))
        .paginate_on(100, SimpleSortMethod::UpdatedAt)
        .filter_on(filter)
        .into_page();

    let cursor = res.type_erase().next_cursor.unwrap();

    let request2 = Request::builder()
        .uri(format!("/soup/ast?cursor={cursor}"))
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
        Arc::new(MockEntityAccess),
    ))
    .layer(Extension(UserContext {
        user_id: "macro|test@example.com".to_string(),
        fusion_user_id: "1234".to_string(),
        permissions: None,
        organization_id: None,
    }));

    let _res = router.oneshot(request2).await.unwrap();

    let guard = inner_counter.lock().unwrap();
    let req = guard
        .first()
        .expect("SoupService::handle should have been called with next cursor");
    assert!(matches!(req.cursor_kind, MockCursorKind::SimpleCursor));
}

// ============================================================================
// /soup/ast CRM scope extension
// ============================================================================

use item_filters::ast::CrmScope;

#[test]
fn ast_endpoint_email_crm_domains_stamps_scope_and_ands_into_tree() {
    let js = json!({
        "ecd": ["acme.com"],
    });
    let api: ApiEntityFilterAst = serde_json::from_value(js).unwrap();
    let req = SoupRequest {
        soup_type: SoupType::Expanded,
        limit: 20,
        cursor: SoupQuery::Simple(SimpleQueryInner(Query::Sort(
            SimpleSortMethod::ViewedAt,
            api,
        ))),
        user: MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap(),
        email_preview_view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        link_ids: vec![],
    };
    let req: SoupRequest<Option<EntityFilterAst>> = req.into_ast().unwrap();
    let ast = match &req.cursor {
        SoupQuery::Simple(SimpleQueryInner(Query::Sort(_, f))) => f.as_ref().unwrap(),
        _ => panic!("expected simple sort"),
    };
    let scope = ast.email_filter.crm_scope.as_ref().expect("scope set");
    assert!(matches!(scope, CrmScope::Domains(d) if d == &vec!["acme.com".to_string()]));
    // Sub-tree of any-direction OR literals stamped on the email AST.
    assert!(ast.email_filter.tree.is_some());
}

#[test]
fn ast_endpoint_email_crm_addresses_stamps_scope() {
    let js = json!({
        "eca": ["alice@acme.com"],
    });
    let api: ApiEntityFilterAst = serde_json::from_value(js).unwrap();
    let req = SoupRequest {
        soup_type: SoupType::Expanded,
        limit: 20,
        cursor: SoupQuery::Simple(SimpleQueryInner(Query::Sort(
            SimpleSortMethod::ViewedAt,
            api,
        ))),
        user: MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap(),
        email_preview_view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        link_ids: vec![],
    };
    let req: SoupRequest<Option<EntityFilterAst>> = req.into_ast().unwrap();
    let ast = match &req.cursor {
        SoupQuery::Simple(SimpleQueryInner(Query::Sort(_, f))) => f.as_ref().unwrap(),
        _ => panic!("expected simple sort"),
    };
    let scope = ast.email_filter.crm_scope.as_ref().expect("scope set");
    assert!(matches!(scope, CrmScope::Addresses(a) if a == &vec!["alice@acme.com".to_string()]));
    assert!(ast.email_filter.tree.is_some());
}

#[test]
fn ast_endpoint_email_crm_both_lists_rejected() {
    let js = json!({
        "ecd": ["acme.com"],
        "eca": ["alice@acme.com"],
    });
    let api: ApiEntityFilterAst = serde_json::from_value(js).unwrap();
    let req = SoupRequest {
        soup_type: SoupType::Expanded,
        limit: 20,
        cursor: SoupQuery::Simple(SimpleQueryInner(Query::Sort(
            SimpleSortMethod::ViewedAt,
            api,
        ))),
        user: MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap(),
        email_preview_view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        link_ids: vec![],
    };
    let res = req.into_ast();
    assert!(res.is_err(), "mutual exclusivity must reject both lists");
}

#[test]
fn ast_endpoint_empty_crm_lists_leaves_scope_none() {
    let js = json!({
        "ef": null,
    });
    let api: ApiEntityFilterAst = serde_json::from_value(js).unwrap();
    let req = SoupRequest {
        soup_type: SoupType::Expanded,
        limit: 20,
        cursor: SoupQuery::Simple(SimpleQueryInner(Query::Sort(
            SimpleSortMethod::ViewedAt,
            api,
        ))),
        user: MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap(),
        email_preview_view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        link_ids: vec![],
    };
    let req: SoupRequest<Option<EntityFilterAst>> = req.into_ast().unwrap();
    // ast.is_none() because the whole filter is empty.
    let ast = match &req.cursor {
        SoupQuery::Simple(SimpleQueryInner(Query::Sort(_, f))) => f.as_ref(),
        _ => panic!("expected simple sort"),
    };
    assert!(ast.is_none(), "fully-empty filter should collapse to None");
}

#[test]
fn ast_endpoint_crm_ands_with_existing_freeform_ef() {
    // The AND-merge between the freeform `ef` AST and the CRM-expanded
    // sub-tree is the most consequential bit of `into_entity_ast`. This
    // test pins the root shape:
    //   Expr::And(
    //       <original ef literal>,            // unchanged
    //       <any-direction OR over the CRM domain>
    //   )
    let js = json!({
        "ef": { "l": { "Sender": { "Complete": "bob@elsewhere.com" } } },
        "ecd": ["acme.com"],
    });
    let api: ApiEntityFilterAst = serde_json::from_value(js).unwrap();
    let req = SoupRequest {
        soup_type: SoupType::Expanded,
        limit: 20,
        cursor: SoupQuery::Simple(SimpleQueryInner(Query::Sort(
            SimpleSortMethod::ViewedAt,
            api,
        ))),
        user: MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap(),
        email_preview_view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        link_ids: vec![],
    };
    let req: SoupRequest<Option<EntityFilterAst>> = req.into_ast().unwrap();
    let ast = match &req.cursor {
        SoupQuery::Simple(SimpleQueryInner(Query::Sort(_, f))) => f.as_ref().unwrap(),
        _ => panic!("expected simple sort"),
    };

    let tree = ast.email_filter.tree.as_ref().expect("tree set");
    match tree.as_ref() {
        filter_ast::Expr::And(left, right) => {
            // Left = the original ef literal, untouched.
            let left_json = serde_json::to_value(left.as_ref()).unwrap();
            assert_eq!(
                left_json,
                serde_json::json!({ "l": { "Sender": { "Complete": "bob@elsewhere.com" } } }),
                "left side of AND must be the original ef literal verbatim"
            );
            // Right = the any-direction CRM sub-tree. All four direction
            // literals must appear in the right subtree carrying acme.com.
            let right_json = serde_json::to_string(right.as_ref()).unwrap();
            for direction in ["Sender", "Cc", "Bcc", "Recipient"] {
                assert!(
                    right_json.contains(direction),
                    "right side must contain {} direction literal",
                    direction
                );
            }
            assert!(right_json.contains("acme.com"));
        }
        other => panic!(
            "expected And at root after CRM AND-merge, got: {}",
            serde_json::to_string(other).unwrap()
        ),
    }
}

#[test]
fn ast_endpoint_crm_domains_are_lowercased_in_scope() {
    // Mixed-case input must land in the scope as lowercase — the CRM
    // pre-check uses LOWER(domain) on the SQL side and would otherwise
    // miss legitimate matches.
    let js = json!({
        "ecd": ["ACME.com"],
    });
    let api: ApiEntityFilterAst = serde_json::from_value(js).unwrap();
    let req = SoupRequest {
        soup_type: SoupType::Expanded,
        limit: 20,
        cursor: SoupQuery::Simple(SimpleQueryInner(Query::Sort(
            SimpleSortMethod::ViewedAt,
            api,
        ))),
        user: MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap(),
        email_preview_view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        link_ids: vec![],
    };
    let req: SoupRequest<Option<EntityFilterAst>> = req.into_ast().unwrap();
    let ast = match &req.cursor {
        SoupQuery::Simple(SimpleQueryInner(Query::Sort(_, f))) => f.as_ref().unwrap(),
        _ => panic!("expected simple sort"),
    };
    let scope = ast.email_filter.crm_scope.as_ref().expect("scope set");
    assert!(matches!(scope, CrmScope::Domains(d) if d == &vec!["acme.com".to_string()]));
}
