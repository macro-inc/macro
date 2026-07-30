use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::http::{Request as HttpRequest, header};
use email::domain::models::{
    CreateDraftInput, CreatedDraft, EmailErr, EmailFilter, EmailSyncStatus,
    EnrichedEmailThreadPreview, GetEmailsRequest, LabelListVisibility, LabelType, Link, LinkLabel,
    MessageListVisibility, ParsedMessage, ParsedThread, Thread, UpdateThreadLabelsResult,
    UpsertEmailFilterInput, UserEmailLink, UserEmailLinkSettings, UserProvider,
};
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EditAccessLevel,
    EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission, TeamRole, UserTeamInfo,
    ViewAccessLevel,
};
use graphql_common::GraphqlRequestParts;
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::{
    email::EmailStr,
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model_entity::EntityType as ModelEntityType;
use model_user::UserContext;
use models_pagination::{Paginated, PaginatedCursor, SimpleSortMethod};
use models_soup::{
    document::SoupDocument,
    email_thread::{SoupContact, SoupEmailThreadPreview, SoupEnrichedEmailThreadPreview},
    item::SoupItem,
};
use rootcause::Report;
use soup_realtime::domain::models::Patch;
use uuid::Uuid;

use super::*;

const VALID_USER_ID: &str = "macro|user@example.com";
const INTERNAL_USER_ID: &str = "macro|internal@example.com";
const VALID_INTERNAL_KEY: &str = "valid-internal-key";

#[derive(Clone)]
struct TestRealtimeSubscriptionService {
    receiver: Arc<Mutex<Option<tokio::sync::mpsc::Receiver<Patch<model_entity::Entity<'static>>>>>>,
    subscribed_user: Arc<Mutex<Option<MacroUserIdStr<'static>>>>,
}

impl SoupRealtimeSubscriptionService for TestRealtimeSubscriptionService {
    fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> tokio::sync::mpsc::Receiver<Patch<model_entity::Entity<'static>>> {
        *self.subscribed_user.lock().expect("subscribed user lock") = Some(user_id);
        self.receiver
            .lock()
            .expect("subscription receiver lock")
            .take()
            .expect("test subscription is opened once")
    }
}

