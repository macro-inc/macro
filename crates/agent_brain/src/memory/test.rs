use serde_json::{Value, json};

use super::*;

#[tokio::test]
async fn history_is_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let history = History::new(dir.path().join("h.jsonl"), 3);

    for i in 0..10 {
        history.append(&json!({ "i": i })).await.unwrap();
    }

    let all: Vec<Value> = read_jsonl(&dir.path().join("h.jsonl")).await.unwrap();
    assert!(
        all.len() <= 6,
        "trimmed once past twice the bound, has {}",
        all.len()
    );
    assert_eq!(all.last().unwrap()["i"], 9);
    let recent: Vec<Value> = history.recent(2).await.unwrap();
    assert_eq!(recent, vec![json!({"i": 8}), json!({"i": 9})]);
}

#[tokio::test]
async fn missing_files_read_as_empty() {
    let dir = tempfile::tempdir().unwrap();
    let rows: Vec<Value> = tail_jsonl(&dir.path().join("none.jsonl"), 5).await.unwrap();
    assert!(rows.is_empty());
    assert!(!trim_lines(&dir.path().join("none.jsonl"), 5).await.unwrap());
}

#[tokio::test]
async fn bad_lines_are_skipped() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("x.jsonl");
    tokio::fs::write(&path, "{\"a\":1}\nnot json\n\n{\"a\":2}\n")
        .await
        .unwrap();
    let rows: Vec<Value> = read_jsonl(&path).await.unwrap();
    assert_eq!(rows.len(), 2);
}

#[tokio::test]
async fn prune_trims_logs_and_history() {
    let dir = tempfile::tempdir().unwrap();
    let state = StateDir::new(dir.path());
    state.ensure().await.unwrap();
    let lines: String = (0..50).map(|i| format!("{{\"i\":{i}}}\n")).collect();
    tokio::fs::write(state.decisions_log(), &lines)
        .await
        .unwrap();
    tokio::fs::write(state.history_path("ch1"), &lines)
        .await
        .unwrap();
    tokio::fs::write(state.log_dir().join("respond-1.log"), "x")
        .await
        .unwrap();

    let report = prune(
        &state,
        PruneOptions {
            log_age: Duration::from_secs(3600),
            log_lines: 10,
            history_lines: 5,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        report,
        PruneReport {
            logs_deleted: 0,
            files_trimmed: 2
        }
    );
    assert_eq!(
        read_jsonl::<Value>(&state.decisions_log())
            .await
            .unwrap()
            .len(),
        10
    );
    assert_eq!(
        read_jsonl::<Value>(&state.history_path("ch1"))
            .await
            .unwrap()
            .len(),
        5
    );
    assert!(
        state.log_dir().join("respond-1.log").exists(),
        "fresh logs are kept"
    );
}

#[test]
fn file_safe_neutralises_paths() {
    assert_eq!(file_safe("0192-ab_c.d"), "0192-ab_c.d");
    assert_eq!(file_safe("a/b"), "a_b");
    assert_eq!(file_safe(".."), "_..");
    assert_eq!(file_safe(""), "_");
}

#[test]
fn records_reply_in_the_thread_and_flag_dms() {
    let posted: MessagePosted = serde_json::from_value(json!({
        "message_id": "m2", "content": "hi", "created_at": "2026-11-02T10:00:00Z",
        "mentions": [], "attachments": [], "parent": {"type": "channel", "id": "ch1"},
        "root_id": "m1", "thread_id": "m1", "sender": "macro|a@example.com"
    }))
    .unwrap();
    let channel = ChannelDetail {
        channel_id: "ch1".to_owned(),
        channel_name: "Ada".to_owned(),
        channel_type: crate::client::ChannelType::DirectMessage,
        participants: Vec::new(),
    };
    let record = MessageRecord::from_posted(&posted, &channel, "macro|ada@example.com");
    assert_eq!(record.root, "m1");
    assert!(record.dm);
    assert!(!record.mentions_me);
}
