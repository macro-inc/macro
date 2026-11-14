use std::io::Write as _;
use std::time::SystemTime;

use chrono::DateTime;

use super::*;
use crate::domain::observation::{Change, Fact, TranscriptDelta, TranscriptEvent};
use crate::outbound::test_support::{copy_tree, fixtures, start};

const DAY: Duration = Duration::from_secs(24 * 60 * 60);

fn at(text: &str) -> Timestamp {
    DateTime::parse_from_rfc3339(text)
        .expect("timestamp")
        .with_timezone(&Utc)
}

fn projects() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    copy_tree(&fixtures().join("claude"), dir.path());
    dir
}

fn key(session: &str, subagent: Option<&str>) -> TranscriptKey {
    TranscriptKey {
        program: TranscriptProgram::Claude,
        session: session.to_owned(),
        subagent: subagent.map(str::to_owned),
    }
}

fn deltas(changes: Vec<Change>) -> Vec<TranscriptDelta> {
    changes
        .into_iter()
        .filter_map(|change| match change {
            Change::Upsert(Fact::Transcript(delta)) => Some(delta),
            _ => None,
        })
        .collect()
}

fn delta(change: Change) -> TranscriptDelta {
    match change {
        Change::Upsert(Fact::Transcript(delta)) => delta,
        other => panic!("expected a transcript delta, got {other:?}"),
    }
}

fn append(path: &Path, line: &str) {
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .expect("open");
    writeln!(file, "{line}").expect("append");
}

#[tokio::test]
async fn indexing_counts_turns_tools_usage_and_the_reported_cost() {
    let dir = projects();
    let root = dir.path().to_owned();
    let mut source = start(Box::new(ClaudeTranscriptsSource::new(root.clone(), DAY)));

    let changes = source.until_ready().await;
    assert_eq!(changes[0], Change::Reset(Vec::new()));
    let mut deltas = deltas(changes);
    deltas.sort_by(|a, b| a.key.cmp(&b.key));

    let main = root.join("proj-alpha/s-1.jsonl");
    let opus_usage = Tokens {
        input: 10,
        output: 200,
        cache_read: 5_000,
        cache_write: 1_000,
        cache_write_1h: 1_000,
    };
    let haiku_usage = Tokens {
        input: 3,
        output: 7,
        ..Tokens::default()
    };
    assert_eq!(
        deltas[0],
        TranscriptDelta {
            key: key("s-1", None),
            path: main.clone(),
            from_start: true,
            cwd: Some(PathBuf::from("/work/alpha")),
            branch: Some("feat/widget".to_owned()),
            model: Some("claude-opus-5-5".to_owned()),
            title: Some("Speed up the widget".to_owned()),
            events: vec![
                TranscriptEvent {
                    at: at("2030-01-01T10:00:00Z"),
                    kind: TranscriptEventKind::TurnStart,
                },
                TranscriptEvent {
                    at: at("2030-01-01T10:00:05Z"),
                    kind: TranscriptEventKind::Usage(opus_usage),
                },
                TranscriptEvent {
                    at: at("2030-01-01T10:00:06Z"),
                    kind: TranscriptEventKind::ToolStart {
                        id: "toolu_1".to_owned(),
                        name: "Bash".to_owned(),
                        gist: Some("cargo".to_owned()),
                    },
                },
                TranscriptEvent {
                    at: at("2030-01-01T10:00:07Z"),
                    kind: TranscriptEventKind::ToolStart {
                        id: "toolu_2".to_owned(),
                        name: "Edit".to_owned(),
                        gist: Some("store.rs".to_owned()),
                    },
                },
                TranscriptEvent {
                    at: at("2030-01-01T10:00:09Z"),
                    kind: TranscriptEventKind::ToolEnd {
                        id: "toolu_1".to_owned(),
                        is_error: false,
                    },
                },
                TranscriptEvent {
                    at: at("2030-01-01T10:00:09Z"),
                    kind: TranscriptEventKind::ToolEnd {
                        id: "toolu_2".to_owned(),
                        is_error: true,
                    },
                },
            ],
        }
    );

    // The model changed after usage was recorded: a new delta, so each usage
    // record is priced at the model that produced it.
    assert_eq!(
        deltas[1],
        TranscriptDelta {
            key: key("s-1", None),
            path: main,
            from_start: false,
            cwd: None,
            branch: None,
            model: Some("claude-haiku-4-5".to_owned()),
            title: None,
            events: vec![
                TranscriptEvent {
                    at: at("2030-01-01T10:00:12Z"),
                    kind: TranscriptEventKind::Usage(haiku_usage),
                },
                TranscriptEvent {
                    at: at("2030-01-01T10:00:12Z"),
                    kind: TranscriptEventKind::TurnEnd,
                },
                // The cost record carries no time; it takes the last one seen.
                TranscriptEvent {
                    at: at("2030-01-01T10:00:13Z"),
                    kind: TranscriptEventKind::Cost(Cost::Known(1.25)),
                },
            ],
        }
    );

    let subagent = &deltas[2];
    assert_eq!(subagent.key, key("s-1", Some("abc")));
    assert_eq!(subagent.title.as_deref(), Some("Survey the repository"));
    assert_eq!(subagent.model.as_deref(), Some("claude-sonnet-5-5"));
    assert_eq!(subagent.events.len(), 3);
    assert_eq!(deltas.len(), 3);

    source.stop().await;
}

