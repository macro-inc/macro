use super::*;
use crate::domain::slack::export::{ExportRecord, NormalizedRecord};

fn message(line: &str, conversation: &str) -> NormalizedMessage {
    let record: ExportRecord = serde_json::from_str(line).unwrap();
    let NormalizedRecord::Message(message) =
        record.normalize(conversation.parse().unwrap()).unwrap()
    else {
        panic!("expected message");
    };
    *message
}

#[test]
fn cross_day_reply_and_edit_request_the_same_exact_root() {
    let lines: Vec<_> = include_str!("../../../../tests/fixtures/message-events.ndjson")
        .lines()
        .collect();
    let root = message(lines[0], "C100");
    assert_eq!(root.thread_reference(), ThreadReference::Root);
    for line in [&lines[2], &lines[3]] {
        let reply = message(line, "C100");
        assert_eq!(
            reply.thread_reference().parent_lookup(),
            Some(&root.identity)
        );
        assert!(reply.identity.ts.unix_micros() - root.identity.ts.unix_micros() >= 86_400_000_000);
        let parent_id = Uuid::now_v7();
        assert_eq!(
            reply.thread_reference().resolve(Some(parent_id)),
            ThreadPlacement::Reply(parent_id)
        );
    }
}

#[test]
fn absent_roots_keep_orphan_metadata_without_a_history_map() {
    let line = include_str!("../../../../tests/fixtures/message-events.ndjson")
        .lines()
        .nth(6)
        .unwrap();
    let orphan = message(line, "C100").thread_reference();
    let ts = "1699999999.999999".parse().unwrap();
    assert_eq!(
        orphan.parent_lookup(),
        Some(&MessageIdentity {
            conversation: "C100".parse().unwrap(),
            ts
        })
    );
    assert_eq!(orphan.resolve(None), ThreadPlacement::Orphan(ts));
}

#[test]
fn replies_array_does_not_make_a_message_a_reply() {
    let root = message(
        r#"{"ts":"1.000001","replies":[{"ts":"2.000001","user":"U100"}]}"#,
        "C100",
    );
    assert_eq!(root.thread_reference().parent_lookup(), None);
    assert_eq!(root.thread_reference().resolve(None), ThreadPlacement::Root);
}

#[test]
fn lookup_identity_includes_conversation_team_and_every_microsecond() {
    let first = message(r#"{"ts":"1.000001","thread_ts":"1.000002"}"#, "C100");
    let other = message(r#"{"ts":"1.000001","thread_ts":"1.000002"}"#, "C200");
    assert_ne!(first.identity, other.identity);
    let parent = first.thread_reference().parent_lookup().unwrap().clone();
    assert_ne!(first.identity, parent);
    assert_ne!(first.thread_reference(), other.thread_reference());
    let team = TeamId::try_from(Uuid::now_v7()).unwrap();
    let other_team = TeamId::try_from(Uuid::now_v7()).unwrap();
    assert_ne!(
        parent.clone().in_team(team),
        parent.clone().in_team(other_team)
    );
    let scoped = parent.in_team(team);
    assert_eq!(scoped.team_id, team);
    assert_eq!(scoped.slack_channel_id.as_str(), "C100");
    assert_eq!(scoped.ts.to_string(), "1.000002");
}
