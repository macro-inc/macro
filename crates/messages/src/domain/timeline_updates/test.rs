use std::sync::Mutex;

use channel_sender::ChannelSender;
use chrono::DateTime;

use super::*;
use crate::domain::models::{
    Message, MessageKind, MessageListItem, MessageThreadPreview, PostMessageNotificationPolicy,
    ThreadState,
};

const CHANNEL: Uuid = Uuid::from_u128(100);
const ROOT: Uuid = Uuid::from_u128(1);
const REPLY: Uuid = Uuid::from_u128(2);

fn message(id: Uuid, parent: MessageParent, thread_id: Option<Uuid>) -> Message {
    let at = DateTime::from_timestamp(1_000, 0).unwrap();
    Message {
        kind: MessageKind::Message,
        guest_name: None,
        id,
        parent,
        thread_id,
        import_order: None,
        sender_id: ChannelSender::try_from("macro|author@example.com".to_owned()).unwrap(),
        bot_profile: None,
        mentions: vec![],
        imported_author: None,
        triggered_via: None,
        triggered_by: None,
        content: "hello".into(),
        created_at: at,
        updated_at: at,
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    }
}

fn root_item(id: Uuid) -> MessageListItem {
    let message = message(id, MessageParent::Channel(CHANNEL), None);
    let at = message.created_at;
    MessageListItem {
        message,
        state: ThreadState {
            root_id: id,
            user_id: "macro|author@example.com".into(),
            resolved: false,
            anchor: None,
            created_at: at,
            updated_at: at,
            deleted_at: None,
        },
        thread: MessageThreadPreview {
            reply_count: 1,
            latest_reply_at: Some(at),
            preview: vec![],
        },
    }
}

fn posted(
    parent: MessageParent,
    seq: Option<i64>,
    id: Uuid,
    thread_id: Option<Uuid>,
) -> MessageEvent {
    MessageEvent {
        seq,
        parent: parent.clone(),
        actor: "macro|author@example.com".into(),
        nonce: None,
        change: MessageChange::Posted {
            notification_policy: PostMessageNotificationPolicy::Default,
            message: message(id, parent, thread_id),
            mentions: vec![],
        },
    }
}

fn users(ids: &[&str]) -> HashSet<String> {
    ids.iter().map(|id| (*id).to_owned()).collect()
}

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

/// Records what the gateway was asked to send.
#[derive(Default)]
struct Gateway(Mutex<Vec<HashSet<String>>>);
impl MessageRealtime for Gateway {
    async fn subscribers(&self, _: &MessageParent) -> Result<HashSet<String>, rootcause::Report> {
        Ok(HashSet::new())
    }
    async fn send(
        &self,
        _: &MessageEvent,
        users: HashSet<String>,
    ) -> Result<(), rootcause::Report> {
        self.0.lock().unwrap().push(users);
        Ok(())
    }
}

/// Serves the changes a page would return and counts the reads.
#[derive(Default)]
struct Changes {
    current: Vec<ChannelMessageChange>,
    reads: Mutex<Vec<Vec<Uuid>>>,
}
impl ChannelMessageChangeLoader for Changes {
    async fn load_message_changes(
        &self,
        channel_id: Uuid,
        ids: &[Uuid],
    ) -> Result<Vec<ChannelMessageChange>, MessageError> {
        assert_eq!(channel_id, CHANNEL);
        self.reads.lock().unwrap().push(ids.to_vec());
        Ok(self.current.clone())
    }
}

/// Records published updates.
#[derive(Default)]
struct Published(Mutex<Vec<AddressedChannelTimelineUpdate>>);
impl ChannelTimelineUpdatePublisher for Published {
    type Err = std::convert::Infallible;

    fn publish(&self, update: &AddressedChannelTimelineUpdate) -> Result<(), Self::Err> {
        self.0.lock().unwrap().push(update.clone());
        Ok(())
    }
}
impl ChannelTimelineUpdatePublisher for std::sync::Arc<Published> {
    type Err = std::convert::Infallible;

    fn publish(&self, update: &AddressedChannelTimelineUpdate) -> Result<(), Self::Err> {
        self.as_ref().publish(update)
    }
}

