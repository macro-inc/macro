use std::sync::{Arc, Mutex};

use ::call::domain::events::{
    CallArchiveReason, CallRecordArchivedMetadata, CallRecordDeletedMetadata,
    CallRecordSummarizedMetadata, CallRecordUpdatedMetadata, CallRecordingReadyMetadata,
    CallStartedMetadata, CallTopicEvent,
};
use ::chat::domain::events::{
    ChatCopiedMetadata, ChatCreatedMetadata, ChatDeletedMetadata, ChatMessageDeletedMetadata,
    ChatMessageRole, ChatMessageSentMetadata, ChatPermanentlyDeletedMetadata, ChatRestoredMetadata,
    ChatTopicEvent, ChatUpdatedMetadata,
};
use ::email::domain::events::{
    EmailEventOrigin, EmailMacroEvent, EmailTopicEvent, LinkConnectedMetadata,
    LinkDisconnectReason, LinkDisconnectedMetadata, LinkReauthRequiredMetadata,
    MessageDeletedMetadata, MessageDraftSyncedMetadata, MessageReceivedMetadata,
    MessageSendCancelledMetadata, MessageSendQueuedMetadata, MessageSentMetadata, SendCancelReason,
    ThreadArchivedMetadata, ThreadBackfilledMetadata, ThreadLabelsUpdatedMetadata,
    ThreadProjectChangedMetadata, ThreadReadMetadata, ThreadSpamChangedMetadata,
    ThreadStarredMetadata, ThreadTrashedMetadata, ThreadsReindexReason,
    ThreadsReindexRequestedMetadata,
};
use calendar_events::domain::events::{
    CalendarEventMetadata, CalendarMacroEvent, CalendarTopicEvent,
};
use channels::domain::{
    broker_events::{
        ChannelCreatedMetadata, ChannelDeletedMetadata, ChannelParticipantAddedMetadata,
        ChannelParticipantRemovedMetadata, ChannelTopicEvent, ChannelUpdatedMetadata,
    },
    models::{ChannelSender, ChannelType},
};
use chrono::Utc;
use documents::domain::events::{
    DocumentContentUploadedMetadata, DocumentCopiedMetadata, DocumentCreatedMetadata,
    DocumentDeletedMetadata, DocumentInteractionMetadata, DocumentPurgedMetadata,
    DocumentSyncContentUpdatedMetadata, DocumentTopicEvent, DocumentUpdatedMetadata,
    EmailAttachmentsReleasedMetadata, InteractionReason,
};
use macro_event_broker::{Event, EventBrokerError, MacroEvent as _, MessageParts};
use macro_event_topics::{
    MacroCalendarTopic, MacroCallsTopic, MacroChannelsTopic, MacroChatsTopic, MacroDocumentsTopic,
    MacroEmailTopic, MacroProjectsTopic, MacroPropertiesTopic, Topic as _,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
use model_owner::Owner;
use models_properties::{
    DataType, EntityType, PropertyOwner, service::property_option::PropertyOptionValue,
};
use projects::domain::events::{
    ProjectCreatedMetadata, ProjectDeletedMetadata, ProjectPermanentlyDeletedMetadata,
    ProjectRestoredMetadata, ProjectTopicEvent, ProjectUpdatedMetadata, ProjectUploadedMetadata,
};
use properties::domain::events::{
    EntityPropertiesClearedMetadata, EntityPropertyDeletedMetadata, EntityPropertyUpdatedMetadata,
    PropertyCreatedMetadata, PropertyDeletedMetadata, PropertyOptionCreatedMetadata,
    PropertyOptionDeletedMetadata, PropertyOptionUpdatedMetadata, PropertyTopicEvent,
};
use uuid::Uuid;

use messages::domain::models::MessageParent;
use messages::outbound::broker::MessageTopicEvent;

use super::{
    call::{CallEventDescription, CallIndexAction, describe_call_event},
    channel::{ChannelEventDescription, ChannelIndexAction, describe_channel_event},
    chat::{ChatEventDescription, ChatIndexAction, describe_chat_event},
    document::{
        DocumentEventDescription, DocumentIndexAction, describe_document_event,
        stored_extractor_message, sync_extractor_message,
    },
    email::{EmailEventDescription, EmailIndexAction, describe_email_event},
    message::{MessageEventDescription, MessageIndexAction, describe_message_event},
    project::{
        ProjectEventDescription, ProjectIndexAction, collect_project_ids, describe_project_event,
    },
    property::{PropertyEventDescription, PropertyIndexAction, describe_property_event},
    *,
};

const CALL_ID: Uuid = Uuid::from_u128(1);
const CHANNEL_ID: Uuid = Uuid::from_u128(2);
const MESSAGE_ID: Uuid = Uuid::from_u128(3);
const CHAT_ID: &str = "chat-id";
const SECOND_CHAT_ID: &str = "second-chat-id";
const CHAT_MESSAGE_ID: &str = "chat-message-id";
const DOCUMENT_ID: &str = "document-id";
const SOURCE_DOCUMENT_ID: &str = "source-document-id";
const PROJECT_ID: &str = "project-root";
const CHILD_PROJECT_ID: &str = "project-child";
const PARENT_PROJECT_ID: &str = "project-parent";
const NEW_PARENT_PROJECT_ID: &str = "project-new-parent";
const PROPERTY_ENTITY_ID: &str = "property-entity-id";
const PROPERTY_DEFINITION_ID: Uuid = Uuid::from_u128(4);
const PROPERTY_OPTION_ID: Uuid = Uuid::from_u128(5);
const ENTITY_PROPERTY_ID: Uuid = Uuid::from_u128(6);
const EMAIL_LINK_ID: Uuid = Uuid::from_u128(7);
const EMAIL_THREAD_ID: Uuid = Uuid::from_u128(8);
const SECOND_EMAIL_THREAD_ID: Uuid = Uuid::from_u128(9);

struct TestMessage {
    topic: &'static str,
    key: Option<String>,
    payload: Option<Vec<u8>>,
}

impl MessageParts for TestMessage {
    fn key(&self) -> Option<&str> {
        self.key.as_deref()
    }

    fn payload(&self) -> Option<&[u8]> {
        self.payload.as_deref()
    }

    fn topic(&self) -> &str {
        self.topic
    }
}

fn channel_sender() -> ChannelSender<'static> {
    ChannelSender::try_from("macro|owner@example.com".to_string()).expect("valid channel sender")
}

/// Instruments whose measurements go nowhere.
fn unread_metrics() -> IndexMetrics {
    use opentelemetry::metrics::MeterProvider as _;
    IndexMetrics::new(&opentelemetry_sdk::metrics::SdkMeterProvider::default().meter("test"))
}

/// Builds a [`WorkerPool`] whose worker channels are captured as receivers.
fn test_pool(workers: usize, capacity: usize) -> (WorkerPool, Vec<mpsc::Receiver<ReceivedEvent>>) {
    let (senders, receivers) = (0..workers).map(|_| mpsc::channel(capacity)).unzip();
    (
        WorkerPool::new(senders, Arc::default(), unread_metrics()),
        receivers,
    )
}

fn received_thread_backfilled_event(thread_id: Uuid, offset: i64) -> ReceivedEvent {
    let event = DeclaredMacroEvent::EmailMacroEvent(EmailMacroEvent::new(
        EMAIL_LINK_ID.to_string(),
        EmailTopicEvent::ThreadBackfilled(ThreadBackfilledMetadata {
            link_id: EMAIL_LINK_ID,
            owner: user_id(),
            thread_id,
        }),
    ));
    attach_event_coordinates(
        Ok::<_, EventBrokerError>(event),
        0,
        offset,
        tracing::Span::none(),
    )
    .expect("attached event")
}

fn received_thread_reindex_event(thread_ids: Vec<Uuid>, offset: i64) -> ReceivedEvent {
    let event = DeclaredMacroEvent::EmailMacroEvent(EmailMacroEvent::new(
        EMAIL_LINK_ID.to_string(),
        EmailTopicEvent::ThreadsReindexRequested(ThreadsReindexRequestedMetadata {
            link_id: EMAIL_LINK_ID,
            owner: user_id(),
            thread_ids,
            reason: ThreadsReindexReason::ProviderChanged,
        }),
    ));
    attach_event_coordinates(
        Ok::<_, EventBrokerError>(event),
        0,
        offset,
        tracing::Span::none(),
    )
    .expect("attached event")
}

fn received_agent_session_event(session: Uuid, offset: i64) -> ReceivedEvent {
    use ::agent_session::domain::events::{AgentSessionLifecycleEvent, SessionRenamedMetadata};

    received_lifecycle_event(session, offset, |identity| {
        AgentSessionLifecycleEvent::Renamed(SessionRenamedMetadata { identity })
    })
}

fn received_lifecycle_event(
    session: Uuid,
    offset: i64,
    event: impl FnOnce(
        ::agent_session::domain::events::SessionIdentity,
    ) -> ::agent_session::domain::events::AgentSessionLifecycleEvent,
) -> ReceivedEvent {
    attach_event_coordinates(
        DeclaredMacroEvent::decode(&lifecycle_message(session, event)),
        0,
        offset,
        tracing::Span::none(),
    )
    .expect("decodable agent-session event")
}

fn lifecycle_message(
    session: Uuid,
    event: impl FnOnce(
        ::agent_session::domain::events::SessionIdentity,
    ) -> ::agent_session::domain::events::AgentSessionLifecycleEvent,
) -> TestMessage {
    use ::agent_session::domain::{
        events::SessionIdentity,
        model::{AgentSessionId, SessionSource},
    };
    use macro_event_topics::MacroAgentSessionLifecycleTopic;

    let id = AgentSessionId::new_from_uuid(session);
    let event = event(SessionIdentity {
        session_id: id,
        session_name: "Indexed session".into(),
        bot_id: serde_json::from_value(serde_json::json!(Uuid::from_u128(2))).unwrap(),
        bot_name: "Agent".into(),
        owner_id: user_id(),
        origin: None,
        audience: vec![],
        source: SessionSource::User,
    });
    encoded_message(
        MacroAgentSessionLifecycleTopic::TOPIC_STR,
        id,
        Event::new(event),
    )
}

const AGENT_SESSION_ID: Uuid = Uuid::from_u128(10);
const SECOND_AGENT_SESSION_ID: Uuid = Uuid::from_u128(11);
/// Long enough that a handoff blocked on a full channel fails the test
/// instead of hanging it; paused time makes the wait instant.
const BLOCKED_HANDOFF_TIMEOUT: Duration = Duration::from_secs(60);

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).expect("valid user id")
}

fn started_event() -> CallTopicEvent {
    CallTopicEvent::Started(CallStartedMetadata {
        call_id: CALL_ID,
        channel_id: Some(CHANNEL_ID),
        created_by: user_id(),
        created_at: Utc::now(),
        recording_enabled: true,
    })
}

fn archived_event() -> CallTopicEvent {
    CallTopicEvent::RecordArchived(CallRecordArchivedMetadata {
        channel_thread: false,
        call_id: CALL_ID,
        channel_id: Some(CHANNEL_ID),
        created_by: user_id(),
        started_at: Utc::now(),
        ended_at: Utc::now(),
        duration_ms: Some(1_000),
        participant_count: 1,
        participants: vec![user_id()],
        has_recording: true,
        archive_reason: CallArchiveReason::LastParticipantLeft,
    })
}

fn updated_event() -> CallTopicEvent {
    CallTopicEvent::RecordUpdated(CallRecordUpdatedMetadata {
        call_id: CALL_ID,
        channel_id: Some(CHANNEL_ID),
        actor_user_id: Some(user_id()),
        custom_name: Some("Renamed call".to_string()),
        share_with_team: None,
    })
}

fn deleted_event() -> CallTopicEvent {
    CallTopicEvent::RecordDeleted(CallRecordDeletedMetadata {
        call_id: CALL_ID,
        channel_id: Some(CHANNEL_ID),
        actor_user_id: Some(user_id()),
    })
}

fn summarized_event() -> CallTopicEvent {
    CallTopicEvent::RecordSummarized(CallRecordSummarizedMetadata {
        call_id: CALL_ID,
        channel_id: Some(CHANNEL_ID),
        ai_name_generated: true,
    })
}

fn recording_ready_event() -> CallTopicEvent {
    CallTopicEvent::RecordingReady(CallRecordingReadyMetadata {
        call_id: CALL_ID,
        channel_id: Some(CHANNEL_ID),
    })
}

fn encoded_message<E: serde::Serialize>(
    topic: &'static str,
    key: impl ToString,
    event: Event<E>,
) -> TestMessage {
    TestMessage {
        topic,
        key: Some(key.to_string()),
        payload: Some(serde_json::to_vec(&event).expect("serializable broker event")),
    }
}

fn received_email_event(is_spam_or_trash: bool) -> EmailTopicEvent {
    EmailTopicEvent::MessageReceived(MessageReceivedMetadata {
        link_id: EMAIL_LINK_ID,
        owner: user_id(),
        message_id: MESSAGE_ID,
        provider_message_id: "provider-message-id".to_string(),
        thread_id: EMAIL_THREAD_ID,
        provider_thread_id: "provider-thread-id".to_string(),
        is_new_thread: true,
        subject: Some("Subject".to_string()),
        from_email: Some("sender@example.com".to_string()),
        from_name: Some("Sender".to_string()),
        to_emails: vec!["owner@example.com".to_string()],
        attachment_count: 1,
        is_spam_or_trash,
        received_at: Some(Utc::now()),
    })
}

fn draft_email_event(is_spam_or_trash: bool) -> EmailTopicEvent {
    EmailTopicEvent::MessageDraftSynced(MessageDraftSyncedMetadata {
        link_id: EMAIL_LINK_ID,
        owner: user_id(),
        message_id: MESSAGE_ID,
        provider_message_id: "provider-message-id".to_string(),
        thread_id: EMAIL_THREAD_ID,
        provider_thread_id: "provider-thread-id".to_string(),
        is_spam_or_trash,
    })
}

