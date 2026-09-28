use super::*;
use activity::domain::ports::ActivityRealtimePublisher;
use activity::{Activity, Actor};
use channels::domain::activity::{ChannelAction, ChannelActivity};

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
    let publisher = ChannelTimelinePublisher(sender);
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
    let (channel_id, activities) = receiver.try_recv().unwrap();
    assert_eq!(channel_id, CHANNEL);
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
    let publisher = ChannelTimelinePublisher(sender);
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