#[derive(Clone, Default)]
struct CountingSoupService {
    raw_calls: Arc<AtomicUsize>,
    raw_team_receipts: Arc<AtomicUsize>,
    return_empty_raw: bool,
    raw_response: Arc<Mutex<Option<Vec<SoupItem<()>>>>>,
    frecency_calls: Arc<AtomicUsize>,
    frecency_team_receipts: Arc<AtomicUsize>,
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

impl CountingSoupService {
    fn set_raw_response(&self, items: Vec<SoupItem<()>>) {
        *self.raw_response.lock().expect("raw response lock") = Some(items);
    }
}

impl SoupService for CountingSoupService {
    async fn get_user_soup<T>(
        &self,
        _req: soup::domain::models::SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<entity_access::domain::models::MemberTeamRole>>,
    ) -> Result<soup::domain::ports::SoupOutput<T>, soup::domain::models::SoupErr>
    where
        soup::domain::models::SoupRequest<T>: soup::domain::models::IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        self.raw_calls.fetch_add(1, Ordering::SeqCst);
        if team_receipt.is_some() {
            self.raw_team_receipts.fetch_add(1, Ordering::SeqCst);
        }
        let raw_response = self.raw_response.lock().expect("raw response lock").clone();
        if self.return_empty_raw || raw_response.is_some() {
            let page: PaginatedCursor<SoupItem<()>, String, SimpleSortMethod, T> =
                Paginated::from_parts(raw_response.unwrap_or_default(), None);
            return Ok(soup::domain::ports::SoupOutput::Left(page));
        }
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
        team_receipt: Option<EntityAccessReceipt<entity_access::domain::models::MemberTeamRole>>,
    ) -> Result<
        soup::domain::ports::SoupOutput<T, soup::domain::models::EnrichedSoupItem>,
        soup::domain::models::SoupErr,
    >
    where
        soup::domain::models::SoupRequest<T>: soup::domain::models::IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        self.frecency_calls.fetch_add(1, Ordering::SeqCst);
        if team_receipt.is_some() {
            self.frecency_team_receipts.fetch_add(1, Ordering::SeqCst);
        }
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
    user_label_calls: Arc<AtomicUsize>,
    user_link_calls: Arc<AtomicUsize>,
    user_catalog_identities: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
    seen_mutation_calls: Arc<Mutex<Vec<(MacroUserIdStr<'static>, Uuid)>>>,
    label_mutation_calls: Arc<Mutex<Vec<(MacroUserIdStr<'static>, Uuid, Uuid, bool)>>>,
}

fn test_email_err() -> EmailErr {
    EmailErr::RepoErr(anyhow::anyhow!("counting email service"))
}

impl EmailUserService for CountingEmailService {
    async fn get_user_email_labels(
        &self,
        macro_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<LinkLabel>, EmailErr> {
        self.user_label_calls.fetch_add(1, Ordering::SeqCst);
        self.user_catalog_identities
            .lock()
            .expect("user catalog identities lock")
            .push(macro_id);
        Ok(vec![LinkLabel {
            id: Uuid::from_u128(501),
            link_id: Uuid::from_u128(502),
            provider_label_id: "Label_501".to_owned(),
            name: "Customers".to_owned(),
            created_at: Default::default(),
            message_list_visibility: MessageListVisibility::Show,
            label_list_visibility: LabelListVisibility::LabelShow,
            type_: LabelType::User,
        }])
    }

    async fn get_user_email_links(
        &self,
        macro_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<UserEmailLink>, EmailErr> {
        self.user_link_calls.fetch_add(1, Ordering::SeqCst);
        self.user_catalog_identities
            .lock()
            .expect("user catalog identities lock")
            .push(macro_id);
        Ok(vec![UserEmailLink {
            id: Uuid::from_u128(502),
            macro_id: MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
            email_address: EmailStr::try_from("inbox@example.com".to_owned()).unwrap(),
            photo_url: Some("https://example.com/inbox.png".to_owned()),
            provider: UserProvider::Gmail,
            is_sync_active: true,
            sync_status: EmailSyncStatus::UpToDate,
            needs_reauth: false,
            settings: UserEmailLinkSettings {
                signature_on_replies_forwards: true,
                signature: Some("<p>Regards</p>".to_owned()),
            },
            is_primary: true,
            created_at: Default::default(),
            updated_at: Default::default(),
        }])
    }
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
        _link: &Link,
        _thread_id: Uuid,
        _label_id: Uuid,
        _add: bool,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        Err(test_email_err())
    }

    async fn mark_thread_seen(
        &self,
        macro_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> Result<(), EmailErr> {
        self.seen_mutation_calls
            .lock()
            .expect("seen mutation calls lock")
            .push((macro_id, thread_id));
        Ok(())
    }

    async fn update_thread_labels_for_user(
        &self,
        macro_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
        label_id: Uuid,
        add: bool,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        self.label_mutation_calls
            .lock()
            .expect("label mutation calls lock")
            .push((macro_id, thread_id, label_id, add));
        Ok(UpdateThreadLabelsResult {
            successful_ids: Vec::new(),
            failed_ids: Vec::new(),
        })
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

#[derive(Clone, Default)]
struct RecordingEmailContentReader {
    calls: Arc<Mutex<Vec<Vec<graphql_email::EmailContentKey>>>>,
}

impl graphql_email::SoupEmailContentEdgeReader for RecordingEmailContentReader {
    async fn get_email_content(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        keys: Vec<graphql_email::EmailContentKey>,
    ) -> HashMap<graphql_email::EmailContentKey, graphql_email::EmailContentLoad> {
        self.calls
            .lock()
            .expect("email content calls lock")
            .push(keys.clone());
        keys.into_iter()
            .map(|key| {
                let thread_id = key.thread_id;
                (
                    key,
                    graphql_email::EmailContentLoad::Found(vec![parsed_message(thread_id)]),
                )
            })
            .collect()
    }
}

fn parsed_message(thread_id: Uuid) -> ParsedMessage {
    ParsedMessage {
        db_id: Uuid::from_u128(100),
        link_id: Uuid::from_u128(200),
        thread_db_id: thread_id,
        subject: Some("Direct thread subject".to_owned()),
        snippet: Some("Direct thread snippet".to_owned()),
        from: None,
        to: Vec::new(),
        cc: Vec::new(),
        bcc: Vec::new(),
        labels: Vec::new(),
        body_parsed: Some("Direct thread body".to_owned()),
        body_text: Some("Direct thread body".to_owned()),
        body_html_sanitized: None,
        body_macro: None,
        body_replyless: Some("Direct thread body".to_owned()),
        internal_date_ts: Some(Default::default()),
        sent_at: Some(Default::default()),
        is_read: true,
        is_starred: false,
        is_sent: false,
        is_draft: false,
        has_attachments: false,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

/// Entity access service whose team lookups are counted and return a team.
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
        _scope: BotAccessScope,
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
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
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
        Ok(Some(UserTeamInfo {
            team_id: Uuid::from_u128(42),
            role: TeamRole::Member,
        }))
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
        NoOpSoupRealtimeSubscriptionService,
        CountingEmailService,
        CountingEntityAccessService,
        FakeAuthorizationService,
        TestState,
        NoOpEntityPropertyWriter,
        UnavailableEntityMutationService,
        NoOpChannelActivityMutationService,
        NoOpNotificationMutationService,
        NoOpSoupNotificationEdgeReader,
        NoOpEntityPropertyReader,
        RecordingEmailContentReader,
        graphql_favorite::NoOpEntityFavoriteEdgeReader,
        graphql_permission::NoOpEntityPermissionEdgeReader,
    >,
    state: TestState,
    soup_service: CountingSoupService,
    email_service: CountingEmailService,
    email_content_reader: RecordingEmailContentReader,
    authorization_calls: Arc<AtomicUsize>,
    inbox_calls: Arc<AtomicUsize>,
    user_label_calls: Arc<AtomicUsize>,
    user_link_calls: Arc<AtomicUsize>,
    user_catalog_identities: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
    team_calls: Arc<AtomicUsize>,
    raw_soup_calls: Arc<AtomicUsize>,
    raw_soup_team_receipts: Arc<AtomicUsize>,
    frecency_soup_calls: Arc<AtomicUsize>,
    frecency_soup_team_receipts: Arc<AtomicUsize>,
    grouped_soup_calls: Arc<AtomicUsize>,
}

fn harness() -> TestHarness {
    let email = CountingEmailService::default();
    let entity_access = CountingEntityAccessService::default();
    let authorization = FakeAuthorizationService::default();
    let soup = CountingSoupService::default();
    let email_content_reader = RecordingEmailContentReader::default();
    let authorization_calls = Arc::clone(&authorization.authorization_calls);
    let inbox_calls = Arc::clone(&email.inbox_calls);
    let user_label_calls = Arc::clone(&email.user_label_calls);
    let user_link_calls = Arc::clone(&email.user_link_calls);
    let user_catalog_identities = Arc::clone(&email.user_catalog_identities);
    let team_calls = Arc::clone(&entity_access.team_calls);
    let raw_soup_calls = Arc::clone(&soup.raw_calls);
    let raw_soup_team_receipts = Arc::clone(&soup.raw_team_receipts);
    let frecency_soup_calls = Arc::clone(&soup.frecency_calls);
    let frecency_soup_team_receipts = Arc::clone(&soup.frecency_team_receipts);
    let grouped_soup_calls = Arc::clone(&soup.grouped_calls);
    TestHarness {
        schema: build_schema_with_service(soup.clone()),
        state: TestState {
            authorization: MacroAuthorizationState::new(Arc::new(authorization)),
            email: EmailRouterState::new(email.clone()),
            entity_access: Arc::new(entity_access),
        },
        soup_service: soup,
        email_service: email,
        email_content_reader,
        authorization_calls,
        inbox_calls,
        user_label_calls,
        user_link_calls,
        user_catalog_identities,
        team_calls,
        raw_soup_calls,
        raw_soup_team_receipts,
        frecency_soup_calls,
        frecency_soup_team_receipts,
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
        self.schema.execute(self.request(query, parts)).await
    }

    async fn execute_authenticated_mutation(&self, mutation: &str) -> async_graphql::Response {
        let user_id = MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap();
        self.schema
            .execute(self.request(mutation, authenticated_parts()).data(user_id))
            .await
    }

    fn request(&self, query: &str, parts: axum::http::request::Parts) -> async_graphql::Request {
        let user_id = MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap();
        async_graphql::Request::new(query)
            .data(GraphqlRequestParts::new(parts))
            .data(self.state.clone())
            .data(self.state.email.service())
            .data(graphql_soup::soup_item_loader(
                self.soup_service.clone(),
                Arc::new(self.email_service.clone()),
            ))
            .data(graphql_email::email_content_loader(
                user_id,
                self.email_content_reader.clone(),
            ))
    }
}

#[tokio::test]
async fn soup_updates_subscribes_as_the_authenticated_user() {
    use async_graphql::futures_util::{StreamExt as _, pin_mut};

    let user_id = MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap();
    let subscribed_user = Arc::new(Mutex::new(None));
    let (sender, receiver) = tokio::sync::mpsc::channel(2);
    let realtime = TestRealtimeSubscriptionService {
        receiver: Arc::new(Mutex::new(Some(receiver))),
        subscribed_user: Arc::clone(&subscribed_user),
    };
    let soup_service = CountingSoupService {
        return_empty_raw: true,
        ..Default::default()
    };
    let loader = graphql_soup::soup_item_loader(soup_service.clone(), Arc::new(NoOpEmailService));
    let schema: SoupSchema<
        CountingSoupService,
        TestRealtimeSubscriptionService,
        NoOpEmailService,
        NoOpEntityAccessService,
        SchemaOnlyAuthorizationService,
        SchemaOnlyState,
        NoOpEntityPropertyWriter,
        UnavailableEntityMutationService,
        NoOpChannelActivityMutationService,
        NoOpNotificationMutationService,
        NoOpSoupNotificationEdgeReader,
        NoOpEntityPropertyReader,
        NoOpSoupEmailContentEdgeReader,
        NoOpEntityFavoriteEdgeReader,
        NoOpEntityPermissionEdgeReader,
    > = build_schema_with_services(soup_service, realtime);
    let request = async_graphql::Request::new(
        "subscription { soupUpdates { __typename ... on SoupUpdated { item { id } } ... on GraphqlCacheDeletion { graphqlTypeName entityId } } }",
    )
    .data(user_id.clone())
    .data(loader);
    let responses = schema.execute_stream(request);
    pin_mut!(responses);

    let document_id = Uuid::from_u128(42);
    sender
        .send(Patch::Updated(
            ModelEntityType::Document.with_entity_string(document_id.to_string()),
        ))
        .await
        .expect("subscription remains open");
    sender
        .send(Patch::Deleted(
            ModelEntityType::Document.with_entity_string(document_id.to_string()),
        ))
        .await
        .expect("subscription remains open");
    let mut updates = Vec::new();
    while updates.len() < 2 {
        let response = responses.next().await.expect("subscription response");
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let data = response.data.into_json().expect("response data is JSON");
        updates.extend(
            data["soupUpdates"]
                .as_array()
                .expect("soupUpdates is a buffered list")
                .iter()
                .cloned(),
        );
    }

    assert_eq!(updates.len(), 2);
    assert_eq!(updates[0]["__typename"], "SoupUpdated");
    assert!(updates[0]["item"].is_null());
    assert_eq!(updates[1]["__typename"], "GraphqlCacheDeletion");
    assert_eq!(updates[1]["graphqlTypeName"], "GraphqlSoupDocument");
    assert_eq!(updates[1]["entityId"], document_id.to_string());
    assert_eq!(
        subscribed_user
            .lock()
            .expect("subscribed user lock")
            .as_ref(),
        Some(&user_id)
    );
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
    assert_eq!(harness.user_label_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.user_link_calls.load(Ordering::SeqCst), 0);
    assert!(
        harness
            .user_catalog_identities
            .lock()
            .expect("user catalog identities lock")
            .is_empty()
    );
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.frecency_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.grouped_soup_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn email_catalog_fields_use_the_authenticated_user_and_remain_direct_user_fields() {
    let harness = harness();

    let response = harness
        .execute(
            r#"{
                user {
                    emailLabels { __typename id linkId providerLabelId name }
                    emailLinks {
                        id macroId emailAddress photoUrl provider isSyncActive syncStatus
                        needsReauth settings { signatureOnRepliesForwards signature }
                        isPrimary createdAt updatedAt
                    }
                }
            }"#,
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let label = &data["user"]["emailLabels"][0];
    assert_eq!(label["__typename"], "GraphqlSoupEmailLabel");
    assert_eq!(label["linkId"], Uuid::from_u128(502).to_string());
    let link = &data["user"]["emailLinks"][0];
    assert_eq!(link["emailAddress"], "inbox@example.com");
    assert_eq!(link["syncStatus"], "UP_TO_DATE");
    assert_eq!(link["settings"]["signature"], "<p>Regards</p>");
    assert_eq!(harness.user_label_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.user_link_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        *harness
            .user_catalog_identities
            .lock()
            .expect("user catalog identities lock"),
        vec![
            MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
            MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
        ]
    );
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
async fn soup_passes_team_receipt_to_raw_path() {
    let harness = harness();

    let _response = harness
        .execute("{ user { soup(input: {initial: {}}) { nextCursor } } }")
        .await;

    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.raw_soup_team_receipts.load(Ordering::SeqCst), 1);
    assert_eq!(harness.frecency_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        harness.frecency_soup_team_receipts.load(Ordering::SeqCst),
        0
    );
}

#[tokio::test]
async fn soup_input_rejects_initial_and_continuation_together() {
    let harness = harness();

    let response = harness
        .execute(
            r#"{ user { soup(input: {initial: {}, continuation: {cursor: "invalid"}}) { nextCursor } } }"#,
        )
        .await;

    assert!(!response.errors.is_empty());
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.frecency_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn soup_passes_team_receipt_to_frecency_enriched_path() {
    let harness = harness();

    let _response = harness
        .execute("{ user { soup(input: {initial: {}}) { items { frecencyScore } } } }")
        .await;

    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.raw_soup_team_receipts.load(Ordering::SeqCst), 0);
    assert_eq!(harness.frecency_soup_calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        harness.frecency_soup_team_receipts.load(Ordering::SeqCst),
        1
    );
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.team_calls.load(Ordering::SeqCst), 1);
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
    // and CRM service (covered by their tests); this asserts CRM-scoped
    // input still receives the always-resolved team receipt.
    let response = harness
        .execute(
            r#"{ user { soup(input: {initial: {filters: {emailFilter: {crmScope: {domains: ["example.com"]}}}}}) { nextCursor } } }"#,
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

fn soup_email_thread(thread_id: Uuid) -> SoupItem<()> {
    soup_email_thread_with_read_status(thread_id, false)
}

fn soup_email_thread_with_read_status(thread_id: Uuid, is_read: bool) -> SoupItem<()> {
    SoupItem::EmailThread(SoupEnrichedEmailThreadPreview {
        thread: SoupEmailThreadPreview {
            id: thread_id,
            provider_id: Some("provider-thread".to_owned()),
            owner_id: MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
            inbox_visible: true,
            is_read,
            is_draft: false,
            is_important: true,
            name: Some("Direct thread".to_owned()),
            snippet: Some("Direct thread snippet".to_owned()),
            sender_email: Some("sender@example.com".to_owned()),
            sender_name: Some("Sender".to_owned()),
            sender_photo_url: None,
            sort_ts: Default::default(),
            created_at: Default::default(),
            updated_at: Default::default(),
            viewed_at: None,
            project_id: None,
        },
        attachments: Vec::new(),
        participants: vec![SoupContact {
            id: Uuid::from_u128(300),
            link_id: Uuid::from_u128(200),
            name: Some("Sender".to_owned()),
            email_address: Some("sender@example.com".to_owned()),
            sfs_photo_url: None,
        }],
        labels: Vec::new(),
        extra: (),
    })
}

#[tokio::test]
async fn email_thread_returns_the_canonical_soup_type_and_forwards_message_pagination() {
    let harness = harness();
    let thread_id = Uuid::from_u128(42);
    harness
        .soup_service
        .set_raw_response(vec![soup_email_thread(thread_id)]);

    let response = harness
        .execute(&format!(
            r#"{{ user {{ emailThread(input: {{threadId: "{thread_id}"}}) {{ __typename id linkId inboxVisible isRead messages(offset: 7, limit: 20) {{ id threadId bodyParsed }} }} }} }}"#
        ))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let thread = &data["user"]["emailThread"];
    assert_eq!(thread["__typename"], "GraphqlSoupEmailThread");
    assert_eq!(thread["id"], thread_id.to_string());
    assert_eq!(thread["linkId"], Uuid::from_u128(200).to_string());
    assert_eq!(thread["inboxVisible"], true);
    assert_eq!(thread["isRead"], false);
    assert_eq!(thread["messages"][0]["threadId"], thread_id.to_string());
    assert_eq!(thread["messages"][0]["bodyParsed"], "Direct thread body");
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        *harness
            .email_content_reader
            .calls
            .lock()
            .expect("email content calls lock"),
        vec![vec![graphql_email::EmailContentKey::page(thread_id, 7, 20)]]
    );
}

#[tokio::test]
async fn email_mutations_return_the_canonical_thread_for_normalized_cache_updates() {
    let harness = harness();
    let thread_id = Uuid::from_u128(44);
    let label_id = Uuid::from_u128(45);
    harness
        .soup_service
        .set_raw_response(vec![soup_email_thread_with_read_status(thread_id, true)]);

    let seen_response = harness
        .execute_authenticated_mutation(&format!(
            r#"mutation {{ markEmailThreadSeen(input: {{threadId: "{thread_id}"}}) {{ __typename id isRead }} }}"#
        ))
        .await;
    assert!(
        seen_response.errors.is_empty(),
        "{:?}",
        seen_response.errors
    );
    let seen_thread = &seen_response.data.into_json().unwrap()["markEmailThreadSeen"];
    assert_eq!(seen_thread["__typename"], "GraphqlSoupEmailThread");
    assert_eq!(seen_thread["id"], thread_id.to_string());
    assert_eq!(seen_thread["isRead"], true);

    let label_response = harness
        .execute_authenticated_mutation(&format!(
            r#"mutation {{ updateEmailThreadLabel(input: {{threadId: "{thread_id}", labelId: "{label_id}", value: true}}) {{ __typename id isRead }} }}"#
        ))
        .await;
    assert!(
        label_response.errors.is_empty(),
        "{:?}",
        label_response.errors
    );
    let label_thread = &label_response.data.into_json().unwrap()["updateEmailThreadLabel"];
    assert_eq!(label_thread["__typename"], "GraphqlSoupEmailThread");
    assert_eq!(label_thread["id"], thread_id.to_string());
    assert_eq!(label_thread["isRead"], true);

    let expected_user = MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap();
    assert_eq!(
        *harness
            .email_service
            .seen_mutation_calls
            .lock()
            .expect("seen mutation calls lock"),
        vec![(expected_user.clone(), thread_id)]
    );
    assert_eq!(
        *harness
            .email_service
            .label_mutation_calls
            .lock()
            .expect("label mutation calls lock"),
        vec![(expected_user, thread_id, label_id, true)]
    );
}

#[tokio::test]
async fn email_thread_returns_null_when_soup_cannot_load_the_thread() {
    let harness = harness();
    let thread_id = Uuid::from_u128(43);
    harness.soup_service.set_raw_response(Vec::new());

    let response = harness
        .execute(&format!(
            r#"{{ user {{ emailThread(input: {{threadId: "{thread_id}"}}) {{ id messages {{ id }} }} }} }}"#
        ))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert!(data["user"]["emailThread"].is_null());
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 1);
    assert!(
        harness
            .email_content_reader
            .calls
            .lock()
            .expect("email content calls lock")
            .is_empty()
    );
}

#[tokio::test]
async fn email_thread_rejects_an_invalid_thread_id_before_loading_soup() {
    let harness = harness();

    let response = harness
        .execute(r#"{ user { emailThread(input: {threadId: "not-a-uuid"}) { id } } }"#)
        .await;

    assert_eq!(response.errors.len(), 1);
    assert!(
        response.errors[0]
            .message
            .starts_with("invalid threadId UUID")
    );
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.inbox_calls.load(Ordering::SeqCst), 0);
}
