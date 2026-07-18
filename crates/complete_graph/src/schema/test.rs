use std::sync::atomic::{AtomicUsize, Ordering};

use axum::http::{Request as HttpRequest, header};
use email::domain::models::{
    CreateDraftInput, CreatedDraft, EmailErr, EmailFilter, EnrichedEmailThreadPreview,
    GetEmailsRequest, Link, LinkLabel, ParsedThread, Thread, UpdateThreadLabelsResult,
    UpsertEmailFilterInput,
};
use entity_access::domain::models::{
    AccessError, AccessLevel, BotId, CallChannelInfo, EditAccessLevel, EntityAccessReceipt,
    EntityPermission, EntityType, RequiredPermission, UserTeamInfo, ViewAccessLevel,
};
use graphql_common::GraphqlSoupRequestParts;
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model_user::UserContext;
use models_pagination::{PaginatedCursor, SimpleSortMethod};
use models_soup::{document::SoupDocument, item::SoupItem};
use rootcause::Report;
use uuid::Uuid;

use super::*;

const VALID_USER_ID: &str = "macro|user@example.com";
const INTERNAL_USER_ID: &str = "macro|internal@example.com";
const VALID_INTERNAL_KEY: &str = "valid-internal-key";

#[derive(Clone, Default)]
struct CountingSoupService {
    raw_calls: Arc<AtomicUsize>,
    frecency_calls: Arc<AtomicUsize>,
    grouped_calls: Arc<AtomicUsize>,
}

fn grouped_document(id: Uuid) -> SoupItem<soup::domain::models::SoupPropertiesField> {
    SoupItem::Document(SoupDocument {
        id,
        document_version_id: 1,
        owner_id: MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
        name: format!("Document {id}"),
        file_type: None,
        sha: None,
        project_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        created_at: Default::default(),
        updated_at: Default::default(),
        viewed_at: Default::default(),
        sub_type: None,
        deleted_at: None,
        extra: soup::domain::models::SoupPropertiesField::default(),
    })
}

fn test_soup_err() -> soup::domain::models::SoupErr {
    soup::domain::models::SoupErr::SoupDbErr(anyhow::anyhow!("counting Soup service"))
}

impl SoupService for CountingSoupService {
    async fn get_user_soup<T>(
        &self,
        _req: soup::domain::models::SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<entity_access::domain::models::MemberTeamRole>>,
    ) -> Result<soup::domain::ports::SoupOutput<T>, soup::domain::models::SoupErr>
    where
        soup::domain::models::SoupRequest<T>: soup::domain::models::IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        self.raw_calls.fetch_add(1, Ordering::SeqCst);
        Err(test_soup_err())
    }

    async fn get_user_soup_with_properties<T>(
        &self,
        _req: soup::domain::models::SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<entity_access::domain::models::MemberTeamRole>>,
    ) -> Result<
        soup::domain::ports::SoupOutput<T, soup::domain::models::EnrichedSoupItem>,
        soup::domain::models::SoupErr,
    >
    where
        soup::domain::models::SoupRequest<T>: soup::domain::models::IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        Err(test_soup_err())
    }

    async fn get_user_soup_with_frecency<T>(
        &self,
        _req: soup::domain::models::SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<entity_access::domain::models::MemberTeamRole>>,
    ) -> Result<
        soup::domain::ports::SoupOutput<T, soup::domain::models::EnrichedSoupItem>,
        soup::domain::models::SoupErr,
    >
    where
        soup::domain::models::SoupRequest<T>: soup::domain::models::IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        self.frecency_calls.fetch_add(1, Ordering::SeqCst);
        Err(test_soup_err())
    }

    async fn get_user_soup_with_properties_and_frecency<T>(
        &self,
        _req: soup::domain::models::SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<entity_access::domain::models::MemberTeamRole>>,
    ) -> Result<
        soup::domain::ports::SoupOutput<T, soup::domain::models::EnrichedSoupItem>,
        soup::domain::models::SoupErr,
    >
    where
        soup::domain::models::SoupRequest<T>: soup::domain::models::IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        Err(test_soup_err())
    }

    async fn get_user_soup_grouped(
        &self,
        _req: soup::domain::models::GroupedSortRequest<'_>,
    ) -> Result<
        impl Iterator<
            Item = soup::domain::models::grouping::ItemGroupingInfo<
                soup::domain::models::SoupPropertiesField,
            >,
        > + Send,
        soup::domain::models::SoupErr,
    > {
        self.grouped_calls.fetch_add(1, Ordering::SeqCst);
        Ok(vec![
            soup::domain::models::grouping::ItemGroupingInfo {
                key: "document".to_string(),
                total_group_count: 3,
                index_in_group: 1,
                item: grouped_document(Uuid::from_u128(1)),
            },
            soup::domain::models::grouping::ItemGroupingInfo {
                key: "document".to_string(),
                total_group_count: 3,
                index_in_group: 2,
                item: grouped_document(Uuid::from_u128(2)),
            },
        ]
        .into_iter())
    }

    async fn caller_tag_sets<'a>(
        &self,
        _user_id: MacroUserIdStr<'a>,
    ) -> Result<
        Vec<models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions>,
        soup::domain::models::SoupErr,
    >{
        Err(test_soup_err())
    }
}

