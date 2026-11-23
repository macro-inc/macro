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

/// Folder trash, restore and purge run through this: a dropped request must
/// not stop the work partway.
#[tokio::test]
async fn run_on_own_task_finishes_after_the_caller_is_dropped() {
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (finished_tx, finished_rx) = tokio::sync::oneshot::channel();
    let release = Arc::new(tokio::sync::Notify::new());
    let waiting = Arc::clone(&release);
    let caller = tokio::spawn(run_on_own_task(async move {
        let _ = started_tx.send(());
        waiting.notified().await;
        let _ = finished_tx.send(());
        Ok(Vec::new())
    }));

    started_rx.await.expect("work should start");
    caller.abort();
    assert!(
        caller
            .await
            .expect_err("caller should be cancelled")
            .is_cancelled()
    );
    release.notify_one();

    assert_eq!(finished_rx.await, Ok(()));
}
