use axum::{
    Router,
    http::{Method, Request, StatusCode, header},
};
use chrono::{Duration, Utc};
use email::domain::{
    models::{EmailErr, PreviewView, PreviewViewStandardLabel, UserProvider},
    ports::EmailService,
};
use entity_access::domain::models::{BotAccessScope, BotId, EntityAccessReceipt, ViewAccessLevel};
use http_body_util::BodyExt;
use item_filters::EntityFilters;
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use model_user::UserContext;
use models_pagination::{
    CursorVal, CursorWithValAndFilter, Frecency, FrecencyValue, Identify, PaginateOn, Query,
    SimpleSortMethod, SortOn, TypeEraseCursor,
};
use rootcause::Report;
use serde::Serialize;
use serde_json::json;
use std::sync::Arc;
use tower::util::ServiceExt;
use uuid::Uuid;

use item_filters::ast::EntityFilterAst;

use crate::{
    domain::{
        models::{
            EnrichedSoupItem, FrecencyQueryInner, GroupedSortRequest, IntoSoupReqAst,
            SimpleQueryInner, SoupErr, SoupPropertiesField, SoupQuery, SoupRequest,
            SoupSortDirection, SoupType, TouchedQueryInner, grouping::ItemGroupingInfo,
        },
        ports::{SoupOutput, SoupService},
    },
    inbound::axum_router::ApiEntityFilterAst,
    inbound::axum_router::{SoupRouterState, soup_router},
};

static CURSOR: &str = "eyJpZCI6ImUzNmM5MTJlLTU2M2MtNDIxZS1iMTAzLWE0YjAwY2ZmMzBlZSIsImxpbWl0IjoxMDAsInZhbCI6eyJzb3J0X3R5cGUiOiJ1cGRhdGVkX2F0IiwibGFzdF92YWwiOiIyMDI1LTExLTA3VDE5OjEyOjU5Ljc4MFoifSwiZmlsdGVyIjp7fX0=";
const USER_ID: &str = "macro|test@example.com";
const INTERNAL_USER_ID: &str = "macro|internal@example.com";
const VALID_INTERNAL_KEY: &str = "valid-internal-key";

#[derive(Debug)]
enum MockCursorKind {
    SimpleSort,
    SimpleCursor,
    FrecencySort,
    FrecencyCursor,
    TouchedSort,
    TouchedCursor,
}

#[derive(Debug)]
struct MockSoupCall {
    user_id: String,
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
    succeeds: bool,
}

impl MockSoup {
    fn new() -> Self {
        Self {
            called: Arc::new(std::sync::Mutex::new(Vec::new())),
            succeeds: false,
        }
    }

    fn succeeding() -> Self {
        Self {
            succeeds: true,
            ..Self::new()
        }
    }
}

impl SoupService for MockSoup {
    async fn get_user_soup<T>(
        &self,
        _req: SoupRequest<T>,
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
        Err(SoupErr::SoupDbErr(anyhow::anyhow!("Not implemented")))
    }

