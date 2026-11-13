use std::collections::HashSet;

use feature_flags::outbound::fake::FakeFeatureFlags;
use model_entity::{Entity, EntityType};
use model_notifications::{ChannelMessageSendMetadata, CommentedOnDocumentMetadata};
use notification::domain::models::{Notification, NotificationLane, TaggedContent};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use super::*;
use crate::domain::evaluate::DocumentPlacement;
use crate::domain::models::{RoutingRecord, StackKind, StackRule, StackSource};
use crate::domain::test_support::{FakePlacements, FakeStacks, flags, stack, user};

fn router(
    stacks: FakeStacks,
    placements: FakePlacements,
    flags: FakeFeatureFlags,
) -> StackRouter<FakeStacks, FakePlacements, FakeFeatureFlags> {
    StackRouter::new(stacks, placements, flags)
}

fn support_message() -> TaggedContent<ChannelMessageSendMetadata> {
    TaggedContent::new(
        serde_json::from_value(json!({
            "messageId": "message-1",
            "messageContent": "hello",
            "channelType": "private",
            "channelName": "Macro Support: Acme",
        }))
        .unwrap(),
    )
}

fn task_comment() -> TaggedContent<CommentedOnDocumentMetadata> {
    TaggedContent::new(
        serde_json::from_value(json!({
            "documentName": "Ship it",
            "owner": "macro|owner@example.com",
            "fileType": "md",
            "subType": { "type": "task" },
            "commentId": 1,
            "threadId": 1,
            "text": "hello",
        }))
        .unwrap(),
    )
}

fn routed<'a, T>(
    notification: &'a TaggedContent<T>,
    notification_type: &'a str,
    entity: &'a Entity<'a>,
    recipients: &'a HashSet<MacroUserIdStr<'a>>,
) -> RoutedNotification<'a, T> {
    RoutedNotification {
        notification_id: Uuid::nil(),
        notification_type,
        notification,
        entity,
        sender_id: None,
        recipients,
    }
}

fn support_stack(id: u128) -> NotificationStack {
    stack(
        id,
        vec![StackRule {
            sources: vec![StackSource::ChannelNameContains {
                text: "macro support".to_string(),
            }],
            ..Default::default()
        }],
        vec![StackRule {
            kinds: vec![StackKind::Mention],
            ..Default::default()
        }],
    )
}

fn folder_stack(id: u128) -> NotificationStack {
    stack(
        id,
        vec![StackRule {
            sources: vec![StackSource::Folder {
                id: "folder-top".to_string(),
            }],
            ..Default::default()
        }],
        vec![],
    )
}

#[tokio::test]
async fn each_recipient_is_routed_by_their_own_stacks() {
    let with_stack = user("with-stack@example.com");
    let without = user("without@example.com");
    let router = router(
        FakeStacks::default().with(&with_stack, support_stack(7)),
        FakePlacements::default(),
        flags(&[&with_stack, &without], &[]),
    );
    let message = support_message();
    let channel = EntityType::Channel.with_entity_str("channel-1");
    let recipients = HashSet::from([with_stack.clone(), without]);

    let routes = router
        .route(routed(
            &message,
            "channel_message_send",
            &channel,
            &recipients,
        ))
        .await
        .unwrap();

    assert_eq!(routes.len(), 1);
    let route = &routes[&with_stack];
    assert_eq!(route.lane, NotificationLane::Noise);
    assert_eq!(route.stack_id, Some(Uuid::from_u128(7)));
    assert_eq!(
        serde_json::from_value::<RoutingRecord>(route.routing.clone()).unwrap(),
        RoutingRecord {
            stack_id: Uuid::from_u128(7),
            stack_revision: 1,
            outcome: RoutingOutcome::Captured,
            capture_rule: 0,
            release_rule: None,
        }
    );
}

#[tokio::test]
async fn a_released_notification_keeps_no_stack_and_records_why() {
    let owner = user("owner@example.com");
    let router = router(
        FakeStacks::default().with(&owner, support_stack(7)),
        FakePlacements::default(),
        flags(&[&owner], &[]),
    );
    let mention: TaggedContent<model_notifications::ChannelMentionMetadata> = TaggedContent::new(
        serde_json::from_value(json!({
            "messageId": "message-1",
            "messageContent": "hello",
            "channelType": "private",
            "channelName": "Macro Support: Acme",
        }))
        .unwrap(),
    );
    let channel = EntityType::Channel.with_entity_str("channel-1");
    let recipients = HashSet::from([owner.clone()]);

    let routes = router
        .route(routed(&mention, "channel_mention", &channel, &recipients))
        .await
        .unwrap();

    let route = &routes[&owner];
    assert_eq!(route.lane, NotificationLane::Signal);
    assert_eq!(route.stack_id, None);
    assert_eq!(route.routing["outcome"], "released");
    assert_eq!(route.routing["stackId"], json!(Uuid::from_u128(7)));
    assert_eq!(route.routing["releaseRule"], 0);
}