/// Email service whose inbox lookups are counted, so tests can assert when
/// the lazy extraction actually runs.
#[derive(Clone, Default)]
struct CountingEmailService {
    inbox_calls: Arc<AtomicUsize>,
}

fn test_email_err() -> EmailErr {
    EmailErr::RepoErr(anyhow::anyhow!("counting email service"))
}

impl EmailService for CountingEmailService {
    async fn get_email_thread_previews(
        &self,
        _req: GetEmailsRequest,
    ) -> Result<PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>, EmailErr>
    {
        Err(test_email_err())
    }

    async fn get_link_by_auth_id_and_macro_id(
        &self,
        _auth_id: &str,
        _macro_id: MacroUserIdStr<'_>,
    ) -> Result<Option<Link>, EmailErr> {
        Err(test_email_err())
    }

    async fn get_link_by_macro_id(
        &self,
        _macro_id: MacroUserIdStr<'_>,
    ) -> Result<Option<Link>, EmailErr> {
        Err(test_email_err())
    }

    async fn get_inboxes_for_macro_id(
        &self,
        _macro_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<Link>, EmailErr> {
        self.inbox_calls.fetch_add(1, Ordering::SeqCst);
        Ok(Vec::new())
    }

    async fn get_owned_link_for_thread(
        &self,
        _macro_id: MacroUserIdStr<'_>,
        _thread_id: Uuid,
    ) -> Result<Option<Link>, EmailErr> {
        Err(test_email_err())
    }

    async fn get_thread_with_messages(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _offset: i64,
        _limit: i64,
    ) -> Result<Option<Thread>, EmailErr> {
        Err(test_email_err())
    }

    async fn get_thread_parsed(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _offset: i64,
        _limit: i64,
    ) -> Result<Option<ParsedThread>, EmailErr> {
        Err(test_email_err())
    }

    async fn create_draft(
        &self,
        _link: &Link,
        _accessible_inboxes: &[Link],
        _input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        Err(test_email_err())
    }

    async fn send_message(
        &self,
        _link: &Link,
        _accessible_inboxes: &[Link],
        _input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        Err(test_email_err())
    }

    async fn list_labels(&self, _link: &Link) -> Result<Vec<LinkLabel>, EmailErr> {
        Err(test_email_err())
    }

    async fn update_thread_labels(
        &self,
        _access_token: &str,
        _link: &Link,
        _thread_id: Uuid,
        _label_id: Uuid,
        _add: bool,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        Err(test_email_err())
    }

    async fn update_thread_project(
        &self,
        _thread_receipt: EntityAccessReceipt<EditAccessLevel>,
        _project_receipt: Option<EntityAccessReceipt<EditAccessLevel>>,
    ) -> Result<Option<String>, EmailErr> {
        Err(test_email_err())
    }

    async fn upsert_email_filter(
        &self,
        _link: &Link,
        _input: UpsertEmailFilterInput,
    ) -> Result<EmailFilter, EmailErr> {
        Err(test_email_err())
    }

    async fn delete_email_filter(&self, _link: &Link, _filter_id: Uuid) -> Result<bool, EmailErr> {
        Err(test_email_err())
    }

    async fn list_email_filters(&self, _link: &Link) -> Result<Vec<EmailFilter>, EmailErr> {
        Err(test_email_err())
    }
}

/// Entity access service whose team lookups are counted. The user has no
/// team, so CRM-scoped queries are rejected after the (counted) lookup.
#[derive(Clone, Default)]
struct CountingEntityAccessService {
    team_calls: Arc<AtomicUsize>,
}

impl EntityAccessService for CountingEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Internal)
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid), AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        self.team_calls.fetch_add(1, Ordering::SeqCst);
        Ok(None)
    }
}

