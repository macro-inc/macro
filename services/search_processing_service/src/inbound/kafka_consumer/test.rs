use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

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
        ChannelCreatedMetadata, ChannelDeletedMetadata, ChannelMessageAttachmentCreatedMetadata,
        ChannelMessageAttachmentRemovedMetadata, ChannelMessageDeletedMetadata,
        ChannelMessagePatchedMetadata, ChannelMessagePostedMetadata,
        ChannelParticipantAddedMetadata, ChannelParticipantRemovedMetadata, ChannelTopicEvent,
        ChannelUpdatedMetadata,
    },
    models::{ChannelSender, ChannelType},
};
use chrono::Utc;
use documents::domain::events::{
    DocumentContentUploadedMetadata, DocumentCopiedMetadata, DocumentCreatedMetadata,
    DocumentDeletedMetadata, DocumentInteractionMetadata, DocumentPurgedMetadata,
    DocumentSyncContentUpdatedMetadata, DocumentTopicEvent, DocumentUpdatedMetadata,
    InteractionReason,
};
use macro_event_broker::{Event, EventBrokerError, MacroEvent as _, MessageParts};
use macro_event_topics::{
    MacroCalendarTopic, MacroCallsTopic, MacroChannelsTopic, MacroChatsTopic, MacroDocumentsTopic,
    MacroEmailTopic, MacroProjectsTopic, MacroPropertiesTopic, Topic as _,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
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

use super::{
    call::{CallEventDescription, CallIndexAction, describe_call_event},
    channel::{ChannelEventDescription, ChannelIndexAction, describe_channel_event},
    chat::{ChatEventDescription, ChatIndexAction, describe_chat_event},
    document::{
        DocumentEventDescription, DocumentIndexAction, describe_document_event,
        stored_extractor_message, sync_extractor_message,
    },
    email::{EmailEventDescription, EmailIndexAction, describe_email_event},
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

/// Builds a [`WorkerPool`] whose worker channels are captured as receivers.
fn test_pool(workers: usize, capacity: usize) -> (WorkerPool, Vec<mpsc::Receiver<ReceivedEvent>>) {
    let (senders, receivers) = (0..workers).map(|_| mpsc::channel(capacity)).unzip();
    (WorkerPool::new(senders), receivers)
}

fn received_thread_backfilled_event(thread_id: Uuid, offset: i64) -> ReceivedEvent {
    ReceivedEvent {
        event: DeclaredMacroEvent::EmailMacroEvent(EmailMacroEvent::new(
            EMAIL_LINK_ID.to_string(),
            EmailTopicEvent::ThreadBackfilled(ThreadBackfilledMetadata {
                link_id: EMAIL_LINK_ID,
                owner: user_id(),
                thread_id,
            }),
        )),
        partition: 0,
        offset,
    }
}

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).expect("valid user id")
}

fn started_event() -> CallTopicEvent {
    CallTopicEvent::Started(CallStartedMetadata {
        call_id: CALL_ID,
        channel_id: CHANNEL_ID,
        created_by: user_id(),
        created_at: Utc::now(),
        recording_enabled: true,
    })
}

fn archived_event() -> CallTopicEvent {
    CallTopicEvent::RecordArchived(CallRecordArchivedMetadata {
        call_id: CALL_ID,
        channel_id: CHANNEL_ID,
        created_by: user_id(),
        started_at: Utc::now(),
        ended_at: Utc::now(),
        duration_ms: Some(1_000),
        participant_count: 2,
        has_recording: true,
        archive_reason: CallArchiveReason::LastParticipantLeft,
    })
}

fn updated_event() -> CallTopicEvent {
    CallTopicEvent::RecordUpdated(CallRecordUpdatedMetadata {
        call_id: CALL_ID,
        channel_id: CHANNEL_ID,
        actor_user_id: Some(user_id()),
        custom_name: Some("Renamed call".to_string()),
        share_with_team: None,
    })
}

fn deleted_event() -> CallTopicEvent {
    CallTopicEvent::RecordDeleted(CallRecordDeletedMetadata {
        call_id: CALL_ID,
        channel_id: CHANNEL_ID,
        actor_user_id: Some(user_id()),
    })
}

fn summarized_event() -> CallTopicEvent {
    CallTopicEvent::RecordSummarized(CallRecordSummarizedMetadata {
        call_id: CALL_ID,
        channel_id: CHANNEL_ID,
        ai_name_generated: true,
    })
}