fn email_event_cases() -> Vec<(EmailTopicEvent, EmailEventDescription)> {
    let owner = "macro|owner@example.com".to_string();

    vec![
        (
            EmailTopicEvent::LinkConnected(LinkConnectedMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                email_address: "owner@example.com".to_string(),
                provider: "GMAIL".to_string(),
                is_primary: true,
                connected_at: Utc::now(),
            }),
            EmailEventDescription {
                action: EmailIndexAction::Ignore,
                link_id: EMAIL_LINK_ID,
                event_type: "email.link_connected",
            },
        ),
        (
            EmailTopicEvent::LinkDisconnected(LinkDisconnectedMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                email_address: "owner@example.com".to_string(),
                reason: LinkDisconnectReason::ManuallyDisabled,
            }),
            EmailEventDescription {
                action: EmailIndexAction::RemoveLink {
                    link_id: EMAIL_LINK_ID,
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.link_disconnected",
            },
        ),
        (
            EmailTopicEvent::LinkReauthRequired(LinkReauthRequiredMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                email_address: "owner@example.com".to_string(),
                observed_at: Utc::now(),
            }),
            EmailEventDescription {
                action: EmailIndexAction::Ignore,
                link_id: EMAIL_LINK_ID,
                event_type: "email.link_reauth_required",
            },
        ),
        (
            received_email_event(false),
            EmailEventDescription {
                action: EmailIndexAction::UpsertMessage {
                    message_id: MESSAGE_ID,
                    owner: owner.clone(),
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.message_received",
            },
        ),
        (
            draft_email_event(true),
            EmailEventDescription {
                action: EmailIndexAction::RemoveMessage {
                    message_id: MESSAGE_ID,
                    thread_id: EMAIL_THREAD_ID,
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.message_draft_synced",
            },
        ),
        (
            EmailTopicEvent::MessageSent(MessageSentMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                actor: Some(user_id()),
                message_id: MESSAGE_ID,
                provider_message_id: "provider-message-id".to_string(),
                thread_id: EMAIL_THREAD_ID,
                provider_thread_id: "provider-thread-id".to_string(),
                subject: Some("Subject".to_string()),
                to_emails: vec!["recipient@example.com".to_string()],
                cc_emails: vec![],
                origin: EmailEventOrigin::UserAction,
                sent_at: Utc::now(),
            }),
            EmailEventDescription {
                action: EmailIndexAction::UpsertSentMessage {
                    message_id: MESSAGE_ID,
                    owner: owner.clone(),
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.message_sent",
            },
        ),
        (
            EmailTopicEvent::MessageSent(MessageSentMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                actor: None,
                message_id: MESSAGE_ID,
                provider_message_id: "provider-message-id".to_string(),
                thread_id: EMAIL_THREAD_ID,
                provider_thread_id: "provider-thread-id".to_string(),
                subject: Some("Subject".to_string()),
                to_emails: vec!["recipient@example.com".to_string()],
                cc_emails: vec![],
                origin: EmailEventOrigin::ProviderSync,
                sent_at: Utc::now(),
            }),
            EmailEventDescription {
                action: EmailIndexAction::UpsertMessage {
                    message_id: MESSAGE_ID,
                    owner: owner.clone(),
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.message_sent",
            },
        ),
        (
            EmailTopicEvent::MessageDeleted(MessageDeletedMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                message_id: MESSAGE_ID,
                provider_message_id: "provider-message-id".to_string(),
                thread_id: EMAIL_THREAD_ID,
            }),
            EmailEventDescription {
                action: EmailIndexAction::RemoveMessage {
                    message_id: MESSAGE_ID,
                    thread_id: EMAIL_THREAD_ID,
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.message_deleted",
            },
        ),
        (
            EmailTopicEvent::MessageSendQueued(MessageSendQueuedMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                actor: Some(user_id()),
                message_id: MESSAGE_ID,
                thread_id: EMAIL_THREAD_ID,
                scheduled_send_at: Utc::now(),
                is_scheduled: false,
            }),
            EmailEventDescription {
                action: EmailIndexAction::Ignore,
                link_id: EMAIL_LINK_ID,
                event_type: "email.message_send_queued",
            },
        ),
        (
            EmailTopicEvent::MessageSendCancelled(MessageSendCancelledMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                actor: Some(user_id()),
                message_id: MESSAGE_ID,
                thread_id: EMAIL_THREAD_ID,
                reason: SendCancelReason::Undo,
            }),
            EmailEventDescription {
                action: EmailIndexAction::Ignore,
                link_id: EMAIL_LINK_ID,
                event_type: "email.message_send_cancelled",
            },
        ),
        (
            EmailTopicEvent::ThreadArchived(ThreadArchivedMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                actor: Some(user_id()),
                thread_id: EMAIL_THREAD_ID,
                archived: true,
                origin: EmailEventOrigin::UserAction,
            }),
            EmailEventDescription {
                action: EmailIndexAction::ReindexThread {
                    thread_id: EMAIL_THREAD_ID,
                    owner: owner.clone(),
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.thread_archived",
            },
        ),
        (
            EmailTopicEvent::ThreadTrashed(ThreadTrashedMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                actor: None,
                thread_id: EMAIL_THREAD_ID,
                trashed: true,
                origin: EmailEventOrigin::ProviderSync,
            }),
            EmailEventDescription {
                action: EmailIndexAction::ReindexThread {
                    thread_id: EMAIL_THREAD_ID,
                    owner: owner.clone(),
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.thread_trashed",
            },
        ),
        (
            EmailTopicEvent::ThreadRead(ThreadReadMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                actor: None,
                thread_id: EMAIL_THREAD_ID,
                is_read: true,
                origin: EmailEventOrigin::ProviderSync,
            }),
            EmailEventDescription {
                action: EmailIndexAction::ReindexThread {
                    thread_id: EMAIL_THREAD_ID,
                    owner: owner.clone(),
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.thread_read",
            },
        ),
        (
            EmailTopicEvent::ThreadStarred(ThreadStarredMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                actor: None,
                thread_id: EMAIL_THREAD_ID,
                starred: true,
                origin: EmailEventOrigin::ProviderSync,
            }),
            EmailEventDescription {
                action: EmailIndexAction::ReindexThread {
                    thread_id: EMAIL_THREAD_ID,
                    owner: owner.clone(),
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.thread_starred",
            },
        ),
        (
            EmailTopicEvent::ThreadSpamChanged(ThreadSpamChangedMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                actor: None,
                thread_id: EMAIL_THREAD_ID,
                spam: true,
                origin: EmailEventOrigin::ProviderSync,
            }),
            EmailEventDescription {
                action: EmailIndexAction::ReindexThread {
                    thread_id: EMAIL_THREAD_ID,
                    owner: owner.clone(),
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.thread_spam_changed",
            },
        ),
        (
            EmailTopicEvent::ThreadProjectChanged(ThreadProjectChangedMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                actor: user_id(),
                thread_id: EMAIL_THREAD_ID,
                previous_project_id: Some("old-project".to_string()),
                project_id: Some("new-project".to_string()),
            }),
            EmailEventDescription {
                action: EmailIndexAction::Ignore,
                link_id: EMAIL_LINK_ID,
                event_type: "email.thread_project_changed",
            },
        ),
        (
            EmailTopicEvent::ThreadLabelsUpdated(ThreadLabelsUpdatedMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                actor: None,
                thread_id: EMAIL_THREAD_ID,
                added: vec![],
                removed: vec![],
                origin: EmailEventOrigin::ProviderSync,
            }),
            EmailEventDescription {
                action: EmailIndexAction::ReindexThread {
                    thread_id: EMAIL_THREAD_ID,
                    owner: owner.clone(),
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.thread_labels_updated",
            },
        ),
        (
            EmailTopicEvent::ThreadBackfilled(ThreadBackfilledMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                thread_id: EMAIL_THREAD_ID,
            }),
            EmailEventDescription {
                action: EmailIndexAction::ReindexThread {
                    thread_id: EMAIL_THREAD_ID,
                    owner: owner.clone(),
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.thread_backfilled",
            },
        ),
        (
            EmailTopicEvent::ThreadsReindexRequested(ThreadsReindexRequestedMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                thread_ids: vec![EMAIL_THREAD_ID, SECOND_EMAIL_THREAD_ID],
                reason: ThreadsReindexReason::ContactsChanged,
            }),
            EmailEventDescription {
                action: EmailIndexAction::ReindexThreads {
                    thread_ids: vec![EMAIL_THREAD_ID, SECOND_EMAIL_THREAD_ID],
                    owner,
                },
                link_id: EMAIL_LINK_ID,
                event_type: "email.threads_reindex_requested",
            },
        ),
    ]
}

fn chat_event_cases() -> Vec<(ChatTopicEvent, ChatEventDescription<'static>)> {
    let owner = user_id();

    vec![
        (
            ChatTopicEvent::Created(ChatCreatedMetadata {
                chat_id: CHAT_ID.to_string(),
                owner: Owner::User(owner.clone()),
                name: "Chat".to_string(),
                project_id: Some(PROJECT_ID.to_string()),
            }),
            ChatEventDescription {
                action: ChatIndexAction::Ignore,
                chat_id: CHAT_ID,
                event_type: "chat.created",
            },
        ),
        (
            ChatTopicEvent::Updated(ChatUpdatedMetadata {
                chat_id: CHAT_ID.to_string(),
                actor_user_id: owner.clone(),
                name: Some("Renamed chat".to_string()),
                previous_project_id: Some(PROJECT_ID.to_string()),
                project_id: Some(PARENT_PROJECT_ID.to_string()),
                share_permission_updated: true,
            }),
            ChatEventDescription {
                action: ChatIndexAction::Ignore,
                chat_id: CHAT_ID,
                event_type: "chat.updated",
            },
        ),
        (
            ChatTopicEvent::Deleted(ChatDeletedMetadata {
                chat_id: CHAT_ID.to_string(),
                actor_user_id: Some(owner.clone()),
                project_id: Some(PROJECT_ID.to_string()),
            }),
            ChatEventDescription {
                action: ChatIndexAction::Ignore,
                chat_id: CHAT_ID,
                event_type: "chat.deleted",
            },
        ),
        (
            ChatTopicEvent::PermanentlyDeleted(ChatPermanentlyDeletedMetadata {
                chat_id: CHAT_ID.to_string(),
                actor_user_id: Some(owner.clone()),
                project_id: Some(PROJECT_ID.to_string()),
            }),
            ChatEventDescription {
                action: ChatIndexAction::RemoveChat { chat_id: CHAT_ID },
                chat_id: CHAT_ID,
                event_type: "chat.permanently_deleted",
            },
        ),
        (
            ChatTopicEvent::Restored(ChatRestoredMetadata {
                chat_id: CHAT_ID.to_string(),
                actor_user_id: Some(owner.clone()),
                project_id: Some(PROJECT_ID.to_string()),
            }),
            ChatEventDescription {
                action: ChatIndexAction::Ignore,
                chat_id: CHAT_ID,
                event_type: "chat.restored",
            },
        ),
        (
            ChatTopicEvent::Copied(ChatCopiedMetadata {
                chat_id: CHAT_ID.to_string(),
                source_chat_id: "source-chat-id".to_string(),
                owner: owner.clone(),
                name: "Copied chat".to_string(),
            }),
            ChatEventDescription {
                action: ChatIndexAction::Ignore,
                chat_id: CHAT_ID,
                event_type: "chat.copied",
            },
        ),
        (
            ChatTopicEvent::MessageSent(ChatMessageSentMetadata {
                chat_id: CHAT_ID.to_string(),
                message_id: CHAT_MESSAGE_ID.to_string(),
                role: ChatMessageRole::User,
                model: "chat-model".to_string(),
                actor_user_id: Some(owner),
                attachment_count: 1,
            }),
            ChatEventDescription {
                action: ChatIndexAction::UpsertMessage {
                    chat_id: CHAT_ID,
                    message_id: CHAT_MESSAGE_ID,
                },
                chat_id: CHAT_ID,
                event_type: "chat.message_sent",
            },
        ),
        (
            ChatTopicEvent::MessageDeleted(ChatMessageDeletedMetadata {
                chat_id: CHAT_ID.to_string(),
                message_id: CHAT_MESSAGE_ID.to_string(),
            }),
            ChatEventDescription {
                action: ChatIndexAction::RemoveMessage {
                    chat_id: CHAT_ID,
                    message_id: CHAT_MESSAGE_ID,
                },
                chat_id: CHAT_ID,
                event_type: "chat.message_deleted",
            },
        ),
    ]
}

fn channel_event_cases() -> Vec<(ChannelTopicEvent, ChannelEventDescription)> {
    let sender = channel_sender();

    vec![
        (
            ChannelTopicEvent::Created(ChannelCreatedMetadata {
                channel_id: CHANNEL_ID,
                actor: sender.clone(),
                on_behalf_of: None,
                channel_type: ChannelType::Private,
                channel_name: Some("general".to_string()),
                participant_user_ids: vec![user_id()],
            }),
            ChannelEventDescription {
                action: ChannelIndexAction::Ignore,
                channel_id: CHANNEL_ID,
                event_type: "channel.created",
            },
        ),
        (
            ChannelTopicEvent::Updated(ChannelUpdatedMetadata {
                channel_id: CHANNEL_ID,
                actor: user_id(),
                previous_name: Some("general".to_string()),
                channel_name: Some("renamed".to_string()),
            }),
            ChannelEventDescription {
                action: ChannelIndexAction::Ignore,
                channel_id: CHANNEL_ID,
                event_type: "channel.updated",
            },
        ),
        (
            ChannelTopicEvent::Deleted(ChannelDeletedMetadata {
                channel_id: CHANNEL_ID,
                actor: sender.clone(),
                participant_user_ids: Vec::new(),
            }),
            ChannelEventDescription {
                action: ChannelIndexAction::RemoveChannel {
                    channel_id: CHANNEL_ID,
                },
                channel_id: CHANNEL_ID,
                event_type: "channel.deleted",
            },
        ),
        (
            ChannelTopicEvent::ParticipantAdded(ChannelParticipantAddedMetadata {
                channel_id: CHANNEL_ID,
                channel_type: ChannelType::Private,
                added_by: sender,
                added_user_ids: vec![user_id()],
            }),
            ChannelEventDescription {
                action: ChannelIndexAction::Ignore,
                channel_id: CHANNEL_ID,
                event_type: "channel.participant_added",
            },
        ),
        (
            ChannelTopicEvent::ParticipantRemoved(ChannelParticipantRemovedMetadata {
                channel_id: CHANNEL_ID,
                channel_type: ChannelType::Private,
                removed_by: user_id(),
                removed_user_ids: vec![user_id()],
            }),
            ChannelEventDescription {
                action: ChannelIndexAction::Ignore,
                channel_id: CHANNEL_ID,
                event_type: "channel.participant_removed",
            },
        ),
    ]
}

fn message_event_cases() -> Vec<(MessageTopicEvent, MessageEventDescription)> {
    use messages::domain::events::{
        MessageAttachmentCreatedMetadata, MessageAttachmentRemovedMetadata, MessageDeletedMetadata,
        MessageMentionedMetadata, MessagePatchedMetadata, MessagePostedMetadata,
    };
    let sender = channel_sender();
    let channel = MessageParent::Channel(CHANNEL_ID);
    let document = MessageParent::parse("document", "doc-1").unwrap();
    let posted = |parent: MessageParent| MessagePostedMetadata {
        parent,
        message_id: MESSAGE_ID,
        thread_id: None,
        root_id: MESSAGE_ID,
        sender: sender.clone(),
        triggered_by: None,
        content: "hello".to_string(),
        mentions: vec![],
        attachments: vec![],
        created_at: Utc::now(),
    };
    let upsert = MessageIndexAction::UpsertMessage {
        channel_id: CHANNEL_ID,
        message_id: MESSAGE_ID,
    };

    vec![
        (
            MessageTopicEvent::Posted(posted(channel.clone())),
            MessageEventDescription {
                action: upsert,
                parent: channel.clone(),
                event_type: "message.posted",
            },
        ),
        (
            MessageTopicEvent::Posted(posted(document.clone())),
            MessageEventDescription {
                action: MessageIndexAction::Ignore,
                parent: document.clone(),
                event_type: "message.posted",
            },
        ),
        (
            MessageTopicEvent::Mentioned(MessageMentionedMetadata {
                parent: channel.clone(),
                message_id: MESSAGE_ID,
                thread_id: None,
                root_id: MESSAGE_ID,
                sender: sender.clone(),
                content: "hello @bot".to_string(),
                mentioned: messages::domain::models::SimpleMention {
                    entity_type: "bot".to_string(),
                    entity_id: "bot|00000000-0000-0000-0000-00000000b07a".to_string(),
                },
                created_at: Utc::now(),
            }),
            MessageEventDescription {
                action: MessageIndexAction::Ignore,
                parent: channel.clone(),
                event_type: "message.mentioned",
            },
        ),
        (
            MessageTopicEvent::Patched(MessagePatchedMetadata {
                completed_reply: None,
                parent: channel.clone(),
                message_id: MESSAGE_ID,
                thread_id: None,
                root_id: MESSAGE_ID,
                actor: sender.clone(),
                content: "edited".to_string(),
                edited_at: Some(Utc::now()),
                updated_at: Utc::now(),
            }),
            MessageEventDescription {
                action: upsert,
                parent: channel.clone(),
                event_type: "message.patched",
            },
        ),
        (
            MessageTopicEvent::Deleted(MessageDeletedMetadata {
                parent: channel.clone(),
                message_id: MESSAGE_ID,
                thread_id: None,
                root_id: MESSAGE_ID,
                actor: sender.clone(),
                deleted_at: Some(Utc::now()),
            }),
            MessageEventDescription {
                action: MessageIndexAction::RemoveMessage {
                    channel_id: CHANNEL_ID,
                    message_id: MESSAGE_ID,
                },
                parent: channel.clone(),
                event_type: "message.deleted",
            },
        ),
        (
            MessageTopicEvent::AttachmentCreated(MessageAttachmentCreatedMetadata {
                parent: channel.clone(),
                message_id: MESSAGE_ID,
                thread_id: None,
                root_id: MESSAGE_ID,
                actor: sender.clone(),
                attachments: vec![],
            }),
            MessageEventDescription {
                action: upsert,
                parent: channel.clone(),
                event_type: "message.attachment_created",
            },
        ),
        (
            MessageTopicEvent::AttachmentRemoved(MessageAttachmentRemovedMetadata {
                parent: channel.clone(),
                message_id: MESSAGE_ID,
                thread_id: None,
                root_id: MESSAGE_ID,
                actor: sender,
                attachments: vec![],
            }),
            MessageEventDescription {
                action: upsert,
                parent: channel,
                event_type: "message.attachment_removed",
            },
        ),
    ]
}

