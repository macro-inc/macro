use chrono::DateTime;

use super::*;
use crate::domain::observation::{Change, Fact, TranscriptDelta, TranscriptEvent};
use crate::outbound::test_support::{copy_tree, fixtures, start};

const DAY: Duration = Duration::from_secs(24 * 60 * 60);
const SESSION: &str = "0aaaaaaa-1111-7222-8333-444444444444";

fn at(text: &str) -> Timestamp {
    DateTime::parse_from_rfc3339(text)
        .expect("timestamp")
        .with_timezone(&Utc)
}

async fn index(fixture: &str) -> Vec<TranscriptDelta> {
    let dir = tempfile::tempdir().expect("tempdir");
    copy_tree(&fixtures().join(fixture), dir.path());
    let mut source = start(Box::new(CodexRolloutsSource::new(
        dir.path().to_owned(),
        DAY,
    )));
    let deltas = source
        .until_ready()
        .await
        .into_iter()
        .filter_map(|change| match change {
            Change::Upsert(Fact::Transcript(delta)) => Some(delta),
            _ => None,
        })
        .collect();
    source.stop().await;
    deltas
}

#[tokio::test]
async fn a_rollout_yields_turns_tool_calls_and_per_response_usage() {
    let deltas = index("codex").await;

    assert_eq!(deltas.len(), 1);
    let delta = &deltas[0];
    assert_eq!(
        delta.key,
        TranscriptKey {
            program: TranscriptProgram::Codex,
            session: SESSION.to_owned(),
            subagent: None,
        }
    );
    assert_eq!(delta.cwd.as_deref(), Some(Path::new("/work/gamma")));
    assert_eq!(delta.branch.as_deref(), Some("feat/gamma"));
    assert_eq!(delta.model.as_deref(), Some("gpt-6-sol"));
    assert_eq!(
        delta.events,
        vec![
            TranscriptEvent {
                at: at("2030-01-01T10:00:00.100Z"),
                kind: TranscriptEventKind::TurnStart,
            },
            TranscriptEvent {
                at: at("2030-01-01T10:00:02Z"),
                kind: TranscriptEventKind::ToolStart {
                    id: "call_1".to_owned(),
                    name: "exec".to_owned(),
                    gist: None,
                },
            },
            // The running total after it repeats this usage and is ignored.
            TranscriptEvent {
                at: at("2030-01-01T10:00:02.100Z"),
                kind: TranscriptEventKind::Usage(Tokens {
                    input: 300,
                    output: 50,
                    cache_read: 600,
                    cache_write: 100,
                    cache_write_1h: 0,
                }),
            },
            TranscriptEvent {
                at: at("2030-01-01T10:00:03Z"),
                kind: TranscriptEventKind::ToolEnd {
                    id: "call_1".to_owned(),
                    is_error: false,
                },
            },
            TranscriptEvent {
                at: at("2030-01-01T10:00:04Z"),
                kind: TranscriptEventKind::TurnEnd,
            },
        ]
    );
}

#[tokio::test]
async fn running_totals_become_increases_when_no_usage_records_exist() {
    let deltas = index("codex_legacy").await;

    let usage: Vec<Tokens> = deltas
        .iter()
        .flat_map(|delta| &delta.events)
        .filter_map(|event| match event.kind {
            TranscriptEventKind::Usage(tokens) => Some(tokens),
            _ => None,
        })
        .collect();
    assert_eq!(
        usage,
        [
            Tokens {
                input: 60,
                output: 10,
                cache_read: 40,
                ..Tokens::default()
            },
            Tokens {
                input: 150,
                output: 20,
                ..Tokens::default()
            },
        ]
    );
}

#[test]
fn only_rollout_files_with_a_session_id_are_read() {
    let root = Path::new("/s");
    let format = CodexFormat;

    assert_eq!(
        format
            .key(
                root,
                Path::new("/s/2030/01/01/rollout-2030-01-01T10-00-00-0aaaaaaa-1111-7222-8333-444444444444.jsonl")
            )
            .map(|key| key.session),
        Some(SESSION.to_owned())
    );
    assert_eq!(
        format.key(root, Path::new("/s/2030/01/01/notes.jsonl")),
        None
    );
    assert_eq!(format.key(root, Path::new("/s/rollout-short.jsonl")), None);
}
