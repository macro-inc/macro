use super::*;
use crate::domain::test::message;
use std::sync::Mutex;

#[derive(Clone, Default)]
struct Delivery(Arc<Mutex<Vec<MessageEvent>>>);
impl MessageEventPublisher for Delivery {
    async fn publish(&self, event: MessageEvent) -> Result<(), rootcause::Report> {
        self.0.lock().unwrap().push(event);
        Ok(())
    }
}
fn posted(parent: MessageParent, bot: bool) -> MessageEvent {
    let mut message = message(1, None, "@macro explain this");
    message.parent = parent.clone();
    if bot {
        message.sender_id = channel_sender::ChannelSender::new_from_bot(bot_id::MACRO_AI_BOT_ID);
    }
    MessageEvent {
        parent,
        root_id: message.id,
        actor: message.sender_id.as_ref().to_owned(),
        nonce: None,
        change: MessageChange::Posted {
            notification_policy: Default::default(),
            message,
            mentions: vec![],
        },
    }
}
#[tokio::test]
async fn user_posts_from_both_parents_dispatch_once_and_bot_responses_never_reenter() {
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    let delivery = Delivery::default();
    let publisher = messages::domain::effects::MessageEffects::new(
        messages::domain::ports::NoMessageEventPublisher,
        LocalBotPublisher::new(sender),
        delivery.clone(),
    );
    for parent in [
        MessageParent::Channel(uuid::Uuid::from_u128(900)),
        MessageParent::parse("document", "doc").unwrap(),
    ] {
        publisher
            .publish(posted(parent.clone(), false))
            .await
            .unwrap();
        assert_eq!(receiver.try_recv().unwrap().parent, parent);
        assert!(receiver.try_recv().is_err());
        publisher.publish(posted(parent, true)).await.unwrap();
        assert!(receiver.try_recv().is_err());
    }
    assert_eq!(delivery.0.lock().unwrap().len(), 4);
}
#[tokio::test]
async fn closed_agent_receiver_does_not_suppress_realtime_and_notification_delivery() {
    let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
    drop(receiver);
    let delivery = Delivery::default();
    let publisher = messages::domain::effects::MessageEffects::new(
        messages::domain::ports::NoMessageEventPublisher,
        LocalBotPublisher::new(sender),
        delivery.clone(),
    );
    assert!(
        publisher
            .publish(posted(
                MessageParent::parse("document", "doc").unwrap(),
                false
            ))
            .await
            .is_err()
    );
    assert_eq!(delivery.0.lock().unwrap().len(), 1);
}