fn document_event_cases() -> Vec<(DocumentTopicEvent, DocumentEventDescription)> {
    let user = user_id();
    let owner = Owner::User(user.clone());

    vec![
        (
            DocumentTopicEvent::Created(DocumentCreatedMetadata {
                document_id: DOCUMENT_ID.to_string(),
                owner: owner.clone(),
                actor: None,
                on_behalf_of: None,
                document_name: "Document".to_string(),
                file_type: Some(FileType::Pdf),
                project_id: Some(PROJECT_ID.to_string()),
                sub_type: None,
                created_at: None,
            }),
            DocumentEventDescription {
                action: DocumentIndexAction::Ignore,
                document_id: DOCUMENT_ID.to_string(),
                event_type: "document.created",
            },
        ),
        (
            DocumentTopicEvent::Updated(DocumentUpdatedMetadata {
                appearance_change: None,
                document_id: DOCUMENT_ID.to_string(),
                owner: owner.clone(),
                actor_user_id: Some(user.clone()),
                actor: None,
                on_behalf_of: None,
                document_name: Some("Renamed document".to_string()),
                previous_project_id: Some(PROJECT_ID.to_string()),
                project_id: None,
                file_type: None,
                share_permission_updated: false,
            }),
            DocumentEventDescription {
                action: DocumentIndexAction::RefreshName,
                document_id: DOCUMENT_ID.to_string(),
                event_type: "document.updated",
            },
        ),
        (
            DocumentTopicEvent::Updated(DocumentUpdatedMetadata {
                appearance_change: None,
                document_id: DOCUMENT_ID.to_string(),
                owner: owner.clone(),
                actor_user_id: Some(user.clone()),
                actor: None,
                on_behalf_of: None,
                document_name: None,
                previous_project_id: None,
                project_id: Some(PROJECT_ID.to_string()),
                file_type: None,
                share_permission_updated: true,
            }),
            DocumentEventDescription {
                action: DocumentIndexAction::Ignore,
                document_id: DOCUMENT_ID.to_string(),
                event_type: "document.updated",
            },
        ),
        (
            DocumentTopicEvent::Deleted(DocumentDeletedMetadata {
                sub_type: None,
                document_id: DOCUMENT_ID.to_string(),
                actor_user_id: Some(user.clone()),
                actor: None,
                on_behalf_of: None,
                project_id: Some(PROJECT_ID.to_string()),
            }),
            DocumentEventDescription {
                action: DocumentIndexAction::Ignore,
                document_id: DOCUMENT_ID.to_string(),
                event_type: "document.deleted",
            },
        ),
        (
            DocumentTopicEvent::ContentUploaded(DocumentContentUploadedMetadata {
                document_id: DOCUMENT_ID.to_string(),
                owner: owner.clone(),
                file_type: FileType::Pdf,
                document_version_id: Some("convert".to_string()),
            }),
            DocumentEventDescription {
                action: DocumentIndexAction::ExtractText {
                    owner: owner.to_string(),
                    file_type: FileType::Pdf,
                    document_version_id: Some("convert".to_string()),
                },
                document_id: DOCUMENT_ID.to_string(),
                event_type: "document.content_uploaded",
            },
        ),
        (
            DocumentTopicEvent::SyncContentUpdated(DocumentSyncContentUpdatedMetadata {
                editors: Vec::new(),
                document_id: DOCUMENT_ID.to_string(),
                file_type: FileType::Md,
                document_version_id: None,
                actor: None,
                on_behalf_of: None,
            }),
            DocumentEventDescription {
                action: DocumentIndexAction::ExtractSync {
                    file_type: FileType::Md,
                    document_version_id: None,
                },
                document_id: DOCUMENT_ID.to_string(),
                event_type: "document.sync_content_updated",
            },
        ),
        (
            DocumentTopicEvent::Purged(DocumentPurgedMetadata {
                document_id: DOCUMENT_ID.to_string(),
            }),
            DocumentEventDescription {
                action: DocumentIndexAction::Remove,
                document_id: DOCUMENT_ID.to_string(),
                event_type: "document.purged",
            },
        ),
        (
            DocumentTopicEvent::EmailAttachmentsReleased(EmailAttachmentsReleasedMetadata {
                trashed_document_ids: vec![DOCUMENT_ID.to_string()],
                kept_document_ids: vec![SOURCE_DOCUMENT_ID.to_string()],
            }),
            DocumentEventDescription {
                action: DocumentIndexAction::ReleaseEmailAttachments {
                    document_ids: vec![DOCUMENT_ID.to_string(), SOURCE_DOCUMENT_ID.to_string()],
                },
                document_id: DOCUMENT_ID.to_string(),
                event_type: "document.email_attachments_released",
            },
        ),
        (
            DocumentTopicEvent::Copied(DocumentCopiedMetadata {
                document_id: DOCUMENT_ID.to_string(),
                source_document_id: SOURCE_DOCUMENT_ID.to_string(),
                source_version_id: Some(7),
                owner,
                actor: None,
                on_behalf_of: None,
                document_name: "Copied document".to_string(),
                file_type: Some(FileType::Pdf),
                project_id: Some(PROJECT_ID.to_string()),
                sub_type: None,
            }),
            DocumentEventDescription {
                action: DocumentIndexAction::Ignore,
                document_id: DOCUMENT_ID.to_string(),
                event_type: "document.copied",
            },
        ),
        (
            DocumentTopicEvent::Interaction(DocumentInteractionMetadata {
                document_id: DOCUMENT_ID.to_string(),
                reason: InteractionReason::Edited,
            }),
            DocumentEventDescription {
                action: DocumentIndexAction::Ignore,
                document_id: DOCUMENT_ID.to_string(),
                event_type: "document.interaction",
            },
        ),
    ]
}

fn project_event_cases() -> Vec<(ProjectTopicEvent, ProjectEventDescription<'static>)> {
    let owner = Owner::User(user_id());

    vec![
        (
            ProjectTopicEvent::Created(ProjectCreatedMetadata {
                project_id: PROJECT_ID.to_string(),
                owner: owner.clone(),
                name: "Project".to_string(),
                parent_project_id: Some(PARENT_PROJECT_ID.to_string()),
                created_at: Some(Utc::now()),
            }),
            ProjectEventDescription {
                action: ProjectIndexAction::Reconcile {
                    project_ids: vec![PROJECT_ID.to_string(), PARENT_PROJECT_ID.to_string()],
                    purged_chat_ids: Vec::new(),
                },
                project_id: PROJECT_ID,
                event_type: "project.created",
            },
        ),
        (
            ProjectTopicEvent::Updated(ProjectUpdatedMetadata {
                project_id: PROJECT_ID.to_string(),
                owner: owner.clone(),
                actor_user_id: Some(user_id()),
                name: Some("Renamed project".to_string()),
                previous_parent_id: Some(PARENT_PROJECT_ID.to_string()),
                parent_id: Some(NEW_PARENT_PROJECT_ID.to_string()),
                share_permission_updated: false,
            }),
            ProjectEventDescription {
                action: ProjectIndexAction::Reconcile {
                    project_ids: vec![
                        PROJECT_ID.to_string(),
                        PARENT_PROJECT_ID.to_string(),
                        NEW_PARENT_PROJECT_ID.to_string(),
                    ],
                    purged_chat_ids: Vec::new(),
                },
                project_id: PROJECT_ID,
                event_type: "project.updated",
            },
        ),
        (
            ProjectTopicEvent::Updated(ProjectUpdatedMetadata {
                project_id: PROJECT_ID.to_string(),
                owner: owner.clone(),
                actor_user_id: Some(user_id()),
                name: None,
                previous_parent_id: Some(PARENT_PROJECT_ID.to_string()),
                parent_id: Some(String::new()),
                share_permission_updated: true,
            }),
            ProjectEventDescription {
                action: ProjectIndexAction::Reconcile {
                    project_ids: vec![PROJECT_ID.to_string(), PARENT_PROJECT_ID.to_string()],
                    purged_chat_ids: Vec::new(),
                },
                project_id: PROJECT_ID,
                event_type: "project.updated",
            },
        ),
        (
            ProjectTopicEvent::Deleted(ProjectDeletedMetadata {
                project_id: PROJECT_ID.to_string(),
                owner: owner.clone(),
                actor_user_id: Some(user_id()),
                parent_project_id: Some(PARENT_PROJECT_ID.to_string()),
                deleted_project_ids: vec![
                    PROJECT_ID.to_string(),
                    CHILD_PROJECT_ID.to_string(),
                    CHILD_PROJECT_ID.to_string(),
                    PARENT_PROJECT_ID.to_string(),
                ],
                deleted_document_ids: vec!["document-id".to_string()],
                deleted_chat_ids: vec!["chat-id".to_string()],
            }),
            ProjectEventDescription {
                action: ProjectIndexAction::Reconcile {
                    project_ids: vec![
                        PROJECT_ID.to_string(),
                        CHILD_PROJECT_ID.to_string(),
                        PARENT_PROJECT_ID.to_string(),
                    ],
                    purged_chat_ids: Vec::new(),
                },
                project_id: PROJECT_ID,
                event_type: "project.deleted",
            },
        ),
        (
            ProjectTopicEvent::Restored(ProjectRestoredMetadata {
                project_id: PROJECT_ID.to_string(),
                owner: owner.clone(),
                actor_user_id: Some(user_id()),
                parent_project_id: Some(PARENT_PROJECT_ID.to_string()),
                restored_project_ids: vec![PROJECT_ID.to_string(), CHILD_PROJECT_ID.to_string()],
            }),
            ProjectEventDescription {
                action: ProjectIndexAction::Reconcile {
                    project_ids: vec![
                        PROJECT_ID.to_string(),
                        CHILD_PROJECT_ID.to_string(),
                        PARENT_PROJECT_ID.to_string(),
                    ],
                    purged_chat_ids: Vec::new(),
                },
                project_id: PROJECT_ID,
                event_type: "project.restored",
            },
        ),
        (
            ProjectTopicEvent::PermanentlyDeleted(ProjectPermanentlyDeletedMetadata {
                project_id: PROJECT_ID.to_string(),
                owner: owner.clone(),
                actor_user_id: Some(user_id()),
                parent_project_id: Some(PARENT_PROJECT_ID.to_string()),
                purged_project_ids: vec![PROJECT_ID.to_string(), CHILD_PROJECT_ID.to_string()],
                purged_document_ids: vec!["document-id".to_string()],
                purged_chat_ids: vec![CHAT_ID.to_string(), SECOND_CHAT_ID.to_string()],
            }),
            ProjectEventDescription {
                action: ProjectIndexAction::Reconcile {
                    project_ids: vec![
                        PROJECT_ID.to_string(),
                        CHILD_PROJECT_ID.to_string(),
                        PARENT_PROJECT_ID.to_string(),
                    ],
                    purged_chat_ids: vec![CHAT_ID.to_string(), SECOND_CHAT_ID.to_string()],
                },
                project_id: PROJECT_ID,
                event_type: "project.permanently_deleted",
            },
        ),
        (
            ProjectTopicEvent::Uploaded(ProjectUploadedMetadata {
                root_project_id: PROJECT_ID.to_string(),
                owner,
                name: "Uploaded project".to_string(),
                parent_project_id: Some(PARENT_PROJECT_ID.to_string()),
                project_ids: vec![PROJECT_ID.to_string(), CHILD_PROJECT_ID.to_string()],
            }),
            ProjectEventDescription {
                action: ProjectIndexAction::Reconcile {
                    project_ids: vec![
                        PROJECT_ID.to_string(),
                        CHILD_PROJECT_ID.to_string(),
                        PARENT_PROJECT_ID.to_string(),
                    ],
                    purged_chat_ids: Vec::new(),
                },
                project_id: PROJECT_ID,
                event_type: "project.uploaded",
            },
        ),
    ]
}

fn property_event_cases() -> Vec<(PropertyTopicEvent, PropertyEventDescription<'static>)> {
    let actor_user_id = Some(user_id());

    vec![
        (
            PropertyTopicEvent::Created(PropertyCreatedMetadata {
                property_definition_id: PROPERTY_DEFINITION_ID,
                actor_user_id: actor_user_id.clone(),
                owner: PropertyOwner::System,
                display_name: "Status".to_string(),
                data_type: DataType::String,
                is_multi_select: false,
                specific_entity_type: None,
                created_at: Utc::now(),
            }),
            PropertyEventDescription {
                action: PropertyIndexAction::Ignore,
                event_type: "property.created",
            },
        ),
        (
            PropertyTopicEvent::Deleted(PropertyDeletedMetadata {
                property_definition_id: PROPERTY_DEFINITION_ID,
                actor_user_id: actor_user_id.clone(),
                owner: PropertyOwner::System,
                display_name: "Status".to_string(),
                data_type: DataType::String,
            }),
            PropertyEventDescription {
                action: PropertyIndexAction::Ignore,
                event_type: "property.deleted",
            },
        ),
        (
            PropertyTopicEvent::OptionCreated(PropertyOptionCreatedMetadata {
                option_id: PROPERTY_OPTION_ID,
                property_definition_id: PROPERTY_DEFINITION_ID,
                actor_user_id: actor_user_id.clone(),
                value: PropertyOptionValue::String("Open".to_string()),
                color: None,
                display_order: 0,
            }),
            PropertyEventDescription {
                action: PropertyIndexAction::Ignore,
                event_type: "property_option.created",
            },
        ),
        (
            PropertyTopicEvent::OptionUpdated(PropertyOptionUpdatedMetadata {
                option_id: PROPERTY_OPTION_ID,
                property_definition_id: PROPERTY_DEFINITION_ID,
                actor_user_id: actor_user_id.clone(),
                value: PropertyOptionValue::String("Done".to_string()),
                color: Some("#ffffff".to_string()),
                display_order: 1,
            }),
            PropertyEventDescription {
                action: PropertyIndexAction::Ignore,
                event_type: "property_option.updated",
            },
        ),
        (
            PropertyTopicEvent::OptionDeleted(PropertyOptionDeletedMetadata {
                option_id: PROPERTY_OPTION_ID,
                property_definition_id: PROPERTY_DEFINITION_ID,
                actor_user_id: actor_user_id.clone(),
                value: PropertyOptionValue::String("Done".to_string()),
            }),
            PropertyEventDescription {
                action: PropertyIndexAction::Ignore,
                event_type: "property_option.deleted",
            },
        ),
        (
            PropertyTopicEvent::EntityPropertyUpdated(EntityPropertyUpdatedMetadata {
                inherited_from_project: None,
                entity_property_id: ENTITY_PROPERTY_ID,
                entity_id: PROPERTY_ENTITY_ID.to_string(),
                entity_type: EntityType::Document,
                property_definition_id: PROPERTY_DEFINITION_ID,
                actor_user_id: actor_user_id.clone(),
                actor: None,
                on_behalf_of: None,
                source: None,
                value: None,
                previous_value: None,
                updated_at: Utc::now(),
            }),
            PropertyEventDescription {
                action: PropertyIndexAction::Reindex {
                    entity_id: PROPERTY_ENTITY_ID,
                    entity_type: EntityType::Document,
                },
                event_type: "entity_property.updated",
            },
        ),
        (
            PropertyTopicEvent::EntityPropertyDeleted(EntityPropertyDeletedMetadata {
                entity_property_id: ENTITY_PROPERTY_ID,
                entity_id: PROPERTY_ENTITY_ID.to_string(),
                entity_type: EntityType::Chat,
                property_definition_id: PROPERTY_DEFINITION_ID,
                actor_user_id: actor_user_id.clone(),
                actor: None,
                on_behalf_of: None,
            }),
            PropertyEventDescription {
                action: PropertyIndexAction::Reindex {
                    entity_id: PROPERTY_ENTITY_ID,
                    entity_type: EntityType::Chat,
                },
                event_type: "entity_property.deleted",
            },
        ),
        (
            PropertyTopicEvent::EntityPropertiesCleared(EntityPropertiesClearedMetadata {
                entity_id: PROPERTY_ENTITY_ID.to_string(),
                entity_type: EntityType::Thread,
                actor_user_id,
                actor: None,
                on_behalf_of: None,
            }),
            PropertyEventDescription {
                action: PropertyIndexAction::Reindex {
                    entity_id: PROPERTY_ENTITY_ID,
                    entity_type: EntityType::Thread,
                },
                event_type: "entity_properties.cleared",
            },
        ),
    ]
}

#[test]
fn subscribes_to_declared_search_processing_topics_with_durable_group() {
    assert_eq!(
        SearchProcessingConsumerGroup::GROUP_NAME,
        "search-processing-service"
    );
    let topics = DeclaredMacroEvent::topics();
    assert!(topics.contains(&macro_event_topics::MacroAgentSessionLifecycleTopic::TOPIC_STR));
    assert_eq!(MacroChatsTopic::TOPIC_STR, "macro.chats");
    assert!(topics.contains(&MacroCallsTopic::TOPIC_STR));
    assert!(topics.contains(&MacroChannelsTopic::TOPIC_STR));
    assert!(topics.contains(&MacroChatsTopic::TOPIC_STR));
    assert!(topics.contains(&MacroDocumentsTopic::TOPIC_STR));
    assert!(topics.contains(&MacroEmailTopic::TOPIC_STR));
    assert!(topics.contains(&MacroProjectsTopic::TOPIC_STR));
    assert!(topics.contains(&MacroPropertiesTopic::TOPIC_STR));
    assert!(topics.contains(&MacroCalendarTopic::TOPIC_STR));
}