#[tokio::test]
async fn sequenced_reply_is_hydrated_once_with_its_root_and_addressed_to_the_delivered_users() {
    let changes = Changes {
        current: vec![
            ChannelMessageChange::Root {
                message: Box::new(root_item(ROOT)),
                call: None,
            },
            ChannelMessageChange::Reply {
                message: Box::new(message(REPLY, MessageParent::Channel(CHANNEL), Some(ROOT))),
            },
        ],
        ..Default::default()
    };
    let realtime = ChannelTimelineRealtime::new(Gateway::default(), changes, Published::default());
    realtime
        .send(
            &posted(MessageParent::Channel(CHANNEL), Some(42), REPLY, Some(ROOT)),
            users(&["macro|a@example.com", "macro|b@example.com"]),
        )
        .await
        .unwrap();

    assert_eq!(
        realtime.realtime.0.lock().unwrap().len(),
        1,
        "gateway still delivers"
    );
    assert_eq!(*realtime.changes.reads.lock().unwrap(), [vec![REPLY]]);
    let published = realtime.publisher.0.lock().unwrap();
    let [addressed] = published.as_slice() else {
        panic!("one update per change, got {}", published.len());
    };
    assert_eq!(
        addressed
            .recipients
            .iter()
            .map(ToString::to_string)
            .collect::<HashSet<_>>(),
        users(&["macro|a@example.com", "macro|b@example.com"])
    );
    assert_eq!(addressed.update.channel_id, CHANNEL);
    assert_eq!(addressed.update.seq, 42);
    assert_eq!(
        addressed
            .update
            .messages
            .iter()
            .map(ChannelMessageChange::id)
            .collect::<Vec<_>>(),
        [ROOT, REPLY]
    );
    assert!(addressed.update.removed_ids.is_empty());
}

#[tokio::test]
async fn a_change_the_read_no_longer_finds_is_published_as_removed() {
    let realtime =
        ChannelTimelineRealtime::new(Gateway::default(), Changes::default(), Published::default());
    realtime
        .send(
            &posted(MessageParent::Channel(CHANNEL), Some(7), ROOT, None),
            users(&["macro|a@example.com"]),
        )
        .await
        .unwrap();

    let published = realtime.publisher.0.lock().unwrap();
    assert_eq!(published.len(), 1);
    assert!(published[0].update.messages.is_empty());
    assert_eq!(published[0].update.removed_ids, [ROOT]);
}

#[tokio::test]
async fn unsequenced_and_non_channel_changes_publish_nothing_and_read_nothing() {
    let realtime =
        ChannelTimelineRealtime::new(Gateway::default(), Changes::default(), Published::default());
    let typing = MessageEvent {
        seq: None,
        parent: MessageParent::Channel(CHANNEL),
        actor: "macro|author@example.com".into(),
        nonce: None,
        change: MessageChange::Typing {
            thread_id: None,
            active: true,
            agent: None,
        },
    };
    let document = MessageParent::Document("doc".to_owned().try_into().unwrap());
    for event in [typing, posted(document, None, ROOT, None)] {
        realtime
            .send(&event, users(&["macro|a@example.com"]))
            .await
            .unwrap();
    }

    assert_eq!(realtime.realtime.0.lock().unwrap().len(), 2);
    assert!(realtime.changes.reads.lock().unwrap().is_empty());
    assert!(realtime.publisher.0.lock().unwrap().is_empty());
}

/// Fixed participants, counting the reads.
struct Participants(Mutex<usize>);
impl ChannelTimelineAudience for Participants {
    type Err = std::convert::Infallible;

    async fn participants(
        &self,
        channel_id: Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        assert_eq!(channel_id, CHANNEL);
        *self.0.lock().unwrap() += 1;
        Ok(vec![user("macro|a@example.com")])
    }
}

fn activity(id: u128) -> TimelineActivity {
    TimelineActivity {
        id: Uuid::from_u128(id),
        actor_id: "macro|author@example.com".into(),
        occurred_at: DateTime::from_timestamp(1_000, 0).unwrap(),
        action: "picture_changed".into(),
        payload: None,
    }
}

#[tokio::test]
async fn sequenced_activity_is_published_one_update_per_seq_with_one_participant_read() {
    let published = std::sync::Arc::new(Published::default());
    let updates = ChannelActivityUpdates::new(Participants(Mutex::new(0)), published.clone());
    updates
        .publish(
            CHANNEL,
            [
                (activity(10), Some(8)),
                (activity(11), None),
                (activity(12), Some(9)),
            ],
        )
        .await
        .unwrap();

    assert_eq!(*updates.audience.0.lock().unwrap(), 1);
    let published = published.0.lock().unwrap();
    assert_eq!(
        published
            .iter()
            .map(|addressed| (addressed.update.seq, addressed.update.activities[0].id))
            .collect::<Vec<_>>(),
        [(8, Uuid::from_u128(10)), (9, Uuid::from_u128(12))]
    );
    assert!(
        published
            .iter()
            .all(|addressed| addressed.recipients == [user("macro|a@example.com")])
    );

    // Nothing sequenced: no participant read.
    drop(published);
    updates
        .publish(CHANNEL, [(activity(13), None)])
        .await
        .unwrap();
    assert_eq!(*updates.audience.0.lock().unwrap(), 1);
}

