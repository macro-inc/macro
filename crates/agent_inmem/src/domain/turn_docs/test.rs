use agent::types::{ChatMessage, ChatMessageContent, Role};
use agent_session::domain::model::AgentSessionId;

use super::{DOCS_PER_SESSION_BYTES, SessionDocs, inject};

#[test]
fn each_request_keeps_the_documentation_it_received_in_place() {
    let docs = SessionDocs::default();
    let session = AgentSessionId::new();
    docs.add(
        session,
        &["find my notes".to_owned()],
        "<macro_sdk>documents</macro_sdk>".to_owned(),
    );
    let received = docs.add(
        session,
        &[
            "find my notes".to_owned(),
            "make a task for each".to_owned(),
        ],
        "<macro_sdk>tasks</macro_sdk>".to_owned(),
    );
    let mut messages = vec![
        ChatMessage {
            content: ChatMessageContent::Text("find my notes".to_owned()),
            role: Role::User,
            attachments: None,
        },
        ChatMessage {
            content: ChatMessageContent::Text("Found three.".to_owned()),
            role: Role::Assistant,
            attachments: None,
        },
        ChatMessage {
            content: ChatMessageContent::Text("make a task for each".to_owned()),
            role: Role::User,
            attachments: None,
        },
    ];

    inject(&mut messages, &received);

    assert_eq!(
        messages[0].content,
        ChatMessageContent::Text("find my notes\n<macro_sdk>documents</macro_sdk>".to_owned())
    );
    assert_eq!(
        messages[1].content,
        ChatMessageContent::Text("Found three.".to_owned())
    );
    assert_eq!(
        messages[2].content,
        ChatMessageContent::Text("make a task for each\n<macro_sdk>tasks</macro_sdk>".to_owned())
    );
}

#[test]
fn documentation_the_previous_request_holds_is_not_sent_again() {
    let docs = SessionDocs::default();
    let session = AgentSessionId::new();
    docs.add(
        session,
        &["find my notes".to_owned()],
        "<macro_sdk>documents</macro_sdk>".to_owned(),
    );

    let received = docs.add(
        session,
        &["find my notes".to_owned(), "and the old ones".to_owned()],
        "<macro_sdk>documents</macro_sdk>".to_owned(),
    );

    assert_eq!(
        received,
        vec![(0, "<macro_sdk>documents</macro_sdk>".to_owned())]
    );
}

#[test]
fn documentation_an_older_request_holds_is_sent_again() {
    let docs = SessionDocs::default();
    let session = AgentSessionId::new();
    docs.add(
        session,
        &["a".to_owned()],
        "<macro_sdk>documents</macro_sdk>".to_owned(),
    );
    docs.add(
        session,
        &["a".to_owned(), "b".to_owned()],
        "<macro_sdk>tasks</macro_sdk>".to_owned(),
    );

    let received = docs.add(
        session,
        &["a".to_owned(), "b".to_owned(), "c".to_owned()],
        "<macro_sdk>documents</macro_sdk>".to_owned(),
    );

    assert_eq!(
        received,
        vec![
            (0, "<macro_sdk>documents</macro_sdk>".to_owned()),
            (1, "<macro_sdk>tasks</macro_sdk>".to_owned()),
            (2, "<macro_sdk>documents</macro_sdk>".to_owned()),
        ]
    );
}

#[test]
fn a_request_that_runs_again_replaces_what_it_received() {
    let docs = SessionDocs::default();
    let session = AgentSessionId::new();
    docs.add(
        session,
        &["a".to_owned()],
        "<macro_sdk>documents</macro_sdk>".to_owned(),
    );
    docs.add(
        session,
        &["a".to_owned(), "b".to_owned()],
        "<macro_sdk>tasks</macro_sdk>".to_owned(),
    );

    let received = docs.add(
        session,
        &["a".to_owned(), "b".to_owned()],
        "<macro_sdk>emails</macro_sdk>".to_owned(),
    );

    assert_eq!(
        received,
        vec![
            (0, "<macro_sdk>documents</macro_sdk>".to_owned()),
            (1, "<macro_sdk>emails</macro_sdk>".to_owned()),
        ]
    );
}

#[test]
fn a_summary_that_replaced_earlier_requests_drops_their_documentation() {
    let docs = SessionDocs::default();
    let session = AgentSessionId::new();
    docs.add(
        session,
        &["a".to_owned()],
        "<macro_sdk>documents</macro_sdk>".to_owned(),
    );
    docs.add(
        session,
        &["a".to_owned(), "b".to_owned()],
        "<macro_sdk>tasks</macro_sdk>".to_owned(),
    );

    let received = docs.add(
        session,
        &[
            "The conversation so far, summarized:".to_owned(),
            "b".to_owned(),
            "c".to_owned(),
        ],
        "<macro_sdk>emails</macro_sdk>".to_owned(),
    );

    assert_eq!(
        received,
        vec![
            (1, "<macro_sdk>tasks</macro_sdk>".to_owned()),
            (2, "<macro_sdk>emails</macro_sdk>".to_owned()),
        ]
    );
}

#[test]
fn documentation_past_the_budget_drops_every_earlier_request_at_once() {
    let docs = SessionDocs::default();
    let session = AgentSessionId::new();
    let half = "d".repeat(DOCS_PER_SESSION_BYTES / 2 - 10);
    docs.add(session, &["a".to_owned()], format!("1{half}"));
    docs.add(
        session,
        &["a".to_owned(), "b".to_owned()],
        format!("2{half}"),
    );

    let received = docs.add(
        session,
        &["a".to_owned(), "b".to_owned(), "c".to_owned()],
        "<macro_sdk>emails</macro_sdk>".to_owned(),
    );

    assert_eq!(
        received,
        vec![(2, "<macro_sdk>emails</macro_sdk>".to_owned())]
    );
}

#[test]
fn a_turn_without_documentation_records_nothing() {
    let docs = SessionDocs::default();
    let session = AgentSessionId::new();

    let received = docs.add(session, &["a".to_owned()], String::new());

    assert_eq!(received, Vec::new());
}
