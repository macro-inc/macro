use super::*;
use crate::domain::observation::Change;
use crate::outbound::test_support::start;

const RECORD: &str = r#"{"version":1,"id":"m-1","kind":"Claude","cwd":"/work/delta","model":"claude-opus-5-5","native_id":"s-7","transcript":"/claude/projects/p/s-7.jsonl","started":1893456000}"#;

#[tokio::test]
async fn session_records_are_reported_with_their_harness_and_new_harnesses_are_noticed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let sessions = dir.path().join("h-1").join("sessions");
    std::fs::create_dir_all(&sessions).expect("mkdir");
    std::fs::write(sessions.join("m-1.json"), RECORD).expect("write");
    // A harness's worktrees are never read.
    std::fs::create_dir_all(dir.path().join("h-1/worktrees/w")).expect("mkdir");
    std::fs::write(dir.path().join("h-1/worktrees/w/x.json"), "{}").expect("write");
    let mut source = start(Box::new(MacrodSessionsSource::new(dir.path().to_owned())));

    let changes = source.until_ready().await;
    assert_eq!(
        changes[0],
        Change::Reset(vec![Fact::MacrodSession(MacrodSessionFact {
            id: "m-1".to_owned(),
            harness: "h-1".to_owned(),
            cwd: Some(PathBuf::from("/work/delta")),
            model: Some("claude-opus-5-5".to_owned()),
            native_id: Some("s-7".to_owned()),
            transcript: Some(PathBuf::from("/claude/projects/p/s-7.jsonl")),
            started: DateTime::from_timestamp(1_893_456_000, 0),
        })])
    );

    std::fs::write(
        sessions.join("m-2.json"),
        RECORD.replace("\"m-1\"", "\"m-2\""),
    )
    .expect("write");
    match source.next_fact().await {
        Change::Upsert(Fact::MacrodSession(session)) => assert_eq!(session.id, "m-2"),
        other => panic!("expected a session upsert, got {other:?}"),
    }

    source.stop().await;
}
