use super::*;

#[test]
fn success_includes_requested_entity_and_cascade_refs() {
    let requested = EntityType::Project.with_entity_string("project-1".to_owned());
    let child = EntityType::Document.with_entity_string("document-1".to_owned());

    let success = success_with_affected(requested.clone(), vec![child.clone()])
        .expect("mutation should succeed");

    assert_eq!(success.affected_entities, vec![requested, child]);
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

#[test]
fn favoritable_kinds_are_an_explicit_allowlist() {
    for entity_type in [
        EntityType::User,
        EntityType::Team,
        EntityType::ChannelMessage,
    ] {
        assert!(
            !favoritable(entity_type),
            "{entity_type} must not be favoritable"
        );
    }
    for entity_type in [
        EntityType::Document,
        EntityType::Project,
        EntityType::Chat,
        EntityType::Channel,
        EntityType::EmailThread,
        EntityType::Call,
        EntityType::ForeignEntity,
        EntityType::StaticFile,
        EntityType::CrmCompany,
        EntityType::CrmContact,
    ] {
        assert!(
            favoritable(entity_type),
            "{entity_type} must be favoritable"
        );
    }
}
