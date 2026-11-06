//! A channel call's team sharing changes only once everyone on it agrees.

use super::*;
use crate::domain::models::{
    CallTeamShareState, EditCallRecordOutcome, PendingTeamShareChange, TeamShareChange,
};

const CREATOR_ID: &str = "macro|creator@example.com";
const EDITOR_ID: &str = "macro|editor@example.com";
const OTHER_ID: &str = "macro|other@example.com";

fn approvers(repo: &mut MockCallRepository, people: &'static [&'static str]) {
    repo.expect_team_share_approvers().returning(move |_| {
        Box::pin(async move { Ok(people.iter().map(ToString::to_string).collect()) })
    });
}

fn open_change(repo: &mut MockCallRepository, shared: bool, approved_by: &'static [&'static str]) {
    let change = TeamShareChange {
        shared,
        requested_by: approved_by[0].to_string(),
        approved_by: approved_by.iter().map(ToString::to_string).collect(),
    };
    repo.expect_get_team_share_change().returning(move |_| {
        let change = change.clone();
        Box::pin(async move { Ok(Some(change)) })
    });
}

fn no_open_change(repo: &mut MockCallRepository) {
    repo.expect_get_team_share_change()
        .returning(|_| Box::pin(async { Ok(None) }));
}

/// The repository's approval: the actor joins the given earlier approvals.
fn records_approval(
    repo: &mut MockCallRepository,
    expected_shared: bool,
    earlier: &'static [&'static str],
) {
    repo.expect_approve_team_share_change()
        .times(1)
        .returning(move |call_id, shared, user_id| {
            assert_eq!(*call_id, MUTATED_EVENT_CALL_ID);
            assert_eq!(shared, expected_shared);
            let actor = user_id.as_ref().to_string();
            let mut approved_by: Vec<String> = earlier.iter().map(ToString::to_string).collect();
            approved_by.push(actor.clone());
            Box::pin(async move {
                Ok(Some(TeamShareChange {
                    shared,
                    requested_by: approved_by[0].clone(),
                    approved_by,
                }))
            })
        });
}

fn serves_record(repo: &mut MockCallRepository, record: CallRecord) {
    repo.expect_get_call_record_by_call_id()
        .returning(move |_| {
            let record = record.clone();
            Box::pin(async move { Ok(Some(record)) })
        });
}

fn other_receipt() -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user("other@example.com"),
        &MUTATED_EVENT_CALL_ID.to_string(),
        EntityType::Call,
    )
}

#[tokio::test]
async fn toggling_with_someone_else_on_the_call_changes_nothing_yet() {
    let mut repo = MockCallRepository::new();
    serves_record(&mut repo, live_record());
    no_open_change(&mut repo);
    approvers(&mut repo, &[EDITOR_ID, OTHER_ID]);
    records_approval(&mut repo, true, &[]);
    // No toggle or patch expectation: writing the value would panic.
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    let shared = service
        .toggle_share_with_team(authenticated_mutation_receipt())
        .await
        .expect("proposal succeeds");

    assert!(!shared);
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn editing_with_someone_else_on_the_call_holds_the_change_and_keeps_the_rename() {
    let mut repo = MockCallRepository::new();
    serves_record(&mut repo, live_record());
    no_open_change(&mut repo);
    approvers(&mut repo, &[EDITOR_ID, OTHER_ID]);
    records_approval(&mut repo, true, &[]);
    repo.expect_patch_call_record()
        .times(1)
        .returning(|_, args| {
            assert_eq!(args.custom_name.as_deref(), Some("Renamed"));
            assert_eq!(args.live_share_with_team, None);
            assert!(args.team_share.is_none());
            Box::pin(async { Ok(()) })
        });
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    let outcome = service
        .edit_call_record(
            authenticated_mutation_receipt(),
            EditCallRecordRequest {
                share_permission: None,
                share_with_team: Some(true),
                custom_name: Some("Renamed".to_string()),
            },
        )
        .await
        .expect("edit succeeds");

    assert_eq!(outcome, EditCallRecordOutcome::TeamShareAwaitingApproval);
    assert_updated_event(
        &event_broker,
        Some(MUTATED_EVENT_ACTOR),
        Some("Renamed"),
        None,
    );
}

#[tokio::test]
async fn the_last_approval_applies_a_live_change_and_clears_the_request() {
    let mut repo = MockCallRepository::new();
    serves_record(&mut repo, live_record());
    open_change(&mut repo, true, &[EDITOR_ID]);
    approvers(&mut repo, &[EDITOR_ID, OTHER_ID]);
    records_approval(&mut repo, true, &[EDITOR_ID]);
    repo.expect_patch_call_record()
        .times(1)
        .returning(|_, args| {
            assert_eq!(args.live_share_with_team, Some(true));
            assert!(args.team_share.is_none());
            Box::pin(async { Ok(()) })
        });
    repo.expect_clear_team_share_change()
        .times(1)
        .returning(|_| Box::pin(async { Ok(()) }));
    repo.expect_get_participants()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Vec::new()) }));
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    service
        .respond_to_team_share_change(other_receipt(), true)
        .await
        .expect("approval succeeds");

    assert_updated_event(&event_broker, Some(OTHER_ID), None, Some(true));
}

