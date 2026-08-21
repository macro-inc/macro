use super::*;
use channels::domain::models::{MutatedMessage, Sender};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::{Arc, Mutex};
use tracing::{Id, Subscriber, instrument::WithSubscriber as _};
use tracing_subscriber::{Layer, layer::Context, prelude::*};
use uuid::Uuid;

#[derive(Clone, Default)]
struct Parents(Arc<Mutex<Vec<(String, Id, Option<Id>)>>>);

impl<S: Subscriber> Layer<S> for Parents {
    fn on_new_span(&self, attrs: &tracing::span::Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let parent = attrs.parent().cloned().or_else(|| {
            attrs
                .is_contextual()
                .then(|| ctx.current_span().id().cloned())
                .flatten()
        });
        self.0
            .lock()
            .unwrap()
            .push((attrs.metadata().name().to_string(), id.clone(), parent));
    }
}

fn trigger() -> ChannelBotTrigger {
    let channel_id = Uuid::new_v4();
    let now = Utc::now();
    ChannelBotTrigger {
        channel_id,
        message: MutatedMessage {
            id: Uuid::new_v4(),
            channel_id,
            thread_id: None,
            sender_id: Sender::new_from_user(
                MacroUserIdStr::try_from_email("sender@example.com").unwrap(),
            ),
            triggered_by: None,
            content: "hello".to_string(),
            created_at: now,
            updated_at: now,
            edited_at: None,
            deleted_at: None,
        },
        mentioned_bot_ids: Vec::new(),
    }
}

#[tokio::test]
async fn queue_captures_enqueue_context_and_restores_it_after_dequeue() {
    let parents = Parents::default();
    let subscriber = tracing_subscriber::registry().with(parents.clone());
    let dispatcher = tracing::Dispatch::new(subscriber);
    let (sender, mut receiver) = bot_trigger_queue();

    tracing::dispatcher::with_default(&dispatcher, || {
        let request = tracing::info_span!("request");
        let _guard = request.enter();
        sender.dispatch(trigger());
    });

    let queued = receiver.receiver.recv().await.unwrap();
    async {
        assert_eq!(
            tracing::Span::current()
                .metadata()
                .map(|metadata| metadata.name()),
            Some("channel.bot_trigger")
        );
    }
    .instrument(queued.span)
    .with_subscriber(dispatcher)
    .await;

    let spans = parents.0.lock().unwrap();
    let (_, request_id, _) = spans.iter().find(|(name, ..)| name == "request").unwrap();
    let (_, _, trigger_parent) = spans
        .iter()
        .find(|(name, ..)| name == "channel.bot_trigger")
        .unwrap();
    assert_eq!(trigger_parent.as_ref(), Some(request_id));
}
