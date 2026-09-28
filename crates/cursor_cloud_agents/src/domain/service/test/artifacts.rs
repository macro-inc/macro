//! Walkthrough artifacts reaching the client as ordinary assistant text.
use super::*;
use crate::domain::artifact::ArtifactListing;
use crate::outbound::memory_journal::MemoryJournal;
use crate::testing::FakeArtifactStore;

type ArtifactService =
    CursorSessionService<FakeCursor, RecordingNotifier, FixedChooser, FakeArtifactStore>;

struct Harness {
    service: Arc<ArtifactService>,
    cursor: FakeCursor,
    notifier: RecordingNotifier,
    store: FakeArtifactStore,
    journal: Arc<MemoryJournal>,
}

fn harness() -> Harness {
    let cursor = FakeCursor::new();
    let notifier = RecordingNotifier::new();
    let store = FakeArtifactStore::new();
    let journal = Arc::new(MemoryJournal::default());
    let service = Arc::new(CursorSessionService::new(
        cursor.clone(),
        notifier.clone(),
        FixedChooser(None, false),
        journal.clone(),
        store.clone(),
    ));
    Harness {
        service,
        cursor,
        notifier,
        store,
        journal,
    }
}

fn listing(path: &str, updated_at: &str, size_bytes: u64) -> ArtifactListing {
    ArtifactListing {
        path: path.to_owned(),
        size_bytes,
        updated_at: updated_at.to_owned(),
    }
}

/// Run one turn whose stream says `text` and then finishes.
async fn turn(harness: &Harness, session: &SessionId, run: &str, text: &str) -> StopReason {
    let events = harness.cursor.script_stream();
    events
        .send(CursorEvent::Assistant {
            text: text.to_owned(),
        })
        .expect("stream open");
    events.send(finished(run)).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    harness
        .service
        .prompt(session, "take a walkthrough")
        .await
        .expect("prompt runs")
}

/// Everything the client was told, as agent text.
fn chunks(notifier: &RecordingNotifier) -> Vec<String> {
    agent_texts(&notifier.updates())
}

#[tokio::test]
async fn a_turns_artifacts_arrive_as_one_chunk_of_markdown() {
    let harness = harness();
    harness.cursor.script_artifact_listing(vec![
        listing("artifacts/walkthrough.mp4", "2026-09-16T00:00:02Z", 2048),
        listing("artifacts/shot.png", "2026-09-16T00:00:01Z", 512),
    ]);
    harness
        .cursor
        .script_artifact_body("artifacts/shot.png", Some("image/png"), b"png-bytes");
    harness.cursor.script_artifact_body(
        "artifacts/walkthrough.mp4",
        Some("binary/octet-stream"),
        b"mp4-bytes",
    );
    let session = harness.service.new_session(Path::new(""), Vec::new());

    let stop = turn(&harness, &session, "run-fake-1", "here you go").await;

    assert_eq!(stop, StopReason::EndTurn);
    assert_eq!(
        chunks(&harness.notifier),
        vec![
            "here you go".to_owned(),
            "\n\n![shot.png](https://files.test/shot.png)\
             \n\n<m-video>{\"url\":\"https://files.test/walkthrough.mp4\",\"srcType\":\"url\"}</m-video>"
                .to_owned(),
        ],
        "the artifacts follow the run's own text, oldest first"
    );
    // The mp4 was served as opaque bytes; its extension is what named it.
    assert_eq!(
        harness
            .store
            .stored()
            .iter()
            .map(|stored| (stored.name.clone(), stored.mime_type.clone()))
            .collect::<Vec<_>>(),
        vec![
            ("shot.png".to_owned(), "image/png".to_owned()),
            ("walkthrough.mp4".to_owned(), "video/mp4".to_owned()),
        ]
    );
    let journalled: Vec<_> = harness
        .journal
        .read(&session)
        .await
        .expect("journal read")
        .into_iter()
        .filter_map(|entry| match entry.input {
            JournalInput::ArtifactsCollected(artifacts) => Some(artifacts),
            _ => None,
        })
        .collect();
    assert_eq!(journalled.len(), 1);
    assert_eq!(
        journalled[0]
            .iter()
            .map(|artifact| artifact.key.clone())
            .collect::<Vec<_>>(),
        vec![
            "artifacts/shot.png@2026-09-16T00:00:01Z".to_owned(),
            "artifacts/walkthrough.mp4@2026-09-16T00:00:02Z".to_owned(),
        ]
    );
}

