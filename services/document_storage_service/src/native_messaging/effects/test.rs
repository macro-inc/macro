use super::*;
use activity::Activity;
use channel_sender::ChannelSender;
use chrono::Utc;
use messages::domain::models::{
    ImportedAuthor, Message, MessageParent, PostMessageNotificationPolicy,
};
use notification::domain::{
    models::queue_message::{IngressQueueMessage, RawIngressQueueMessage},
    ports::NotificationIngressQueue,
    service::SqsNotificationIngress,
};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Clone, Default)]
struct Captured {
    soup: Arc<Mutex<Vec<SoupRealtimePatch>>>,
    activities: Arc<Mutex<Vec<Activity>>>,
    notifications: Arc<Mutex<Vec<Value>>>,
    fail_soup: Arc<std::sync::atomic::AtomicBool>,
}

impl SoupRealtimeService for Captured {
    async fn notify_users(&self, patch: SoupRealtimePatch) -> Result<(), rootcause::Report> {
        if self.fail_soup.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(rootcause::report!("fixture delivery failure"));
        }
        self.soup.lock().unwrap().push(patch);
        Ok(())
    }
}

impl ActivityRepo for Captured {
    type Err = std::io::Error;
    async fn insert_activities(&self, activities: &[Activity]) -> Result<(), Self::Err> {
        self.activities
            .lock()
            .unwrap()
            .extend_from_slice(activities);
        Ok(())
    }
    async fn purge_entities(&self, _: &[(EntityType, String)]) -> Result<(), Self::Err> {
        panic!("message publication must not purge activity")
    }
}

impl ActivityRealtimePublisher for Captured {
    async fn publish_recorded(&self, _: &[Activity]) {}
    async fn publish_invalidated(&self) {
        panic!("message publication must not invalidate activity")
    }
}

impl NotificationIngressQueue for Captured {
    async fn publish(&self, message: IngressQueueMessage) -> Result<(), rootcause::Report> {
        self.notifications
            .lock()
            .unwrap()
            .push(serde_json::to_value(message).unwrap());
        Ok(())
    }
    async fn receive_messages(&self) -> Result<Vec<RawIngressQueueMessage>, rootcause::Report> {
        panic!("effects only produce notifications")
    }
    async fn delete_message(&self, _: &str) -> Result<(), rootcause::Report> {
        panic!("effects only produce notifications")
    }
}

fn publisher(capture: &Captured) -> impl NativeMessageEffects {
    NativeEffects {
        soup: capture.clone(),
        activity: ActivityMaterializer::new(capture.clone(), capture.clone()),
        notifications: SqsNotificationIngress {
            queue: capture.clone(),
        },
    }
}

fn fixture() -> (NativeEffect, MessageEvent, ChannelInfo, HashSet<String>) {
    let channel = Uuid::now_v7();
    let message = Message {
        id: Uuid::now_v7(),
        parent: MessageParent::Channel(channel),
        thread_id: None,
        sender_id: ChannelSender::new_external(Uuid::now_v7()).unwrap(),
        imported_author: Some(ImportedAuthor {
            name: "Customer Name".into(),
        }),
        bot_profile: None,
        triggered_by: None,
        mentions: vec![],
        content: "A customer message".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    };
    let effect = NativeEffect {
        channel_id: channel,
        message_id: message.id,
        revision: 2,
        first_publication: true,
        provenance: Provenance::Customer,
        direction: Direction::Inbound,
    };
    let event = MessageEvent {
        parent: message.parent.clone(),
        actor: message.sender_id.as_ref().to_owned(),
        nonce: None,
        change: MessageChange::Posted {
            message,
            mentions: vec![],
            notification_policy: PostMessageNotificationPolicy::Silent,
        },
    };
    (
        effect,
        event,
        ChannelInfo {
            id: channel,
            name: Some("Customer".into()),
            channel_type: ChannelType::Private,
            org_id: None,
            team_id: None,
        },
        HashSet::from(["macro|viewer@fixture.test".into()]),
    )
}

