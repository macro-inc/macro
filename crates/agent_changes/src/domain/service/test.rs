use super::*;
use crate::domain::model::{ChangesetRange, ChangesetSource, ExtractedChangeset, GitRef};
use crate::domain::ports::NoPullRequestDrafts;
use crate::testing::{MemoryBlobStore, MemoryChangesetRepo, ScriptedExtractor};
use agent_session::testing::{InMemoryAgentSessionRepo, RecordingRealtime, test_agent_session};

const SESSION: AgentSessionId = AgentSessionId::TEST_A;

const PATCH: &str = "\
diff --git a/src/lib.rs b/src/lib.rs
index 1111111..2222222 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,2 +1,3 @@
 fn main() {
+    run();
 }
";

type TestService = AgentChangesService<
    InMemoryAgentSessionRepo,
    ScriptedExtractor,
    MemoryChangesetRepo,
    MemoryBlobStore,
    RecordingRealtime,
    NoPullRequestDrafts,
>;

fn extracted(patch: &str) -> ExtractedChangeset {
    ExtractedChangeset {
        source: ChangesetSource::MacrodGit,
        range: ChangesetRange {
            repository: Some("https://github.com/example/example".to_owned()),
            base: GitRef::named("main"),
            head: GitRef::named("agent/work"),
        },
        patch: patch.to_owned(),
        truncated: false,
    }
}

fn service(extractor: ScriptedExtractor) -> (TestService, MemoryChangesetRepo, MemoryBlobStore) {
    let sessions = InMemoryAgentSessionRepo::new();
    sessions.insert_session(test_agent_session(SESSION));
    let repo = MemoryChangesetRepo::new();
    let blobs = MemoryBlobStore::new();
    let service = AgentChangesService::new(
        sessions,
        extractor,
        repo.clone(),
        blobs.clone(),
        RecordingRealtime::new(),
        NoPullRequestDrafts,
    );
    (service, repo, blobs)
}

fn view_access() -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_internal_user(
        &SESSION.as_uuid().to_string(),
        EntityType::AgentSession,
    )
}

fn edit_access() -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::dangerously_assert_internal_user(
        &SESSION.as_uuid().to_string(),
        EntityType::AgentSession,
    )
}

#[tokio::test]
async fn a_capture_stores_the_patch_and_a_summary_read_from_it() {
    let (service, _repo, blobs) = service(ScriptedExtractor::returning(extracted(PATCH)));

    let outcome = service.capture(SESSION).await.unwrap();
    let CaptureOutcome::Captured(changeset) = outcome else {
        panic!("expected a capture, got {outcome:?}");
    };
    assert_eq!(changeset.files.len(), 1);
    assert_eq!(changeset.files[0].path, "src/lib.rs");
    assert_eq!((changeset.additions, changeset.deletions), (1, 0));
    assert_eq!(changeset.range.head.name.as_deref(), Some("agent/work"));
    assert!(changeset.has_patch());

    let changes = service.changes(&view_access()).await.unwrap();
    assert_eq!(changes.changeset, Some(changeset.clone()));
    let attempt = changes.attempt.expect("an attempt was recorded");
    assert_eq!(attempt.outcome, Some(AttemptOutcome::Captured));
    assert!(!attempt.in_flight());

    assert_eq!(service.patch(&view_access()).await.unwrap(), PATCH);
    assert_eq!(
        blobs.keys(),
        vec![
            PatchBlobKey::for_changeset(SESSION, changeset.id)
                .as_str()
                .to_owned()
        ]
    );
}

#[tokio::test]
async fn a_new_capture_replaces_the_summary_and_drops_the_old_patch() {
    let extractor = ScriptedExtractor::returning(extracted(PATCH));
    let (service, _repo, blobs) = service(extractor.clone());
    service.capture(SESSION).await.unwrap();
    let first_key = blobs.keys();

    extractor.set(extracted(&PATCH.replace("run();", "run_again();")));
    let outcome = service.capture(SESSION).await.unwrap();
    assert!(matches!(outcome, CaptureOutcome::Captured(_)));

    let keys = blobs.keys();
    assert_eq!(keys.len(), 1, "exactly one patch is kept");
    assert_ne!(
        keys, first_key,
        "the patch lives under the new capture's key"
    );
    assert!(
        service
            .patch(&view_access())
            .await
            .unwrap()
            .contains("run_again")
    );
}

#[tokio::test]
async fn an_empty_patch_is_a_changeset_with_nothing_in_it() {
    let (service, _repo, blobs) = service(ScriptedExtractor::returning(extracted("")));
    let CaptureOutcome::Captured(changeset) = service.capture(SESSION).await.unwrap() else {
        panic!("expected a capture");
    };
    assert!(changeset.files.is_empty());
    assert!(!changeset.has_patch());
    assert!(
        blobs.keys().is_empty(),
        "nothing is stored for an empty diff"
    );
    assert!(matches!(
        service.patch(&view_access()).await,
        Err(ChangesError::NoChangeset)
    ));
}