#[tokio::test]
async fn stacks_route_nothing_for_someone_they_are_off_for() {
    let on = user("on@example.com");
    let off = user("off@example.com");
    let unreadable = user("unreadable@example.com");
    let router = router(
        FakeStacks::default()
            .with(&on, support_stack(1))
            .with(&off, support_stack(2))
            .with(&unreadable, support_stack(3)),
        FakePlacements::default(),
        // A flag that cannot be read counts as off, so the notification is
        // delivered as usual.
        flags(&[&on], &[&off]),
    );
    let message = support_message();
    let channel = EntityType::Channel.with_entity_str("channel-1");
    let recipients = HashSet::from([on.clone(), off, unreadable]);

    let routes = router
        .route(routed(
            &message,
            "channel_message_send",
            &channel,
            &recipients,
        ))
        .await
        .unwrap();

    assert_eq!(routes.keys().collect::<Vec<_>>(), vec![&on]);
}

#[tokio::test]
async fn a_disabled_stack_routes_nothing() {
    let owner = user("owner@example.com");
    let disabled = NotificationStack {
        enabled: false,
        ..support_stack(1)
    };
    let router = router(
        FakeStacks::default().with(&owner, disabled),
        FakePlacements::default(),
        flags(&[&owner], &[]),
    );
    let message = support_message();
    let channel = EntityType::Channel.with_entity_str("channel-1");
    let recipients = HashSet::from([owner]);

    let routes = router
        .route(routed(
            &message,
            "channel_message_send",
            &channel,
            &recipients,
        ))
        .await
        .unwrap();

    assert!(routes.is_empty());
}

#[tokio::test]
async fn a_folder_stack_reads_where_the_document_is_filed() {
    let owner = user("owner@example.com");
    let placements = FakePlacements {
        placement: DocumentPlacement {
            folders: vec!["folder-leaf".to_string(), "folder-top".to_string()],
            project: None,
        },
        ..Default::default()
    };
    let reads = placements.reads.clone();
    let router = router(
        FakeStacks::default().with(&owner, folder_stack(1)),
        placements,
        flags(&[&owner], &[]),
    );
    let comment = task_comment();
    let document = EntityType::Document.with_entity_str("document-1");
    let recipients = HashSet::from([owner.clone()]);

    let routes = router
        .route(routed(
            &comment,
            "commented_on_document",
            &document,
            &recipients,
        ))
        .await
        .unwrap();

    assert_eq!(routes[&owner].stack_id, Some(Uuid::from_u128(1)));
    assert_eq!(
        *reads.lock().unwrap(),
        vec![("document-1".to_string(), true)]
    );
}

#[tokio::test]
async fn where_a_document_is_filed_is_not_read_unless_a_stack_asks() {
    let owner = user("owner@example.com");
    let placements = FakePlacements::default();
    let reads = placements.reads.clone();
    let router = router(
        FakeStacks::default().with(&owner, support_stack(1)),
        placements,
        flags(&[&owner], &[]),
    );
    let comment = task_comment();
    let document = EntityType::Document.with_entity_str("document-1");
    let recipients = HashSet::from([owner]);

    let routes = router
        .route(routed(
            &comment,
            "commented_on_document",
            &document,
            &recipients,
        ))
        .await
        .unwrap();

    assert!(routes.is_empty());
    assert!(reads.lock().unwrap().is_empty());
}

#[derive(serde::Serialize, Deserialize)]
struct NewKind {
    detail: String,
}

impl Notification for NewKind {
    const TYPE_NAME: &'static str = "a_kind_this_crate_cannot_read";
}

#[tokio::test]
async fn a_type_the_router_cannot_read_routes_nobody() {
    let owner = user("owner@example.com");
    let router = router(
        FakeStacks::default().with(&owner, support_stack(1)),
        FakePlacements::default(),
        flags(&[&owner], &[]),
    );
    let unknown = TaggedContent::new(NewKind {
        detail: "x".to_string(),
    });
    let channel = EntityType::Channel.with_entity_str("channel-1");
    let recipients = HashSet::from([owner]);

    let routes = router
        .route(routed(&unknown, NewKind::TYPE_NAME, &channel, &recipients))
        .await
        .unwrap();

    assert!(routes.is_empty());
}