#[tokio::test]
async fn first_live_customer_revision_discovers_channel_and_notifies_without_impersonation() {
    let capture = Captured::default();
    let publisher = publisher(&capture);
    let (effect, event, channel, viewers) = fixture();
    publisher
        .publish(&effect, &event, &channel, &viewers)
        .await
        .unwrap();
    let patches = capture.soup.lock().unwrap();
    assert_eq!(patches.len(), 2);
    assert_eq!(patches[0].patch.value().entity_type, EntityType::Channel);
    assert_eq!(patches[0].patch.value().entity_id, channel.id.to_string());
    assert_eq!(
        patches[1].patch.value().entity_type,
        EntityType::ChannelMessage
    );
    assert_eq!(
        patches[1].patch.value().entity_id,
        effect.message_id.to_string()
    );
    assert_eq!(patches[1].access_source, patches[0].access_source);
    let notifications = capture.notifications.lock().unwrap();
    let request = &notifications[0]["request"];
    assert_eq!(request["uuid_to_write"], effect.message_id.to_string());
    assert!(request["req"]["sender_id"].is_null());
    let metadata = &request["req"]["notification"]["content"];
    assert!(metadata["sender"].is_null());
    assert_eq!(metadata["senderDisplayName"], "Customer Name");
    assert_eq!(
        request["req"]["recipient_ids"],
        serde_json::json!(["macro|viewer@fixture.test"])
    );
    let activities = capture.activities.lock().unwrap();
    assert_eq!(activities.len(), 1);
    assert_eq!(activities[0].actor.as_ref(), event.actor);
    assert!(activities[0].actor.is_external());
    assert_eq!(activities[0].action, activity::Action::Messaged);
}

#[tokio::test]
async fn failed_publication_replays_with_stable_notification_and_activity_ids() {
    let capture = Captured::default();
    let publisher = publisher(&capture);
    let (effect, event, channel, viewers) = fixture();
    capture
        .fail_soup
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(
        publisher
            .publish(&effect, &event, &channel, &viewers)
            .await
            .is_err()
    );
    capture
        .fail_soup
        .store(false, std::sync::atomic::Ordering::SeqCst);
    publisher
        .publish(&effect, &event, &channel, &viewers)
        .await
        .unwrap();
    let notifications = capture.notifications.lock().unwrap();
    assert_eq!(notifications.len(), 2);
    assert_eq!(
        notifications[0]["request"]["uuid_to_write"],
        notifications[1]["request"]["uuid_to_write"]
    );
    let activities = capture.activities.lock().unwrap();
    assert_eq!(activities.len(), 2);
    assert_eq!(activities[0].id, activities[1].id);
}

#[tokio::test]
async fn imports_and_later_media_revisions_only_refresh_native_lists() {
    let capture = Captured::default();
    let publisher = publisher(&capture);
    let (mut effect, event, channel, viewers) = fixture();
    effect.provenance = Provenance::OnboardingHistory;
    publisher
        .publish(&effect, &event, &channel, &viewers)
        .await
        .unwrap();
    effect.provenance = Provenance::Customer;
    effect.first_publication = false;
    publisher
        .publish(&effect, &event, &channel, &viewers)
        .await
        .unwrap();
    assert_eq!(capture.soup.lock().unwrap().len(), 4);
    assert!(capture.notifications.lock().unwrap().is_empty());
    assert!(capture.activities.lock().unwrap().is_empty());
}

#[tokio::test]
async fn business_replies_record_activity_without_customer_unread_notifications() {
    let capture = Captured::default();
    let publisher = publisher(&capture);
    let (mut effect, event, channel, viewers) = fixture();
    effect.direction = Direction::Outbound;
    for provenance in [Provenance::MacroReply, Provenance::PhoneEcho] {
        effect.provenance = provenance;
        publisher
            .publish(&effect, &event, &channel, &viewers)
            .await
            .unwrap();
    }
    assert!(capture.notifications.lock().unwrap().is_empty());
    assert_eq!(capture.activities.lock().unwrap().len(), 2);
    assert_eq!(capture.soup.lock().unwrap().len(), 4);
}