#[derive(Clone, Default)]
struct FakeAuthorizationService {
    authorization_calls: Arc<AtomicUsize>,
}

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        self.authorization_calls.fetch_add(1, Ordering::SeqCst);

        match jwt {
            "valid" => Ok(user_context(VALID_USER_ID)),
            "expired" => Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        self.authorization_calls.fetch_add(1, Ordering::SeqCst);

        if provided_key != VALID_INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(claims.user_id.map(|user_id| user_context(&user_id)))
    }
}

fn user_context(user_id: &str) -> UserContext {
    UserContext {
        user_id: user_id.to_owned(),
        fusion_user_id: "fusion-user-id".to_owned(),
        permissions: None,
        organization_id: None,
    }
}

#[derive(Clone)]
struct TestState {
    authorization: MacroAuthorizationState<FakeAuthorizationService>,
    email: EmailRouterState<CountingEmailService>,
    entity_access: Arc<CountingEntityAccessService>,
}

impl FromRef<TestState> for MacroAuthorizationState<FakeAuthorizationService> {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}

impl FromRef<TestState> for EmailRouterState<CountingEmailService> {
    fn from_ref(state: &TestState) -> Self {
        state.email.clone()
    }
}

impl FromRef<TestState> for Arc<CountingEntityAccessService> {
    fn from_ref(state: &TestState) -> Self {
        state.entity_access.clone()
    }
}

struct TestHarness {
    schema: SoupSchema<
        CountingSoupService,
        CountingEmailService,
        CountingEntityAccessService,
        FakeAuthorizationService,
        TestState,
        NoOpEntityPropertyWriter,
        NoOpSoupNotificationEdgeReader,
        NoOpEntityPropertyReader,
        NoOpSoupEmailContentEdgeReader,
    >,
    state: TestState,
    authorization_calls: Arc<AtomicUsize>,
    inbox_calls: Arc<AtomicUsize>,
    team_calls: Arc<AtomicUsize>,
    raw_soup_calls: Arc<AtomicUsize>,
    frecency_soup_calls: Arc<AtomicUsize>,
    grouped_soup_calls: Arc<AtomicUsize>,
}

fn harness() -> TestHarness {
    let email = CountingEmailService::default();
    let entity_access = CountingEntityAccessService::default();
    let authorization = FakeAuthorizationService::default();
    let soup = CountingSoupService::default();
    let authorization_calls = Arc::clone(&authorization.authorization_calls);
    let inbox_calls = Arc::clone(&email.inbox_calls);
    let team_calls = Arc::clone(&entity_access.team_calls);
    let raw_soup_calls = Arc::clone(&soup.raw_calls);
    let frecency_soup_calls = Arc::clone(&soup.frecency_calls);
    let grouped_soup_calls = Arc::clone(&soup.grouped_calls);
    TestHarness {
        schema: build_schema_with_service(soup),
        state: TestState {
            authorization: MacroAuthorizationState::new(Arc::new(authorization)),
            email: EmailRouterState::new(email),
            entity_access: Arc::new(entity_access),
        },
        authorization_calls,
        inbox_calls,
        team_calls,
        raw_soup_calls,
        frecency_soup_calls,
        grouped_soup_calls,
    }
}

fn authenticated_parts() -> axum::http::request::Parts {
    bearer_parts("valid")
}

fn bearer_parts(token: &str) -> axum::http::request::Parts {
    let request = HttpRequest::builder()
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(())
        .unwrap();
    request.into_parts().0
}

fn internal_parts(user_id: &str) -> axum::http::request::Parts {
    let request = HttpRequest::builder()
        .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
        .header(INTERNAL_MACRO_USER_ID_HEADER, user_id)
        .body(())
        .unwrap();
    request.into_parts().0
}

impl TestHarness {
    async fn execute(&self, query: &str) -> async_graphql::Response {
        self.execute_with_parts(query, authenticated_parts()).await
    }

