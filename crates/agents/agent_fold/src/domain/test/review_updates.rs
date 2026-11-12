//! Saved reviews announcing their new revisions through the log.
use super::util::parse_log;
use crate::domain::lifecycle::LifecycleFold;
use crate::domain::model::{FoldEvent, TurnState};
use agent_runtime_protocol::domain::review::ReviewUpdatedNotification;

#[test]
fn review_updates_project_each_reviews_newest_revision_without_touching_the_turn() {
    let log = parse_log(
        r#"
{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"Draft the email"}]}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Drafted."}}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"_macro/review_updated","params":{"reviewId":"0192f7a0-0000-7000-8000-00000000000a","revision":2}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"_macro/review_updated","params":{"reviewId":"0192f7a0-0000-7000-8000-00000000000a","revision":1}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"_macro/review_updated","params":{"reviewId":"0192f7a0-0000-7000-8000-00000000000b","revision":1}}}
"#,
    );
    let mut machine = LifecycleFold::new();
    let _ = machine.push(log[0].clone());
    let _ = machine.push(log[1].clone());

    let newer = machine.push(log[2].clone());
    assert!(matches!(
        newer.events.as_slice(),
        [FoldEvent::MetadataUpdated(_)]
    ));
    assert_eq!(
        machine.inner().metadata().review_revisions,
        vec![ReviewUpdatedNotification {
            review_id: "0192f7a0-0000-7000-8000-00000000000a".parse().unwrap(),
            revision: 2,
        }]
    );

    // A save that committed first can be logged second; it is not news.
    let older = machine.push(log[3].clone());
    assert!(older.events.is_empty());

    let _ = machine.push(log[4].clone());
    assert_eq!(
        machine.inner().metadata().review_revisions,
        vec![
            ReviewUpdatedNotification {
                review_id: "0192f7a0-0000-7000-8000-00000000000a".parse().unwrap(),
                revision: 2,
            },
            ReviewUpdatedNotification {
                review_id: "0192f7a0-0000-7000-8000-00000000000b".parse().unwrap(),
                revision: 1,
            },
        ]
    );
    assert_eq!(machine.inner().metadata().turn, TurnState::Running);
    assert_eq!(machine.inner().messages().len(), 2);
}