#[tokio::test]
async fn an_append_arrives_within_a_second_without_a_timer() {
    let dir = projects();
    let root = dir.path().to_owned();
    let mut source = start(Box::new(ClaudeTranscriptsSource::new(root.clone(), DAY)));
    source.until_ready().await;

    append(
        &root.join("proj-alpha/s-1.jsonl"),
        r#"{"type":"assistant","message":{"model":"claude-haiku-4-5","id":"msg_3","content":[{"type":"tool_use","id":"toolu_3","name":"Grep","input":{"pattern":"secret"}}],"stop_reason":"tool_use"},"timestamp":"2030-01-01T10:01:00.000Z"}"#,
    );

    let delta = delta(source.next_fact().await);
    assert!(!delta.from_start);
    assert_eq!(
        delta.events,
        vec![TranscriptEvent {
            at: at("2030-01-01T10:01:00Z"),
            kind: TranscriptEventKind::ToolStart {
                id: "toolu_3".to_owned(),
                name: "Grep".to_owned(),
                gist: None,
            },
        }]
    );

    source.stop().await;
}

#[tokio::test]
async fn a_truncated_transcript_is_counted_again_from_the_start() {
    let dir = projects();
    let root = dir.path().to_owned();
    let mut source = start(Box::new(ClaudeTranscriptsSource::new(root.clone(), DAY)));
    source.until_ready().await;

    std::fs::write(
        root.join("proj-alpha/s-1.jsonl"),
        "{\"type\":\"user\",\"message\":{\"content\":\"again\"},\"timestamp\":\"2030-01-02T00:00:00Z\"}\n",
    )
    .expect("truncate");

    let delta = delta(source.next_fact().await);
    assert!(delta.from_start);
    assert_eq!(
        delta.events,
        vec![TranscriptEvent {
            at: at("2030-01-02T00:00:00Z"),
            kind: TranscriptEventKind::TurnStart,
        }]
    );

    source.stop().await;
}

#[tokio::test]
async fn files_older_than_the_history_window_are_skipped_until_written_again() {
    let dir = projects();
    let root = dir.path().to_owned();
    let old = root.join("proj-alpha/s-1/subagents/agent-abc.jsonl");
    std::fs::File::options()
        .write(true)
        .open(&old)
        .expect("open")
        .set_modified(SystemTime::now() - 2 * DAY)
        .expect("set mtime");
    let mut source = start(Box::new(ClaudeTranscriptsSource::new(root.clone(), DAY)));

    let indexed = deltas(source.until_ready().await);
    assert!(indexed.iter().all(|delta| delta.key.subagent.is_none()));

    append(
        &old,
        r#"{"type":"user","message":{"content":"more"},"timestamp":"2030-01-01T11:00:00Z"}"#,
    );
    let delta = delta(source.next_fact().await);
    assert_eq!(delta.key, key("s-1", Some("abc")));
    assert!(delta.from_start);
    assert_eq!(delta.events.len(), 4);

    source.stop().await;
}

#[test]
fn only_session_and_subagent_transcripts_are_read() {
    let root = Path::new("/p");
    let format = ClaudeFormat;

    assert_eq!(
        format.key(root, Path::new("/p/proj/s-9.jsonl")),
        Some(key("s-9", None))
    );
    assert_eq!(
        format.key(root, Path::new("/p/proj/s-9/subagents/agent-a1.jsonl")),
        Some(key("s-9", Some("a1")))
    );
    assert_eq!(
        format.key(root, Path::new("/p/proj/s-9/subagents/agent-a1.meta.json")),
        None
    );
    assert_eq!(
        format.key(root, Path::new("/p/proj/s-9/tool-results/x.jsonl")),
        None
    );
    assert_eq!(format.key(root, Path::new("/p/proj/memory/notes.md")), None);
}

fn opened(deltas: &[TranscriptDelta]) -> Vec<(Timestamp, PrRef)> {
    deltas
        .iter()
        .flat_map(|delta| &delta.events)
        .filter_map(|event| match &event.kind {
            TranscriptEventKind::PrOpened(pr) => Some((event.at, pr.clone())),
            _ => None,
        })
        .collect()
}

fn pr(repo: &str, number: u32) -> PrRef {
    PrRef {
        repo: crate::domain::model::RepoName::parse(repo).expect("a repo"),
        number,
    }
}

#[tokio::test]
async fn a_pr_is_opened_by_gh_pr_create_and_its_url_or_by_claude_codes_own_record() {
    let dir = tempfile::tempdir().expect("tempdir");
    copy_tree(&fixtures().join("claude_prs"), dir.path());
    let mut source = start(Box::new(ClaudeTranscriptsSource::new(
        dir.path().to_owned(),
        DAY,
    )));

    let deltas = deltas(source.until_ready().await);
    assert!(deltas.iter().all(|delta| delta.key == key("s-pr", None)));
    // A URL printed by another command opens nothing, nor does an edit;
    // the `pull/new/<branch>` hint is not a pull request.
    assert_eq!(
        opened(&deltas),
        vec![
            (at("2030-01-02T10:02:05Z"), pr("example-org/widgets", 42)),
            (at("2030-01-02T10:03:05Z"), pr("example-org/gadgets", 7)),
        ]
    );
    source.stop().await;
}
