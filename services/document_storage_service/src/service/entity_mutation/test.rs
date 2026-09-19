use super::*;

#[test]
fn success_preserves_domain_effect_order_and_kind() {
    let requested = EntityType::Project.with_entity_string("project-1".to_owned());
    let child = EntityType::Document.with_entity_string("document-1".to_owned());
    let effects = vec![
        EntityMutationEffect::deleted(requested.clone()),
        EntityMutationEffect::updated(child.clone()),
    ];

    let success = success(effects.clone()).expect("mutation should succeed");

    assert_eq!(success.effects, effects);
}

#[test]
fn lifecycle_invalid_inputs_map_to_stable_public_error() {
    let error = lifecycle_failure(LifecycleError::InvalidInput(
        "invalid project state".to_owned(),
    ));

    assert!(matches!(
        error,
        entity_mutation::EntityMutationErrorCode::InvalidInput(_)
    ));
}

#[test]
fn target_project_failures_map_to_stable_error_codes() {
    let forbidden = target_project_failure(AccessError::Unauthorized);
    assert!(matches!(
        forbidden,
        entity_mutation::EntityMutationErrorCode::Forbidden(_)
    ));

    let missing = target_project_failure(AccessError::NotFound("project-1"));
    assert!(matches!(
        missing,
        entity_mutation::EntityMutationErrorCode::NotFound(_)
    ));
}