#[test]
fn email_has_a_lane_of_its_own_and_the_live_lane_reads_every_other_topic() {
    assert_eq!(EmailLaneEvent::topics(), [MacroEmailTopic::TOPIC_STR]);
    let mut lanes: Vec<_> = EmailLaneEvent::topics()
        .iter()
        .chain(LiveLaneEvent::topics())
        .copied()
        .collect();
    let mut declared = DeclaredMacroEvent::topics().to_vec();
    lanes.sort_unstable();
    declared.sort_unstable();
    assert_eq!(lanes, declared);
}

#[test]
fn backlog_metrics_split_lanes_as_the_consumers_do() {
    use super::entity_type::EntityType as IndexedType;

    for topic in EmailLaneEvent::topics() {
        assert_eq!(IndexedType::from_topic(topic), Some(IndexedType::Email));
    }
    for topic in LiveLaneEvent::topics() {
        assert_ne!(
            IndexedType::from_topic(topic),
            Some(IndexedType::Email),
            "{topic}"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn a_lane_leaves_the_group_once_every_lane_has_rewound() {
    let leave = LeaveTogether::new(2);
    let deadline = tokio::time::Instant::now() + LEAVE_TOGETHER_DEADLINE;
    let first = tokio::spawn({
        let leave = leave.clone();
        async move { leave.rewound(deadline).await }
    });
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(
        !first.is_finished(),
        "a lane must wait for the other lane's rewind"
    );

    leave.rewound(deadline).await;
    first.await.expect("first lane");
    assert!(tokio::time::Instant::now() < deadline);
}

#[tokio::test(start_paused = true)]
async fn a_lane_waits_no_longer_than_the_deadline_for_a_lane_that_is_not_running() {
    let leave = LeaveTogether::new(2);
    let deadline = tokio::time::Instant::now() + LEAVE_TOGETHER_DEADLINE;

    leave.rewound(deadline).await;

    assert_eq!(tokio::time::Instant::now(), deadline);
}

#[test]
fn a_lane_decodes_its_records_as_the_declared_topics_do() {
    use ::agent_session::domain::events::{AgentSessionLifecycleEvent, SessionRenamedMetadata};

    let email = encoded_message(
        MacroEmailTopic::TOPIC_STR,
        EMAIL_LINK_ID,
        Event::new(received_email_event(false)),
    );
    let session = lifecycle_message(AGENT_SESSION_ID, |identity| {
        AgentSessionLifecycleEvent::Renamed(SessionRenamedMetadata { identity })
    });
    let decoded = [
        (
            EmailLaneEvent::decode(&email).map(DeclaredMacroEvent::from),
            DeclaredMacroEvent::decode(&email),
        ),
        (
            LiveLaneEvent::decode(&session).map(DeclaredMacroEvent::from),
            DeclaredMacroEvent::decode(&session),
        ),
    ];
    for (lane, declared) in decoded {
        let (lane, declared) = (lane.expect("lane event"), declared.expect("declared event"));
        assert_eq!(event_topic(&lane), event_topic(&declared));
        assert_eq!(event_type(&lane), event_type(&declared));
        assert_eq!(event_id(&lane), event_id(&declared));
        assert_eq!(ordering_key(&lane), ordering_key(&declared));
    }

    assert!(matches!(
        LiveLaneEvent::decode(&email),
        Err(EventBrokerError::UnknownTopic(_))
    ));
    assert!(matches!(
        EmailLaneEvent::decode(&session),
        Err(EventBrokerError::UnknownTopic(_))
    ));
}

#[test]
fn maps_all_call_lifecycle_events_to_index_actions() {
    assert_eq!(
        describe_call_event(&started_event()),
        CallEventDescription {
            action: CallIndexAction::Ignore,
            call_id: CALL_ID,
            event_type: "call.started",
        }
    );
    assert_eq!(
        describe_call_event(&archived_event()),
        CallEventDescription {
            action: CallIndexAction::Upsert { call_id: CALL_ID },
            call_id: CALL_ID,
            event_type: "call.record_archived",
        }
    );
    assert_eq!(
        describe_call_event(&updated_event()),
        CallEventDescription {
            action: CallIndexAction::Upsert { call_id: CALL_ID },
            call_id: CALL_ID,
            event_type: "call.record_updated",
        }
    );
    assert_eq!(
        describe_call_event(&deleted_event()),
        CallEventDescription {
            action: CallIndexAction::Remove {
                call_id: CALL_ID,
                channel_id: Some(CHANNEL_ID),
            },
            call_id: CALL_ID,
            event_type: "call.record_deleted",
        }
    );
    assert_eq!(
        describe_call_event(&summarized_event()),
        CallEventDescription {
            action: CallIndexAction::Upsert { call_id: CALL_ID },
            call_id: CALL_ID,
            event_type: "call.record_summarized",
        }
    );
    assert_eq!(
        describe_call_event(&recording_ready_event()),
        CallEventDescription {
            action: CallIndexAction::Ignore,
            call_id: CALL_ID,
            event_type: "call.recording_ready",
        }
    );
}

#[test]
fn maps_all_email_lifecycle_events_to_index_actions() {
    let cases = email_event_cases();
    assert_eq!(cases.len(), 19);

    for (event, expected) in cases {
        let serialized = serde_json::to_value(&event).expect("serializable email event");
        assert_eq!(serialized["event_type"], expected.event_type);
        assert_eq!(describe_email_event(&event), expected);
    }
}

#[test]
fn email_message_sync_actions_remove_spam_or_trash_and_upsert_other_messages() {
    assert_eq!(
        describe_email_event(&received_email_event(true)).action,
        EmailIndexAction::RemoveMessage {
            message_id: MESSAGE_ID,
            thread_id: EMAIL_THREAD_ID,
        }
    );
    assert_eq!(
        describe_email_event(&draft_email_event(false)).action,
        EmailIndexAction::UpsertMessage {
            message_id: MESSAGE_ID,
            owner: "macro|owner@example.com".to_string(),
        }
    );
}

#[test]
fn maps_all_chat_lifecycle_events_to_index_actions() {
    let cases = chat_event_cases();
    assert_eq!(cases.len(), 8);

    for (event, expected) in cases {
        let serialized = serde_json::to_value(&event).expect("serializable chat event");
        assert_eq!(serialized["event_type"], expected.event_type);
        assert_eq!(describe_chat_event(&event), expected);
    }
}

#[test]
fn maps_all_channel_lifecycle_events_to_index_actions() {
    let cases = channel_event_cases();
    assert_eq!(cases.len(), 5);

    for (event, expected) in cases {
        let serialized = serde_json::to_value(&event).expect("serializable channel event");
        assert_eq!(serialized["event_type"], expected.event_type);
        assert_eq!(describe_channel_event(&event), expected);
    }
}

#[test]
fn maps_message_facts_to_channel_index_actions() {
    let cases = message_event_cases();
    assert_eq!(cases.len(), 7);

    for (event, expected) in cases {
        let serialized = serde_json::to_value(&event).expect("serializable message event");
        assert_eq!(serialized["event_type"], expected.event_type);
        assert_eq!(describe_message_event(&event), expected);
    }
}

#[test]
fn maps_all_document_lifecycle_events_to_index_actions() {
    let cases = document_event_cases();
    assert_eq!(cases.len(), 10);

    for (event, expected) in cases {
        let serialized = serde_json::to_value(&event).expect("serializable document event");
        assert_eq!(serialized["event_type"], expected.event_type);
        assert_eq!(describe_document_event(&event), expected);
    }
}

#[test]
fn document_extraction_actions_preserve_optional_versions() {
    let content_uploaded = DocumentTopicEvent::ContentUploaded(DocumentContentUploadedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        owner: Owner::User(user_id()),
        file_type: FileType::Pdf,
        document_version_id: None,
    });
    assert_eq!(
        describe_document_event(&content_uploaded).action,
        DocumentIndexAction::ExtractText {
            owner: "macro|owner@example.com".to_string(),
            file_type: FileType::Pdf,
            document_version_id: None,
        }
    );

    let sync_content_updated =
        DocumentTopicEvent::SyncContentUpdated(DocumentSyncContentUpdatedMetadata {
            editors: Vec::new(),
            document_id: DOCUMENT_ID.to_string(),
            file_type: FileType::Md,
            document_version_id: Some("snapshot-7".to_string()),
            actor: None,
            on_behalf_of: None,
        });
    assert_eq!(
        describe_document_event(&sync_content_updated).action,
        DocumentIndexAction::ExtractSync {
            file_type: FileType::Md,
            document_version_id: Some("snapshot-7".to_string()),
        }
    );
}

#[test]
fn document_extractor_messages_disable_index_overrides_and_set_expected_users() {
    let stored = stored_extractor_message(
        DOCUMENT_ID,
        "macro|owner@example.com".to_string(),
        FileType::Pdf,
        None,
    );
    assert_eq!(stored.user_id, "macro|owner@example.com");
    assert_eq!(stored.document_id, DOCUMENT_ID);
    assert_eq!(stored.file_type, FileType::Pdf);
    assert_eq!(stored.document_version_id, None);
    assert_eq!(stored.index_override, None);

    let sync = sync_extractor_message(DOCUMENT_ID, FileType::Md, Some("snapshot-7".to_string()));
    assert_eq!(sync.user_id, "");
    assert_eq!(sync.document_id, DOCUMENT_ID);
    assert_eq!(sync.file_type, FileType::Md);
    assert_eq!(sync.document_version_id.as_deref(), Some("snapshot-7"));
    assert_eq!(sync.index_override, None);
}

#[test]
fn bot_owned_document_event_preserves_the_principal_for_indexing() {
    const BOT_PRINCIPAL: &str = "bot|00000000-0000-0000-0000-00000000a1a1";

    let message = TestMessage {
        topic: MacroDocumentsTopic::TOPIC_STR,
        key: Some(DOCUMENT_ID.to_string()),
        payload: Some(
            br#"{
                "event_id":"00000000-0000-0000-0000-000000000001",
                "schema_version":1,
                "event_type":"document.content_uploaded",
                "metadata":{
                    "document_id":"document-id",
                    "owner":"bot|00000000-0000-0000-0000-00000000a1a1",
                    "file_type":"pdf",
                    "document_version_id":"convert"
                }
            }"#
            .to_vec(),
        ),
    };

    let decoded = DeclaredMacroEvent::decode(&message).expect("decodable document event");
    let DeclaredMacroEvent::DocumentMacroEvent(event) = decoded else {
        panic!("expected document event");
    };
    let DocumentIndexAction::ExtractText {
        owner,
        file_type,
        document_version_id,
    } = describe_document_event(&event.event().event).action
    else {
        panic!("expected document extraction");
    };
    let extractor_message =
        stored_extractor_message(DOCUMENT_ID, owner, file_type, document_version_id);

    assert_eq!(extractor_message.user_id, BOT_PRINCIPAL);
}

#[test]
fn maps_all_project_lifecycle_events_to_reconciliation_actions() {
    let cases = project_event_cases();
    assert_eq!(cases.len(), 7);

    for (event, expected) in cases {
        let serialized = serde_json::to_value(&event).expect("serializable project event");
        assert_eq!(serialized["event_type"], expected.event_type);
        assert_eq!(describe_project_event(&event), expected);
    }
}

#[test]
fn maps_all_property_lifecycle_events_to_index_actions() {
    let cases = property_event_cases();
    assert_eq!(cases.len(), 8);

    for (event, expected) in cases {
        let serialized = serde_json::to_value(&event).expect("serializable property event");
        assert_eq!(serialized["event_type"], expected.event_type);
        assert_eq!(describe_property_event(&event), expected);
    }
}

#[test]
fn project_id_collection_is_stable_and_drops_missing_or_empty_ids() {
    assert_eq!(
        collect_project_ids([
            Some(PROJECT_ID),
            None,
            Some(""),
            Some(CHILD_PROJECT_ID),
            Some(PROJECT_ID),
        ]),
        vec![PROJECT_ID.to_string(), CHILD_PROJECT_ID.to_string()]
    );
}

#[test]
fn email_envelope_decodes_round_trip() {
    let event = draft_email_event(false);
    let message = encoded_message(
        MacroEmailTopic::TOPIC_STR,
        EMAIL_LINK_ID,
        Event::new(event.clone()),
    );

    let decoded = DeclaredMacroEvent::decode(&message).expect("decodable email event");
    let DeclaredMacroEvent::EmailMacroEvent(decoded_event) = decoded else {
        panic!("expected email event");
    };
    assert_eq!(decoded_event.key(), EMAIL_LINK_ID.to_string());
    assert_eq!(decoded_event.event().event, event);
}

#[test]
fn agent_session_lifecycle_decodes_and_routes_by_session() {
    use ::agent_session::domain::{
        events::*,
        model::{AgentSessionId, SessionSource},
    };
    use macro_event_topics::MacroAgentSessionLifecycleTopic;

    let id = AgentSessionId::new_from_uuid(Uuid::from_u128(10));
    let identity = SessionIdentity {
        session_id: id,
        session_name: "Indexed session".into(),
        bot_id: serde_json::from_value(serde_json::json!(Uuid::from_u128(2))).unwrap(),
        bot_name: "Agent".into(),
        owner_id: user_id(),
        origin: None,
        audience: vec![],
        source: SessionSource::User,
    };
    for event in [
        AgentSessionLifecycleEvent::Renamed(SessionRenamedMetadata {
            identity: identity.clone(),
        }),
        AgentSessionLifecycleEvent::Deleted(SessionDeletedMetadata { identity }),
    ] {
        let message = encoded_message(
            MacroAgentSessionLifecycleTopic::TOPIC_STR,
            id,
            Event::new(event.clone()),
        );
        let decoded = DeclaredMacroEvent::decode(&message).unwrap();
        assert_eq!(ordering_key(&decoded), id.to_string());
        let DeclaredMacroEvent::AgentSessionLifecycleMacroEvent(decoded) = decoded else {
            panic!("expected agent-session lifecycle event");
        };
        assert_eq!(decoded.event().event, event);
    }
}

#[test]
fn chat_envelope_decodes_round_trip() {
    let event = ChatTopicEvent::MessageSent(ChatMessageSentMetadata {
        chat_id: CHAT_ID.to_string(),
        message_id: CHAT_MESSAGE_ID.to_string(),
        role: ChatMessageRole::Assistant,
        model: "chat-model".to_string(),
        actor_user_id: None,
        attachment_count: 0,
    });
    let message = encoded_message(
        MacroChatsTopic::TOPIC_STR,
        CHAT_ID,
        Event::new(event.clone()),
    );

    let decoded = DeclaredMacroEvent::decode(&message).expect("decodable chat event");
    let DeclaredMacroEvent::ChatMacroEvent(decoded_event) = decoded else {
        panic!("expected chat event");
    };
    assert_eq!(decoded_event.key(), CHAT_ID);
    assert_eq!(decoded_event.event().event, event);
}

#[test]
fn channel_envelope_decodes_round_trip() {
    let event = ChannelTopicEvent::Deleted(ChannelDeletedMetadata {
        channel_id: CHANNEL_ID,
        actor: channel_sender(),
        participant_user_ids: Vec::new(),
    });
    let message = encoded_message(
        MacroChannelsTopic::TOPIC_STR,
        CHANNEL_ID,
        Event::new(event.clone()),
    );

    let decoded = DeclaredMacroEvent::decode(&message).expect("decodable channel event");
    let DeclaredMacroEvent::ChannelMacroEvent(decoded_event) = decoded else {
        panic!("expected channel event");
    };
    assert_eq!(decoded_event.key(), CHANNEL_ID.to_string());
    assert_eq!(decoded_event.event().event, event);
}

#[test]
fn calendar_envelope_decodes_round_trip_keyed_by_event_id() {
    let event_id = uuid::Uuid::now_v7();
    let event = CalendarTopicEvent::Updated(CalendarEventMetadata {
        event_id,
        owner_id: "macro|user".to_string(),
    });
    let message = encoded_message(
        MacroCalendarTopic::TOPIC_STR,
        &event_id.to_string(),
        Event::new(event.clone()),
    );

    let decoded = DeclaredMacroEvent::decode(&message).expect("decodable calendar event");
    let DeclaredMacroEvent::CalendarMacroEvent(decoded_event) = decoded else {
        panic!("expected calendar event");
    };
    assert_eq!(decoded_event.key(), event_id.to_string());
    assert_eq!(decoded_event.event().event, event);
}

#[test]
fn calendar_variants_choose_reindex_or_remove() {
    // A deletion has no row left to read, so it drops the document directly
    // instead of spending a query to learn the row is gone.
    let metadata = CalendarEventMetadata {
        event_id: uuid::Uuid::now_v7(),
        owner_id: "macro|user".to_string(),
    };
    assert_eq!(
        super::calendar_event::index_action(&CalendarTopicEvent::Created(metadata.clone())).0,
        super::calendar_event::CalendarIndexAction::Reindex
    );
    assert_eq!(
        super::calendar_event::index_action(&CalendarTopicEvent::Updated(metadata.clone())).0,
        super::calendar_event::CalendarIndexAction::Reindex
    );
    assert_eq!(
        super::calendar_event::index_action(&CalendarTopicEvent::Deleted(metadata)).0,
        super::calendar_event::CalendarIndexAction::Remove
    );
}

#[test]
fn calendar_events_shard_by_event_id_so_one_event_stays_ordered() {
    // Two changes to one event must land on the same worker, or a later
    // update could be indexed before an earlier one.
    let event_id = uuid::Uuid::now_v7();
    let first = DeclaredMacroEvent::CalendarMacroEvent(CalendarMacroEvent::for_change(
        CalendarTopicEvent::Created(CalendarEventMetadata {
            event_id,
            owner_id: "macro|user".to_string(),
        }),
    ));
    // A different variant for the same entity must still shard together.
    let second = DeclaredMacroEvent::CalendarMacroEvent(CalendarMacroEvent::for_change(
        CalendarTopicEvent::Deleted(CalendarEventMetadata {
            event_id,
            owner_id: "macro|user".to_string(),
        }),
    ));
    assert_eq!(ordering_key(&first), event_id.to_string());
    assert_eq!(ordering_key(&first), ordering_key(&second));
}

#[test]
fn project_envelope_decodes_round_trip_with_string_key() {
    let event = ProjectTopicEvent::Restored(ProjectRestoredMetadata {
        project_id: PROJECT_ID.to_string(),
        owner: Owner::User(user_id()),
        actor_user_id: Some(user_id()),
        parent_project_id: Some(PARENT_PROJECT_ID.to_string()),
        restored_project_ids: vec![PROJECT_ID.to_string(), CHILD_PROJECT_ID.to_string()],
    });
    let message = encoded_message(
        MacroProjectsTopic::TOPIC_STR,
        PROJECT_ID,
        Event::new(event.clone()),
    );

    let decoded = DeclaredMacroEvent::decode(&message).expect("decodable project event");
    let DeclaredMacroEvent::ProjectMacroEvent(decoded_event) = decoded else {
        panic!("expected project event");
    };
    assert_eq!(decoded_event.key(), PROJECT_ID);
    assert_eq!(decoded_event.event().event, event);
}

#[test]
fn property_envelope_decodes_round_trip_with_entity_key() {
    let event = PropertyTopicEvent::EntityPropertiesCleared(EntityPropertiesClearedMetadata {
        entity_id: PROPERTY_ENTITY_ID.to_string(),
        entity_type: EntityType::Document,
        actor_user_id: Some(user_id()),
        actor: None,
        on_behalf_of: None,
    });
    let message = encoded_message(
        MacroPropertiesTopic::TOPIC_STR,
        PROPERTY_ENTITY_ID,
        Event::new(event.clone()),
    );

    let decoded = DeclaredMacroEvent::decode(&message).expect("decodable property event");
    let DeclaredMacroEvent::PropertyMacroEvent(decoded_event) = decoded else {
        panic!("expected property event");
    };
    assert_eq!(decoded_event.key(), PROPERTY_ENTITY_ID);
    assert_eq!(decoded_event.event().event, event);
}

#[test]
fn exact_macro_documents_envelopes_decode_into_document_events() {
    let cases: Vec<(&[u8], Event<DocumentTopicEvent>)> = vec![
        (
            br#"{
                "event_id":"00000000-0000-0000-0000-000000000001",
                "schema_version":1,
                "event_type":"document.content_uploaded",
                "metadata":{
                    "document_id":"document-id",
                    "owner":"macro|owner@example.com",
                    "file_type":"pdf",
                    "document_version_id":"convert"
                }
            }"#,
            Event::with_event_id(
                Uuid::from_u128(1),
                DocumentTopicEvent::ContentUploaded(DocumentContentUploadedMetadata {
                    document_id: DOCUMENT_ID.to_string(),
                    owner: Owner::User(user_id()),
                    file_type: FileType::Pdf,
                    document_version_id: Some("convert".to_string()),
                }),
            ),
        ),
        (
            br#"{
                "event_id":"00000000-0000-0000-0000-000000000002",
                "schema_version":1,
                "event_type":"document.sync_content_updated",
                "metadata":{
                    "document_id":"document-id",
                    "file_type":"md",
                    "document_version_id":null
                }
            }"#,
            Event::with_event_id(
                Uuid::from_u128(2),
                DocumentTopicEvent::SyncContentUpdated(DocumentSyncContentUpdatedMetadata {
                    editors: Vec::new(),
                    document_id: DOCUMENT_ID.to_string(),
                    file_type: FileType::Md,
                    document_version_id: None,
                    actor: None,
                    on_behalf_of: None,
                }),
            ),
        ),
        (
            br#"{
                "event_id":"00000000-0000-0000-0000-000000000003",
                "schema_version":1,
                "event_type":"document.purged",
                "metadata":{"document_id":"document-id"}
            }"#,
            Event::with_event_id(
                Uuid::from_u128(3),
                DocumentTopicEvent::Purged(DocumentPurgedMetadata {
                    document_id: DOCUMENT_ID.to_string(),
                }),
            ),
        ),
    ];

    for (payload, expected) in cases {
        let message = TestMessage {
            topic: MacroDocumentsTopic::TOPIC_STR,
            key: Some(DOCUMENT_ID.to_string()),
            payload: Some(payload.to_vec()),
        };

        let decoded = DeclaredMacroEvent::decode(&message).expect("decodable document event");
        let DeclaredMacroEvent::DocumentMacroEvent(decoded_event) = decoded else {
            panic!("expected document event");
        };
        assert_eq!(decoded_event.key(), DOCUMENT_ID);
        assert_eq!(decoded_event.event(), &expected);
    }
}

