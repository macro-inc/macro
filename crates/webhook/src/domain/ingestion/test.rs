use super::*;
use crate::domain::{
    events::{
        WebhookCreatedMetadata, WebhookDeletedMetadata, WebhookTopicEvent, WebhookUpdatedMetadata,
        WebhookValidatedMetadata,
    },
    models::{
        CreateWebhookOutcome, CreateWebhookRequest, PatchWebhookRequest, Webhook,
        WebhookEventQueueMessage, WebhookStatus,
    },
    ports::{WebhookEventEnqueuer, WebhookRepo, WebhookWorkspaceResolver},
};
use channel_sender::ChannelSender;
use channels::domain::{
    broker_events::{
        ChannelCreatedMetadata, ChannelDeletedMetadata, ChannelMentionedMetadata,
        ChannelMessageAttachmentCreatedMetadata, ChannelMessageAttachmentRemovedMetadata,
        ChannelMessageDeletedMetadata, ChannelMessagePatchedMetadata, ChannelMessagePostedMetadata,
        ChannelParticipantAddedMetadata, ChannelParticipantRemovedMetadata, ChannelUpdatedMetadata,
    },
    models::{ChannelType, SimpleMention},
};
use chrono::{DateTime, Utc};
use documents::domain::events::{
    DocumentContentUploadedMetadata, DocumentCopiedMetadata, DocumentCreatedMetadata,
    DocumentDeletedMetadata, DocumentPurgedMetadata, DocumentSyncContentUpdatedMetadata,
    DocumentUpdatedMetadata,
};
use entity_access::domain::models::{
    AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt, EntityPermission,
    RequiredPermission, TeamRole, UserTeamInfo,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

const DOCUMENT_ID: &str = "11111111-1111-1111-1111-111111111111";
const COPIED_DOCUMENT_ID: &str = "22222222-2222-2222-2222-222222222222";
const PERSONAL_WORKSPACE_ID: &str = "macro|reader@example.com";
const BOT_PRINCIPAL_ID: &str = "bot|66666666-6666-6666-6666-666666666666";
const TEAM_WORKSPACE_ID: &str = "33333333-3333-3333-3333-333333333333";

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().expect("test mutex is not poisoned")
}

fn user_id(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn sender(id: &str) -> ChannelSender<'static> {
    ChannelSender::try_from(id.to_string()).expect("valid channel sender")
}

fn timestamp() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
        .expect("valid timestamp")
        .with_timezone(&Utc)
}

#[derive(Debug, Clone, Copy)]
enum AccessFailure {
    Internal,
}

#[derive(Clone)]
struct MockAccessService {
    users: Vec<MacroUserIdStr<'static>>,
    failure: Option<AccessFailure>,
    calls: Arc<Mutex<Vec<(String, EntityType)>>>,
}

impl MockAccessService {
    fn with_users(users: Vec<MacroUserIdStr<'static>>) -> Self {
        Self {
            users,
            failure: None,
            calls: Arc::default(),
        }
    }
}

