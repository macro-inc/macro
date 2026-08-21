use super::*;
use crate::domain::{events::ChannelEvent, models::Sender};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tracing::{Id, Subscriber};
use tracing_subscriber::{Layer, layer::Context, prelude::*};
use uuid::Uuid;

#[derive(Clone, Default)]
struct RecordingHandler {
    handled: Arc<AtomicBool>,
}

impl ChannelEventHandler for RecordingHandler {
    async fn handle(&self, _event: ChannelEvent) {
        self.handled.store(true, Ordering::Release);
    }
}

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

#[tokio::test]
async fn dispatch_tracks_task_and_parents_side_effect_span_to_caller() {
    let parents = Parents::default();
    let subscriber = tracing_subscriber::registry().with(parents.clone());
    let dispatcher = tracing::Dispatch::new(subscriber);
    let tracker = TaskTracker::new();
    let handler = RecordingHandler::default();
    let event_handler = handler.clone();

    tracing::dispatcher::with_default(&dispatcher, || {
        let request = tracing::info_span!("request");
        let _guard = request.enter();
        SpawnedChannelEventDispatcher::with_task_tracker(event_handler, tracker.clone()).dispatch(
            ChannelEvent::ReactionChanged {
                channel_id: Uuid::new_v4(),
                actor: Sender::new_from_user(
                    MacroUserIdStr::try_from_email("sender@example.com").unwrap(),
                ),
                message_id: Uuid::new_v4(),
                reactions: Vec::new(),
                recipients: Vec::new(),
                nonce: None,
            },
        );
    });

    tracker.close();
    tracker.wait().await;
    assert!(handler.handled.load(Ordering::Acquire));

    let spans = parents.0.lock().unwrap();
    let (_, request_id, _) = spans.iter().find(|(name, ..)| name == "request").unwrap();
    let (_, _, side_effect_parent) = spans
        .iter()
        .find(|(name, ..)| name == "channel.side_effects")
        .unwrap();
    assert_eq!(side_effect_parent.as_ref(), Some(request_id));
}
