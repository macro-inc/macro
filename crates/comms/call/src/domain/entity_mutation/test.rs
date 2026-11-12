use entity_mutation::EntityMutationErrorCode;

use crate::domain::models::CallError;

#[test]
fn maps_team_share_errors_to_mutation_codes() {
    // A non-creator changing team sharing.
    assert!(matches!(
        EntityMutationErrorCode::from(CallError::Forbidden("not the creator".to_string())),
        EntityMutationErrorCode::Forbidden(_)
    ));
    // Stale team-share facts.
    assert!(matches!(
        EntityMutationErrorCode::from(CallError::Conflict("stale".to_string())),
        EntityMutationErrorCode::Conflict(_)
    ));
    // The view-only cap and contradictory legacy inputs.
    assert!(matches!(
        EntityMutationErrorCode::from(CallError::InvalidRequest("view only".to_string())),
        EntityMutationErrorCode::InvalidInput(_)
    ));
}