#[tokio::test]
async fn malformed_missing_key_and_unsupported_email_messages_are_commit_safe() {
    let malformed = TestMessage {
        topic: MacroEmailTopic::TOPIC_STR,
        key: Some(EMAIL_LINK_ID.to_string()),
        payload: Some(b"not json".to_vec()),
    };
    let malformed = attach_event_coordinates(
        DeclaredMacroEvent::decode(&malformed),
        7,
        60,
        tracing::Span::none(),
    );

    let missing_key = TestMessage {
        topic: MacroEmailTopic::TOPIC_STR,
        key: None,
        payload: encoded_message(
            MacroEmailTopic::TOPIC_STR,
            EMAIL_LINK_ID,
            Event::new(draft_email_event(false)),
        )
        .payload,
    };
    let missing_key = attach_event_coordinates(
        DeclaredMacroEvent::decode(&missing_key),
        7,
        61,
        tracing::Span::none(),
    );

    let unsupported = encoded_message(
        MacroEmailTopic::TOPIC_STR,
        EMAIL_LINK_ID,
        Event::with_schema_version(draft_email_event(false), 2),
    );
    let unsupported = attach_event_coordinates(
        DeclaredMacroEvent::decode(&unsupported),
        7,
        62,
        tracing::Span::none(),
    );
    let (pool, mut receivers) = test_pool(1, 1);

    assert!(matches!(
        pool.handoff(malformed).await,
        HandoffOutcome::MalformedRecord(EventBrokerError::Serialization(_))
    ));
    assert!(matches!(
        pool.handoff(missing_key).await,
        HandoffOutcome::MalformedRecord(EventBrokerError::MissingMessageKey)
    ));
    match pool.handoff(unsupported).await {
        HandoffOutcome::MalformedRecord(EventBrokerError::UnsupportedSchemaVersion {
            topic,
            expected,
            actual,
        }) => {
            assert_eq!(topic, MacroEmailTopic::TOPIC_STR);
            assert_eq!(expected, 1);
            assert_eq!(actual, 2);
        }
        outcome => panic!("expected malformed email record, got {outcome:?}"),
    }
    assert!(matches!(
        receivers[0].try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn malformed_and_unsupported_chat_messages_are_commit_safe() {
    let malformed = TestMessage {
        topic: MacroChatsTopic::TOPIC_STR,
        key: Some(CHAT_ID.to_string()),
        payload: Some(b"not json".to_vec()),
    };
    let malformed = attach_event_coordinates(
        DeclaredMacroEvent::decode(&malformed),
        5,
        40,
        tracing::Span::none(),
    );
    let (pool, mut receivers) = test_pool(1, 1);

    assert!(matches!(
        pool.handoff(malformed).await,
        HandoffOutcome::MalformedRecord(EventBrokerError::Serialization(_))
    ));

    let unsupported_event = ChatTopicEvent::MessageDeleted(ChatMessageDeletedMetadata {
        chat_id: CHAT_ID.to_string(),
        message_id: CHAT_MESSAGE_ID.to_string(),
    });
    let unsupported = encoded_message(
        MacroChatsTopic::TOPIC_STR,
        CHAT_ID,
        Event::with_schema_version(unsupported_event, 2),
    );
    let unsupported = attach_event_coordinates(
        DeclaredMacroEvent::decode(&unsupported),
        5,
        41,
        tracing::Span::none(),
    );
    match pool.handoff(unsupported).await {
        HandoffOutcome::MalformedRecord(EventBrokerError::UnsupportedSchemaVersion {
            topic,
            expected,
            actual,
        }) => {
            assert_eq!(topic, MacroChatsTopic::TOPIC_STR);
            assert_eq!(expected, 1);
            assert_eq!(actual, 2);
        }
        outcome => panic!("expected malformed chat record, got {outcome:?}"),
    }

    assert!(matches!(
        receivers[0].try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn unsupported_project_schema_message_is_commit_safe() {
    let event = ProjectTopicEvent::Restored(ProjectRestoredMetadata {
        project_id: PROJECT_ID.to_string(),
        owner: Owner::User(user_id()),
        actor_user_id: Some(user_id()),
        parent_project_id: None,
        restored_project_ids: vec![PROJECT_ID.to_string()],
    });
    let message = encoded_message(
        MacroProjectsTopic::TOPIC_STR,
        PROJECT_ID,
        Event::with_schema_version(event, 2),
    );
    let decoded = attach_event_coordinates(
        DeclaredMacroEvent::decode(&message),
        4,
        30,
        tracing::Span::none(),
    );
    let (pool, mut receivers) = test_pool(1, 1);

    match pool.handoff(decoded).await {
        HandoffOutcome::MalformedRecord(EventBrokerError::UnsupportedSchemaVersion {
            topic,
            expected,
            actual,
        }) => {
            assert_eq!(topic, MacroProjectsTopic::TOPIC_STR);
            assert_eq!(expected, 1);
            assert_eq!(actual, 2);
        }
        outcome => panic!("expected malformed project record, got {outcome:?}"),
    }
    assert!(matches!(
        receivers[0].try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn unsupported_property_schema_message_is_commit_safe() {
    let event = PropertyTopicEvent::EntityPropertiesCleared(EntityPropertiesClearedMetadata {
        entity_id: PROPERTY_ENTITY_ID.to_string(),
        entity_type: EntityType::Document,
        actor_user_id: Some(user_id()),
        actor: None,
        on_behalf_of: None,
    });
    let message = encoded_message(
        MacroPropertiesTopic::TOPIC_STR,
        PROPERTY_ENTITY_ID,
        Event::with_schema_version(event, 2),
    );
    let decoded = attach_event_coordinates(
        DeclaredMacroEvent::decode(&message),
        6,
        50,
        tracing::Span::none(),
    );
    let (pool, mut receivers) = test_pool(1, 1);

    match pool.handoff(decoded).await {
        HandoffOutcome::MalformedRecord(EventBrokerError::UnsupportedSchemaVersion {
            topic,
            expected,
            actual,
        }) => {
            assert_eq!(topic, MacroPropertiesTopic::TOPIC_STR);
            assert_eq!(expected, 1);
            assert_eq!(actual, 2);
        }
        outcome => panic!("expected malformed property record, got {outcome:?}"),
    }
    assert!(matches!(
        receivers[0].try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn unsupported_channel_schema_message_is_commit_safe() {
    let event = ChannelTopicEvent::Deleted(ChannelDeletedMetadata {
        channel_id: CHANNEL_ID,
        actor: channel_sender(),
        participant_user_ids: Vec::new(),
    });
    let message = encoded_message(
        MacroChannelsTopic::TOPIC_STR,
        CHANNEL_ID,
        Event::with_schema_version(event, 2),
    );
    let decoded = attach_event_coordinates(
        DeclaredMacroEvent::decode(&message),
        2,
        20,
        tracing::Span::none(),
    );
    let (pool, mut receivers) = test_pool(1, 1);

    match pool.handoff(decoded).await {
        HandoffOutcome::MalformedRecord(EventBrokerError::UnsupportedSchemaVersion {
            topic,
            expected,
            actual,
        }) => {
            assert_eq!(topic, MacroChannelsTopic::TOPIC_STR);
            assert_eq!(expected, 1);
            assert_eq!(actual, 2);
        }
        outcome => panic!("expected malformed channel record, got {outcome:?}"),
    }
    assert!(matches!(
        receivers[0].try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn malformed_missing_key_and_unsupported_schema_messages_are_commit_safe() {
    let malformed = TestMessage {
        topic: MacroCallsTopic::TOPIC_STR,
        key: Some(CALL_ID.to_string()),
        payload: Some(b"not json".to_vec()),
    };
    let malformed = attach_event_coordinates(
        DeclaredMacroEvent::decode(&malformed),
        1,
        10,
        tracing::Span::none(),
    );
    assert!(matches!(malformed, Err(EventBrokerError::Serialization(_))));

    let missing_key = TestMessage {
        topic: MacroCallsTopic::TOPIC_STR,
        key: None,
        payload: encoded_message(
            MacroCallsTopic::TOPIC_STR,
            CALL_ID,
            Event::new(archived_event()),
        )
        .payload,
    };
    let missing_key = attach_event_coordinates(
        DeclaredMacroEvent::decode(&missing_key),
        1,
        11,
        tracing::Span::none(),
    );
    assert!(matches!(
        missing_key,
        Err(EventBrokerError::MissingMessageKey)
    ));

    let unsupported = encoded_message(
        MacroCallsTopic::TOPIC_STR,
        CALL_ID,
        Event::with_schema_version(archived_event(), 2),
    );
    let unsupported = attach_event_coordinates(
        DeclaredMacroEvent::decode(&unsupported),
        1,
        12,
        tracing::Span::none(),
    );
    assert!(matches!(
        unsupported,
        Err(EventBrokerError::UnsupportedSchemaVersion {
            expected: 1,
            actual: 2,
            ..
        })
    ));

    let (pool, mut receivers) = test_pool(1, 1);
    for decoded in [malformed, missing_key, unsupported] {
        assert!(matches!(
            pool.handoff(decoded).await,
            HandoffOutcome::MalformedRecord(_)
        ));
    }
    assert!(matches!(
        receivers[0].try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn successful_handoff_carries_event_partition_and_offset() {
    let event = archived_event();
    let message = encoded_message(
        MacroCallsTopic::TOPIC_STR,
        CALL_ID,
        Event::new(event.clone()),
    );
    let decoded = attach_event_coordinates(
        DeclaredMacroEvent::decode(&message),
        3,
        42,
        tracing::Span::none(),
    );
    let (pool, mut receivers) = test_pool(1, 1);

    assert!(matches!(
        pool.handoff(decoded).await,
        HandoffOutcome::HandedOff
    ));

    let received = receivers[0].recv().await.expect("handed-off event");
    assert_eq!(received.partition, 3);
    assert_eq!(received.offset, 42);
    let DeclaredMacroEvent::CallMacroEvent(received_event) = received.event else {
        panic!("expected call event");
    };
    assert_eq!(received_event.event().event, event);
}

#[tokio::test]
async fn closed_worker_channel_leaves_the_current_message_uncommitted() {
    let message = encoded_message(
        MacroCallsTopic::TOPIC_STR,
        CALL_ID,
        Event::new(archived_event()),
    );
    let decoded = attach_event_coordinates(
        DeclaredMacroEvent::decode(&message),
        3,
        42,
        tracing::Span::none(),
    );
    let (pool, receivers) = test_pool(1, 1);
    drop(receivers);

    assert!(matches!(
        pool.handoff(decoded).await,
        HandoffOutcome::WorkerClosed
    ));
}

#[tokio::test]
async fn bounded_handoff_blocks_when_full_and_preserves_order() {
    let (pool, mut receivers) = test_pool(1, 1);
    let first = received_thread_backfilled_event(EMAIL_THREAD_ID, 1);
    let second = received_thread_backfilled_event(EMAIL_THREAD_ID, 2);

    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(first)).await,
        HandoffOutcome::HandedOff
    ));

    let blocked_handoff =
        tokio::spawn(async move { pool.handoff(Ok::<_, EventBrokerError>(second)).await });
    tokio::task::yield_now().await;
    assert!(
        !blocked_handoff.is_finished(),
        "handoff must wait while the bounded channel is full"
    );

    assert_eq!(receivers[0].recv().await.expect("first event").offset, 1);
    assert!(matches!(
        blocked_handoff.await.expect("handoff task did not panic"),
        HandoffOutcome::HandedOff
    ));
    assert_eq!(receivers[0].recv().await.expect("second event").offset, 2);
}

#[tokio::test(start_paused = true)]
async fn queued_agent_session_reread_absorbs_later_hints_without_blocking() {
    let (pool, mut receivers) = test_pool(1, 1);

    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_agent_session_event(
            AGENT_SESSION_ID,
            1
        )))
        .await,
        HandoffOutcome::HandedOff
    ));
    for offset in 2..40 {
        let outcome = tokio::time::timeout(
            BLOCKED_HANDOFF_TIMEOUT,
            pool.handoff(Ok::<_, EventBrokerError>(received_agent_session_event(
                AGENT_SESSION_ID,
                offset,
            ))),
        )
        .await
        .expect("a hint for a session with a queued reread must not wait on its full worker");
        assert!(matches!(outcome, HandoffOutcome::Coalesced));
    }

    assert_eq!(receivers[0].recv().await.expect("queued reread").offset, 1);
    assert!(matches!(
        receivers[0].try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
}

#[tokio::test(start_paused = true)]
async fn one_mailbox_reindex_burst_spreads_across_workers() {
    let (pool, mut receivers) = test_pool(WORKER_COUNT, WORKER_CHANNEL_CAPACITY);
    let threads: Vec<Uuid> = (0..60)
        .map(|index| Uuid::from_u128(60_000 + index))
        .collect();

    for (offset, thread) in (0..).zip(&threads) {
        let outcome = tokio::time::timeout(
            BLOCKED_HANDOFF_TIMEOUT,
            pool.handoff(Ok::<_, EventBrokerError>(received_thread_reindex_event(
                vec![*thread],
                offset,
            ))),
        )
        .await
        .expect("one mailbox's reindex requests must not all wait on one worker");
        assert!(matches!(outcome, HandoffOutcome::HandedOff));
    }

    let busy_workers = receivers
        .iter_mut()
        .map(|receiver| receiver.try_recv().is_ok())
        .filter(|received| *received)
        .count();
    assert!(
        busy_workers > WORKER_COUNT / 2,
        "a mailbox's threads must spread across workers, got {busy_workers}"
    );
}

#[tokio::test]
async fn thread_reindex_queues_behind_the_threads_earlier_events() {
    let (pool, mut receivers) = test_pool(WORKER_COUNT, WORKER_CHANNEL_CAPACITY);
    let thread_worker = pool.shard_index(&EMAIL_THREAD_ID.to_string());

    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_thread_backfilled_event(
            EMAIL_THREAD_ID,
            1
        )))
        .await,
        HandoffOutcome::HandedOff
    ));
    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_thread_reindex_event(
            vec![EMAIL_THREAD_ID],
            2
        )))
        .await,
        HandoffOutcome::HandedOff
    ));

    let receiver = &mut receivers[thread_worker];
    assert_eq!(receiver.try_recv().expect("backfilled event").offset, 1);
    assert_eq!(
        receiver
            .try_recv()
            .expect("reindex request on the thread's worker")
            .offset,
        2
    );
}

#[tokio::test(start_paused = true)]
async fn queued_thread_reindex_absorbs_later_requests_for_the_thread() {
    let (pool, mut receivers) = test_pool(1, 1);

    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_thread_reindex_event(
            vec![EMAIL_THREAD_ID],
            1
        )))
        .await,
        HandoffOutcome::HandedOff
    ));
    for offset in 2..40 {
        let outcome = tokio::time::timeout(
            BLOCKED_HANDOFF_TIMEOUT,
            pool.handoff(Ok::<_, EventBrokerError>(received_thread_reindex_event(
                vec![EMAIL_THREAD_ID],
                offset,
            ))),
        )
        .await
        .expect("a reindex request for a thread with a queued reread must not wait");
        assert!(matches!(outcome, HandoffOutcome::Coalesced));
    }

    assert_eq!(receivers[0].recv().await.expect("queued reread").offset, 1);
    assert!(matches!(
        receivers[0].try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn thread_reindex_behind_another_thread_event_is_not_absorbed() {
    let (pool, mut receivers) = test_pool(1, 3);

    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_thread_reindex_event(
            vec![EMAIL_THREAD_ID],
            1
        )))
        .await,
        HandoffOutcome::HandedOff
    ));
    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_thread_backfilled_event(
            EMAIL_THREAD_ID,
            2
        )))
        .await,
        HandoffOutcome::HandedOff
    ));
    // The queued reread runs before the event between them, so it cannot
    // cover a request published after that event.
    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_thread_reindex_event(
            vec![EMAIL_THREAD_ID],
            3
        )))
        .await,
        HandoffOutcome::HandedOff
    ));

    for offset in 1..=3 {
        assert_eq!(
            receivers[0].try_recv().expect("queued event").offset,
            offset
        );
    }
}