#[tokio::test]
async fn a_later_turn_announces_only_what_it_has_not_announced_before() {
    let harness = harness();
    harness
        .cursor
        .script_artifact_listing(vec![listing("artifacts/one.png", "t1", 8)]);
    harness.cursor.script_artifact_listing(vec![
        listing("artifacts/one.png", "t1", 8),
        listing("artifacts/two.png", "t2", 8),
    ]);
    for path in ["artifacts/one.png", "artifacts/two.png"] {
        harness
            .cursor
            .script_artifact_body(path, Some("image/png"), b"bytes");
    }
    let session = harness.service.new_session(Path::new(""), Vec::new());

    turn(&harness, &session, "run-fake-1", "first").await;
    turn(&harness, &session, "run-fake-2", "second").await;

    assert_eq!(
        chunks(&harness.notifier),
        vec![
            "first".to_owned(),
            "\n\n![one.png](https://files.test/one.png)".to_owned(),
            "second".to_owned(),
            "\n\n![two.png](https://files.test/two.png)".to_owned(),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn an_empty_first_listing_is_listed_once_more() {
    let harness = harness();
    harness.cursor.script_artifact_listing(Vec::new());
    harness
        .cursor
        .script_artifact_listing(vec![listing("artifacts/late.png", "t1", 8)]);
    harness
        .cursor
        .script_artifact_body("artifacts/late.png", Some("image/png"), b"bytes");
    let session = harness.service.new_session(Path::new(""), Vec::new());

    turn(&harness, &session, "run-fake-1", "done").await;

    assert_eq!(
        chunks(&harness.notifier),
        vec![
            "done".to_owned(),
            "\n\n![late.png](https://files.test/late.png)".to_owned(),
        ]
    );
    assert_eq!(
        harness
            .cursor
            .calls()
            .iter()
            .filter(|call| matches!(call, CursorCall::ListArtifacts(_)))
            .count(),
        2
    );
}

#[tokio::test]
async fn one_file_that_cannot_be_stored_does_not_cost_the_others() {
    let harness = harness();
    harness.cursor.script_artifact_listing(vec![
        listing("artifacts/broken.png", "t1", 8),
        listing("artifacts/fine.png", "t2", 8),
        listing("artifacts/huge.mp4", "t3", 128 * 1024 * 1024),
    ]);
    for path in ["artifacts/broken.png", "artifacts/fine.png"] {
        harness
            .cursor
            .script_artifact_body(path, Some("image/png"), b"bytes");
    }
    harness.store.fail_for("broken.png");
    let session = harness.service.new_session(Path::new(""), Vec::new());

    let stop = turn(&harness, &session, "run-fake-1", "done").await;

    assert_eq!(stop, StopReason::EndTurn);
    assert_eq!(
        chunks(&harness.notifier),
        vec![
            "done".to_owned(),
            "\n\n![fine.png](https://files.test/fine.png)".to_owned(),
        ]
    );
    assert!(
        !harness.cursor.calls().contains(&CursorCall::FetchArtifact(
            CursorAgentId::new("bc-fake"),
            "artifacts/huge.mp4".to_owned()
        )),
        "a file over the size cap is declined before it is fetched"
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_listing_leaves_the_turn_alone() {
    let harness = harness();
    harness
        .cursor
        .script_artifact_listing_error("artifacts unavailable");
    let session = harness.service.new_session(Path::new(""), Vec::new());

    let stop = turn(&harness, &session, "run-fake-1", "done").await;

    assert_eq!(stop, StopReason::EndTurn);
    assert_eq!(chunks(&harness.notifier), vec!["done".to_owned()]);
}

#[tokio::test]
async fn a_reloaded_session_re_announces_the_same_artifacts() {
    let harness = harness();
    harness
        .cursor
        .script_artifact_listing(vec![listing("artifacts/shot.png", "t1", 8)]);
    harness
        .cursor
        .script_artifact_body("artifacts/shot.png", Some("image/png"), b"bytes");
    let session = harness.service.new_session(Path::new(""), Vec::new());
    turn(&harness, &session, "run-fake-1", "done").await;
    let live = chunks(&harness.notifier);

    let replayed = RecordingNotifier::new();
    let cursor = FakeCursor::new();
    let restored = Arc::new(CursorSessionService::new(
        cursor.clone(),
        replayed.clone(),
        FixedChooser(None, false),
        harness.journal.clone(),
        FakeArtifactStore::new(),
    ));
    restored.restore_session(session.clone(), Some(CursorAgentId::new("bc-fake")), None);
    restored
        .replay_session(&session)
        .await
        .expect("load")
        .complete();

    assert_eq!(chunks(&replayed), live);
    assert!(
        cursor.calls().is_empty(),
        "a load re-announces from the journal, never from the provider"
    );
}

#[tokio::test]
async fn a_txt_artifact_arrives_as_a_fenced_code_block() {
    let harness = harness();
    harness
        .cursor
        .script_artifact_listing(vec![listing("artifacts/notes.txt", "t1", 12)]);
    harness
        .cursor
        .script_artifact_body("artifacts/notes.txt", Some("text/plain"), b"hello\nworld");
    let session = harness.service.new_session(Path::new(""), Vec::new());

    turn(&harness, &session, "run-fake-1", "done").await;

    assert_eq!(
        chunks(&harness.notifier),
        vec![
            "done".to_owned(),
            "\n\n```txt\nhello\nworld\n```".to_owned(),
        ]
    );
}

#[tokio::test]
async fn a_session_without_a_store_never_lists_artifacts() {
    let cursor = FakeCursor::new();
    let notifier = RecordingNotifier::new();
    let service = Arc::new(CursorSessionService::new(
        cursor.clone(),
        notifier.clone(),
        FixedChooser(None, false),
        Arc::new(MemoryJournal::default()),
        NoArtifactStore,
    ));
    let session = service.new_session(Path::new(""), Vec::new());
    let events = cursor.script_stream();
    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    let stop = service.prompt(&session, "go").await.expect("prompt runs");

    assert_eq!(stop, StopReason::EndTurn);
    assert!(
        !cursor
            .calls()
            .iter()
            .any(|call| matches!(call, CursorCall::ListArtifacts(_)))
    );
}
