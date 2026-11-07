use super::*;
use crate::outbound::memory_journal::MemoryJournal;

fn native_result(run: &str, branch: &str) -> NativeRecord {
    native_result_in_repository(run, branch, "github.com/macro-inc/macro")
}

fn native_result_in_repository(run: &str, branch: &str, repository: &str) -> NativeRecord {
    NativeRecord {
        event: "result".into(),
        data: serde_json::json!({
            "runId": run,
            "status": "FINISHED",
            "text": "Done",
            "git": {"branches": [
                {"repoUrl": "github.com/other/repository", "branch": "other/work"},
                {"repoUrl": repository, "branch": branch}
            ]}
        })
        .to_string(),
        id: None,
    }
}

fn branches(branch: &str) -> Vec<(String, String)> {
    vec![
        ("https://github.com/macro-inc/macro".into(), branch.into()),
        (
            "https://github.com/other/repository".into(),
            "other/work".into(),
        ),
    ]
}

#[tokio::test]
async fn native_no_pr_branch_facts_survive_live_capture_and_durable_replay() {
    let journal = Arc::new(MemoryJournal::default());
    let cursor = FakeCursor::new();
    let live = RecordingNotifier::new();
    let service = CursorSessionService::new(
        cursor.clone(),
        live.clone(),
        FixedChooser(None, false),
        journal.clone(),
        NoArtifactStore,
    );
    let id = service.new_session(Path::new(""), vec![]);
    let stream = cursor.script_raw_stream();
    stream
        .send(native_result("run-fake-1", "cursor/actual-work"))
        .unwrap();
    drop(stream);
    service
        .prompt(&id, "fix it without opening a PR")
        .await
        .unwrap();
    assert_eq!(live.working_branches(), branches("cursor/actual-work"));
    assert!(live.pull_requests().is_empty());

    // Repeated result facts do not cause duplicate live metadata writes.
    let stream = cursor.script_raw_stream();
    stream
        .send(native_result("run-fake-2", "cursor/actual-work"))
        .unwrap();
    drop(stream);
    service.prompt(&id, "continue").await.unwrap();
    assert_eq!(live.working_branches(), branches("cursor/actual-work"));

    let stream = cursor.script_raw_stream();
    stream
        .send(native_result("run-fake-3", "cursor/renamed-work"))
        .unwrap();
    drop(stream);
    service
        .prompt(&id, "rename the working branch")
        .await
        .unwrap();
    let mut changed = branches("cursor/actual-work");
    changed.push((
        "https://github.com/macro-inc/macro".into(),
        "cursor/renamed-work".into(),
    ));
    assert_eq!(live.working_branches(), changed);

    let replayed = RecordingNotifier::new();
    let restored = Arc::new(CursorSessionService::new(
        cursor.clone(),
        replayed.clone(),
        FixedChooser(None, false),
        journal,
        NoArtifactStore,
    ));
    restored.restore_session(id.clone(), Some(CursorAgentId::new("bc-fake")), None);
    let before = cursor.calls();
    restored.replay_session(&id).await.unwrap().complete();
    assert_eq!(replayed.working_branches(), branches("cursor/renamed-work"));
    assert!(replayed.pull_requests().is_empty());
    assert_eq!(
        cursor.calls(),
        before,
        "durable replay needs no remote execution"
    );
}

#[tokio::test]
async fn hydrated_no_pr_history_reports_latest_branch_for_every_repository() {
    let (service, cursor, notifier) = service(None);
    let id = SessionId::new("restored-cursor");
    service.restore_session(id.clone(), Some(CursorAgentId::new("bc-restored")), None);
    cursor.script_run_listings(vec![
        RunListing {
            id: CursorRunId::new("run-latest"),
            status: RunStatus::Finished,
        },
        RunListing {
            id: CursorRunId::new("run-old"),
            status: RunStatus::Finished,
        },
    ]);
    for (run, branch) in [
        ("run-old", "cursor/old-work"),
        ("run-latest", "cursor/latest-work"),
    ] {
        let stream = cursor.script_raw_stream();
        stream
            .send(NativeRecord {
                event: "interaction_update".into(),
                data: serde_json::json!({
                    "type": "user-message-appended", "userMessage": {"text": "fix it"}
                })
                .to_string(),
                id: None,
            })
            .unwrap();
        stream.send(native_result(run, branch)).unwrap();
        drop(stream);
    }
    service.replay_session(&id).await.unwrap().complete();
    assert_eq!(notifier.working_branches(), branches("cursor/latest-work"));
    assert!(notifier.pull_requests().is_empty());
}

#[tokio::test]
async fn replay_retains_only_latest_branch_across_repository_url_aliases() {
    let journal = Arc::new(MemoryJournal::default());
    let cursor = FakeCursor::new();
    let live = RecordingNotifier::new();
    let service = CursorSessionService::new(
        cursor.clone(),
        live.clone(),
        FixedChooser(None, false),
        journal.clone(),
        NoArtifactStore,
    );
    let id = service.new_session(Path::new(""), vec![]);
    for (run, repository, branch) in [
        (
            "run-fake-1",
            "https://github.com/macro-inc/macro",
            "cursor/old",
        ),
        ("run-fake-2", "github.com/macro-inc/macro", "cursor/new"),
        (
            "run-fake-3",
            "HTTPS://GITHUB.com/Macro-Inc/Macro.git/",
            "cursor/latest",
        ),
    ] {
        let stream = cursor.script_raw_stream();
        stream
            .send(native_result_in_repository(run, branch, repository))
            .unwrap();
        drop(stream);
        service.prompt(&id, "continue").await.unwrap();
    }
    assert_eq!(live.working_branches().last().unwrap().1, "cursor/latest");
    let replayed = RecordingNotifier::new();
    let restored = CursorSessionService::new(
        cursor,
        replayed.clone(),
        FixedChooser(None, false),
        journal,
        NoArtifactStore,
    );
    restored.restore_session(id.clone(), Some(CursorAgentId::new("bc-fake")), None);
    restored.replay_session(&id).await.unwrap().complete();
    assert_eq!(replayed.working_branches(), branches("cursor/latest"));
}
