use super::*;
use activity::domain::ports::ActivityObserver;
use activity::{Activity, Actor};
use channels::domain::activity::{ChannelAction, ChannelActivity};

fn picture(channel: &str) -> Activity {
    Activity::from_domain(
        uuid::Uuid::from_u128(1),
        0,
        Actor::new_from_user("macro|test@example.com".to_owned().try_into().unwrap()),
        None,
        ChannelActivity {
            channel_id: channel.to_owned(),
            action: ChannelAction::PictureChanged,
        },
        chrono::Utc::now(),
    )
}

#[tokio::test]
async fn queue_coalesces_one_channels_facts_and_ignores_non_timeline_activity() {
    let (sender, mut receiver) = mpsc::channel(QUEUE_CAPACITY);
    let observer = TimelineObserver(sender);
    let ignored = Activity::common(
        uuid::Uuid::from_u128(2),
        0,
        Actor::new_from_user("macro|test@example.com".to_owned().try_into().unwrap()),
        None,
        activity::EntityType::Channel,
        "ignored",
        activity::CommonAction::Edited,
        chrono::Utc::now(),
    );
    observer
        .persisted(&[picture("channel"), picture("channel"), ignored])
        .await;
    assert_eq!(receiver.try_recv().unwrap(), "channel");
    assert!(receiver.try_recv().is_err());
}

#[tokio::test]
async fn full_or_closed_delivery_queue_never_blocks_persistence() {
    let (sender, receiver) = mpsc::channel(1);
    let observer = TimelineObserver(sender);
    observer.persisted(&[picture("first")]).await;
    tokio::time::timeout(
        std::time::Duration::from_millis(100),
        observer.persisted(&[picture("overflow")]),
    )
    .await
    .unwrap();
    drop(receiver);
    tokio::time::timeout(
        std::time::Duration::from_millis(100),
        observer.persisted(&[picture("closed")]),
    )
    .await
    .unwrap();
}