#[tokio::test]
async fn reindex_request_for_several_threads_is_never_coalesced() {
    let (pool, mut receivers) = test_pool(1, 3);

    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_thread_reindex_event(
            vec![EMAIL_THREAD_ID],
            1
        )))
        .await,
        HandoffOutcome::HandedOff
    ));
    // A reread of its first thread does not cover the second.
    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_thread_reindex_event(
            vec![EMAIL_THREAD_ID, SECOND_EMAIL_THREAD_ID],
            2
        )))
        .await,
        HandoffOutcome::HandedOff
    ));

    // Handing it off released the first request's claim on its thread, so a
    // later request queues behind it.
    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_thread_reindex_event(
            vec![EMAIL_THREAD_ID],
            3
        )))
        .await,
        HandoffOutcome::HandedOff
    ));

    for offset in 1..=3 {
        assert_eq!(
            receivers[0].try_recv().expect("queued event").offset,
            offset
        );
    }
}

#[tokio::test(start_paused = true)]
async fn agent_session_flood_does_not_delay_email_events_on_other_partitions() {
    const AGENT_PARTITION: i32 = 1;
    const EMAIL_PARTITION: i32 = 4;
    const SESSION_EVENTS: i64 = 2_000;
    const EMAIL_EVENTS: u128 = 60;

    let (pool, receivers) = test_pool(WORKER_COUNT, WORKER_CHANNEL_CAPACITY);
    let hot_worker = pool.shard_index(&AGENT_SESSION_ID.to_string());
    let email_threads: Vec<Uuid> = (0..EMAIL_EVENTS)
        .map(|index| Uuid::from_u128(50_000 + index))
        .collect();
    let emails_behind_hot_worker = email_threads
        .iter()
        .filter(|thread| pool.shard_index(&thread.to_string()) == hot_worker)
        .count();
    assert!(
        emails_behind_hot_worker < WORKER_CHANNEL_CAPACITY - 1,
        "fixture must not fill the stuck worker with email events alone"
    );

    // The session's worker is stuck in a reconcile; every other worker drains.
    let mut stuck = None;
    let mut drained = Vec::new();
    for (index, mut receiver) in receivers.into_iter().enumerate() {
        if index == hot_worker {
            stuck = Some(receiver);
            continue;
        }
        drained.push(tokio::spawn(async move {
            let mut emails = 0;
            while let Some(event) = receiver.recv().await {
                assert_eq!(event.partition, EMAIL_PARTITION);
                emails += 1;
            }
            emails
        }));
    }

    let mut email_threads = email_threads.into_iter();
    let flood = async {
        for offset in 0..SESSION_EVENTS {
            let mut session_event = received_agent_session_event(AGENT_SESSION_ID, offset);
            session_event.partition = AGENT_PARTITION;
            let _ = pool.handoff(Ok::<_, EventBrokerError>(session_event)).await;
            if offset % 30 == 0
                && let Some(thread) = email_threads.next()
            {
                let mut email_event = received_thread_backfilled_event(thread, offset);
                email_event.partition = EMAIL_PARTITION;
                assert!(matches!(
                    pool.handoff(Ok::<_, EventBrokerError>(email_event)).await,
                    HandoffOutcome::HandedOff
                ));
            }
        }
    };
    tokio::time::timeout(BLOCKED_HANDOFF_TIMEOUT, flood)
        .await
        .expect("one session's flood must not hold handoff for other events");
    drop(pool);

    let mut stuck = stuck.expect("hot worker channel");
    let mut queued_rereads = 0;
    let mut queued_emails = 0;
    while let Some(event) = stuck.recv().await {
        match event.partition {
            AGENT_PARTITION => queued_rereads += 1,
            _ => queued_emails += 1,
        }
    }
    let mut delivered_emails = queued_emails;
    for worker in drained {
        delivered_emails += worker.await.expect("draining worker did not panic");
    }
    assert_eq!(
        queued_rereads, 1,
        "one queued reread covers the whole flood"
    );
    assert_eq!(delivered_emails, EMAIL_EVENTS as usize);
}

#[tokio::test]
async fn hint_arriving_mid_reread_queues_the_next_reread() {
    let (sender, receiver) = mpsc::channel(WORKER_CHANNEL_CAPACITY);
    let pending_rereads = Arc::new(PendingRereads::default());
    let pool = WorkerPool::new(vec![sender], Arc::clone(&pending_rereads), unread_metrics());
    let (started_sender, mut started) = mpsc::channel(4);
    let resume = Arc::new(tokio::sync::Notify::new());
    let worker_resume = Arc::clone(&resume);
    let worker = tokio::spawn(drain_worker_events(
        receiver,
        pending_rereads,
        mpsc::unbounded_channel().0,
        CancellationToken::new(),
        move |received| {
            let started_sender = started_sender.clone();
            let resume = Arc::clone(&worker_resume);
            async move {
                started_sender
                    .send(received.offset)
                    .await
                    .expect("test observes every reread");
                if received.offset == 1 {
                    resume.notified().await;
                }
            }
        },
    ));

    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_agent_session_event(
            AGENT_SESSION_ID,
            1
        )))
        .await,
        HandoffOutcome::HandedOff
    ));
    assert_eq!(started.recv().await, Some(1), "first reread is running");

    // The running reread may already have read the session, so this hint
    // needs a reread of its own.
    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_agent_session_event(
            AGENT_SESSION_ID,
            2
        )))
        .await,
        HandoffOutcome::HandedOff
    ));
    resume.notify_one();
    assert_eq!(started.recv().await, Some(2), "next reread runs");

    drop(pool);
    worker.await.expect("worker drained without panicking");
}

#[tokio::test]
async fn dead_worker_holding_a_claim_leaves_later_hints_uncommitted() {
    let (pool, receivers) = test_pool(1, 4);
    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_agent_session_event(
            AGENT_SESSION_ID,
            1
        )))
        .await,
        HandoffOutcome::HandedOff
    ));
    // The worker dies with the reread still queued.
    drop(receivers);

    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(received_agent_session_event(
            AGENT_SESSION_ID,
            2
        )))
        .await,
        HandoffOutcome::WorkerClosed
    ));
}

#[tokio::test]
async fn distinct_sessions_and_non_reread_events_each_hand_off() {
    let (pool, mut receivers) = test_pool(1, 8);
    for event in [
        received_agent_session_event(AGENT_SESSION_ID, 1),
        received_agent_session_event(SECOND_AGENT_SESSION_ID, 2),
        received_thread_backfilled_event(EMAIL_THREAD_ID, 3),
        received_thread_backfilled_event(EMAIL_THREAD_ID, 4),
    ] {
        assert!(matches!(
            pool.handoff(Ok::<_, EventBrokerError>(event)).await,
            HandoffOutcome::HandedOff
        ));
    }
    drop(pool);

    let mut offsets = Vec::new();
    while let Some(event) = receivers[0].recv().await {
        offsets.push(event.offset);
    }
    assert_eq!(offsets, [1, 2, 3, 4]);
}

#[tokio::test]
async fn a_settled_session_never_holds_the_reread_its_next_turn_needs() {
    use ::agent_session::domain::{
        events::{AgentSessionLifecycleEvent, SessionSettledMetadata, TurnEndedMetadata},
        model::TurnId,
    };

    let (pool, mut receivers) = test_pool(1, 4);

    // `settled` changes nothing indexed. Had it taken the session's reread
    // claim, the `turn_ended` behind it would be coalesced into a reread that
    // is then skipped, and the reply would never be indexed.
    let settled = received_lifecycle_event(AGENT_SESSION_ID, 1, |identity| {
        AgentSessionLifecycleEvent::Settled(SessionSettledMetadata {
            identity,
            last_turn: None,
        })
    });
    let turn_ended = received_lifecycle_event(AGENT_SESSION_ID, 2, |identity| {
        AgentSessionLifecycleEvent::TurnEnded(TurnEndedMetadata {
            identity,
            turn: TurnId(4),
            action_id: serde_json::from_value(serde_json::json!(Uuid::from_u128(3))).unwrap(),
            actor: None,
            announcement_message_id: None,
            stop_reason: "end_turn".into(),
            queued_remaining: 0,
        })
    });
    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(settled)).await,
        HandoffOutcome::NoIndexChange
    ));
    assert!(matches!(
        pool.handoff(Ok::<_, EventBrokerError>(turn_ended)).await,
        HandoffOutcome::HandedOff
    ));
    drop(pool);

    let mut offsets = Vec::new();
    while let Some(event) = receivers[0].recv().await {
        offsets.push(event.offset);
    }
    assert_eq!(offsets, [2]);
}

#[tokio::test]
async fn closed_worker_releases_the_reread_claim() {
    let (pool, receivers) = test_pool(1, 1);
    drop(receivers);

    for offset in [1, 2] {
        assert!(matches!(
            pool.handoff(Ok::<_, EventBrokerError>(received_agent_session_event(
                AGENT_SESSION_ID,
                offset
            )))
            .await,
            HandoffOutcome::WorkerClosed
        ));
    }
}

#[tokio::test]
async fn events_with_the_same_ordering_key_stay_on_one_worker_in_order() {
    let (pool, mut receivers) = test_pool(WORKER_COUNT, WORKER_CHANNEL_CAPACITY);
    for offset in 0..8 {
        let event = received_thread_backfilled_event(EMAIL_THREAD_ID, offset);
        assert!(matches!(
            pool.handoff(Ok::<_, EventBrokerError>(event)).await,
            HandoffOutcome::HandedOff
        ));
    }
    drop(pool);

    let mut busy_workers = 0;
    for receiver in &mut receivers {
        let mut offsets = Vec::new();
        while let Some(event) = receiver.recv().await {
            offsets.push(event.offset);
        }
        if offsets.is_empty() {
            continue;
        }
        busy_workers += 1;
        assert_eq!(offsets, (0..8).collect::<Vec<_>>());
    }
    assert_eq!(busy_workers, 1, "one key must map to exactly one worker");
}

#[tokio::test]
async fn events_with_distinct_ordering_keys_spread_across_workers() {
    let (pool, mut receivers) = test_pool(WORKER_COUNT, 128);
    for index in 0..100 {
        let thread_id = Uuid::from_u128(1_000 + index);
        let event = received_thread_backfilled_event(thread_id, index as i64);
        assert!(matches!(
            pool.handoff(Ok::<_, EventBrokerError>(event)).await,
            HandoffOutcome::HandedOff
        ));
    }
    drop(pool);

    let busy_workers = receivers
        .iter_mut()
        .map(|receiver| receiver.try_recv().is_ok())
        .filter(|received| *received)
        .count();
    assert!(
        busy_workers > 1,
        "distinct ordering keys must spread across workers, got {busy_workers}"
    );
}

#[test]
fn email_events_shard_by_thread_and_link_scoped_events_by_producer_key() {
    let thread_scoped = DeclaredMacroEvent::EmailMacroEvent(EmailMacroEvent::new(
        EMAIL_LINK_ID.to_string(),
        received_email_event(false),
    ));
    assert_eq!(ordering_key(&thread_scoped), EMAIL_THREAD_ID.to_string());

    let link_scoped = DeclaredMacroEvent::EmailMacroEvent(EmailMacroEvent::new(
        EMAIL_LINK_ID.to_string(),
        EmailTopicEvent::LinkDisconnected(LinkDisconnectedMetadata {
            link_id: EMAIL_LINK_ID,
            owner: user_id(),
            email_address: "owner@example.com".to_string(),
            reason: LinkDisconnectReason::ManuallyDisabled,
        }),
    ));
    assert_eq!(ordering_key(&link_scoped), EMAIL_LINK_ID.to_string());

    let multi_thread = DeclaredMacroEvent::EmailMacroEvent(EmailMacroEvent::new(
        EMAIL_LINK_ID.to_string(),
        EmailTopicEvent::ThreadsReindexRequested(ThreadsReindexRequestedMetadata {
            link_id: EMAIL_LINK_ID,
            owner: user_id(),
            thread_ids: vec![EMAIL_THREAD_ID, SECOND_EMAIL_THREAD_ID],
            reason: ThreadsReindexReason::ContactsChanged,
        }),
    ));
    assert_eq!(ordering_key(&multi_thread), EMAIL_THREAD_ID.to_string());
}

