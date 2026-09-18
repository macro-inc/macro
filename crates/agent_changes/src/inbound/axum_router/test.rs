use super::*;
use crate::domain::model::{ChangesetId, ChangesetRange};

#[test]
fn the_changes_response_says_when_a_capture_is_running() {
    let started = Utc::now();
    let running: AgentSessionChangesResponse = SessionChanges {
        changeset: None,
        attempt: Some(CaptureAttempt {
            started_at: started,
            finished_at: None,
            outcome: None,
            error: None,
        }),
    }
    .into();
    assert!(running.capturing);
    assert!(running.changeset.is_none());

    let done: AgentSessionChangesResponse = SessionChanges {
        changeset: Some(Changeset {
            id: ChangesetId::new(),
            session: crate::domain::model::AgentSessionId::TEST_A,
            source: ChangesetSource::GithubPullRequest,
            range: ChangesetRange::default(),
            files: vec![ChangedFile {
                path: "a.rs".to_owned(),
                previous_path: Some("b.rs".to_owned()),
                kind: FileChangeKind::Renamed,
                additions: 1,
                deletions: 2,
                binary: false,
                patch_omitted: true,
            }],
            additions: 1,
            deletions: 2,
            patch_bytes: 10,
            truncated: true,
            captured_at: started,
        }),
        attempt: Some(CaptureAttempt {
            started_at: started,
            finished_at: Some(started),
            outcome: Some(AttemptOutcome::Captured),
            error: None,
        }),
    }
    .into();
    assert!(!done.capturing);
    let changeset = done.changeset.unwrap();
    assert_eq!(changeset.files[0].kind, FileChangeKindDto::Renamed);
    assert!(changeset.files[0].patch_omitted);
    assert_eq!(
        done.attempt.unwrap().outcome,
        Some(CaptureOutcomeDto::Captured)
    );

    let json = serde_json::to_value(&changeset).unwrap();
    assert_eq!(json["files"][0]["previousPath"], "b.rs");
    assert_eq!(json["source"], "github_pull_request");
    assert_eq!(json["files"][0]["kind"], "renamed");
}

#[test]
fn errors_answer_with_the_status_the_pane_branches_on() {
    let forbidden = AgentChangesApiError::from(ChangesError::Forbidden).into_response();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    let missing = AgentChangesApiError::from(ChangesError::NoChangeset).into_response();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    let storage = AgentChangesApiError::from(ChangesError::Storage(rootcause::report!("down")))
        .into_response();
    assert_eq!(storage.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