    async fn get_user_soup_with_properties<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<
            entity_access::domain::models::EntityAccessReceipt<
                entity_access::domain::models::MemberTeamRole,
            >,
        >,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        Err(SoupErr::SoupDbErr(anyhow::anyhow!("Not implemented")))
    }

    async fn get_user_soup_with_frecency<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<
            entity_access::domain::models::EntityAccessReceipt<
                entity_access::domain::models::MemberTeamRole,
            >,
        >,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        Err(SoupErr::SoupDbErr(anyhow::anyhow!("Not implemented")))
    }

    async fn get_user_soup_with_properties_and_frecency<T>(
        &self,
        req: SoupRequest<T>,
        _team_receipt: Option<
            entity_access::domain::models::EntityAccessReceipt<
                entity_access::domain::models::MemberTeamRole,
            >,
        >,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
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
            SoupQuery::Touched(TouchedQueryInner(Query::Sort(..))) => MockCursorKind::TouchedSort,
            SoupQuery::Touched(TouchedQueryInner(Query::Cursor(..))) => {
                MockCursorKind::TouchedCursor
            }
        };
        let user_id = req.user.to_string();
        let soup_type = req.soup_type;
        let email_preview_view = req.email_preview_view.clone();
        let link_ids = req.link_ids.clone();
        let filter = serde_json::to_value(req.cursor.filter()).unwrap();
        let expanded_filter = serde_json::to_value(req.into_ast()?.cursor.filter()).unwrap();
        let mut guard = self.called.lock().unwrap();
        guard.push(MockSoupCall {
            user_id,
            soup_type,
            email_preview_view,
            link_ids,
            cursor_kind,
            filter,
            expanded_filter,
        });
        drop(guard);

        if self.succeeds {
            Ok(SoupOutput::Simple(
                models_pagination::Paginated::from_parts(Vec::new(), None),
            ))
        } else {
            Err(SoupErr::SoupDbErr(anyhow::anyhow!("Not implemented")))
        }
    }

    async fn get_user_soup_grouped(
        &self,
        _req: GroupedSortRequest<'_>,
    ) -> Result<impl Iterator<Item = ItemGroupingInfo<SoupPropertiesField>> + Send, SoupErr> {
        Err::<std::vec::IntoIter<ItemGroupingInfo<SoupPropertiesField>>, _>(SoupErr::SoupDbErr(
            anyhow::anyhow!("Not implemented"),
        ))
    }

    async fn caller_tag_sets<'a>(
        &self,
        _user_id: MacroUserIdStr<'a>,
    ) -> Result<
        Vec<models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions>,
        SoupErr,
    >{
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
            is_primary: true,
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

    async fn get_owned_link_for_thread(
        &self,
        _macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
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
        _accessible_inboxes: &[email::domain::models::Link],
        _input: email::domain::models::CreateDraftInput,
    ) -> Result<email::domain::models::CreatedDraft, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn send_message(
        &self,
        _link: &email::domain::models::Link,
        _accessible_inboxes: &[email::domain::models::Link],
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

    async fn set_sender_policy(
        &self,
        _link: &email::domain::models::Link,
        _sender_email: &str,
        _policy: email::domain::models::SenderPolicy,
    ) -> Result<(), EmailErr> {
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

    async fn generate_bot_entity_access_receipt<
        T: entity_access::domain::models::RequiredPermission,
    >(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
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

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<
            &macro_user_id::user_id::MacroUserId<macro_user_id::lowercased::Lowercase<'_>>,
        >,
        _entity_id: &str,
        _entity_type: entity_access::domain::models::EntityType,
    ) -> Result<
        (
            entity_access::domain::models::EntityPermission,
            uuid::Uuid,
            entity_access::domain::models::TeamRole,
        ),
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

#[derive(Clone)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        match jwt {
            "valid" => Ok(user_context(USER_ID)),
            "expired" => Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key != VALID_INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(claims.user_id.map(|user_id| user_context(&user_id)))
    }
}

fn user_context(user_id: &str) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: "fusion-user-id".to_string(),
        permissions: None,
        organization_id: None,
    }
}

type MockRouterState<T, U> = SoupRouterState<T, U, MockEntityAccess, FakeAuthorizationService>;

fn mock_router_state<T, U>(service: T, email: U) -> MockRouterState<T, U>
where
    T: SoupService,
    U: EmailService,
{
    SoupRouterState::new(
        service,
        email,
        Arc::new(MockEntityAccess),
        MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    )
}

fn mock_router_with<T, U>(service: T, email: U) -> Router
where
    T: SoupService,
    U: EmailService,
{
    soup_router(mock_router_state(service, email))
}

fn mock_router() -> Router {
    mock_router_with(MockSoup::new(), MockEmail)
}

fn authenticated_request() -> axum::http::request::Builder {
    Request::builder().header(header::AUTHORIZATION, "Bearer valid")
}

async fn send_json(
    router: Router,
    request: Request<axum::body::Body>,
) -> (StatusCode, serde_json::Value) {
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap();
    (status, body)
}

#[tokio::test]
async fn it_should_deserialize_empty_filter() {
    let request = authenticated_request()
        .uri(format!("/soup?cursor={CURSOR}"))
        .body(axum::body::Body::empty())
        .unwrap();

    let (status, body) = send_json(mock_router(), request).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        body,
        json!({
            "message": "An internal server error has occurred"
        })
    );
}