#[test]
fn non_email_events_shard_by_their_producer_key() {
    let message = encoded_message(
        MacroCallsTopic::TOPIC_STR,
        CALL_ID,
        Event::new(archived_event()),
    );
    let call = DeclaredMacroEvent::decode(&message).expect("decodable call event");
    assert_eq!(ordering_key(&call), CALL_ID.to_string());

    let message = encoded_message(
        MacroDocumentsTopic::TOPIC_STR,
        DOCUMENT_ID,
        Event::new(DocumentTopicEvent::Purged(DocumentPurgedMetadata {
            document_id: DOCUMENT_ID.to_string(),
        })),
    );
    let document = DeclaredMacroEvent::decode(&message).expect("decodable document event");
    assert_eq!(ordering_key(&document), DOCUMENT_ID);
}

#[test]
fn production_worker_pool_matches_the_delivery_contract() {
    assert_eq!(WORKER_COUNT, 10);
    let (sender, _receiver) = mpsc::channel::<ReceivedEvent>(WORKER_CHANNEL_CAPACITY);
    assert_eq!(sender.max_capacity(), 16);
}

#[test]
fn standalone_call_deletion_indexes_by_call_without_channel_context() {
    let mut event = deleted_event();
    let CallTopicEvent::RecordDeleted(metadata) = &mut event else {
        panic!("deleted event fixture");
    };
    metadata.channel_id = None;
    assert_eq!(
        describe_call_event(&event).action,
        CallIndexAction::Remove {
            call_id: CALL_ID,
            channel_id: None,
        }
    );
}

/// Exports every finished span to memory, through the same OpenTelemetry layer
/// production uses, so tests see real parents and end times.
struct OtelCapture {
    exporter: opentelemetry_sdk::trace::InMemorySpanExporter,
    _provider: opentelemetry_sdk::trace::SdkTracerProvider,
    _guard: tracing::subscriber::DefaultGuard,
}

impl OtelCapture {
    fn install() -> Self {
        use opentelemetry::trace::TracerProvider as _;
        use tracing_subscriber::layer::SubscriberExt as _;

        let exporter = opentelemetry_sdk::trace::InMemorySpanExporter::default();
        let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder()
            .with_simple_exporter(exporter.clone())
            .build();
        let guard = tracing::subscriber::set_default(tracing_subscriber::registry().with(
            tracing_opentelemetry::layer().with_tracer(provider.tracer("search-processing-test")),
        ));
        Self {
            exporter,
            _provider: provider,
            _guard: guard,
        }
    }

    /// Call after a first pass has registered the callsites under test:
    /// another test thread may have cached a "never" interest for them before
    /// this subscriber existed, so recompute it and measure a second pass.
    fn rearm(&self) {
        tracing::callsite::rebuild_interest_cache();
        self.exporter.reset();
    }

    fn finished(&self, name: &str) -> Vec<opentelemetry_sdk::trace::SpanData> {
        self.exporter
            .get_finished_spans()
            .expect("in-memory exporter")
            .into_iter()
            .filter(|span| span.name == name)
            .collect()
    }
}

fn attribute(span: &opentelemetry_sdk::trace::SpanData, key: &str) -> Option<String> {
    span.attributes
        .iter()
        .find(|attribute| attribute.key.as_str() == key)
        .map(|attribute| attribute.value.to_string())
}

fn kafka_record(
    topic: &str,
    key: String,
    partition: i32,
    offset: i64,
) -> rdkafka::message::OwnedMessage {
    rdkafka::message::OwnedMessage::new(
        None,
        Some(key.into_bytes()),
        topic.to_owned(),
        rdkafka::message::Timestamp::CreateTime(1_000),
        partition,
        offset,
        None,
    )
}

#[tokio::test]
async fn coalesced_event_records_a_process_event_span_with_its_outcome() {
    let capture = OtelCapture::install();
    let (pool, _receivers) = test_pool(1, 8);

    for session in [SECOND_AGENT_SESSION_ID, AGENT_SESSION_ID] {
        capture.rearm();
        for offset in [1, 2] {
            let mut event = received_agent_session_event(session, offset);
            event.partition = 3;
            let _ = pool.handoff(Ok::<_, EventBrokerError>(event)).await;
        }
    }

    let spans = capture.finished("process_event");
    let [coalesced] = spans.as_slice() else {
        panic!("only the coalesced event has finished: {spans:?}");
    };
    assert_eq!(
        attribute(coalesced, "outcome").as_deref(),
        Some("coalesced")
    );
    assert_eq!(
        attribute(coalesced, "event_type").as_deref(),
        Some("agent_session.renamed")
    );
    assert_eq!(attribute(coalesced, "partition").as_deref(), Some("3"));
    assert_eq!(attribute(coalesced, "offset").as_deref(), Some("2"));
}

#[test]
fn received_record_span_names_its_event() {
    let capture = OtelCapture::install();
    let record = kafka_record(
        macro_event_topics::MacroAgentSessionLifecycleTopic::TOPIC_STR,
        AGENT_SESSION_ID.to_string(),
        1,
        4,
    );
    let mut id = None;
    for _ in 0..2 {
        capture.rearm();
        let event = received_agent_session_event(AGENT_SESSION_ID, 4).event;
        id = Some(event_id(&event));
        let (span, received) = receive_record(&record, || Ok::<_, EventBrokerError>(event));
        let received = received.expect("decoded record");
        assert_eq!(received.event_type, "agent_session.renamed");
        assert_eq!(received.produced_at_ms, Some(1_000));
        drop((span, received));
    }
    let id = id.expect("measured pass");

    let spans = capture.finished("kafka.process");
    let [record] = spans.as_slice() else {
        panic!("expected one record span, got {spans:?}");
    };
    assert_eq!(
        attribute(record, "macro.event.type").as_deref(),
        Some("agent_session.renamed")
    );
    assert_eq!(attribute(record, "macro.event.id"), Some(id.to_string()));
    assert_eq!(
        attribute(record, "agent.session.id"),
        Some(AGENT_SESSION_ID.to_string())
    );
    assert_eq!(
        attribute(record, "messaging.kafka.offset").as_deref(),
        Some("4")
    );
}

#[tokio::test]
async fn record_span_covers_processing_and_fails_with_a_dropped_event() {
    let capture = OtelCapture::install();
    let record = kafka_record(MacroEmailTopic::TOPIC_STR, EMAIL_LINK_ID.to_string(), 2, 7);
    for _ in 0..2 {
        capture.rearm();
        let event = received_thread_backfilled_event(EMAIL_THREAD_ID, 7).event;
        let (span, received) = receive_record(&record, || Ok::<_, EventBrokerError>(event));
        let received = received.expect("decoded record");
        // The poll loop is inside the record span only while it hands off.
        async {}.instrument(span.clone()).await;
        drop(span);

        process_received(
            &unread_metrics(),
            &received,
            &UnreachableReplays,
            |_| async {
                tokio::time::sleep(Duration::from_millis(20)).await;
                Err(exhausted(Failure::Overloaded))
            },
        )
        .await;
        drop(received);
    }

    let records = capture.finished("kafka.process");
    let processing = capture.finished("process_event");
    let ([record], [processing]) = (records.as_slice(), processing.as_slice()) else {
        panic!("expected one record and one processing span: {records:?} {processing:?}");
    };
    assert_eq!(processing.parent_span_id, record.span_context.span_id());
    assert!(
        record.end_time >= processing.end_time,
        "the record span must cover the processing it waited for"
    );
    for span in [record, processing] {
        assert!(
            matches!(span.status, opentelemetry::trace::Status::Error { .. }),
            "a dropped event fails {}",
            span.name
        );
    }
    assert_eq!(attribute(processing, "outcome").as_deref(), Some("dropped"));
    assert_eq!(
        attribute(processing, "failure").as_deref(),
        Some("overloaded")
    );
    assert_eq!(attribute(processing, "attempts").as_deref(), Some("8"));
    assert_eq!(
        attribute(processing, "entity_type").as_deref(),
        Some("email")
    );
    assert_eq!(attribute(processing, "delivery").as_deref(), Some("kafka"));
    assert_eq!(
        attribute(processing, "event_type").as_deref(),
        Some("email.thread_backfilled")
    );
    assert_eq!(
        attribute(processing, "entity_id"),
        Some(EMAIL_THREAD_ID.to_string())
    );
    assert!(attribute(processing, "record_age_ms").is_some());
}

/// A replay queue that cannot be reached.
struct UnreachableReplays;

impl ReplayQueue for UnreachableReplays {
    async fn replay_later(
        &self,
        _: sqs_client::search::replay::ReplayBrokerEvent,
        _: Duration,
    ) -> anyhow::Result<()> {
        anyhow::bail!("search event queue unreachable")
    }
}

/// Records each replay it is asked to queue.
#[derive(Default)]
struct RecordedReplays(Mutex<Vec<(sqs_client::search::replay::ReplayBrokerEvent, Duration)>>);

impl ReplayQueue for RecordedReplays {
    async fn replay_later(
        &self,
        replay: sqs_client::search::replay::ReplayBrokerEvent,
        delay: Duration,
    ) -> anyhow::Result<()> {
        self.0.lock().unwrap().push((replay, delay));
        Ok(())
    }
}

/// A replay queue that never answers.
struct HangingReplays;

impl ReplayQueue for HangingReplays {
    async fn replay_later(
        &self,
        _: sqs_client::search::replay::ReplayBrokerEvent,
        _: Duration,
    ) -> anyhow::Result<()> {
        std::future::pending().await
    }
}

#[tokio::test(start_paused = true)]
async fn an_event_whose_replay_cannot_be_queued_in_time_is_dropped() {
    let received = received_thread_backfilled_event(EMAIL_THREAD_ID, 3);

    let record =
        conclude_kafka_attempts(&received, Err(exhausted(Failure::Error)), &HangingReplays).await;

    assert_eq!(record.outcome, EventOutcome::Dropped);
    assert_eq!(record.failure, Some(Failure::Error));
}

fn exhausted(failure: Failure) -> Exhausted {
    Exhausted {
        error: "opensearch failed 1 of 2 bulk items".to_owned(),
        diagnosis: attempts::Diagnosis {
            failure,
            failed_items: 1,
        },
        attempts: attempts::OVERLOADED_MAX_ATTEMPTS,
    }
}

#[tokio::test]
async fn a_failed_event_is_queued_for_its_replay_from_the_record_as_read() {
    let capture = OtelCapture::install();
    let record = kafka_record(MacroEmailTopic::TOPIC_STR, EMAIL_LINK_ID.to_string(), 2, 7);
    let replays = RecordedReplays::default();
    for _ in 0..2 {
        capture.rearm();
        replays.0.lock().unwrap().clear();
        let message = encoded_message(
            MacroEmailTopic::TOPIC_STR,
            EMAIL_LINK_ID,
            Event::new(EmailTopicEvent::ThreadBackfilled(
                ThreadBackfilledMetadata {
                    link_id: EMAIL_LINK_ID,
                    owner: user_id(),
                    thread_id: EMAIL_THREAD_ID,
                },
            )),
        );
        let record = record.clone().set_payload(message.payload.clone());
        let (span, received) = receive_record(&record, || DeclaredMacroEvent::decode(&message));
        let received = received.expect("decoded record");
        drop(span);

        process_received(&unread_metrics(), &received, &replays, |_| async {
            Err(exhausted(Failure::BulkItems))
        })
        .await;
    }

    let queued = replays.0.lock().unwrap();
    let [(replay, delay)] = queued.as_slice() else {
        panic!("expected one replay, got {queued:?}");
    };
    assert_eq!(*delay, replay::REPLAY_DELAY);
    assert_eq!(
        (replay.topic.as_str(), replay.partition, replay.offset),
        (MacroEmailTopic::TOPIC_STR, 2, 7)
    );
    assert_eq!(replay.key, EMAIL_LINK_ID.to_string());
    assert_eq!(replay.produced_at_ms, Some(1_000));
    assert_eq!(replay.failure, "bulk_items");
    let replayed = replay::decode(replay).expect("the replay decodes as the record did");
    assert_eq!(event_type(&replayed), "email.thread_backfilled");
    assert_eq!(ordering_key(&replayed), EMAIL_THREAD_ID.to_string());

    let spans = capture.finished("process_event");
    let [processing] = spans.as_slice() else {
        panic!("expected one processing span, got {spans:?}");
    };
    assert_eq!(
        attribute(processing, "outcome").as_deref(),
        Some("retry_queued")
    );
    assert_eq!(
        attribute(processing, "failure").as_deref(),
        Some("bulk_items")
    );
    assert_eq!(attribute(processing, "failed_items").as_deref(), Some("1"));
    assert!(
        !matches!(
            processing.status,
            opentelemetry::trace::Status::Error { .. }
        ),
        "a queued replay is late, not lost"
    );
}

#[test]
fn a_replay_joins_the_trace_of_the_processing_that_failed() {
    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let capture = OtelCapture::install();
    for _ in 0..2 {
        capture.rearm();
        let failed = tracing::info_span!("failed_processing");
        let traceparent = failed.in_scope(replay::current_traceparent);
        drop(failed);
        let replayed = tracing::info_span!("replayed_processing");
        replay::adopt_traceparent(&replayed, traceparent.as_deref());
        drop(replayed);
    }

    let (failed, replayed) = (
        capture.finished("failed_processing"),
        capture.finished("replayed_processing"),
    );
    let ([failed], [replayed]) = (failed.as_slice(), replayed.as_slice()) else {
        panic!("expected one span each: {failed:?} {replayed:?}");
    };
    assert_eq!(
        replayed.span_context.trace_id(),
        failed.span_context.trace_id()
    );
    assert_eq!(replayed.parent_span_id, failed.span_context.span_id());
}

#[test]
fn every_event_names_its_entity_type() {
    let email = received_thread_backfilled_event(EMAIL_THREAD_ID, 1);
    let session = received_agent_session_event(AGENT_SESSION_ID, 2);

    assert_eq!(
        entity_type::EntityType::of(&email.event),
        entity_type::EntityType::Email
    );
    assert_eq!(
        <&'static str>::from(entity_type::EntityType::of(&session.event)),
        "agent_session"
    );
}

fn email_position(offset: i64) -> RecordPosition {
    RecordPosition {
        topic: "macro.email",
        partition: 0,
        offset,
    }
}

fn any_partition(_: &str, _: i32) -> bool {
    true
}

#[test]
fn a_record_keeps_one_ledger_key_from_receipt_to_completion() {
    let received = received_agent_session_event(AGENT_SESSION_ID, 3);
    let email = received_thread_backfilled_event(Uuid::from_u128(1), 4);

    assert_eq!(
        subscribed_topic(macro_event_topics::MacroAgentSessionLifecycleTopic::TOPIC_STR),
        Some(received.topic)
    );
    assert_eq!(
        subscribed_topic(MacroEmailTopic::TOPIC_STR),
        Some(email.topic)
    );
    assert_eq!(subscribed_topic("macro.unknown"), None);
}

#[test]
fn a_handed_off_record_stays_queued_and_a_skipped_one_finishes() {
    let mut ledger = OffsetLedger::default();
    for offset in 1..=4 {
        ledger.received(email_position(offset), None);
    }

    track_handoff::<EventBrokerError>(&mut ledger, email_position(1), &HandoffOutcome::HandedOff);
    track_handoff::<EventBrokerError>(&mut ledger, email_position(2), &HandoffOutcome::Coalesced);
    track_handoff(
        &mut ledger,
        email_position(3),
        &HandoffOutcome::MalformedRecord(EventBrokerError::MissingMessageKey),
    );
    track_handoff::<EventBrokerError>(
        &mut ledger,
        email_position(4),
        &HandoffOutcome::WorkerClosed,
    );
    ledger.received(email_position(5), None);
    track_handoff::<EventBrokerError>(
        &mut ledger,
        email_position(5),
        &HandoffOutcome::NoIndexChange,
    );

    assert_eq!(ledger.queued(), [email_position(1), email_position(4)]);
}

#[tokio::test]
async fn after_a_graceful_stop_a_worker_starts_no_queued_record() {
    let (sender, receiver) = mpsc::channel(4);
    let (report_sender, mut reports) = mpsc::unbounded_channel();
    sender
        .send(received_thread_backfilled_event(EMAIL_THREAD_ID, 9))
        .await
        .unwrap();
    drop(sender);
    let rewinding = CancellationToken::new();
    rewinding.cancel();
    let processed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let marked = Arc::clone(&processed);

    drain_worker_events(
        receiver,
        Arc::default(),
        report_sender,
        rewinding,
        move |_| {
            marked.store(true, std::sync::atomic::Ordering::SeqCst);
            std::future::ready(())
        },
    )
    .await;

    assert!(!processed.load(std::sync::atomic::Ordering::SeqCst));
    assert!(
        reports.try_recv().is_err(),
        "an unstarted record stays queued for the rewind"
    );
}

