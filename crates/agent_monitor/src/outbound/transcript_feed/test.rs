use std::io::Write as _;

use futures::StreamExt as _;

use super::*;
use crate::domain::model::{AgentId, AgentKind};
use crate::outbound::test_support::{PUSH_DEADLINE, fixtures};

const CODEX_FILE: &str = "rollout-2026-01-02T10-00-00-00000000-0000-7000-8000-000000000001.jsonl";

fn agent(transcript: PathBuf) -> Agent {
    let mut agent = Agent::new(
        AgentId::claude_session("s"),
        AgentKind::Builder,
        String::from("s"),
    );
    agent.transcript = Some(transcript);
    agent
}

/// A copy of a fixture in a fresh directory, so a test can append to it.
fn copy(file: &str) -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join(file);
    std::fs::copy(fixtures().join("feed").join(file), &path).expect("copy fixture");
    (directory, path)
}

async fn next(stream: &mut TranscriptStream) -> TranscriptItem {
    tokio::time::timeout(PUSH_DEADLINE, stream.next())
        .await
        .expect("an item arrives")
        .expect("the stream is open")
}

/// Kind, tool name, text, error, duration: the parts a row shows.
fn row(item: &TranscriptItem) -> (TranscriptItemKind, Option<&str>, &str, bool, Option<u64>) {
    (
        item.kind,
        item.tool_name.as_deref(),
        item.text.as_str(),
        item.is_error,
        item.duration_ms,
    )
}

#[tokio::test]
async fn a_claude_transcript_tails_then_follows_appends() {
    let (_directory, path) = copy("session.jsonl");
    let mut stream = LocalTranscripts
        .follow(&agent(path.clone()), 200)
        .await
        .expect("the transcript is readable");

    let mut backlog = Vec::new();
    for _ in 0..6 {
        backlog.push(next(&mut stream).await);
    }
    assert_eq!(
        backlog.iter().map(row).collect::<Vec<_>>(),
        vec![
            (
                TranscriptItemKind::User,
                None,
                "Rename the widget module",
                false,
                None
            ),
            (
                TranscriptItemKind::Assistant,
                None,
                "Looking at the module first.",
                false,
                None
            ),
            (
                TranscriptItemKind::ToolCall,
                Some("Bash"),
                r#"{"command":"ls src"}"#,
                false,
                None
            ),
            (
                TranscriptItemKind::ToolResult,
                Some("Bash"),
                "lib.rs\nwidget.rs",
                false,
                Some(2500)
            ),
            (
                TranscriptItemKind::ToolCall,
                Some("Read"),
                r#"{"file_path":"/work/src/missing.rs"}"#,
                false,
                None
            ),
            (
                TranscriptItemKind::ToolResult,
                Some("Read"),
                "File does not exist.",
                true,
                Some(250)
            ),
        ]
    );

    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .expect("open for append");
    writeln!(
        file,
        r#"{{"type":"assistant","timestamp":"2026-01-02T10:00:09.000Z","message":{{"id":"msg_3","content":[{{"type":"text","text":"Done."}}]}}}}"#
    )
    .expect("append");
    let appended = next(&mut stream).await;
    assert_eq!(
        row(&appended),
        (TranscriptItemKind::Assistant, None, "Done.", false, None)
    );
}

#[tokio::test]
async fn the_tail_keeps_only_the_last_items() {
    let (_directory, path) = copy("session.jsonl");
    let mut stream = LocalTranscripts
        .follow(&agent(path), 2)
        .await
        .expect("the transcript is readable");

    assert_eq!(next(&mut stream).await.tool_name.as_deref(), Some("Read"));
    assert_eq!(next(&mut stream).await.text, "File does not exist.");
}

#[tokio::test]
async fn a_codex_rollout_reads_messages_and_tool_calls() {
    let (_directory, path) = copy(CODEX_FILE);
    let mut stream = LocalTranscripts
        .follow(&agent(path), 200)
        .await
        .expect("the rollout is readable");

    let mut items = Vec::new();
    for _ in 0..4 {
        items.push(next(&mut stream).await);
    }
    assert_eq!(
        items.iter().map(row).collect::<Vec<_>>(),
        vec![
            (TranscriptItemKind::User, None, "Run the tests", false, None),
            (
                TranscriptItemKind::ToolCall,
                Some("exec"),
                "cargo test",
                false,
                None
            ),
            (
                TranscriptItemKind::ToolResult,
                Some("exec"),
                "test result: ok",
                false,
                Some(2000)
            ),
            (
                TranscriptItemKind::Assistant,
                None,
                "All tests pass.",
                false,
                None
            ),
        ]
    );
}

#[tokio::test]
async fn an_agent_without_a_readable_transcript_is_unavailable() {
    let directory = tempfile::tempdir().expect("tempdir");
    let missing = agent(directory.path().join("gone.jsonl"));
    assert!(matches!(
        LocalTranscripts.follow(&missing, 10).await,
        Err(TranscriptError::Unavailable)
    ));

    let mut none = missing;
    none.transcript = None;
    assert!(matches!(
        LocalTranscripts.follow(&none, 10).await,
        Err(TranscriptError::Unavailable)
    ));
}

#[test]
fn long_text_is_clipped_on_a_character_boundary() {
    assert_eq!(clip("  héllo world  ", 5), "héllo…");
    assert_eq!(clip("short", 10), "short");
}
