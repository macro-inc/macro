//! Thinking reaches the consumer as it is produced.
//!
//! A reasoning model can think for tens of seconds before it says anything
//! else. Holding those deltas until the next non-reasoning item - a tool call,
//! text, the final response - shows the reader nothing for that whole stretch
//! and then the entire thought at once, which is the opposite of what a
//! thinking stream is for.

use super::util;
use crate::stream::StreamPart;
use ai_toolset::AsyncToolCollection;
use rig_core::message::Message;
use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
use std::sync::Arc;

fn reasoning(text: &str) -> MockStreamEvent {
    MockStreamEvent::ReasoningDelta {
        id: None,
        reasoning: text.to_owned(),
    }
}

/// Each delta arrives as its own part, in order. One coalesced `Thinking`
/// part would pass a "the thought came through" assertion just as well, which
/// is why this pins the shape rather than the text.
#[tokio::test]
async fn reasoning_deltas_stream_as_they_arrive() {
    let model = MockCompletionModel::from_stream_turns([vec![
        reasoning("first "),
        reasoning("second "),
        reasoning("third"),
        MockStreamEvent::final_response_with_default_usage(),
    ]]);

    let mut session = util::session(
        util::tool_set(AsyncToolCollection::<()>::new()),
        Arc::new(()),
        model,
    )
    .await;
    let collected = util::collect(
        session
            .send_message(vec![Message::user("think")])
            .await
            .expect("the stream starts"),
    )
    .await;

    let thoughts: Vec<&str> = collected
        .parts
        .iter()
        .filter_map(|part| match part {
            StreamPart::Thinking(text) => Some(text.as_str()),
            _ => None,
        })
        .collect();

    assert_eq!(thoughts, vec!["first ", "second ", "third"]);
    assert!(collected.error.is_none());
}

/// A turn that ends while still thinking - the model produced nothing else,
/// or the run was cancelled - has still shown its reader everything it
/// thought. Nothing waits on a final response that may never come.
#[tokio::test]
async fn thinking_reaches_the_consumer_without_a_following_item() {
    let model =
        MockCompletionModel::from_stream_turns([vec![reasoning("thought that stands alone")]]);

    let mut session = util::session(
        util::tool_set(AsyncToolCollection::<()>::new()),
        Arc::new(()),
        model,
    )
    .await;
    let collected = util::collect(
        session
            .send_message(vec![Message::user("think")])
            .await
            .expect("the stream starts"),
    )
    .await;

    assert!(
        collected.parts.iter().any(|part| matches!(
            part,
            StreamPart::Thinking(text) if text == "thought that stands alone"
        )),
        "the thought reached the consumer: {:?}",
        collected.parts
    );
}
