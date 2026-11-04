use super::*;
use uuid::Uuid;

fn uncertain() -> MessageOperationFacts {
    MessageOperationFacts {
        state: StoredOperationState::Unknown,
        stage: Some(DraftStage::Confirming),
        revision: 7,
        remote_version: Some("opaque-version".into()),
        issue: Some(MessageOperationIssue::SendUnknown),
    }
}

fn request(action: MessageResolutionAction) -> MessageResolutionRequest {
    MessageResolutionRequest {
        message_id: Uuid::now_v7(),
        revision: 7,
        remote_version: Some("opaque-version".into()),
        action,
        accept_duplicate_risk: false,
    }
}

#[test]
fn uncertain_send_requires_explicit_duplicate_risk_acceptance_to_retry() {
    assert!(plan_resolution(uncertain(), request(MessageResolutionAction::RetrySend)).is_err());
    let mut input = request(MessageResolutionAction::RetrySend);
    input.accept_duplicate_risk = true;
    assert!(plan_resolution(uncertain(), input).is_ok());
    assert!(plan_resolution(uncertain(), request(MessageResolutionAction::Recheck)).is_ok());
    assert!(plan_resolution(uncertain(), request(MessageResolutionAction::KeepLocal)).is_err());
}

#[test]
fn a_resolution_cannot_apply_to_a_newer_local_or_remote_revision() {
    let mut input = request(MessageResolutionAction::Recheck);
    input.revision = 6;
    assert!(plan_resolution(uncertain(), input).is_err());
    let mut input = request(MessageResolutionAction::Recheck);
    input.remote_version = Some("another-version".into());
    assert!(plan_resolution(uncertain(), input).is_err());
}

#[test]
fn confirmation_and_uncertainty_are_distinct_from_success() {
    assert_eq!(
        MessageOperationStatus::from(uncertain()).state,
        MessageOperationState::Uncertain
    );
    let mut facts = uncertain();
    facts.state = StoredOperationState::Running;
    assert_eq!(
        MessageOperationStatus::from(facts.clone()).state,
        MessageOperationState::Confirming
    );
    facts.state = StoredOperationState::Sent;
    assert_eq!(
        MessageOperationStatus::from(facts).state,
        MessageOperationState::Sent
    );
}