#[tokio::test]
async fn the_last_approval_applies_an_archived_change_as_the_creator() {
    let mut repo = MockCallRepository::new();
    serves_record(&mut repo, call_record_for_mutation());
    open_change(&mut repo, true, &[CREATOR_ID]);
    approvers(&mut repo, &[CREATOR_ID, OTHER_ID]);
    records_approval(&mut repo, true, &[CREATOR_ID]);
    repo.expect_get_team_share_facts()
        .times(1)
        .returning(|_| Box::pin(async { Ok(team_share_facts()) }));
    repo.expect_patch_call_record()
        .times(1)
        .returning(|_, args| {
            assert_eq!(args.live_share_with_team, None);
            let command = args.team_share.as_ref().expect("creator's command");
            assert_eq!(
                command.target().map(|grant| grant.level),
                Some(TeamShareLevel::View)
            );
            Box::pin(async { Ok(()) })
        });
    repo.expect_clear_team_share_change()
        .times(1)
        .returning(|_| Box::pin(async { Ok(()) }));
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    // `other` is not the creator, and could not make this change alone.
    service
        .respond_to_team_share_change(other_receipt(), true)
        .await
        .expect("approval succeeds");

    assert_updated_event(&event_broker, Some(OTHER_ID), None, Some(true));
}

