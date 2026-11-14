use super::*;
use crate::domain::observation::{Change, FactKey};
use crate::outbound::test_support::start;

fn entry(pid: u32, session: &str, status: &str) -> String {
    format!(
        r#"{{"pid":{pid},"sessionId":"{session}","cwd":"/work/alpha","startedAt":1,"kind":"interactive","name":"alpha-1","status":"{status}","updatedAt":1893456000000}}"#
    )
}

#[tokio::test]
async fn running_entries_become_sessions_and_key_files_are_never_read() {
    let dir = tempfile::tempdir().expect("tempdir");
    let me = std::process::id();
    std::fs::write(dir.path().join(format!("{me}.json")), entry(me, "s-1", "busy"))
        .expect("write");
    // Not JSON at all: reading it would fail the decode, never panic, but it
    // must not even be listed.
    std::fs::write(dir.path().join(format!("{me}.abc123.key")), "secret").expect("write");
    let mut source = start(Box::new(ClaudeRegistrySource::new(dir.path().to_owned())));

    let changes = source.until_ready().await;
    assert_eq!(
        changes[0],
        Change::Reset(vec![Fact::ClaudeSession(ClaudeSessionFact {
            pid: me,
            session_id: "s-1".to_owned(),
            cwd: Some(PathBuf::from("/work/alpha")),
            name: Some("alpha-1".to_owned()),
            busy: true,
            updated: DateTime::from_timestamp_millis(1_893_456_000_000),
        })])
    );

    std::fs::write(dir.path().join(format!("{me}.json")), entry(me, "s-1", "idle"))
        .expect("rewrite");
    match source.next_fact().await {
        Change::Upsert(Fact::ClaudeSession(session)) => assert!(!session.busy),
        other => panic!("expected a session upsert, got {other:?}"),
    }

    std::fs::remove_file(dir.path().join(format!("{me}.json"))).expect("remove");
    assert_eq!(
        source.next_fact().await,
        Change::Remove(FactKey::ClaudeSession(me))
    );

    source.stop().await;
}

#[test]
fn only_pid_named_json_files_are_records() {
    let source = ClaudeRegistrySource::new(PathBuf::from("/c/sessions"));

    assert_eq!(source.pid_of(Path::new("/c/sessions/42.json")), Some(42));
    assert_eq!(source.pid_of(Path::new("/c/sessions/42.abc.key")), None);
    assert_eq!(source.pid_of(Path::new("/c/sessions/notes.json")), None);
    assert_eq!(source.pid_of(Path::new("/c/other/42.json")), None);
}

#[cfg(target_os = "linux")]
#[test]
fn an_entry_whose_process_is_gone_is_not_reported() {
    let dir = tempfile::tempdir().expect("tempdir");
    // Above the kernel's pid limit, so never a live process.
    let dead = 4_194_305;
    let path = dir.path().join(format!("{dead}.json"));
    std::fs::write(&path, entry(dead, "s-2", "idle")).expect("write");
    let source = ClaudeRegistrySource::new(dir.path().to_owned());

    assert_eq!(source.read(&path), None);
}
