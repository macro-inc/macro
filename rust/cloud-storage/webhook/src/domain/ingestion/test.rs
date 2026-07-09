use super::*;
use channel_sender::ChannelSender;
use channels::domain::models::ChannelType;
use chrono::{DateTime, Utc};
use entity_access::domain::models::{
    AccessLevel, CallChannelInfo, EntityAccessReceipt, EntityPermission, RequiredPermission,
    UserTeamInfo,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};

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

/// Mock access service: only [`EntityAccessService::get_users_by_entity`] is
/// exercised by the ingestion service.
#[derive(Clone)]
struct MockAccessService;

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
    ) -> Result<(EntityPermission, Uuid), AccessError> {
        unimplemented!("not used by webhook event ingestion")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Ok(vec![user_id("macro|reader@example.com")])
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

fn service() -> WebhookEventIngestionServiceImpl<MockAccessService> {
    WebhookEventIngestionServiceImpl::new(Arc::new(MockAccessService))
}

fn document_events() -> Vec<DocumentTopicEvent> {
    vec![
        DocumentTopicEvent::Created(DocumentCreatedMetadata {
            document_id: "doc_1".to_string(),
            owner: user_id("macro|owner@example.com"),
            document_name: "notes".to_string(),
            file_type: None,
            project_id: None,
            sub_type: None,
            created_at: Some(timestamp()),
        }),
        DocumentTopicEvent::Updated(DocumentUpdatedMetadata {
            document_id: "doc_1".to_string(),
            owner: user_id("macro|owner@example.com"),
            actor_user_id: Some(user_id("macro|editor@example.com")),
            document_name: Some("renamed".to_string()),
            previous_project_id: None,
            project_id: None,
            file_type: None,
            share_permission_updated: false,
        }),
        DocumentTopicEvent::Deleted(DocumentDeletedMetadata {
            document_id: "doc_1".to_string(),
            actor_user_id: Some(user_id("macro|owner@example.com")),
            project_id: None,
        }),
        DocumentTopicEvent::Copied(DocumentCopiedMetadata {
            document_id: "doc_2".to_string(),
            source_document_id: "doc_1".to_string(),
            source_version_id: None,
            owner: user_id("macro|owner@example.com"),
            document_name: "notes (copy)".to_string(),
            file_type: None,
            project_id: None,
            sub_type: None,
        }),
    ]
}

fn channel_events() -> Vec<ChannelTopicEvent> {
    let channel_id = Uuid::nil();
    let message_id = Uuid::nil();
    vec![
        ChannelTopicEvent::Created(ChannelCreatedMetadata {
            channel_id,
            actor: sender("macro|owner@example.com"),
            channel_type: ChannelType::Team,
            channel_name: Some("general".to_string()),
            participant_user_ids: vec![user_id("macro|owner@example.com")],
        }),
        ChannelTopicEvent::Updated(ChannelUpdatedMetadata {
            channel_id,
            actor: user_id("macro|owner@example.com"),
            previous_name: Some("general".to_string()),
            channel_name: Some("announcements".to_string()),
        }),
        ChannelTopicEvent::Deleted(ChannelDeletedMetadata {
            channel_id,
            actor: sender("macro|owner@example.com"),
        }),
        ChannelTopicEvent::MessagePosted(ChannelMessagePostedMetadata {
            channel_id,
            message_id,
            thread_id: None,
            sender: sender("macro|member@example.com"),
            triggered_by: None,
            channel_type: ChannelType::Team,
            content: "hello".to_string(),
            mentions: vec![],
            attachments: vec![],
            created_at: timestamp(),
        }),
        ChannelTopicEvent::MessagePatched(ChannelMessagePatchedMetadata {
            channel_id,
            message_id,
            thread_id: None,
            actor: sender("macro|member@example.com"),
            content: "hello (edited)".to_string(),
            edited_at: Some(timestamp()),
            updated_at: timestamp(),
        }),
        ChannelTopicEvent::MessageDeleted(ChannelMessageDeletedMetadata {
            channel_id,
            message_id,
            thread_id: None,
            actor: sender("macro|member@example.com"),
            deleted_at: Some(timestamp()),
        }),
        ChannelTopicEvent::MessageAttachmentCreated(ChannelMessageAttachmentCreatedMetadata {
            channel_id,
            message_id,
            actor: sender("macro|member@example.com"),
            attachments: vec![],
        }),
        ChannelTopicEvent::MessageAttachmentRemoved(ChannelMessageAttachmentRemovedMetadata {
            channel_id,
            message_id,
            actor: sender("macro|member@example.com"),
            attachments: vec![],
        }),
        ChannelTopicEvent::ParticipantAdded(ChannelParticipantAddedMetadata {
            channel_id,
            channel_type: ChannelType::Team,
            added_by: sender("macro|owner@example.com"),
            added_user_ids: vec![user_id("macro|member@example.com")],
        }),
        ChannelTopicEvent::ParticipantRemoved(ChannelParticipantRemovedMetadata {
            channel_id,
            channel_type: ChannelType::Team,
            removed_by: user_id("macro|owner@example.com"),
            removed_user_ids: vec![user_id("macro|member@example.com")],
        }),
    ]
}

#[tokio::test]
async fn ingests_every_document_event_variant() {
    let service = service();
    for event in document_events() {
        service
            .ingest_document_event(Event::new(event))
            .await
            .expect("stub handlers always succeed");
    }
}

#[tokio::test]
async fn ingests_every_channel_event_variant() {
    let service = service();
    for event in channel_events() {
        service
            .ingest_channel_event(Event::new(event))
            .await
            .expect("stub handlers always succeed");
    }
}

#[test]
fn classifies_transient_errors() {
    let database_error = WebhookEventIngestionError::EntityAccess(AccessError::DatabaseError(
        sqlx::Error::PoolTimedOut,
    ));
    assert!(database_error.is_transient());

    let unauthorized = WebhookEventIngestionError::EntityAccess(AccessError::Unauthorized);
    assert!(!unauthorized.is_transient());

    let internal = WebhookEventIngestionError::Internal(anyhow::anyhow!("adapter bug"));
    assert!(!internal.is_transient());
}

#[tokio::test]
async fn users_with_access_delegates_to_entity_access() {
    let users = service()
        .users_with_access("doc_1", EntityType::Document)
        .await
        .expect("mock resolves users");
    assert_eq!(users, vec![user_id("macro|reader@example.com")]);
}
