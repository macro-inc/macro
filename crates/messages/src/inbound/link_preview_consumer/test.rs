use super::*;
use crate::domain::{
    events::{MessageDeletedMetadata, MessagePatchedMetadata},
    ports::MessageError,
};
use channel_sender::ChannelSender;
use tokio::sync::mpsc;

fn patched(parent: MessageParent) -> MessageTopicEvent {
    MessageTopicEvent::Patched(MessagePatchedMetadata {
        completed_reply: None,
        parent,
        message_id: Uuid::from_u128(1),
        thread_id: None,
        root_id: Uuid::from_u128(1),
        actor: ChannelSender::try_from("macro|ada@example.com".to_owned()).unwrap(),
        content: "https://example.com".to_string(),
        edited_at: None,
        updated_at: chrono::Utc::now(),
    })
}

#[test]
fn channel_posts_and_patches_are_refreshed_and_other_facts_are_not() {
    let channel = MessageParent::Channel(Uuid::from_u128(7));
    assert_eq!(
        refresh_target(&patched(channel.clone())),
        Some((channel.clone(), Uuid::from_u128(1)))
    );
    assert_eq!(
        refresh_target(&patched(MessageParent::parse("document", "doc").unwrap())),
        None
    );
    assert_eq!(
        refresh_target(&MessageTopicEvent::Deleted(MessageDeletedMetadata {
            parent: channel,
            message_id: Uuid::from_u128(1),
            thread_id: None,
            root_id: Uuid::from_u128(1),
            actor: ChannelSender::try_from("macro|ada@example.com".to_owned()).unwrap(),
            deleted_at: None,
        })),
        None
    );
}

/// Each refresh reports its start, then waits for a permit.
struct Held {
    started: mpsc::UnboundedSender<Uuid>,
    release: Semaphore,
}

#[async_trait::async_trait]
impl MessageLinkPreviews for Held {
    async fn refresh_link_previews(&self, _: &MessageParent, id: Uuid) -> Result<(), MessageError> {
        let _ = self.started.send(id);
        let permit = self.release.acquire().await;
        drop(permit);
        Ok(())
    }
}

#[tokio::test]
async fn events_for_a_message_already_refreshing_coalesce_into_one_more_run() {
    let (started, mut starts) = mpsc::unbounded_channel();
    let held = Arc::new(Held {
        started,
        release: Semaphore::new(0),
    });
    let refresher = Refresher::new(held.clone(), 4);
    let parent = MessageParent::Channel(Uuid::from_u128(7));
    let streamed = Uuid::from_u128(1);
    let other = Uuid::from_u128(2);

    refresher
        .schedule(parent.clone(), streamed, tracing::Span::none())
        .await;
    assert_eq!(starts.recv().await, Some(streamed));

    // A streamed reply patches its message again and again meanwhile; another
    // message does not wait behind it.
    for _ in 0..3 {
        refresher
            .schedule(parent.clone(), streamed, tracing::Span::none())
            .await;
    }
    refresher
        .schedule(parent.clone(), other, tracing::Span::none())
        .await;
    assert_eq!(starts.recv().await, Some(other));

    held.release.add_permits(10);
    assert_eq!(starts.recv().await, Some(streamed));
    refresher.tasks.close();
    refresher.tasks.wait().await;

    drop(refresher);
    drop(held);
    assert_eq!(starts.recv().await, None);
}
