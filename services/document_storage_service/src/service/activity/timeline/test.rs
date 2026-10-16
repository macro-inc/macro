use super::*;
use activity::domain::ports::ActivityRealtimePublisher;
use activity::{Activity, Actor};
use channels::domain::activity::{ChannelAction, ChannelActivity};
use uuid::Uuid;

const CHANNEL: Uuid = Uuid::from_u128(10);

fn picture(channel: Uuid, ordinal: u32) -> Activity {
    Activity::from_domain(
        Uuid::from_u128(1),
        ordinal,
        Actor::new_from_user("macro|test@example.com".to_owned().try_into().unwrap()),
        None,
        ChannelActivity {
            channel_id: channel.to_string(),
            action: ChannelAction::PictureChanged,
        },
        chrono::Utc::now(),
    )
}

#[tokio::test]
async fn queue_groups_one_channels_facts_and_ignores_non_timeline_activity() {
    let (sender, mut receiver) = mpsc::channel(QUEUE_CAPACITY);
    let publisher = TimelinePublisher(sender);
    let ignored = Activity::common(
        Uuid::from_u128(2),
        0,
        Actor::new_from_user("macro|test@example.com".to_owned().try_into().unwrap()),
        None,
        activity::EntityType::Channel,
        &CHANNEL.to_string(),
        activity::CommonAction::Edited,
        chrono::Utc::now(),
    );
    let (first, second) = (picture(CHANNEL, 0), picture(CHANNEL, 1));
    publisher
        .publish_recorded(&[first.clone(), second.clone(), ignored])
        .await;
    let (parent, activities) = receiver.try_recv().unwrap();
    assert_eq!(parent, MessageParent::Channel(CHANNEL));
    assert_eq!(
        activities.iter().map(|a| a.id).collect::<Vec<_>>(),
        [first.id, second.id]
    );
    assert_eq!(activities[0].action, "picture_changed");
    assert_eq!(activities[0].actor_id, "macro|test@example.com");
    assert!(receiver.try_recv().is_err());
}

#[tokio::test]
async fn full_or_closed_delivery_queue_never_blocks_persistence() {
    let (sender, receiver) = mpsc::channel(1);
    let publisher = TimelinePublisher(sender);
    publisher.publish_recorded(&[picture(CHANNEL, 0)]).await;
    tokio::time::timeout(
        std::time::Duration::from_millis(100),
        publisher.publish_recorded(&[picture(Uuid::from_u128(11), 0)]),
    )
    .await
    .unwrap();
    drop(receiver);
    tokio::time::timeout(
        std::time::Duration::from_millis(100),
        publisher.publish_recorded(&[picture(Uuid::from_u128(12), 0)]),
    )
    .await
    .unwrap();
}

/// Subscribers of one parent, recording that access was consulted.
struct Watching(HashSet<String>);
impl MessageRealtime for Watching {
    async fn subscribers(&self, _: &MessageParent) -> Result<HashSet<String>, rootcause::Report> {
        Ok(self.0.clone())
    }
    async fn send(
        &self,
        _: &messages::domain::ports::MessageEvent,
        _: HashSet<String>,
    ) -> Result<(), rootcause::Report> {
        unreachable!("timeline activity has its own payload")
    }
}

/// Only `allowed` can still view the parent.
struct Access {
    allowed: HashSet<String>,
    asked: std::sync::Mutex<usize>,
}
impl MessageAudienceAccess for Access {
    async fn viewers(
        &self,
        _: &MessageParent,
        candidates: HashSet<String>,
    ) -> Result<HashSet<String>, rootcause::Report> {
        *self.asked.lock().unwrap() += 1;
        Ok(candidates.intersection(&self.allowed).cloned().collect())
    }
}

fn users(ids: &[&str]) -> HashSet<String> {
    ids.iter().map(|id| (*id).to_owned()).collect()
}

#[tokio::test]
async fn live_activity_reaches_watchers_who_can_still_view() {
    let parent = MessageParent::Channel(CHANNEL);
    let access = Access {
        allowed: users(&["member", "team-viewer"]),
        asked: Default::default(),
    };
    let watching = Watching(users(&["member", "team-viewer", "removed"]));
    assert_eq!(
        viewers(&watching, &access, &parent).await.unwrap(),
        users(&["member", "team-viewer"])
    );

    // Nobody watching: nothing to authorize.
    let asked = *access.asked.lock().unwrap();
    assert!(
        viewers(&Watching(HashSet::new()), &access, &parent)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(*access.asked.lock().unwrap(), asked);
}