#[tokio::test]
async fn a_worker_reports_a_record_as_started_then_done() {
    let (sender, receiver) = mpsc::channel(4);
    let (report_sender, mut reports) = mpsc::unbounded_channel();
    let (release, released) = tokio::sync::oneshot::channel::<()>();
    let released = Arc::new(std::sync::Mutex::new(Some(released)));
    let worker = tokio::spawn(drain_worker_events(
        receiver,
        Arc::default(),
        report_sender,
        CancellationToken::new(),
        move |_received| {
            let released = released.lock().unwrap().take();
            async move {
                if let Some(released) = released {
                    let _ = released.await;
                }
            }
        },
    ));

    let event = received_thread_backfilled_event(Uuid::from_u128(1), 7);
    let position = event.position();
    sender.send(event).await.unwrap();
    assert_eq!(reports.recv().await, Some(WorkerReport::Started(position)));
    assert!(reports.try_recv().is_err(), "still processing");

    release.send(()).unwrap();
    assert_eq!(reports.recv().await, Some(WorkerReport::Done(position)));
    drop(sender);
    worker.await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_stop_rewinds_to_queued_records_and_not_to_one_a_worker_was_stuck_on() {
    let mut ledger = OffsetLedger::default();
    for offset in [10, 11, 12] {
        ledger.received(email_position(offset), None);
    }
    let (report_sender, mut reports) = mpsc::unbounded_channel();
    let (aborted_sender, aborted) = tokio::sync::oneshot::channel::<()>();
    let stuck = tokio::spawn(async move {
        let _ = report_sender.send(WorkerReport::Started(email_position(10)));
        let _held = (aborted_sender, report_sender);
        std::future::pending::<()>().await;
    });

    let started = tokio::time::Instant::now();
    let drained = drain_workers(
        vec![stuck],
        &mut reports,
        &mut ledger,
        Some(SHUTDOWN_DRAIN_DEADLINE),
    )
    .await;

    assert_eq!(started.elapsed(), SHUTDOWN_DRAIN_DEADLINE);
    assert_eq!(drained.aborted, 1);
    assert!(drained.panic.is_none());
    assert!(aborted.await.is_err(), "the stuck worker was aborted");
    assert_eq!(ledger.started_unfinished(), [email_position(10)]);
    assert_eq!(
        ledger.rewind_points(any_partition),
        [email_position(11)],
        "11 and 12 were still queued"
    );
}

#[tokio::test(start_paused = true)]
async fn after_an_error_the_drain_waits_for_the_workers_without_a_deadline() {
    let mut ledger = OffsetLedger::default();
    ledger.received(email_position(3), None);
    let (report_sender, mut reports) = mpsc::unbounded_channel();
    let worker = tokio::spawn(async move {
        tokio::time::sleep(SHUTDOWN_DRAIN_DEADLINE * 4).await;
        let _ = report_sender.send(WorkerReport::Done(email_position(3)));
    });

    let started = tokio::time::Instant::now();
    let drained = drain_workers(vec![worker], &mut reports, &mut ledger, None).await;

    assert_eq!(drained.aborted, 0);
    assert_eq!(started.elapsed(), SHUTDOWN_DRAIN_DEADLINE * 4);
    assert!(ledger.queued().is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_worker_that_panicked_before_the_stop_is_reported() {
    let (_report_sender, mut reports) = mpsc::unbounded_channel();
    let panicked = tokio::spawn(async { panic!("worker failed") });
    let hangs = tokio::spawn(std::future::pending::<()>());

    let drained = drain_workers(
        vec![panicked, hangs],
        &mut reports,
        &mut OffsetLedger::default(),
        Some(SHUTDOWN_DRAIN_DEADLINE),
    )
    .await;

    assert!(drained.panic.is_some_and(|error| error.is_panic()));
    assert_eq!(drained.aborted, 1);
}

#[tokio::test]
async fn processing_records_its_lag_and_counts_a_drop() {
    use super::metrics::{
        DROPPED, FAILED_BULK_ITEMS, LAG,
        test::{Recorded, tags},
    };

    let recorded = Recorded::new();
    let mut received = received_thread_backfilled_event(EMAIL_THREAD_ID, 7);
    received.produced_at_ms = Some(Utc::now().timestamp_millis() - 90_000);

    process_received(
        &recorded.metrics,
        &received,
        &UnreachableReplays,
        |_| async { Err(exhausted(Failure::BulkItems)) },
    )
    .await;

    let lag = recorded.points(LAG);
    let [lag] = lag.as_slice() else {
        panic!("one lag point: {lag:?}");
    };
    assert_eq!(
        lag.tags,
        tags(&[
            ("entity_type", "email"),
            ("event_type", "email.thread_backfilled"),
            ("outcome", "dropped"),
            ("delivery", "kafka"),
        ])
    );
    assert_eq!(lag.value, 1);
    assert!(
        lag.min.is_some_and(|lag_ms| lag_ms >= 90_000),
        "lag runs from the broker timestamp to the end of processing: {lag:?}"
    );
    let dropped = recorded.points(DROPPED);
    assert_eq!(
        dropped
            .iter()
            .map(|point| (point.tags.clone(), point.value))
            .collect::<Vec<_>>(),
        [(
            tags(&[
                ("entity_type", "email"),
                ("event_type", "email.thread_backfilled"),
                ("failure", "bulk_items"),
                ("delivery", "kafka"),
            ]),
            1
        )]
    );
    assert_eq!(
        recorded
            .points(FAILED_BULK_ITEMS)
            .iter()
            .map(|point| (point.tags.clone(), point.value))
            .collect::<Vec<_>>(),
        [(
            tags(&[
                ("entity_type", "email"),
                ("outcome", "dropped"),
                ("failure", "bulk_items"),
            ]),
            1
        )]
    );
}

#[tokio::test]
async fn failed_items_count_by_the_last_attempts_failure() {
    use super::metrics::{
        FAILED_BULK_ITEMS,
        test::{Recorded, tags},
    };

    let recorded = Recorded::new();
    let received = received_thread_backfilled_event(EMAIL_THREAD_ID, 7);
    let replays = RecordedReplays(Mutex::default());

    process_received(&recorded.metrics, &received, &replays, |_| async {
        Err(exhausted(Failure::Overloaded))
    })
    .await;

    // A refusal while OpenSearch protects itself, such as a drain's 429s,
    // counts apart from items it failed.
    assert_eq!(
        recorded
            .points(FAILED_BULK_ITEMS)
            .iter()
            .map(|point| (point.tags.clone(), point.value))
            .collect::<Vec<_>>(),
        [(
            tags(&[
                ("entity_type", "email"),
                ("outcome", "retry_queued"),
                ("failure", "overloaded"),
            ]),
            1
        )]
    );
}

#[tokio::test]
async fn an_indexed_event_is_not_counted_as_dropped() {
    use super::metrics::{DROPPED, LAG, test::Recorded};

    let recorded = Recorded::new();
    let mut received = received_thread_backfilled_event(EMAIL_THREAD_ID, 7);
    received.produced_at_ms = Some(Utc::now().timestamp_millis());

    process_received(
        &recorded.metrics,
        &received,
        &UnreachableReplays,
        |_| async { Ok((Handled::Indexed, 1)) },
    )
    .await;

    assert_eq!(
        recorded
            .points(LAG)
            .iter()
            .map(|point| point.tags["outcome"].as_str())
            .collect::<Vec<_>>(),
        ["indexed"]
    );
    assert!(recorded.points(DROPPED).is_empty());
}

/// Stands in for OpenSearch's answers to property writes, with bodies as
/// OpenSearch 3.5 returns them: [`PROJECT_ID`] is the only indexed project,
/// and no email thread is indexed.
async fn property_write_opensearch() -> opensearch_client::OpensearchClient {
    use axum::{
        http::{StatusCode, Uri},
        response::IntoResponse,
    };

    let app = axum::Router::new().fallback(|uri: Uri| async move {
        let path = uri.path();
        let (status, body) = if path == format!("/projects/_update/{PROJECT_ID}") {
            (
                StatusCode::OK,
                serde_json::json!({"_index": "projects", "_id": PROJECT_ID, "result": "updated"}),
            )
        } else if path.starts_with("/projects/_update/") {
            let error = serde_json::json!({
                "type": "document_missing_exception",
                "reason": "document missing",
                "index": "projects",
            });
            (
                StatusCode::NOT_FOUND,
                serde_json::json!({"error": {"root_cause": [error.clone()], "type": error["type"], "reason": error["reason"]}, "status": 404}),
            )
        } else if path == "/emails/_update_by_query" {
            (
                StatusCode::OK,
                serde_json::json!({"total": 0, "updated": 0, "version_conflicts": 0, "noops": 0, "failures": []}),
            )
        } else {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({"error": format!("unexpected request {path}")}),
            )
        };
        (status, axum::Json(body)).into_response()
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    opensearch_client::OpensearchClient::new(endpoint, String::new(), String::new()).unwrap()
}

/// Freshness reads `outcome:indexed`, so a property write that changes nothing
/// in the index, because the entity's type has no search index or the entity
/// is not indexed yet, must not count as one.
#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn property_writes_that_change_nothing_indexed_are_not_counted_as_indexed(
    pool: sqlx::PgPool,
) {
    use super::metrics::{LAG, test::Recorded};
    use properties::domain::events::PropertyMacroEvent;

    let opensearch = property_write_opensearch().await;
    let (pool, opensearch) = (&pool, &opensearch);
    let thread_id = EMAIL_THREAD_ID.to_string();
    let cases = [
        (PROJECT_ID, EntityType::Project, "indexed"),
        (
            "project-not-indexed",
            EntityType::Project,
            "no_index_change",
        ),
        (thread_id.as_str(), EntityType::Thread, "no_index_change"),
        ("company-id", EntityType::Company, "ignored"),
    ];
    for (offset, (entity_id, entity_type, outcome)) in (0..).zip(cases) {
        let recorded = Recorded::new();
        let event =
            PropertyMacroEvent::entity_properties_cleared(EntityPropertiesClearedMetadata {
                entity_id: entity_id.to_string(),
                entity_type,
                actor_user_id: None,
                actor: None,
                on_behalf_of: None,
            });
        let mut received = attach_event_coordinates(
            Ok::<_, EventBrokerError>(DeclaredMacroEvent::PropertyMacroEvent(event)),
            0,
            offset,
            tracing::Span::none(),
        )
        .expect("attached event");
        received.produced_at_ms = Some(Utc::now().timestamp_millis());

        process_received(
            &recorded.metrics,
            &received,
            &UnreachableReplays,
            |received| async move {
                let DeclaredMacroEvent::PropertyMacroEvent(event) = &received.event else {
                    unreachable!("a property event");
                };
                property::process_property_event(
                    pool,
                    opensearch,
                    event,
                    received.partition,
                    received.offset,
                    &Attempts::Once,
                )
                .await
            },
        )
        .await;

        assert_eq!(
            recorded
                .points(LAG)
                .iter()
                .map(|point| point.tags["outcome"].as_str())
                .collect::<Vec<_>>(),
            [outcome],
            "{entity_type:?} {entity_id}"
        );
    }
}

#[tokio::test]
async fn an_event_committed_at_handoff_records_its_lag_there() {
    use super::metrics::{LAG, test::Recorded};

    let recorded = Recorded::new();
    let (sender, _receiver) = mpsc::channel(4);
    let pool = WorkerPool::new(vec![sender], Arc::default(), recorded.metrics.clone());
    for offset in [1, 2] {
        let mut received = received_agent_session_event(AGENT_SESSION_ID, offset);
        received.produced_at_ms = Some(Utc::now().timestamp_millis());
        pool.handoff(Ok::<_, EventBrokerError>(received)).await;
    }

    assert_eq!(
        recorded
            .points(LAG)
            .iter()
            .map(|point| (
                point.tags["entity_type"].as_str(),
                point.tags["outcome"].as_str(),
                point.value
            ))
            .collect::<Vec<_>>(),
        [("agent_session", "coalesced", 1)],
        "the first reread is handed off; the second is coalesced into it"
    );
}

#[tokio::test(start_paused = true)]
async fn a_held_handoff_keeps_applying_reports_and_sampling() {
    let (release, released) = tokio::sync::oneshot::channel::<()>();
    let mut shutdown = std::pin::pin!(std::future::pending::<()>());
    let mut sample_tick = tokio::time::interval(backlog::SAMPLE_INTERVAL);
    let (worker_reports, mut reports) = mpsc::unbounded_channel();
    let mut ledger = OffsetLedger::default();
    ledger.received(email_position(1), None);
    ledger.received(email_position(2), None);
    worker_reports
        .send(WorkerReport::Started(email_position(1)))
        .expect("open reports");
    worker_reports
        .send(WorkerReport::Done(email_position(1)))
        .expect("open reports");
    let mut oldest_at_samples = Vec::new();

    let (outcome, ()) = tokio::join!(
        await_handoff(
            async move {
                released.await.ok();
                "handed off"
            },
            &mut shutdown,
            &mut sample_tick,
            &mut reports,
            &mut ledger,
            |ledger| {
                oldest_at_samples.push(
                    ledger
                        .oldest_open("macro.email", 0)
                        .map(|record| record.offset),
                )
            },
        ),
        async {
            tokio::time::sleep(Duration::from_secs(25)).await;
            release.send(()).expect("waiting handoff");
        }
    );

    assert_eq!(outcome, Some("handed off"));
    assert_eq!(
        oldest_at_samples,
        [Some(1), Some(2), Some(2)],
        "a sample at 0, 10 and 20 s; offset 1 finished while the handoff waited"
    );
}

#[tokio::test(start_paused = true)]
async fn a_stop_during_a_held_handoff_leaves_the_record_queued() {
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let mut shutdown = std::pin::pin!(async move {
        stopped.await.ok();
    });
    let mut sample_tick = tokio::time::interval(backlog::SAMPLE_INTERVAL);
    let (_worker_reports, mut reports) = mpsc::unbounded_channel();
    let mut ledger = OffsetLedger::default();
    ledger.received(email_position(3), None);

    let (outcome, ()) = tokio::join!(
        await_handoff(
            std::future::pending::<()>(),
            &mut shutdown,
            &mut sample_tick,
            &mut reports,
            &mut ledger,
            |_| {},
        ),
        async {
            tokio::time::sleep(Duration::from_secs(5)).await;
            stop.send(()).expect("waiting consumer");
        }
    );

    assert_eq!(outcome, None);
    assert_eq!(ledger.rewind_points(any_partition), [email_position(3)]);
}

fn on(partition: i32, offset: i64) -> RecordPosition {
    RecordPosition {
        topic: "macro.email",
        partition,
        offset,
    }
}

#[test]
fn a_graceful_stop_loses_what_its_rewind_does_not_redeliver() {
    let rewind = Rewind {
        rewound: vec![on(0, 6)],
        not_rewound: vec![on(2, 5), on(2, 7)],
        unconfirmed: vec![on(3, 1)],
    };

    assert_eq!(
        losses_at_stop(
            &[on(0, 4), on(0, 9), on(1, 2)],
            Some(&rewind),
            &[],
            Some(on(2, 7)),
        ),
        [
            (on(0, 4), Loss::CutOffAtStop),
            (on(1, 2), Loss::CutOffAtStop),
            (on(2, 5), Loss::NotRewound),
            (on(3, 1), Loss::RewindUnconfirmed),
        ],
        "0@9 is replayed from 0@6, and 2@7, held at the stop, was never committed"
    );
}

#[test]
fn a_stop_without_a_rewind_loses_every_queued_record_but_the_uncommitted_one() {
    assert_eq!(
        losses_at_stop(&[on(0, 4)], None, &[on(1, 3), on(1, 8)], Some(on(1, 8))),
        [
            (on(0, 4), Loss::CutOffAtStop),
            (on(1, 3), Loss::QueuedWithoutRewind),
        ],
        "1@8 met the closed worker channel and stays uncommitted"
    );
}

#[tokio::test]
async fn an_event_whose_source_is_gone_ends_without_a_replay() {
    let received = received_thread_backfilled_event(EMAIL_THREAD_ID, 4);
    let replays = RecordedReplays::default();

    let record =
        conclude_kafka_attempts(&received, Ok((Handled::SourceMissing, 1)), &replays).await;

    assert_eq!(record.outcome, EventOutcome::SourceMissing);
    assert_eq!(record.failure, None);
    assert!(replays.0.lock().unwrap().is_empty());
}