    async fn execute_with_parts(
        &self,
        query: &str,
        parts: axum::http::request::Parts,
    ) -> async_graphql::Response {
        let request = async_graphql::Request::new(query)
            .data(GraphqlSoupRequestParts::new(parts))
            .data(self.state.clone());
        self.schema.execute(request).await
    }
}

#[tokio::test]
async fn user_id_resolves_without_touching_services() {
    let harness = harness();

    let response = harness.execute("{ user { id } }").await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.to_string(),
        r#"{user: {id: "macro|user@example.com"}}"#
    );
    assert_eq!(harness.authorization_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.frecency_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.grouped_soup_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn internal_authorization_uses_the_acting_user_claim() {
    let harness = harness();

    let response = harness
        .execute_with_parts("{ user { id } }", internal_parts(INTERNAL_USER_ID))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.to_string(),
        r#"{user: {id: "macro|internal@example.com"}}"#
    );
    assert_eq!(harness.authorization_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn soup_resolves_inboxes_but_skips_team_lookup_without_crm_scope() {
    let harness = harness();

    let _response = harness
        .execute("{ user { soup(input: {initial: {}}) { hasMore } } }")
        .await;

    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.frecency_soup_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn soup_input_rejects_initial_and_continuation_together() {
    let harness = harness();

    let response = harness
        .execute(
            r#"{ user { soup(input: {initial: {}, continuation: {cursor: "invalid"}}) { hasMore } } }"#,
        )
        .await;

    assert!(!response.errors.is_empty());
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.frecency_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn soup_requests_frecency_only_when_selected() {
    let harness = harness();

    let _response = harness
        .execute("{ user { soup(input: {initial: {}}) { items { frecencyScore } } } }")
        .await;

    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.frecency_soup_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn group_soup_nests_items_in_bins_and_reuses_cached_authorization() {
    let harness = harness();

    let response = harness
        .execute(
            "{ user { id groupSoup(input: {initial: {groupBy: {field: ENTITY_TYPE}}}) { bins { key totalCount nextCursor items { id entityType } } } } }",
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let bin = &data["user"]["groupSoup"]["bins"][0];
    assert_eq!(bin["key"], "document");
    assert_eq!(bin["totalCount"], 3);
    assert_eq!(harness.authorization_calls.load(Ordering::SeqCst), 1);
    let cursor = bin["nextCursor"].as_str().unwrap();
    assert_eq!(bin["items"].as_array().unwrap().len(), 2);

    let continuation = format!(
        "{{ user {{ groupSoup(input: {{continuation: {{groupBy: {{field: ENTITY_TYPE}}, groupKey: \"document\", cursor: \"{cursor}\"}}}}) {{ bins {{ key }} }} }} }}"
    );
    let response = harness.execute(&continuation).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);

    assert_eq!(harness.authorization_calls.load(Ordering::SeqCst), 2);
    assert_eq!(harness.grouped_soup_calls.load(Ordering::SeqCst), 2);
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn crm_scoped_soup_resolves_team_membership_lazily() {
    let harness = harness();

    // The membership/role authorization itself lives in the soup domain
    // and CRM service (covered by their tests); this asserts the GraphQL
    // layer resolves the team receipt only for CRM-scoped input.
    let response = harness
        .execute(
            r#"{ user { soup(input: {initial: {filters: {emailFilter: {crmScope: {domains: ["example.com"]}}}}}) { hasMore } } }"#,
        )
        .await;

    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.frecency_soup_calls.load(Ordering::SeqCst), 0);
    assert!(!response.errors.is_empty());
}

#[tokio::test]
async fn unauthenticated_request_fails_at_the_resolver() {
    let harness = harness();
    let parts = HttpRequest::new(()).into_parts().0;

    let response = harness.execute_with_parts("{ user { id } }", parts).await;

    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "authentication required");
    assert_eq!(harness.authorization_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.frecency_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.grouped_soup_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn invalid_credentials_return_the_safe_authorization_error() {
    let harness = harness();

    let response = harness
        .execute_with_parts("{ user { id } }", bearer_parts("invalid"))
        .await;

    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "unauthorized");
    assert_eq!(harness.authorization_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn expired_credentials_return_the_safe_authorization_error() {
    let harness = harness();

    let response = harness
        .execute_with_parts("{ user { id } }", bearer_parts("expired"))
        .await;

    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "jwt expired");
    assert_eq!(harness.authorization_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 0);
}