#[tokio::test]
async fn proposing_an_open_change_again_is_not_an_approval() {
    let mut repo = MockCallRepository::new();
    serves_record(&mut repo, live_record());
    open_change(&mut repo, true, &[OTHER_ID]);
    // No approval expectation: an agent acting as the waiting person, through
    // the tool or the toggle, must not be able to answer for them.
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    let shared = service
        .toggle_share_with_team(authenticated_mutation_receipt())
        .await
        .expect("nothing changes");

    assert!(!shared);
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn a_failed_apply_keeps_the_request_so_the_approval_can_be_retried() {
    let mut repo = MockCallRepository::new();
    serves_record(&mut repo, live_record());
    open_change(&mut repo, true, &[EDITOR_ID]);
    approvers(&mut repo, &[EDITOR_ID, OTHER_ID]);
    records_approval(&mut repo, true, &[EDITOR_ID]);
    repo.expect_patch_call_record()
        .times(1)
        .returning(|_, _| Box::pin(async { Err(CallError::Conflict("archived".to_string())) }));
    // No clear expectation: dropping the request would panic.
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    let result = service
        .respond_to_team_share_change(other_receipt(), true)
        .await;

    assert!(matches!(result, Err(CallError::Conflict(_))));
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn a_decline_drops_the_request_and_leaves_sharing_alone() {
    let mut repo = MockCallRepository::new();
    serves_record(&mut repo, live_record());
    let mut reads = mockall::Sequence::new();
    repo.expect_get_team_share_change()
        .times(1)
        .in_sequence(&mut reads)
        .returning(|_| {
            Box::pin(async {
                Ok(Some(TeamShareChange {
                    shared: true,
                    requested_by: EDITOR_ID.to_string(),
                    approved_by: vec![EDITOR_ID.to_string()],
                }))
            })
        });
    repo.expect_get_team_share_change()
        .times(1)
        .in_sequence(&mut reads)
        .returning(|_| Box::pin(async { Ok(None) }));
    approvers(&mut repo, &[EDITOR_ID, OTHER_ID]);
    repo.expect_clear_team_share_change()
        .times(1)
        .returning(|_| Box::pin(async { Ok(()) }));
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    let state = service
        .respond_to_team_share_change(other_receipt(), false)
        .await
        .expect("decline succeeds");

    assert_eq!(
        state,
        CallTeamShareState {
            shared: false,
            pending: None,
        }
    );
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn someone_not_on_the_call_cannot_answer() {
    let mut repo = MockCallRepository::new();
    serves_record(&mut repo, live_record());
    open_change(&mut repo, true, &[EDITOR_ID]);
    approvers(&mut repo, &[EDITOR_ID, CREATOR_ID]);
    let service = build_mutation_service(repo, RecordingEventBroker::default());

    for approve in [true, false] {
        assert!(matches!(
            service
                .respond_to_team_share_change(other_receipt(), approve)
                .await,
            Err(CallError::Forbidden(_))
        ));
    }
}

#[tokio::test]
async fn answering_a_settled_change_returns_the_current_state() {
    let mut repo = MockCallRepository::new();
    serves_record(&mut repo, live_record());
    no_open_change(&mut repo);
    let service = build_mutation_service(repo, RecordingEventBroker::default());

    let state = service
        .respond_to_team_share_change(other_receipt(), true)
        .await
        .expect("a retry succeeds");

    assert_eq!(
        state,
        CallTeamShareState {
            shared: false,
            pending: None,
        }
    );
}

#[tokio::test]
async fn an_opposite_change_in_flight_is_a_conflict() {
    let mut repo = MockCallRepository::new();
    serves_record(&mut repo, live_record());
    no_open_change(&mut repo);
    approvers(&mut repo, &[EDITOR_ID, OTHER_ID]);
    repo.expect_approve_team_share_change()
        .times(1)
        .returning(|_, _, _| Box::pin(async { Ok(None) }));
    let service = build_mutation_service(repo, RecordingEventBroker::default());

    assert!(matches!(
        service
            .toggle_share_with_team(authenticated_mutation_receipt())
            .await,
        Err(CallError::Conflict(_))
    ));
}

#[tokio::test]
async fn a_caller_without_a_person_cannot_propose_over_participants() {
    let mut repo = MockCallRepository::new();
    serves_record(&mut repo, live_record());
    no_open_change(&mut repo);
    approvers(&mut repo, &[EDITOR_ID]);
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    assert!(matches!(
        service
            .toggle_share_with_team(internal_mutation_receipt())
            .await,
        Err(CallError::Forbidden(_))
    ));
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn a_channel_less_call_needs_no_consent_to_clear() {
    let mut record = standalone_record(true);
    record.share_with_team = true;
    let mut repo = MockCallRepository::new();
    serves_record(&mut repo, record);
    repo.expect_patch_call_record()
        .times(1)
        .returning(|_, args| {
            assert_eq!(args.live_share_with_team, Some(false));
            Box::pin(async { Ok(()) })
        });
    repo.expect_get_participants()
        .returning(|_| Box::pin(async { Ok(Vec::new()) }));
    let service = build_mutation_service(repo, RecordingEventBroker::default());

    let shared = service
        .toggle_share_with_team(authenticated_mutation_receipt())
        .await
        .expect("clearing succeeds");

    assert!(!shared);
}

#[tokio::test]
async fn state_reports_who_a_change_still_waits_on() {
    let mut repo = MockCallRepository::new();
    serves_record(&mut repo, live_record());
    open_change(&mut repo, true, &[EDITOR_ID]);
    approvers(&mut repo, &[CREATOR_ID, EDITOR_ID, OTHER_ID]);
    let service = build_mutation_service(repo, RecordingEventBroker::default());

    let state = service
        .get_team_share_state(reader_receipt())
        .await
        .expect("state loads");

    assert_eq!(
        state,
        CallTeamShareState {
            shared: false,
            pending: Some(PendingTeamShareChange {
                shared: true,
                requested_by: EDITOR_ID.to_string(),
                waiting_on: vec![CREATOR_ID.to_string(), OTHER_ID.to_string()],
            }),
        }
    );
}