#[tokio::test]
async fn an_unsupported_harness_is_recorded_not_raised() {
    let (service, _repo, _blobs) = service(ScriptedExtractor::unsupported());
    assert_eq!(
        service.capture(SESSION).await.unwrap(),
        CaptureOutcome::Unsupported
    );
    let changes = service.changes(&view_access()).await.unwrap();
    assert!(changes.changeset.is_none());
    let attempt = changes.attempt.unwrap();
    assert_eq!(attempt.outcome, Some(AttemptOutcome::Unsupported));
    assert!(attempt.error.unwrap().contains("claude-code"));
}

#[tokio::test]
async fn a_harness_with_nothing_to_compare_keeps_the_previous_changeset() {
    let extractor = ScriptedExtractor::returning(extracted(PATCH));
    let (service, _repo, _blobs) = service(extractor.clone());
    service.capture(SESSION).await.unwrap();

    let not_ready = ScriptedExtractor::not_ready("The agent has not pushed a branch yet.");
    let sessions = InMemoryAgentSessionRepo::new();
    sessions.insert_session(test_agent_session(SESSION));
    // Same stores, different extractor: the second service sees the first
    // capture and fails to replace it.
    let repo = service.inner.repo.clone();
    let blobs = service.inner.blobs.clone();
    let second = AgentChangesService::new(
        sessions,
        not_ready,
        repo,
        blobs,
        RecordingRealtime::new(),
        NoPullRequestDrafts,
    );
    assert_eq!(
        second.capture(SESSION).await.unwrap(),
        CaptureOutcome::NotReady
    );
    let changes = second.changes(&view_access()).await.unwrap();
    assert!(changes.changeset.is_some(), "the earlier capture stays");
    let attempt = changes.attempt.unwrap();
    assert_eq!(attempt.outcome, Some(AttemptOutcome::NotReady));
    assert_eq!(
        attempt.error.as_deref(),
        Some("The agent has not pushed a branch yet.")
    );
}

#[tokio::test]
async fn an_extractor_failure_is_recorded_with_a_readable_reason() {
    let (service, _repo, _blobs) = service(ScriptedExtractor::failing("boom"));
    assert_eq!(
        service.capture(SESSION).await.unwrap(),
        CaptureOutcome::Failed
    );
    let attempt = service
        .changes(&view_access())
        .await
        .unwrap()
        .attempt
        .unwrap();
    assert_eq!(attempt.outcome, Some(AttemptOutcome::Failed));
    assert!(
        !attempt.error.unwrap().contains("boom"),
        "internal detail stays out"
    );
}

#[tokio::test]
async fn a_request_during_a_capture_becomes_one_rerun() {
    let extractor = ScriptedExtractor::returning(extracted(PATCH));
    let (service, _repo, _blobs) = service(extractor.clone());
    assert!(service.claim(SESSION), "the slot is free");
    // Two requests while it runs collapse into a single rerun.
    assert_eq!(
        service.capture(SESSION).await.unwrap(),
        CaptureOutcome::Queued
    );
    assert_eq!(
        service.capture(SESSION).await.unwrap(),
        CaptureOutcome::Queued
    );
    assert!(service.release(SESSION), "a rerun was asked for");
    assert!(!service.release(SESSION), "and only one");
    assert_eq!(
        extractor.calls(),
        0,
        "queued requests never call the extractor"
    );

    let outcome = service.capture(SESSION).await.unwrap();
    assert!(matches!(outcome, CaptureOutcome::Captured(_)));
    assert_eq!(extractor.calls(), 1);
}

#[tokio::test]
async fn requesting_a_capture_answers_with_the_running_attempt() {
    let (service, _repo, _blobs) = service(ScriptedExtractor::returning(extracted(PATCH)));
    let changes = service.request_capture(&edit_access()).await.unwrap();
    assert!(changes.attempt.is_some(), "the attempt is visible at once");
    // Let the background capture finish before the runtime goes away.
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let changes = service.changes(&view_access()).await.unwrap();
            if changes.changeset.is_some() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the background capture completes");
}

#[tokio::test]
async fn a_receipt_for_another_entity_type_is_refused() {
    let (service, _repo, _blobs) = service(ScriptedExtractor::returning(extracted(PATCH)));
    let access: EntityAccessReceipt<ViewAccessLevel> =
        EntityAccessReceipt::dangerously_assert_internal_user(
            &SESSION.as_uuid().to_string(),
            EntityType::Document,
        );
    assert!(matches!(
        service.changes(&access).await,
        Err(ChangesError::Forbidden)
    ));
}

#[tokio::test]
async fn drafting_needs_a_changeset() {
    let (service, _repo, _blobs) = service(ScriptedExtractor::returning(extracted(PATCH)));
    assert!(matches!(
        service.draft_pull_request(&edit_access()).await,
        Err(ChangesError::NoChangeset)
    ));
    service.capture(SESSION).await.unwrap();
    assert!(matches!(
        service.draft_pull_request(&edit_access()).await,
        Err(ChangesError::Draft(_))
    ));
}
