use std::sync::atomic::{AtomicUsize, Ordering};

use email::domain::models::{
    CreateDraftInput, CreatedDraft, EmailErr, EmailFilter, EnrichedEmailThreadPreview,
    GetEmailsRequest, Link, LinkLabel, ParsedThread, Thread, UpdateThreadLabelsResult,
    UpsertEmailFilterInput,
};
use entity_access::domain::models::{
    AccessError, AccessLevel, CallChannelInfo, EditAccessLevel, EntityAccessReceipt,
    EntityPermission, EntityType, RequiredPermission, UserTeamInfo, ViewAccessLevel,
};
use graphql_common::GraphqlSoupRequestParts;
use macro_authorization::testing::{
    FakeMacroAuthorizationService, bearer_request, test_user_context,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use models_pagination::{PaginatedCursor, SimpleSortMethod};
use uuid::Uuid;

use super::*;

const AUTHORIZATION_TOKEN: &str = "complete-graph-test-token";
const TEST_USER_ID: &str = "macro|user@example.com";

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

#[derive(Clone)]
struct TestState {
    email: EmailRouterState<CountingEmailService>,
    entity_access: Arc<CountingEntityAccessService>,
    authorization: SharedMacroAuthorizationService,
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

impl FromRef<TestState> for SharedMacroAuthorizationService {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}

struct TestHarness {
    schema: SoupSchema<
        NoOpSoupService,
        CountingEmailService,
        CountingEntityAccessService,
        TestState,
        NoOpEntityPropertyWriter,
        NoOpSoupNotificationEdgeReader,
        NoOpEntityPropertyReader,
    >,
    state: TestState,
    authorization: FakeMacroAuthorizationService,
    inbox_calls: Arc<AtomicUsize>,
    team_calls: Arc<AtomicUsize>,
}

fn harness() -> TestHarness {
    let email = CountingEmailService::default();
    let entity_access = CountingEntityAccessService::default();
    let authorization = FakeMacroAuthorizationService::always(test_user_context(TEST_USER_ID));
    let shared_authorization = SharedMacroAuthorizationService::new(authorization.clone());
    let inbox_calls = Arc::clone(&email.inbox_calls);
    let team_calls = Arc::clone(&entity_access.team_calls);
    TestHarness {
        schema: build_schema_with_service(NoOpSoupService),
        state: TestState {
            email: EmailRouterState::new(email, shared_authorization.clone()),
            entity_access: Arc::new(entity_access),
            authorization: shared_authorization,
        },
        authorization,
        inbox_calls,
        team_calls,
    }
}

fn authenticated_parts() -> axum::http::request::Parts {
    let request = bearer_request(axum::http::Request::new(()), AUTHORIZATION_TOKEN);
    let (parts, ()) = request.into_parts();
    parts
}

impl TestHarness {
    async fn execute(&self, query: &str) -> async_graphql::Response {
        let request = async_graphql::Request::new(query)
            .data(GraphqlSoupRequestParts::new(authenticated_parts()))
            .data(self.state.clone());
        self.schema.execute(request).await
    }
}

#[tokio::test]
async fn repeated_user_id_resolution_authorizes_once_without_touching_services() {
    let harness = harness();

    let response = harness.execute("{ user { id repeatedId: id } }").await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.to_string(),
        r#"{user: {id: "macro|user@example.com", repeatedId: "macro|user@example.com"}}"#
    );
    assert_eq!(
        harness.authorization.calls(),
        vec![AUTHORIZATION_TOKEN.to_owned()]
    );
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn soup_resolves_inboxes_but_skips_team_lookup_without_crm_scope() {
    let harness = harness();

    // The schema-only soup service errors, but the laziness assertions below
    // are about which lookups ran before the service call.
    let _response = harness
        .execute("{ user { soup(input: {}) { hasMore } } }")
        .await;

    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 1);
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
            r#"{ user { soup(input: {filters: {emailFilter: {crmScope: {domains: ["example.com"]}}}}) { hasMore } } }"#,
        )
        .await;

    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 1);
    assert!(!response.errors.is_empty());
}

#[tokio::test]
async fn unauthenticated_request_fails_at_the_resolver() {
    let harness = harness();
    let (parts, ()) = axum::http::Request::new(()).into_parts();

    let request = async_graphql::Request::new("{ user { id } }")
        .data(GraphqlSoupRequestParts::new(parts))
        .data(harness.state.clone());
    let response = harness.schema.execute(request).await;

    assert!(!response.errors.is_empty());
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 0);
}