#[tokio::test]
async fn no_credentials_returns_unauthorized_json() {
    let request = Request::get(format!("/soup?cursor={CURSOR}"))
        .body(axum::body::Body::empty())
        .unwrap();

    let (status, body) = send_json(mock_router(), request).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
}

#[tokio::test]
async fn garbage_bearer_returns_unauthorized_json() {
    let request = Request::get(format!("/soup?cursor={CURSOR}"))
        .header(header::AUTHORIZATION, "Bearer garbage")
        .body(axum::body::Body::empty())
        .unwrap();

    let (status, body) = send_json(mock_router(), request).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
}

#[tokio::test]
async fn internal_credentials_use_the_acting_user() {
    let soup = MockSoup::succeeding();
    let calls = soup.called.clone();
    let request = Request::get(format!("/soup?cursor={CURSOR}"))
        .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
        .header(INTERNAL_MACRO_USER_ID_HEADER, INTERNAL_USER_ID)
        .body(axum::body::Body::empty())
        .unwrap();

    let (status, body) = send_json(mock_router_with(soup, MockEmail), request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "items": [], "next_cursor": null }));

    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].user_id, INTERNAL_USER_ID);
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

    async fn get_owned_link_for_thread(
        &self,
        _macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
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
        _accessible_inboxes: &[email::domain::models::Link],
        _input: email::domain::models::CreateDraftInput,
    ) -> Result<email::domain::models::CreatedDraft, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("Not implemented")))
    }

    async fn send_message(
        &self,
        _link: &email::domain::models::Link,
        _accessible_inboxes: &[email::domain::models::Link],
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

    async fn set_sender_policy(
        &self,
        _link: &email::domain::models::Link,
        _sender_email: &str,
        _policy: email::domain::models::SenderPolicy,
    ) -> Result<(), EmailErr> {
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
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
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
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| {
                Err(EmailErr::RepoErr(anyhow::anyhow!("failed to fetch")))
            }),
        },
    );

    let request = authenticated_request()
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
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
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
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
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
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
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
    let router: Router = mock_router_with(
        soup.clone(),
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
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

    let request2 = authenticated_request()
        .uri(format!("/soup?cursor={cursor}"))
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({})).unwrap(),
        ))
        .unwrap();

    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let _res = router.oneshot(request2).await.unwrap();
    let guard2 = inner_counter.lock().unwrap();
    let req = guard2.first().unwrap();
    assert!(matches!(req.cursor_kind, MockCursorKind::FrecencyCursor));
}

#[tokio::test]
async fn cursor_with_all_works() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = mock_router_with(
        soup.clone(),
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
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

    let request2 = authenticated_request()
        .uri(format!("/soup?cursor={cursor}"))
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({})).unwrap(),
        ))
        .unwrap();

    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let _res = router.oneshot(request2).await.unwrap();
    let guard2 = inner_counter.lock().unwrap();
    let req = guard2.first().unwrap();
    assert!(matches!(req.cursor_kind, MockCursorKind::FrecencyCursor));
}

#[tokio::test]
async fn it_parses_channel_filters() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = mock_router_with(
        soup.clone(),
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let uuid1 = Uuid::new_v4();
    let uuid2 = Uuid::new_v4();
    let request = authenticated_request()
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
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
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
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
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
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
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
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let doc_id = Uuid::new_v4();
    let request = authenticated_request()
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
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
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
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
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
    let router: Router = mock_router_with(
        soup.clone(),
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
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

    let request2 = authenticated_request()
        .uri(format!("/soup/ast?cursor={cursor}"))
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({})).unwrap(),
        ))
        .unwrap();

    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

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
        sort_direction: SoupSortDirection::default(),
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
        sort_direction: SoupSortDirection::default(),
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
        sort_direction: SoupSortDirection::default(),
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
        sort_direction: SoupSortDirection::default(),
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
        sort_direction: SoupSortDirection::default(),
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
fn ast_endpoint_crm_ef_merge_tolerates_shared_arc() {
    // The soup service clones the request filters before AST expansion
    // (`get_user_soup_internal`), so the `ef` Arc reaches the CRM
    // AND-merge with refcount > 1. The merge must clone, not error.
    let js = json!({
        "ef": { "l": { "Importance": true } },
        "ecd": ["acme.com"],
    });
    let api: ApiEntityFilterAst = serde_json::from_value(js).unwrap();
    let _extra_ref = api.email_filter.clone();
    let ast = api
        .into_entity_ast()
        .expect("shared ef Arc must not fail the merge");
    let tree = ast.email_filter.tree.as_ref().expect("tree set");
    assert!(
        matches!(tree.as_ref(), filter_ast::Expr::And(_, _)),
        "expected And at root after CRM AND-merge"
    );
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
        sort_direction: SoupSortDirection::default(),
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

/// Ascending frecency has no meaning — the frecency branch orders by relevance
/// score and never applies the merged sort a direction would flip. Rejecting
/// keeps the parameter honest rather than accepting it and doing nothing.
#[tokio::test]
async fn ascending_frecency_is_rejected() {
    let request = authenticated_request()
        .uri("/soup/ast")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&json!({
                "sort_method": "frecency",
                "sort_direction": "asc"
            }))
            .unwrap(),
        ))
        .unwrap();

    let (status, body) = send_json(mock_router(), request).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        json!({
            "message": "sort_direction=asc is not supported with sort_method=frecency"
        })
    );
}