#[cfg(feature = "realtime")]
mod fanout {
    use std::sync::{Arc, atomic::AtomicUsize, atomic::Ordering};

    use tokio::sync::mpsc;

    use super::*;
    use crate::domain::timeline_updates::{ChannelTimelineFanout, ChannelTimelineUpdateSource};

    /// Updates handed in by the test.
    struct Source(tokio::sync::Mutex<mpsc::UnboundedReceiver<AddressedChannelTimelineUpdate>>);
    impl ChannelTimelineUpdateSource for Source {
        type Err = std::io::Error;

        async fn recv(&self) -> Result<(AddressedChannelTimelineUpdate, tracing::Span), Self::Err> {
            let update = self.0.lock().await.recv().await;
            update
                .map(|update| (update, tracing::Span::none()))
                .ok_or_else(|| std::io::Error::other("source closed"))
        }
    }

    static PROJECTIONS: AtomicUsize = AtomicUsize::new(0);

    fn project(update: ChannelTimelineUpdate) -> Arc<i64> {
        PROJECTIONS.fetch_add(1, Ordering::SeqCst);
        Arc::new(update.seq)
    }

    #[tokio::test]
    async fn one_projection_is_shared_by_every_subscribed_recipient_and_nobody_else() {
        let (sender, receiver) = mpsc::unbounded_channel();
        let fanout = Arc::new(ChannelTimelineFanout::new(
            Source(tokio::sync::Mutex::new(receiver)),
            project,
        ));
        let (mut a1, _) = fanout.subscribe(user("macro|a@example.com")).into_parts();
        let (mut a2, _) = fanout.subscribe(user("macro|a@example.com")).into_parts();
        let (mut b, _) = fanout.subscribe(user("macro|b@example.com")).into_parts();
        let (mut outsider, _) = fanout.subscribe(user("macro|c@example.com")).into_parts();
        let run = tokio::spawn({
            let fanout = Arc::clone(&fanout);
            async move { fanout.run().await }
        });

        let update = |seq| AddressedChannelTimelineUpdate {
            recipients: vec![
                user("macro|a@example.com"),
                user("macro|b@example.com"),
                user("macro|nobody-here@example.com"),
            ],
            update: ChannelTimelineUpdate::activity(CHANNEL, seq, activity(seq as u128)),
        };
        sender.send(update(5)).unwrap();
        sender.send(update(6)).unwrap();

        let mut received = Vec::new();
        for subscriber in [&mut a1, &mut a2, &mut b] {
            received.push(subscriber.recv().await.unwrap());
            received.push(subscriber.recv().await.unwrap());
        }
        assert_eq!(
            received.iter().map(|value| **value).collect::<Vec<_>>(),
            [5, 6, 5, 6, 5, 6]
        );
        // One projection per update, shared: every subscriber got the same allocation.
        assert_eq!(PROJECTIONS.load(Ordering::SeqCst), 2);
        assert!(Arc::ptr_eq(&received[0], &received[2]) && Arc::ptr_eq(&received[0], &received[4]));
        assert!(outsider.try_recv().is_err());

        drop(sender);
        assert!(
            run.await.unwrap().is_err(),
            "run ends when its source fails"
        );
    }
}

/// A gateway whose send finishes only once the timeline update is published.
struct GatewayAwaitingPublish(std::sync::Arc<tokio::sync::Notify>);
impl MessageRealtime for GatewayAwaitingPublish {
    async fn subscribers(&self, _: &MessageParent) -> Result<HashSet<String>, rootcause::Report> {
        Ok(HashSet::new())
    }
    async fn send(&self, _: &MessageEvent, _: HashSet<String>) -> Result<(), rootcause::Report> {
        self.0.notified().await;
        Ok(())
    }
}

/// Signals each publish.
struct SignalsPublish(std::sync::Arc<tokio::sync::Notify>);
impl ChannelTimelineUpdatePublisher for SignalsPublish {
    type Err = std::convert::Infallible;

    fn publish(&self, _: &AddressedChannelTimelineUpdate) -> Result<(), Self::Err> {
        self.0.notify_one();
        Ok(())
    }
}

#[tokio::test(start_paused = true)]
async fn the_update_is_published_while_the_gateway_send_is_pending() {
    let published = std::sync::Arc::new(tokio::sync::Notify::new());
    let realtime = ChannelTimelineRealtime::new(
        GatewayAwaitingPublish(std::sync::Arc::clone(&published)),
        Changes::default(),
        SignalsPublish(published),
    );
    let event = posted(MessageParent::Channel(CHANNEL), Some(7), ROOT, None);
    let send = realtime.send(&event, users(&["macro|a@example.com"]));
    tokio::time::timeout(std::time::Duration::from_secs(5), send)
        .await
        .expect("publishing waited for the gateway send")
        .unwrap();
}
