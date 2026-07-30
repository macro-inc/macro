use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use call::domain::events::{
    CallArchiveReason, CallRecordArchivedMetadata, CallRecordDeletedMetadata,
    CallRecordSummarizedMetadata, CallRecordUpdatedMetadata, CallRecordingReadyMetadata,
    CallStartedMetadata,
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
use macro_event_broker::{Event, EventBrokerError, MacroEvent as _, MessageParts};
use macro_event_topics::{MacroCallsTopic, MacroChannelsTopic, Topic as _};
use macro_user_id::user_id::MacroUserIdStr;

use super::*;

const CALL_ID: Uuid = Uuid::from_u128(1);
const CHANNEL_ID: Uuid = Uuid::from_u128(2);
const MESSAGE_ID: Uuid = Uuid::from_u128(3);

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
    key: Uuid,
    event: Event<E>,
) -> TestMessage {
    TestMessage {
        topic,
        key: Some(key.to_string()),
        payload: Some(serde_json::to_vec(&event).expect("serializable broker event")),
    }
}

fn channel_event_cases() -> Vec<(ChannelTopicEvent, ChannelEventDescription)> {
    let sender = channel_sender();

    vec![
        (
            ChannelTopicEvent::Created(ChannelCreatedMetadata {
                channel_id: CHANNEL_ID,
                actor: sender.clone(),
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

#[test]
fn subscribes_to_declared_search_processing_topics_with_durable_group() {
    assert_eq!(
        SearchProcessingConsumerGroup::GROUP_NAME,
        "search-processing-service"
    );
    let topics = SearchProcessingBrokerEvent::topics();
    assert!(topics.contains(&MacroCallsTopic::TOPIC_STR));
    assert!(topics.contains(&MacroChannelsTopic::TOPIC_STR));
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

    let decoded = SearchProcessingBrokerEvent::decode(&message).expect("decodable channel event");
    let SearchProcessingBrokerEvent::ChannelMacroEvent(decoded_event) = decoded else {
        panic!("expected channel event");
    };
    assert_eq!(decoded_event.key(), CHANNEL_ID.to_string());
    assert_eq!(decoded_event.event().event, event);
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
    let decoded = attach_event_coordinates(SearchProcessingBrokerEvent::decode(&message), 2, 20);
    let (sender, mut receiver) = mpsc::channel(1);

    match handoff_decoded(&sender, decoded).await {
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
        receiver.try_recv(),
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
    let malformed =
        attach_event_coordinates(SearchProcessingBrokerEvent::decode(&malformed), 1, 10);
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
    let missing_key =
        attach_event_coordinates(SearchProcessingBrokerEvent::decode(&missing_key), 1, 11);
    assert!(matches!(
        missing_key,
        Err(EventBrokerError::MissingMessageKey)
    ));

    let unsupported = encoded_message(
        MacroCallsTopic::TOPIC_STR,
        CALL_ID,
        Event::with_schema_version(archived_event(), 2),
    );
    let unsupported =
        attach_event_coordinates(SearchProcessingBrokerEvent::decode(&unsupported), 1, 12);
    assert!(matches!(
        unsupported,
        Err(EventBrokerError::UnsupportedSchemaVersion {
            expected: 1,
            actual: 2,
            ..
        })
    ));

    let (sender, mut receiver) = mpsc::channel(1);
    for decoded in [malformed, missing_key, unsupported] {
        assert!(matches!(
            handoff_decoded(&sender, decoded).await,
            HandoffOutcome::MalformedRecord(_)
        ));
    }
    assert!(matches!(
        receiver.try_recv(),
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
    let decoded = attach_event_coordinates(SearchProcessingBrokerEvent::decode(&message), 3, 42);
    let (sender, mut receiver) = mpsc::channel(1);

    assert!(matches!(
        handoff_decoded(&sender, decoded).await,
        HandoffOutcome::HandedOff
    ));

    let received = receiver.recv().await.expect("handed-off event");
    assert_eq!(received.partition, 3);
    assert_eq!(received.offset, 42);
    let SearchProcessingBrokerEvent::CallMacroEvent(received_event) = received.event else {
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
    let decoded = attach_event_coordinates(SearchProcessingBrokerEvent::decode(&message), 3, 42);
    let (sender, receiver) = mpsc::channel(1);
    drop(receiver);

    assert!(matches!(
        handoff_decoded(&sender, decoded).await,
        HandoffOutcome::WorkerClosed
    ));
}

#[tokio::test]
async fn bounded_handoff_blocks_when_full_and_preserves_order() {
    let (sender, mut receiver) = mpsc::channel(1);
    assert!(matches!(
        handoff_decoded(&sender, Ok::<_, ()>(1)).await,
        HandoffOutcome::HandedOff
    ));

    let blocked_handoff =
        tokio::spawn(async move { handoff_decoded(&sender, Ok::<_, ()>(2)).await });
    tokio::task::yield_now().await;
    assert!(
        !blocked_handoff.is_finished(),
        "handoff must wait while the bounded channel is full"
    );

    assert_eq!(receiver.recv().await, Some(1));
    assert!(matches!(
        blocked_handoff.await.expect("handoff task did not panic"),
        HandoffOutcome::HandedOff
    ));
    assert_eq!(receiver.recv().await, Some(2));
}

#[test]
fn production_channel_and_retry_bounds_match_the_delivery_contract() {
    let (sender, _receiver) = mpsc::channel::<ReceivedEvent>(CHANNEL_CAPACITY);
    assert_eq!(sender.max_capacity(), 128);
    assert_eq!(
        processing_retry_strategy().collect::<Vec<_>>(),
        [
            Duration::from_secs(1),
            Duration::from_secs(2),
            Duration::from_secs(4),
            Duration::from_secs(8),
        ]
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
async fn processing_is_dropped_after_exactly_five_failed_attempts() {
    let attempts = Arc::new(AtomicU32::new(0));
    let operation_attempts = Arc::clone(&attempts);

    retry_processing_with_strategy(std::iter::repeat_n(Duration::ZERO, 4), move |_| {
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