/// The descending default must still reach the service — the guard is scoped to
/// the one unsupported combination, not to frecency as a whole.
#[tokio::test]
async fn descending_frecency_is_accepted() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
        .uri("/soup/ast")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&json!({ "sort_method": "frecency" })).unwrap(),
        ))
        .unwrap();

    let response = router.oneshot(request).await.unwrap();

    // The mock service always errors, so the 500 is the harness rather than the
    // guard — pinned instead of loosely asserting "not 400" so a genuine
    // regression to some other status is caught. Reaching the service at all is
    // the actual claim: the guard let this combination through.
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(inner_counter.lock().unwrap().len(), 1);
}

/// touched_by_me selects the touched query mode from the plain sort param.
#[tokio::test]
async fn touched_by_me_sort_selects_touched_query() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    let request = authenticated_request()
        .uri("/soup/ast")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&json!({ "sort_method": "touched_by_me" })).unwrap(),
        ))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();
    let guard = inner_counter.lock().unwrap();
    let req = guard.first().unwrap();
    assert!(matches!(req.cursor_kind, MockCursorKind::TouchedSort));
}

/// A touched page cursor round-trips through the cursor extractor into the
/// touched query mode, not one of the other two cursor shapes.
#[tokio::test]
async fn touched_cursor_round_trips() {
    let soup = MockSoup::new();
    let inner_counter = soup.called.clone();
    let router: Router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );

    // The shape the service emits: entity id + own-mutation timestamp. The
    // sort marker serializes as null (like frecency's); the timestamp value
    // is what keeps this out of the frecency cursor arm.
    let cursor = models_pagination::Base64Str::encode_json(models_pagination::Cursor {
        id: Uuid::new_v4().to_string(),
        limit: 20usize,
        val: CursorVal {
            sort_type: models_pagination::TouchedByMe,
            last_val: chrono::DateTime::<chrono::Utc>::default(),
        },
        filter: EntityFilters::default(),
    })
    .type_erase();

    // Percent-encode the base64 characters that are unsafe in a query string.
    let cursor = cursor
        .replace('+', "%2B")
        .replace('/', "%2F")
        .replace('=', "%3D");
    let request = authenticated_request()
        .uri(format!("/soup?cursor={cursor}"))
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&serde_json::json!({})).unwrap(),
        ))
        .unwrap();

    let _res = router.oneshot(request).await.unwrap();
    let guard = inner_counter.lock().unwrap();
    let req = guard.first().unwrap();
    assert!(matches!(req.cursor_kind, MockCursorKind::TouchedCursor));
}

/// Ascending touched order is rejected for the same reason as frecency: the
/// touched branch orders by the caller's own latest mutation and never
/// applies the merged sort a direction would flip.
#[tokio::test]
async fn ascending_touched_is_rejected() {
    let request = authenticated_request()
        .uri("/soup/ast")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&json!({
                "sort_method": "touched_by_me",
                "sort_direction": "asc"
            }))
            .unwrap(),
        ))
        .unwrap();

    let (status, body) = send_json(mock_router(), request).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        json!({
            "message": "sort_direction=asc is not supported with sort_method=touched_by_me"
        })
    );
}