impl EntityAccessService for MockAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn get_users_by_entity(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        lock(&self.calls).push((entity_id.to_string(), entity_type));
        match self.failure {
            Some(AccessFailure::Internal) => Err(AccessError::internal("mock access failure")),
            None => Ok(self.users.clone()),
        }
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        unimplemented!("not used by webhook event ingestion")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MatchCall {
    workspace_ids: Vec<String>,
    event_name: String,
    entity_id: String,
}

struct MockRepositoryState {
    resolved_workspace_ids: Vec<String>,
    matching_webhooks: Vec<Webhook>,
    fail_workspace_resolution: bool,
    fail_matching: bool,
    workspace_calls: Vec<Vec<MacroUserIdStr<'static>>>,
    match_calls: Vec<MatchCall>,
}

#[derive(Clone)]
struct MockRepository {
    state: Arc<Mutex<MockRepositoryState>>,
}

impl MockRepository {
    fn new(resolved_workspace_ids: Vec<String>, matching_webhooks: Vec<Webhook>) -> Self {
        Self {
            state: Arc::new(Mutex::new(MockRepositoryState {
                resolved_workspace_ids,
                matching_webhooks,
                fail_workspace_resolution: false,
                fail_matching: false,
                workspace_calls: Vec::new(),
                match_calls: Vec::new(),
            })),
        }
    }
}

impl WebhookWorkspaceResolver for MockRepository {
    type Err = anyhow::Error;

    async fn resolve_workspace_ids(
        &self,
        people: Vec<MacroUserIdStr<'static>>,
    ) -> Result<Vec<String>, Self::Err> {
        let mut state = lock(&self.state);
        state.workspace_calls.push(people);
        if state.fail_workspace_resolution {
            anyhow::bail!("workspace resolver unavailable");
        }
        Ok(state.resolved_workspace_ids.clone())
    }

    async fn get_user_team_workspace_id(
        &self,
        _user_id: MacroUserIdStr<'static>,
    ) -> Result<Option<String>, Self::Err> {
        Ok(None)
    }
}

impl WebhookRepo for MockRepository {
    type Err = anyhow::Error;

    async fn create_webhook(
        &self,
        _created_by_user_id: MacroUserIdStr<'static>,
        _workspace_id: String,
        _request: CreateWebhookRequest,
        _signing_secret: String,
        _headers: Value,
    ) -> Result<CreateWebhookOutcome, Self::Err> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn get_webhook(&self, _webhook_id: String) -> Result<Option<Webhook>, Self::Err> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn list_webhooks_for_workspaces(
        &self,
        _workspace_ids: Vec<String>,
    ) -> Result<Vec<Webhook>, Self::Err> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn list_active_webhooks_matching_event(
        &self,
        workspace_ids: Vec<String>,
        event_name: String,
        entity_id: String,
    ) -> Result<Vec<Webhook>, Self::Err> {
        let mut state = lock(&self.state);
        state.match_calls.push(MatchCall {
            workspace_ids,
            event_name,
            entity_id,
        });
        if state.fail_matching {
            anyhow::bail!("webhook repository unavailable");
        }
        Ok(state.matching_webhooks.clone())
    }

    async fn patch_webhook(
        &self,
        _webhook_id: String,
        _request: PatchWebhookRequest,
    ) -> Result<Option<Webhook>, Self::Err> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn delete_webhook(&self, _webhook_id: String) -> Result<Option<Webhook>, Self::Err> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn set_webhook_validity(
        &self,
        _webhook_id: String,
        _is_valid: bool,
    ) -> Result<Option<Webhook>, Self::Err> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn get_user_team_workspace_id(
        &self,
        _user_id: MacroUserIdStr<'static>,
    ) -> Result<Option<String>, Self::Err> {
        unimplemented!("not used by webhook event ingestion")
    }
}

#[derive(Default)]
struct MockEnqueuerState {
    attempted_messages: Vec<WebhookEventQueueMessage>,
    completed_webhook_ids: Vec<String>,
    failing_webhook_id: Option<String>,
    delayed_webhook_id: Option<String>,
}

#[derive(Clone, Default)]
struct MockEnqueuer {
    state: Arc<Mutex<MockEnqueuerState>>,
}

impl WebhookEventEnqueuer for MockEnqueuer {
    type Err = anyhow::Error;

    async fn enqueue(&self, message: WebhookEventQueueMessage) -> Result<(), Self::Err> {
        let (should_fail, should_delay) = {
            let mut state = lock(&self.state);
            let should_fail = state.failing_webhook_id.as_ref() == Some(&message.webhook_id);
            let should_delay = state.delayed_webhook_id.as_ref() == Some(&message.webhook_id);
            state.attempted_messages.push(message.clone());
            (should_fail, should_delay)
        };

        if should_delay {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        lock(&self.state)
            .completed_webhook_ids
            .push(message.webhook_id.clone());

        if should_fail {
            anyhow::bail!("queue unavailable");
        }
        Ok(())
    }
}

type TestService =
    WebhookEventIngestionServiceImpl<MockAccessService, MockRepository, MockEnqueuer>;

fn service(
    access: MockAccessService,
    repository: MockRepository,
    enqueuer: MockEnqueuer,
) -> TestService {
    WebhookEventIngestionServiceImpl::new(Arc::new(access), repository, enqueuer)
}

fn webhook(id: &str, workspace_id: &str) -> Webhook {
    Webhook {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        namespace: id.to_string(),
        name: id.to_string(),
        endpoint_url: "https://example.com/webhook".to_string(),
        signing_secret: "not-queued".to_string(),
        headers: BTreeMap::from([("X-Custom".to_string(), "not-queued".to_string())]),
        status: WebhookStatus::Active,
        is_valid: true,
        created_by_user_id: PERSONAL_WORKSPACE_ID.to_string(),
        created_at: timestamp(),
        updated_at: timestamp(),
        deleted_at: None,
        filters: Vec::new(),
    }
}

#[derive(Clone)]
enum TestBrokerEvent {
    Document(Event<DocumentTopicEvent>),
    Channel(Event<ChannelTopicEvent>),
}

impl TestBrokerEvent {
    async fn ingest(&self, service: &TestService) -> Result<(), WebhookEventIngestionError> {
        match self {
            Self::Document(event) => service.ingest_document_event(event.clone()).await,
            Self::Channel(event) => service.ingest_channel_event(event.clone()).await,
        }
    }

    fn envelope(&self) -> Value {
        match self {
            Self::Document(event) => serde_json::to_value(event).expect("serializable event"),
            Self::Channel(event) => serde_json::to_value(event).expect("serializable event"),
        }
    }

    fn event_id(&self) -> Uuid {
        match self {
            Self::Document(event) => event.event_id,
            Self::Channel(event) => event.event_id,
        }
    }

    fn schema_version(&self) -> u8 {
        match self {
            Self::Document(event) => event.schema_version,
            Self::Channel(event) => event.schema_version,
        }
    }
}

struct EventCase {
    event: TestBrokerEvent,
    event_name: &'static str,
    entity_type: EntityType,
    normalized_entity_type: &'static str,
    entity_id: String,
}

impl EventCase {
    fn new(
        event: TestBrokerEvent,
        event_name: &'static str,
        entity_type: EntityType,
        normalized_entity_type: &'static str,
        entity_id: String,
    ) -> Self {
        Self {
            event,
            event_name,
            entity_type,
            normalized_entity_type,
            entity_id,
        }
    }
}

fn document_event_cases() -> Vec<EventCase> {
    vec![
        EventCase::new(
            TestBrokerEvent::Document(Event::with_schema_version(
                DocumentTopicEvent::Created(DocumentCreatedMetadata {
                    document_id: DOCUMENT_ID.to_string(),
                    owner: user_id("macro|owner@example.com"),
                    actor: None,
                    on_behalf_of: None,
                    document_name: "notes".to_string(),
                    file_type: None,
                    project_id: None,
                    sub_type: None,
                    created_at: Some(timestamp()),
                }),
                2,
            )),
            "document.created",
            EntityType::Document,
            DOCUMENT_ENTITY_TYPE,
            DOCUMENT_ID.to_string(),
        ),
        EventCase::new(
            TestBrokerEvent::Document(Event::with_schema_version(
                DocumentTopicEvent::Updated(DocumentUpdatedMetadata {
                    document_id: DOCUMENT_ID.to_string(),
                    owner: user_id("macro|owner@example.com"),
                    actor_user_id: Some(user_id("macro|editor@example.com")),
                    actor: None,
                    on_behalf_of: None,
                    document_name: Some("renamed".to_string()),
                    previous_project_id: None,
                    project_id: None,
                    file_type: None,
                    share_permission_updated: false,
                }),
                2,
            )),
            "document.updated",
            EntityType::Document,
            DOCUMENT_ENTITY_TYPE,
            DOCUMENT_ID.to_string(),
        ),
        EventCase::new(
            TestBrokerEvent::Document(Event::with_schema_version(
                DocumentTopicEvent::Deleted(DocumentDeletedMetadata {
                    document_id: DOCUMENT_ID.to_string(),
                    actor_user_id: Some(user_id("macro|owner@example.com")),
                    actor: None,
                    on_behalf_of: None,
                    project_id: None,
                }),
                2,
            )),
            "document.deleted",
            EntityType::Document,
            DOCUMENT_ENTITY_TYPE,
            DOCUMENT_ID.to_string(),
        ),
        EventCase::new(
            TestBrokerEvent::Document(Event::with_schema_version(
                DocumentTopicEvent::Copied(DocumentCopiedMetadata {
                    document_id: COPIED_DOCUMENT_ID.to_string(),
                    source_document_id: DOCUMENT_ID.to_string(),
                    source_version_id: None,
                    owner: user_id("macro|owner@example.com"),
                    document_name: "notes (copy)".to_string(),
                    file_type: None,
                    project_id: None,
                    sub_type: None,
                }),
                2,
            )),
            "document.copied",
            EntityType::Document,
            DOCUMENT_ENTITY_TYPE,
            COPIED_DOCUMENT_ID.to_string(),
        ),
    ]
}

fn search_only_document_event_cases() -> Vec<(&'static str, Event<DocumentTopicEvent>)> {
    vec![
        (
            "document.content_uploaded",
            Event::new(DocumentTopicEvent::ContentUploaded(
                DocumentContentUploadedMetadata {
                    document_id: DOCUMENT_ID.to_string(),
                    owner: user_id("macro|owner@example.com"),
                    file_type: "pdf".parse().expect("valid file type"),
                    document_version_id: Some("convert".to_string()),
                },
            )),
        ),
        (
            "document.sync_content_updated",
            Event::new(DocumentTopicEvent::SyncContentUpdated(
                DocumentSyncContentUpdatedMetadata {
                    document_id: DOCUMENT_ID.to_string(),
                    file_type: "md".parse().expect("valid file type"),
                    document_version_id: None,
                    actor: None,
                    on_behalf_of: None,
                },
            )),
        ),
        (
            "document.purged",
            Event::new(DocumentTopicEvent::Purged(DocumentPurgedMetadata {
                document_id: DOCUMENT_ID.to_string(),
            })),
        ),
    ]
}

fn channel_event_cases() -> Vec<EventCase> {
    let channel_id = Uuid::parse_str("44444444-4444-4444-4444-444444444444").unwrap();
    let message_id = Uuid::parse_str("55555555-5555-5555-5555-555555555555").unwrap();
    let owner = "macro|owner@example.com";
    let member = "macro|member@example.com";

    vec![
        EventCase::new(
            TestBrokerEvent::Channel(Event::with_schema_version(
                ChannelTopicEvent::Created(ChannelCreatedMetadata {
                    channel_id,
                    actor: sender(owner),
                    on_behalf_of: None,
                    channel_type: ChannelType::Team,
                    channel_name: Some("general".to_string()),
                    participant_user_ids: vec![user_id(owner)],
                }),
                3,
            )),
            "channel.created",
            EntityType::Channel,
            CHANNEL_ENTITY_TYPE,
            channel_id.to_string(),
        ),
        EventCase::new(
            TestBrokerEvent::Channel(Event::with_schema_version(
                ChannelTopicEvent::Updated(ChannelUpdatedMetadata {
                    channel_id,
                    actor: user_id(owner),
                    previous_name: Some("general".to_string()),
                    channel_name: Some("announcements".to_string()),
                }),
                3,
            )),
            "channel.updated",
            EntityType::Channel,
            CHANNEL_ENTITY_TYPE,
            channel_id.to_string(),
        ),
        EventCase::new(
            TestBrokerEvent::Channel(Event::with_schema_version(
                ChannelTopicEvent::Deleted(ChannelDeletedMetadata {
                    channel_id,
                    actor: sender(owner),
                }),
                3,
            )),
            "channel.deleted",
            EntityType::Channel,
            CHANNEL_ENTITY_TYPE,
            channel_id.to_string(),
        ),
        EventCase::new(
            TestBrokerEvent::Channel(Event::with_schema_version(
                ChannelTopicEvent::MessagePosted(ChannelMessagePostedMetadata {
                    channel_id,
                    message_id,
                    thread_id: None,
                    sender: sender(member),
                    triggered_by: None,
                    channel_type: ChannelType::Team,
                    content: "hello".to_string(),
                    mentions: vec![],
                    attachments: vec![],
                    created_at: timestamp(),
                }),
                3,
            )),
            "channel.message_posted",
            EntityType::Channel,
            CHANNEL_ENTITY_TYPE,
            channel_id.to_string(),
        ),
        EventCase::new(
            TestBrokerEvent::Channel(Event::with_schema_version(
                ChannelTopicEvent::MessagePatched(ChannelMessagePatchedMetadata {
                    channel_id,
                    message_id,
                    thread_id: None,
                    actor: sender(member),
                    content: "hello (edited)".to_string(),
                    edited_at: Some(timestamp()),
                    updated_at: timestamp(),
                }),
                3,
            )),
            "channel.message_patched",
            EntityType::Channel,
            CHANNEL_ENTITY_TYPE,
            channel_id.to_string(),
        ),
        EventCase::new(
            TestBrokerEvent::Channel(Event::with_schema_version(
                ChannelTopicEvent::MessageDeleted(ChannelMessageDeletedMetadata {
                    channel_id,
                    message_id,
                    thread_id: None,
                    actor: sender(member),
                    deleted_at: Some(timestamp()),
                }),
                3,
            )),
            "channel.message_deleted",
            EntityType::Channel,
            CHANNEL_ENTITY_TYPE,
            channel_id.to_string(),
        ),
        EventCase::new(
            TestBrokerEvent::Channel(Event::with_schema_version(
                ChannelTopicEvent::MessageAttachmentCreated(
                    ChannelMessageAttachmentCreatedMetadata {
                        channel_id,
                        message_id,
                        actor: sender(member),
                        attachments: vec![],
                    },
                ),
                3,
            )),
            "channel.message_attachment_created",
            EntityType::Channel,
            CHANNEL_ENTITY_TYPE,
            channel_id.to_string(),
        ),
        EventCase::new(
            TestBrokerEvent::Channel(Event::with_schema_version(
                ChannelTopicEvent::MessageAttachmentRemoved(
                    ChannelMessageAttachmentRemovedMetadata {
                        channel_id,
                        message_id,
                        actor: sender(member),
                        attachments: vec![],
                    },
                ),
                3,
            )),
            "channel.message_attachment_removed",
            EntityType::Channel,
            CHANNEL_ENTITY_TYPE,
            channel_id.to_string(),
        ),
        EventCase::new(
            TestBrokerEvent::Channel(Event::with_schema_version(
                ChannelTopicEvent::ParticipantAdded(ChannelParticipantAddedMetadata {
                    channel_id,
                    channel_type: ChannelType::Team,
                    added_by: sender(owner),
                    added_user_ids: vec![user_id(member)],
                }),
                3,
            )),
            "channel.participant_added",
            EntityType::Channel,
            CHANNEL_ENTITY_TYPE,
            channel_id.to_string(),
        ),
        EventCase::new(
            TestBrokerEvent::Channel(Event::with_schema_version(
                ChannelTopicEvent::ParticipantRemoved(ChannelParticipantRemovedMetadata {
                    channel_id,
                    channel_type: ChannelType::Team,
                    removed_by: user_id(owner),
                    removed_user_ids: vec![user_id(member)],
                }),
                3,
            )),
            "channel.participant_removed",
            EntityType::Channel,
            CHANNEL_ENTITY_TYPE,
            channel_id.to_string(),
        ),
        // Like every channel event, mentions match and resolve access on the
        // channel; the mentioned entity is payload for consumers to filter on.
        EventCase::new(
            TestBrokerEvent::Channel(Event::with_schema_version(
                ChannelTopicEvent::Mentioned(ChannelMentionedMetadata {
                    channel_id,
                    message_id,
                    thread_id: None,
                    sender: sender(member),
                    channel_type: ChannelType::Team,
                    content: "hello bot".to_string(),
                    mentioned: SimpleMention {
                        entity_type: "bot".to_string(),
                        entity_id: BOT_PRINCIPAL_ID.to_string(),
                    },
                    created_at: timestamp(),
                }),
                3,
            )),
            "channel.mentioned",
            EntityType::Channel,
            CHANNEL_ENTITY_TYPE,
            channel_id.to_string(),
        ),
    ]
}

struct WebhookEventCase {
    event: Event<WebhookTopicEvent>,
    event_name: &'static str,
    webhook_id: &'static str,
    workspace_id: &'static str,
}

fn webhook_event_cases() -> Vec<WebhookEventCase> {
    vec![
        WebhookEventCase {
            event: Event::with_event_id_and_schema_version(
                Uuid::parse_str("01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f").unwrap(),
                2,
                WebhookTopicEvent::Created(WebhookCreatedMetadata {
                    webhook_id: "wh_created".to_string(),
                    workspace_id: PERSONAL_WORKSPACE_ID.to_string(),
                    namespace: "created-webhook".to_string(),
                    created_by_user_id: user_id("macro|creator@example.com"),
                    name: "Created webhook".to_string(),
                    endpoint_url: "https://example.com/created".to_string(),
                    status: WebhookStatus::Active,
                    is_valid: false,
                    filters: vec![],
                    header_names: vec!["X-Customer".to_string()],
                    created_at: timestamp(),
                }),
            ),
            event_name: "webhook.created",
            webhook_id: "wh_created",
            workspace_id: PERSONAL_WORKSPACE_ID,
        },
        WebhookEventCase {
            event: Event::with_event_id_and_schema_version(
                Uuid::parse_str("01998a30-2b3c-7d4e-8f50-6b7c8d9e0f1a").unwrap(),
                3,
                WebhookTopicEvent::Updated(WebhookUpdatedMetadata {
                    webhook_id: "wh_updated".to_string(),
                    workspace_id: TEAM_WORKSPACE_ID.to_string(),
                    actor_user_id: user_id("macro|editor@example.com"),
                    name: Some("Updated webhook".to_string()),
                    endpoint_url: None,
                    filters: None,
                    headers_updated: true,
                    status: Some(WebhookStatus::Paused),
                    previous_status: Some(WebhookStatus::Active),
                    is_valid: false,
                    updated_at: timestamp(),
                }),
            ),
            event_name: "webhook.updated",
            webhook_id: "wh_updated",
            workspace_id: TEAM_WORKSPACE_ID,
        },
        WebhookEventCase {
            event: Event::with_event_id_and_schema_version(
                Uuid::parse_str("01998a30-3c4d-7e5f-8051-7c8d9e0f1a2b").unwrap(),
                4,
                WebhookTopicEvent::Deleted(WebhookDeletedMetadata {
                    webhook_id: "wh_deleted".to_string(),
                    workspace_id: PERSONAL_WORKSPACE_ID.to_string(),
                    actor_user_id: user_id("macro|deleter@example.com"),
                }),
            ),
            event_name: "webhook.deleted",
            webhook_id: "wh_deleted",
            workspace_id: PERSONAL_WORKSPACE_ID,
        },
        WebhookEventCase {
            event: Event::with_event_id_and_schema_version(
                Uuid::parse_str("01998a30-4d5e-7f60-8152-8d9e0f1a2b3c").unwrap(),
                5,
                WebhookTopicEvent::Validated(WebhookValidatedMetadata {
                    webhook_id: "wh_validated".to_string(),
                    workspace_id: TEAM_WORKSPACE_ID.to_string(),
                    actor_user_id: user_id("macro|validator@example.com"),
                    is_valid: true,
                    response_status: Some(204),
                    message: None,
                }),
            ),
            event_name: "webhook.validated",
            webhook_id: "wh_validated",
            workspace_id: TEAM_WORKSPACE_ID,
        },
    ]
}

#[tokio::test]
async fn normalizes_and_matches_all_fifteen_event_variants() {
    let event_cases = document_event_cases()
        .into_iter()
        .chain(channel_event_cases())
        .collect::<Vec<_>>();
    assert_eq!(event_cases.len(), 15);

    for event_case in event_cases {
        let access = MockAccessService::with_users(vec![user_id(PERSONAL_WORKSPACE_ID)]);
        let repository = MockRepository::new(
            vec![PERSONAL_WORKSPACE_ID.to_string()],
            vec![webhook("wh_match", PERSONAL_WORKSPACE_ID)],
        );
        let enqueuer = MockEnqueuer::default();
        let service = service(access.clone(), repository.clone(), enqueuer.clone());
        let expected_envelope = event_case.event.envelope();
        let before_ingestion = Utc::now();

        event_case
            .event
            .ingest(&service)
            .await
            .unwrap_or_else(|error| {
                panic!("{} should be ingested: {error}", event_case.event_name)
            });
        let after_ingestion = Utc::now();

        assert_eq!(
            lock(&access.calls).as_slice(),
            &[(event_case.entity_id.clone(), event_case.entity_type)],
            "entity access mapping for {}",
            event_case.event_name
        );
        let repository_state = lock(&repository.state);
        assert_eq!(
            repository_state.match_calls.as_slice(),
            &[MatchCall {
                workspace_ids: vec![PERSONAL_WORKSPACE_ID.to_string()],
                event_name: event_case.event_name.to_string(),
                entity_id: event_case.entity_id.clone(),
            }],
            "repository matching for {}",
            event_case.event_name
        );
        drop(repository_state);

        let enqueuer_state = lock(&enqueuer.state);
        assert_eq!(enqueuer_state.attempted_messages.len(), 1);
        let message = &enqueuer_state.attempted_messages[0];
        assert_eq!(message.webhook_id, "wh_match");
        assert_eq!(
            message.event.event_id,
            event_case.event.event_id().to_string()
        );
        assert_eq!(
            message.event.schema_version,
            event_case.event.schema_version()
        );
        assert_eq!(message.event.event_name, event_case.event_name);
        assert_eq!(message.event.entity_type, event_case.normalized_entity_type);
        assert_eq!(message.event.entity_id, event_case.entity_id);
        assert_eq!(message.event.ordering_key, event_case.entity_id);
        assert_eq!(message.event.broker_envelope, expected_envelope);
        assert_eq!(
            message.event.broker_envelope["event_type"],
            event_case.event_name
        );
        assert!(message.event.occurred_at >= before_ingestion);
        assert!(message.event.occurred_at <= after_ingestion);
    }
}

#[tokio::test]
async fn search_only_document_events_skip_webhook_delivery() {
    let access = MockAccessService {
        users: vec![user_id(PERSONAL_WORKSPACE_ID)],
        failure: Some(AccessFailure::Internal),
        calls: Arc::default(),
    };
    let repository = MockRepository::new(
        vec![PERSONAL_WORKSPACE_ID.to_string()],
        vec![webhook("wh_match", PERSONAL_WORKSPACE_ID)],
    );
    {
        let mut state = lock(&repository.state);
        state.fail_workspace_resolution = true;
        state.fail_matching = true;
    }
    let enqueuer = MockEnqueuer::default();
    let service = service(access.clone(), repository.clone(), enqueuer.clone());

    for (event_name, event) in search_only_document_event_cases() {
        assert!(
            normalized_document_event(&event)
                .unwrap_or_else(|error| panic!("{event_name} normalization failed: {error}"))
                .is_none(),
            "{event_name} should not normalize to a public webhook event"
        );
        service
            .ingest_document_event(event)
            .await
            .unwrap_or_else(|error| panic!("{event_name} ingestion failed: {error}"));
    }

    assert!(lock(&access.calls).is_empty());
    let repository_state = lock(&repository.state);
    assert!(repository_state.workspace_calls.is_empty());
    assert!(repository_state.match_calls.is_empty());
    assert!(lock(&enqueuer.state).attempted_messages.is_empty());
}

#[tokio::test]
async fn normalizes_all_webhook_variants_with_direct_workspace_ownership() {
    for event_case in webhook_event_cases() {
        let access = MockAccessService {
            users: vec![user_id("macro|unrelated@example.com")],
            failure: Some(AccessFailure::Internal),
            calls: Arc::default(),
        };
        let repository = MockRepository::new(
            vec!["workspace-that-must-not-be-used".to_string()],
            vec![webhook("wh_match", event_case.workspace_id)],
        );
        lock(&repository.state).fail_workspace_resolution = true;
        let enqueuer = MockEnqueuer::default();
        let service = service(access.clone(), repository.clone(), enqueuer.clone());
        let expected_envelope = serde_json::to_value(&event_case.event).unwrap();
        let before_ingestion = Utc::now();

        service
            .ingest_webhook_event(event_case.event.clone())
            .await
            .unwrap_or_else(|error| {
                panic!("{} should be ingested: {error}", event_case.event_name)
            });
        let after_ingestion = Utc::now();

        assert!(
            lock(&access.calls).is_empty(),
            "entity access must not be called for {}",
            event_case.event_name
        );
        let repository_state = lock(&repository.state);
        assert!(
            repository_state.workspace_calls.is_empty(),
            "workspace resolution must not be called for {}",
            event_case.event_name
        );
        assert_eq!(
            repository_state.match_calls,
            vec![MatchCall {
                workspace_ids: vec![event_case.workspace_id.to_string()],
                event_name: event_case.event_name.to_string(),
                entity_id: event_case.webhook_id.to_string(),
            }],
            "strict workspace matching for {}",
            event_case.event_name
        );
        drop(repository_state);

        let enqueuer_state = lock(&enqueuer.state);
        assert_eq!(enqueuer_state.attempted_messages.len(), 1);
        let message = &enqueuer_state.attempted_messages[0];
        assert_eq!(message.webhook_id, "wh_match");
        assert_eq!(
            message.event.event_id,
            event_case.event.event_id.to_string()
        );
        assert_eq!(
            message.event.schema_version,
            event_case.event.schema_version
        );
        assert_eq!(message.event.event_name, event_case.event_name);
        assert_eq!(message.event.entity_type, WEBHOOK_ENTITY_TYPE);
        assert_eq!(message.event.entity_id, event_case.webhook_id);
        assert_eq!(message.event.ordering_key, event_case.webhook_id);
        assert_eq!(message.event.broker_envelope, expected_envelope);
        assert_eq!(
            message.event.broker_envelope["event_type"],
            event_case.event_name
        );
        assert!(message.event.occurred_at >= before_ingestion);
        assert!(message.event.occurred_at <= after_ingestion);
    }
}

#[tokio::test]
async fn webhook_event_fans_out_complete_envelope_to_every_match() {
    let event_case = webhook_event_cases().remove(1);
    let expected_envelope = serde_json::to_value(&event_case.event).unwrap();
    let access = MockAccessService::with_users(Vec::new());
    let repository = MockRepository::new(
        Vec::new(),
        vec![
            webhook("wh_first_match", event_case.workspace_id),
            webhook("wh_second_match", event_case.workspace_id),
        ],
    );
    let enqueuer = MockEnqueuer::default();
    let service = service(access.clone(), repository.clone(), enqueuer.clone());

    service
        .ingest_webhook_event(event_case.event)
        .await
        .expect("webhook fan-out succeeds");

    assert!(lock(&access.calls).is_empty());
    let repository_state = lock(&repository.state);
    assert!(repository_state.workspace_calls.is_empty());
    assert_eq!(
        repository_state.match_calls,
        vec![MatchCall {
            workspace_ids: vec![TEAM_WORKSPACE_ID.to_string()],
            event_name: "webhook.updated".to_string(),
            entity_id: "wh_updated".to_string(),
        }]
    );
    drop(repository_state);

    let enqueuer_state = lock(&enqueuer.state);
    let mut webhook_ids = enqueuer_state
        .attempted_messages
        .iter()
        .map(|message| message.webhook_id.as_str())
        .collect::<Vec<_>>();
    webhook_ids.sort_unstable();
    assert_eq!(webhook_ids, vec!["wh_first_match", "wh_second_match"]);
    assert_eq!(enqueuer_state.completed_webhook_ids.len(), 2);
    for message in &enqueuer_state.attempted_messages {
        assert_eq!(message.event.broker_envelope, expected_envelope);
    }
}

#[tokio::test]
async fn malformed_webhook_ids_are_permanent_and_skip_all_resolution() {
    let access = MockAccessService::with_users(vec![user_id(PERSONAL_WORKSPACE_ID)]);
    let repository = MockRepository::new(
        vec![PERSONAL_WORKSPACE_ID.to_string()],
        vec![webhook("wh_match", PERSONAL_WORKSPACE_ID)],
    );
    let enqueuer = MockEnqueuer::default();
    let service = service(access.clone(), repository.clone(), enqueuer.clone());

    for invalid_id in ["", "webhook_without_prefix"] {
        let event = Event::new(WebhookTopicEvent::Deleted(WebhookDeletedMetadata {
            webhook_id: invalid_id.to_string(),
            workspace_id: PERSONAL_WORKSPACE_ID.to_string(),
            actor_user_id: user_id("macro|deleter@example.com"),
        }));

        let error = service
            .ingest_webhook_event(event)
            .await
            .expect_err("malformed webhook ids are rejected");

        assert!(matches!(
            &error,
            WebhookEventIngestionError::InvalidEntityId {
                entity_type: WEBHOOK_ENTITY_TYPE,
                entity_id,
            } if entity_id == invalid_id
        ));
        assert!(!error.is_transient());
    }

    assert!(lock(&access.calls).is_empty());
    let repository_state = lock(&repository.state);
    assert!(repository_state.workspace_calls.is_empty());
    assert!(repository_state.match_calls.is_empty());
    assert!(lock(&enqueuer.state).attempted_messages.is_empty());
}

#[tokio::test]
async fn no_accessors_resolves_no_workspaces_and_enqueues_nothing() {
    let access = MockAccessService::with_users(Vec::new());
    let repository = MockRepository::new(Vec::new(), Vec::new());
    let enqueuer = MockEnqueuer::default();
    let service = service(access, repository.clone(), enqueuer.clone());
    let event = document_event_cases().remove(0).event;

    event.ingest(&service).await.expect("no access is a no-op");

    let repository_state = lock(&repository.state);
    assert_eq!(repository_state.workspace_calls, vec![Vec::new()]);
    assert_eq!(
        repository_state.match_calls,
        vec![MatchCall {
            workspace_ids: Vec::new(),
            event_name: "document.created".to_string(),
            entity_id: DOCUMENT_ID.to_string(),
        }]
    );
    assert!(lock(&enqueuer.state).attempted_messages.is_empty());
}

#[tokio::test]
async fn no_matching_webhooks_enqueues_nothing_after_workspace_expansion() {
    let reader = user_id(PERSONAL_WORKSPACE_ID);
    let access = MockAccessService::with_users(vec![reader.clone()]);
    let repository = MockRepository::new(
        vec![
            PERSONAL_WORKSPACE_ID.to_string(),
            TEAM_WORKSPACE_ID.to_string(),
        ],
        Vec::new(),
    );
    let enqueuer = MockEnqueuer::default();
    let service = service(access, repository.clone(), enqueuer.clone());
    let event = document_event_cases().remove(0).event;

    event.ingest(&service).await.expect("no matches is a no-op");

    let repository_state = lock(&repository.state);
    assert_eq!(repository_state.workspace_calls, vec![vec![reader]]);
    assert_eq!(
        repository_state.match_calls[0].workspace_ids,
        vec![
            PERSONAL_WORKSPACE_ID.to_string(),
            TEAM_WORKSPACE_ID.to_string(),
        ]
    );
    assert!(lock(&enqueuer.state).attempted_messages.is_empty());
}

#[tokio::test]
async fn fans_out_exact_envelope_once_per_personal_and_team_webhook() {
    let event = document_event_cases().remove(3).event;
    let expected_envelope = event.envelope();
    let reader = user_id(PERSONAL_WORKSPACE_ID);
    let access = MockAccessService::with_users(vec![reader.clone()]);
    let repository = MockRepository::new(
        vec![
            PERSONAL_WORKSPACE_ID.to_string(),
            TEAM_WORKSPACE_ID.to_string(),
        ],
        vec![
            webhook("wh_personal", PERSONAL_WORKSPACE_ID),
            webhook("wh_team", TEAM_WORKSPACE_ID),
        ],
    );
    let enqueuer = MockEnqueuer::default();
    let service = service(access, repository.clone(), enqueuer.clone());

    event.ingest(&service).await.expect("fan-out succeeds");

    let repository_state = lock(&repository.state);
    assert_eq!(repository_state.workspace_calls, vec![vec![reader]]);
    assert_eq!(
        repository_state.match_calls,
        vec![MatchCall {
            workspace_ids: vec![
                PERSONAL_WORKSPACE_ID.to_string(),
                TEAM_WORKSPACE_ID.to_string(),
            ],
            event_name: "document.copied".to_string(),
            entity_id: COPIED_DOCUMENT_ID.to_string(),
        }]
    );
    drop(repository_state);

    let enqueuer_state = lock(&enqueuer.state);
    let mut webhook_ids = enqueuer_state
        .attempted_messages
        .iter()
        .map(|message| message.webhook_id.as_str())
        .collect::<Vec<_>>();
    webhook_ids.sort_unstable();
    assert_eq!(webhook_ids, vec!["wh_personal", "wh_team"]);
    for message in &enqueuer_state.attempted_messages {
        assert_eq!(message.event.broker_envelope, expected_envelope);
        assert_eq!(message.event.entity_id, COPIED_DOCUMENT_ID);
    }
}

#[tokio::test]
async fn enqueue_failure_is_transient_after_every_send_completes() {
    let access = MockAccessService::with_users(vec![user_id(PERSONAL_WORKSPACE_ID)]);
    let repository = MockRepository::new(
        vec![PERSONAL_WORKSPACE_ID.to_string()],
        vec![
            webhook("wh_fail", PERSONAL_WORKSPACE_ID),
            webhook("wh_slow", PERSONAL_WORKSPACE_ID),
        ],
    );
    let enqueuer = MockEnqueuer::default();
    {
        let mut state = lock(&enqueuer.state);
        state.failing_webhook_id = Some("wh_fail".to_string());
        state.delayed_webhook_id = Some("wh_slow".to_string());
    }
    let service = service(access, repository, enqueuer.clone());
    let event = document_event_cases().remove(0).event;

    let error = event
        .ingest(&service)
        .await
        .expect_err("one failed send fails ingestion");

    assert!(matches!(error, WebhookEventIngestionError::Enqueue(_)));
    assert!(error.is_transient());
    let mut completed_webhook_ids = lock(&enqueuer.state).completed_webhook_ids.clone();
    completed_webhook_ids.sort_unstable();
    assert_eq!(completed_webhook_ids, vec!["wh_fail", "wh_slow"]);
}

#[tokio::test]
async fn malformed_document_id_is_permanent_and_skips_access_resolution() {
    let access = MockAccessService::with_users(vec![user_id(PERSONAL_WORKSPACE_ID)]);
    let repository = MockRepository::new(Vec::new(), Vec::new());
    let enqueuer = MockEnqueuer::default();
    let service = service(access.clone(), repository, enqueuer);
    let event = Event::new(DocumentTopicEvent::Deleted(DocumentDeletedMetadata {
        document_id: "not-a-uuid".to_string(),
        actor_user_id: None,
        actor: None,
        on_behalf_of: None,
        project_id: None,
    }));

    let error = service
        .ingest_document_event(event)
        .await
        .expect_err("malformed ids are rejected");

    assert!(matches!(
        error,
        WebhookEventIngestionError::InvalidEntityId { .. }
    ));
    assert!(!error.is_transient());
    assert!(lock(&access.calls).is_empty());
}

#[test]
fn classifies_adapter_and_contract_errors() {
    let transient_db_error =
        WebhookEventIngestionError::EntityAccess(AccessError::from(sqlx::Error::PoolTimedOut));
    assert!(transient_db_error.is_transient());
    let permanent_db_error =
        WebhookEventIngestionError::EntityAccess(AccessError::from(sqlx::Error::RowNotFound));
    assert!(!permanent_db_error.is_transient());
    assert!(!WebhookEventIngestionError::EntityAccess(AccessError::internal("bug")).is_transient());
    assert!(!WebhookEventIngestionError::EntityAccess(AccessError::Unauthorized).is_transient());

    let serialization_error = serde_json::from_str::<Value>("{").expect_err("invalid json");
    assert!(!WebhookEventIngestionError::Serialization(serialization_error).is_transient());
    assert!(WebhookEventIngestionError::WorkspaceResolution(anyhow::anyhow!("db")).is_transient());
    assert!(WebhookEventIngestionError::Repository(anyhow::anyhow!("db")).is_transient());
    assert!(WebhookEventIngestionError::Enqueue(anyhow::anyhow!("queue")).is_transient());
}

#[tokio::test]
async fn entity_access_internal_error_is_not_transient() {
    let access = MockAccessService {
        users: Vec::new(),
        failure: Some(AccessFailure::Internal),
        calls: Arc::default(),
    };
    let repository = MockRepository::new(Vec::new(), Vec::new());
    let enqueuer = MockEnqueuer::default();
    let service = service(access, repository, enqueuer);
    let event = document_event_cases().remove(0).event;

    let error = event
        .ingest(&service)
        .await
        .expect_err("access adapter fails");

    assert!(matches!(
        error,
        WebhookEventIngestionError::EntityAccess(AccessError::Internal(_))
    ));
    assert!(!error.is_transient());
}

fn agent_trigger_new_event() -> Event<agent_trigger::domain::broker_events::AgentTriggerTopicEvent>
{
    use agent_trigger::domain::broker_events::{
        AgentBotMentionedEvent, AgentTriggerTopicEvent, NewAgentSessionEvent,
    };
    use channels::domain::broker_events::ChannelMessagePostedMetadata;
    use channels::domain::models::ChannelType;

    Event::new(AgentTriggerTopicEvent::New(
        NewAgentSessionEvent::TopLevelMentioned(AgentBotMentionedEvent {
            bot_id: bot_id::BotId::new_from_uuid(uuid::Uuid::from_u128(0xB07)),
            message: ChannelMessagePostedMetadata {
                channel_id: uuid::Uuid::from_u128(1),
                message_id: uuid::Uuid::from_u128(2),
                thread_id: None,
                sender: sender("macro|asker@example.com"),
                triggered_by: None,
                channel_type: ChannelType::Public,
                content: "fix the flaky test".to_owned(),
                mentions: vec![],
                attachments: vec![],
                created_at: timestamp(),
            },
        }),
    ))
}

fn agent_trigger_existing_event()
-> Event<agent_trigger::domain::broker_events::AgentTriggerTopicEvent> {
    use agent_trigger::domain::broker_events::{
        AgentTriggerTopicEvent, ChannelEventMetadata, ExistingAgentSessionEvent,
    };
    use channels::domain::broker_events::ChannelMessagePostedMetadata;
    use channels::domain::models::ChannelType;

    Event::new(AgentTriggerTopicEvent::Existing(
        ExistingAgentSessionEvent::Channel(ChannelEventMetadata {
            bot_id: bot_id::BotId::new_from_uuid(uuid::Uuid::from_u128(0xB07)),
            session_id: agent_session::domain::model::AgentSessionId::TEST_A,
            kind: agent_trigger::domain::broker_events::ChannelKind::MentionThread,
            message: ChannelMessagePostedMetadata {
                channel_id: uuid::Uuid::from_u128(1),
                message_id: uuid::Uuid::from_u128(2),
                thread_id: None,
                sender: sender("macro|asker@example.com"),
                triggered_by: None,
                channel_type: ChannelType::Public,
                content: "and now the other one".to_owned(),
                mentions: vec![],
                attachments: vec![],
                created_at: timestamp(),
            },
        }),
    ))
}

/// A follow-up on a session that exists asks the session, not the channel:
/// the session carries its own grants, so whatever channel a later message
/// landed in is incidental.
#[tokio::test]
async fn an_existing_session_trigger_is_gated_by_the_session() {
    let access = MockAccessService::with_users(vec![user_id(PERSONAL_WORKSPACE_ID)]);
    let repository = MockRepository::new(
        vec![PERSONAL_WORKSPACE_ID.to_string()],
        vec![webhook("wh_agent_feed", PERSONAL_WORKSPACE_ID)],
    );
    let service = service(access.clone(), repository.clone(), MockEnqueuer::default());

    service
        .ingest_agent_trigger_event(agent_trigger_existing_event())
        .await
        .expect("agent trigger events are ingested");

    assert_eq!(
        lock(&access.calls).as_slice(),
        &[(
            agent_session::domain::model::AgentSessionId::TEST_A.to_string(),
            EntityType::AgentSession
        )],
    );
}

#[tokio::test]
async fn agent_trigger_events_are_scoped_by_the_channel_but_named_by_the_bot() {
    let access = MockAccessService::with_users(vec![user_id(PERSONAL_WORKSPACE_ID)]);
    let repository = MockRepository::new(
        vec![PERSONAL_WORKSPACE_ID.to_string()],
        vec![webhook("wh_agent_feed", PERSONAL_WORKSPACE_ID)],
    );
    let enqueuer = MockEnqueuer::default();
    let service = service(access.clone(), repository.clone(), enqueuer.clone());
    let event = agent_trigger_new_event();

    service
        .ingest_agent_trigger_event(event.clone())
        .await
        .expect("agent trigger events are ingested");

    let bot_id = bot_id::BotId::new_from_uuid(uuid::Uuid::from_u128(0xB07)).to_string();
    // Who may see it is decided by the channel the mention sits in - the same
    // question a channel event asks - not by the bot.
    assert_eq!(
        lock(&access.calls).as_slice(),
        &[(uuid::Uuid::from_u128(1).to_string(), EntityType::Channel)],
    );
    let repository_state = lock(&repository.state);
    // ...but the entity matched on is the bot, so a filter's `ids` scopes a
    // subscriber to exactly one bot's triggers.
    assert_eq!(repository_state.match_calls.len(), 1);
    assert_eq!(repository_state.match_calls[0].entity_id, bot_id);
    assert_eq!(
        repository_state.match_calls[0].event_name,
        "agent_trigger.new"
    );
    assert_eq!(
        repository_state.match_calls[0].workspace_ids,
        vec![PERSONAL_WORKSPACE_ID.to_string()]
    );
    drop(repository_state);

    // The delivered body is the broker envelope, verbatim: exactly what the
    // daemon on the other end decodes.
    let enqueuer_state = lock(&enqueuer.state);
    assert_eq!(enqueuer_state.attempted_messages.len(), 1);
    let normalized = &enqueuer_state.attempted_messages[0].event;
    assert_eq!(normalized.event_name, "agent_trigger.new");
    assert_eq!(normalized.entity_type, "bot");
    assert_eq!(normalized.entity_id, bot_id);
    assert_eq!(normalized.ordering_key, bot_id);
    assert_eq!(
        normalized.broker_envelope,
        serde_json::to_value(&event).expect("a serializable envelope"),
    );
}