fn recording_ready_event() -> CallTopicEvent {
    CallTopicEvent::RecordingReady(CallRecordingReadyMetadata {
        call_id: CALL_ID,
        channel_id: CHANNEL_ID,
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
                owner: owner.clone(),
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
            ChannelTopicEvent::MessagePosted(ChannelMessagePostedMetadata {
                channel_id: CHANNEL_ID,
                message_id: MESSAGE_ID,
                thread_id: None,
                sender: sender.clone(),
                triggered_by: None,
                channel_type: ChannelType::Private,
                content: "hello".to_string(),
                mentions: vec![],
                attachments: vec![],
                created_at: Utc::now(),
            }),
            ChannelEventDescription {
                action: ChannelIndexAction::UpsertMessage {
                    channel_id: CHANNEL_ID,
                    message_id: MESSAGE_ID,
                },
                channel_id: CHANNEL_ID,
                event_type: "channel.message_posted",
            },
        ),
        (
            ChannelTopicEvent::MessagePatched(ChannelMessagePatchedMetadata {
                channel_id: CHANNEL_ID,
                message_id: MESSAGE_ID,
                thread_id: None,
                actor: sender.clone(),
                content: "edited".to_string(),
                edited_at: Some(Utc::now()),
                updated_at: Utc::now(),
            }),
            ChannelEventDescription {
                action: ChannelIndexAction::UpsertMessage {
                    channel_id: CHANNEL_ID,
                    message_id: MESSAGE_ID,
                },
                channel_id: CHANNEL_ID,
                event_type: "channel.message_patched",
            },
        ),
        (
            ChannelTopicEvent::MessageDeleted(ChannelMessageDeletedMetadata {
                channel_id: CHANNEL_ID,
                message_id: MESSAGE_ID,
                thread_id: None,
                actor: sender.clone(),
                deleted_at: Some(Utc::now()),
            }),
            ChannelEventDescription {
                action: ChannelIndexAction::RemoveMessage {
                    channel_id: CHANNEL_ID,
                    message_id: MESSAGE_ID,
                },
                channel_id: CHANNEL_ID,
                event_type: "channel.message_deleted",
            },
        ),
        (
            ChannelTopicEvent::MessageAttachmentCreated(ChannelMessageAttachmentCreatedMetadata {
                channel_id: CHANNEL_ID,
                message_id: MESSAGE_ID,
                actor: sender.clone(),
                attachments: vec![],
            }),
            ChannelEventDescription {
                action: ChannelIndexAction::UpsertMessage {
                    channel_id: CHANNEL_ID,
                    message_id: MESSAGE_ID,
                },
                channel_id: CHANNEL_ID,
                event_type: "channel.message_attachment_created",
            },
        ),
        (
            ChannelTopicEvent::MessageAttachmentRemoved(ChannelMessageAttachmentRemovedMetadata {
                channel_id: CHANNEL_ID,
                message_id: MESSAGE_ID,
                actor: sender.clone(),
                attachments: vec![],
            }),
            ChannelEventDescription {
                action: ChannelIndexAction::UpsertMessage {
                    channel_id: CHANNEL_ID,
                    message_id: MESSAGE_ID,
                },
                channel_id: CHANNEL_ID,
                event_type: "channel.message_attachment_removed",
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

fn document_event_cases() -> Vec<(DocumentTopicEvent, DocumentEventDescription)> {
    let owner = user_id();

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
                document_id: DOCUMENT_ID.to_string(),
                owner: owner.clone(),
                actor_user_id: Some(owner.clone()),
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
                document_id: DOCUMENT_ID.to_string(),
                owner: owner.clone(),
                actor_user_id: Some(owner.clone()),
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
                document_id: DOCUMENT_ID.to_string(),
                actor_user_id: Some(owner.clone()),
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
            DocumentTopicEvent::Copied(DocumentCopiedMetadata {
                document_id: DOCUMENT_ID.to_string(),
                source_document_id: SOURCE_DOCUMENT_ID.to_string(),
                source_version_id: Some(7),
                owner,
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
    let owner = user_id();

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
                entity_property_id: ENTITY_PROPERTY_ID,
                entity_id: PROPERTY_ENTITY_ID.to_string(),
                entity_type: EntityType::Document,
                property_definition_id: PROPERTY_DEFINITION_ID,
                actor_user_id: actor_user_id.clone(),
                actor: None,
                on_behalf_of: None,
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
                channel_id: CHANNEL_ID,
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
    assert_eq!(cases.len(), 18);

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
    assert_eq!(cases.len(), 10);

    for (event, expected) in cases {
        let serialized = serde_json::to_value(&event).expect("serializable channel event");
        assert_eq!(serialized["event_type"], expected.event_type);
        assert_eq!(describe_channel_event(&event), expected);
    }
}

#[test]
fn maps_all_document_lifecycle_events_to_index_actions() {
    let cases = document_event_cases();
    assert_eq!(cases.len(), 9);

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
        owner: user_id(),
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
        owner: user_id(),
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
                    owner: user_id(),
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
    let malformed = attach_event_coordinates(DeclaredMacroEvent::decode(&malformed), 7, 60);

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
    let missing_key = attach_event_coordinates(DeclaredMacroEvent::decode(&missing_key), 7, 61);

    let unsupported = encoded_message(
        MacroEmailTopic::TOPIC_STR,
        EMAIL_LINK_ID,
        Event::with_schema_version(draft_email_event(false), 2),
    );
    let unsupported = attach_event_coordinates(DeclaredMacroEvent::decode(&unsupported), 7, 62);
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
    let malformed = attach_event_coordinates(DeclaredMacroEvent::decode(&malformed), 5, 40);
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
    let unsupported = attach_event_coordinates(DeclaredMacroEvent::decode(&unsupported), 5, 41);
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
        owner: user_id(),
        actor_user_id: Some(user_id()),
        parent_project_id: None,
        restored_project_ids: vec![PROJECT_ID.to_string()],
    });
    let message = encoded_message(
        MacroProjectsTopic::TOPIC_STR,
        PROJECT_ID,
        Event::with_schema_version(event, 2),
    );
    let decoded = attach_event_coordinates(DeclaredMacroEvent::decode(&message), 4, 30);
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
    let decoded = attach_event_coordinates(DeclaredMacroEvent::decode(&message), 6, 50);
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
    });
    let message = encoded_message(
        MacroChannelsTopic::TOPIC_STR,
        CHANNEL_ID,
        Event::with_schema_version(event, 2),
    );
    let decoded = attach_event_coordinates(DeclaredMacroEvent::decode(&message), 2, 20);
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
    let malformed = attach_event_coordinates(DeclaredMacroEvent::decode(&malformed), 1, 10);
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
    let missing_key = attach_event_coordinates(DeclaredMacroEvent::decode(&missing_key), 1, 11);
    assert!(matches!(
        missing_key,
        Err(EventBrokerError::MissingMessageKey)
    ));

    let unsupported = encoded_message(
        MacroCallsTopic::TOPIC_STR,
        CALL_ID,
        Event::with_schema_version(archived_event(), 2),
    );
    let unsupported = attach_event_coordinates(DeclaredMacroEvent::decode(&unsupported), 1, 12);
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
    let decoded = attach_event_coordinates(DeclaredMacroEvent::decode(&message), 3, 42);
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
    let decoded = attach_event_coordinates(DeclaredMacroEvent::decode(&message), 3, 42);
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
    assert_eq!(ordering_key(&multi_thread), EMAIL_LINK_ID.to_string());
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
fn production_worker_pool_and_retry_bounds_match_the_delivery_contract() {
    assert_eq!(WORKER_COUNT, 10);
    let (sender, _receiver) = mpsc::channel::<ReceivedEvent>(WORKER_CHANNEL_CAPACITY);
    assert_eq!(sender.max_capacity(), 16);
    assert_eq!(
        processing_retry_strategy().collect::<Vec<_>>(),
        [Duration::from_secs(1), Duration::from_secs(2)]
    );
}

#[tokio::test]
async fn processing_retries_until_success() {
    let attempts = Arc::new(AtomicU32::new(0));
    let operation_attempts = Arc::clone(&attempts);

    retry_processing_with_strategy(std::iter::repeat_n(Duration::ZERO, 4), move |_| {
        let operation_attempts = Arc::clone(&operation_attempts);
        async move {
            let attempt = operation_attempts.fetch_add(1, Ordering::SeqCst) + 1;
            if attempt <= 2 {
                Err("temporary processing failure")
            } else {
                Ok(())
            }
        }
    })
    .await
    .expect("third processing attempt succeeds");

    assert_eq!(attempts.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn processing_is_dropped_after_exactly_three_failed_attempts() {
    let attempts = Arc::new(AtomicU32::new(0));
    let operation_attempts = Arc::clone(&attempts);

    retry_processing_with_strategy(std::iter::repeat_n(Duration::ZERO, 2), move |_| {
        let operation_attempts = Arc::clone(&operation_attempts);
        async move {
            operation_attempts.fetch_add(1, Ordering::SeqCst);
            Err::<(), _>("persistent processing failure")
        }
    })
    .await
    .expect_err("persistent processing failure is dropped by the worker");

    assert_eq!(attempts.load(Ordering::SeqCst), MAX_PROCESSING_ATTEMPTS);
}
