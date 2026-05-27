use super::*;
use rig_core::message::{Message, ToolResultContent, UserContent};

#[test]
fn no_merge_needed() {
    let history = OneOrMany::many(vec![
        Message::user("hello"),
        Message::assistant("hi"),
        Message::user("bye"),
    ])
    .unwrap();
    let merged = merge_consecutive_user(history);
    assert_eq!(merged.len(), 3);
}

#[test]
fn merges_two_consecutive_user_messages() {
    let history = OneOrMany::many(vec![Message::user("a"), Message::user("b")]).unwrap();
    let merged = merge_consecutive_user(history);
    assert_eq!(merged.len(), 1);
    let Message::User { content } = merged.first() else {
        panic!("expected user");
    };
    assert_eq!(content.len(), 2);
}

#[test]
fn merges_tool_results_after_tool_calls() {
    let tr1 = UserContent::tool_result(
        "call_1",
        OneOrMany::one(ToolResultContent::text("result 1")),
    );
    let tr2 = UserContent::tool_result(
        "call_2",
        OneOrMany::one(ToolResultContent::text("result 2")),
    );
    let history = OneOrMany::many(vec![
        Message::user("do stuff"),
        Message::assistant("calling tools"),
        Message::User {
            content: OneOrMany::one(tr1),
        },
        Message::User {
            content: OneOrMany::one(tr2),
        },
    ])
    .unwrap();

    let merged = merge_consecutive_user(history);
    assert_eq!(merged.len(), 3, "user, assistant, merged-user");

    let Message::User { content } = &merged.iter().collect::<Vec<_>>()[2] else {
        panic!("expected user");
    };
    assert_eq!(content.len(), 2, "both tool results in one message");
}

#[test]
fn single_message_unchanged() {
    let history = OneOrMany::one(Message::user("only"));
    let merged = merge_consecutive_user(history);
    assert_eq!(merged.len(), 1);
}
