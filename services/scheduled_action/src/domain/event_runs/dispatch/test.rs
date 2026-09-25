use super::super::test_support::*;
use super::*;
use entity_access::domain::models::{
    AccessLevel, BotReceiptAuth, BotReceiptScope, Entity, EntityAccessAuth, EntityPermission,
};
use serde_json::json;

async fn dispatch(
    service: &impl EventRunDispatch,
    pending: PendingEventRun,
) -> Result<DispatchResult, Report> {
    service.dispatch(pending, std::future::pending()).await
}

#[tokio::test]
async fn shutdown_before_claim_leaves_work_pending() {
    let (repo, access, executor, pending) = setup();
    let service = EventDispatchService::new(repo.clone(), access, executor.clone());
    assert_eq!(
        service
            .dispatch(pending, std::future::ready(()))
            .await
            .unwrap(),
        DispatchResult::NotStarted
    );
    assert!(repo.0.lock().unwrap().started.is_empty());
    assert_eq!(repo.0.lock().unwrap().pending.len(), 1);
    assert!(executor.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn access_revoked_after_admission_cancels_without_execution() {
    let (repo, access, executor, pending) = setup();
    *access.denied.lock().unwrap() = true;
    let service = EventDispatchService::new(repo.clone(), access, executor.clone());
    assert_eq!(
        dispatch(&service, pending).await.unwrap(),
        DispatchResult::Cancelled(CancellationReason::AccessDenied)
    );
    assert!(executor.calls.lock().unwrap().is_empty());
    assert!(repo.0.lock().unwrap().started.is_empty());
}

#[tokio::test]
async fn non_user_owner_never_reaches_authorization_or_execution() {
    let (repo, access, executor, pending) = setup();
    repo.0.lock().unwrap().configurations[0].owner = Owner::Team(generate_uuid_v7());
    let service = EventDispatchService::new(repo, access.clone(), executor.clone());
    assert_eq!(
        dispatch(&service, pending).await.unwrap(),
        DispatchResult::Cancelled(CancellationReason::NotUserOwned)
    );
    assert!(access.calls.lock().unwrap().is_empty());
    assert!(executor.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn deletion_trigger_change_disable_and_reenable_cancel_obsolete_work() {
    for change in 0..5 {
        let (repo, access, executor, pending) = setup();
        let reason = {
            let mut state = repo.0.lock().unwrap();
            match change {
                // Deletion or a switch to cron returns no event configuration.
                0 | 1 => {
                    state.configurations.clear();
                    CancellationReason::Superseded
                }
                2 => {
                    state.configurations[0].enabled = false;
                    CancellationReason::Disabled
                }
                3 => {
                    // Re-enabled actions have a new revision even with identical filters.
                    state.configurations[0].revision = pending.revision.next().unwrap();
                    CancellationReason::Superseded
                }
                _ => {
                    state.configurations[0].filters =
                        serde_json::from_value(json!([{"events":["channel.created"]}])).unwrap();
                    CancellationReason::Superseded
                }
            }
        };
        let service = EventDispatchService::new(repo, access, executor.clone());
        assert_eq!(
            dispatch(&service, pending).await.unwrap(),
            DispatchResult::Cancelled(reason)
        );
        assert!(executor.calls.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn transient_prestart_errors_leave_pending_but_failed_execution_is_terminal() {
    let (repo, access, executor, pending) = setup();
    let service = EventDispatchService::new(repo.clone(), access.clone(), executor.clone());
    *access.unavailable.lock().unwrap() = true;
    assert!(dispatch(&service, pending.clone()).await.is_err());
    *access.unavailable.lock().unwrap() = false;
    repo.0.lock().unwrap().fail_claim = true;
    assert!(dispatch(&service, pending.clone()).await.is_err());
    assert_eq!(repo.0.lock().unwrap().pending.len(), 1);
    assert!(executor.calls.lock().unwrap().is_empty());
    repo.0.lock().unwrap().fail_claim = false;
    executor
        .outcomes
        .lock()
        .unwrap()
        .push_back(EventRunOutcome::Failed);
    assert_eq!(
        dispatch(&service, pending.clone()).await.unwrap(),
        DispatchResult::Finished(FinalizationResult::Finalized)
    );
    assert_eq!(
        dispatch(&service, pending).await.unwrap(),
        DispatchResult::NotStarted
    );
    assert_eq!(executor.calls.lock().unwrap().len(), 1);
    assert_eq!(
        repo.0.lock().unwrap().finished[0].1,
        EventRunOutcome::Failed
    );
}

#[tokio::test]
async fn poststart_bookkeeping_failure_is_reconciled_without_reexecution() {
    let (repo, access, executor, pending) = setup();
    repo.0.lock().unwrap().fail_finalize = true;
    let service = EventDispatchService::new(repo.clone(), access, executor.clone());
    assert!(dispatch(&service, pending.clone()).await.is_err());
    assert!(
        service
            .pending(10.try_into().unwrap())
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        dispatch(&service, pending.clone()).await.unwrap(),
        DispatchResult::NotStarted
    );
    assert_eq!(service.reconcile(10.try_into().unwrap()).await.unwrap(), 0);
    repo.0.lock().unwrap().started[0].2 = Utc::now() - chrono::Duration::seconds(1);
    assert_eq!(service.reconcile(10.try_into().unwrap()).await.unwrap(), 1);
    assert_eq!(
        repo.0.lock().unwrap().finished[0].1,
        EventRunOutcome::Interrupted
    );
    assert_eq!(
        dispatch(&service, pending).await.unwrap(),
        DispatchResult::NotStarted
    );
    assert_eq!(executor.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn claim_race_never_executes_but_disable_after_start_does_not_undo_run() {
    let (repo, access, executor, pending) = setup();
    let service = EventDispatchService::new(repo.clone(), access, executor.clone());
    repo.0.lock().unwrap().lose_claim = true;
    assert_eq!(
        dispatch(&service, pending.clone()).await.unwrap(),
        DispatchResult::NotStarted
    );
    assert!(executor.calls.lock().unwrap().is_empty());
    repo.0.lock().unwrap().lose_claim = false;
    repo.0.lock().unwrap().disable_after_claim = true;
    assert_eq!(
        dispatch(&service, pending).await.unwrap(),
        DispatchResult::Finished(FinalizationResult::Finalized)
    );
    assert!(!repo.0.lock().unwrap().configurations[0].enabled);
    assert_eq!(executor.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn two_events_queue_during_execution_then_failure_does_not_block_next() {
    let (repo, access, executor, first) = setup();
    let configuration = repo.0.lock().unwrap().configurations[0].clone();
    let authorized = AuthorizedEventRun::prepare(
        first.clone(),
        &configuration,
        capability(user(), &first.event),
    )
    .unwrap();
    let now = Utc::now();
    let started = repo
        .claim(
            authorized,
            ClaimToken::generate(),
            now,
            now + MAX_ACTION_TIME,
        )
        .await
        .unwrap()
        .unwrap();
    let second = pending(&configuration);
    let third = pending(&configuration);
    repo.admit(second.action_id, second.revision, &second.event)
        .await
        .unwrap();
    repo.admit(third.action_id, third.revision, &third.event)
        .await
        .unwrap();
    let service = EventDispatchService::new(repo.clone(), access, executor.clone());
    assert!(
        service
            .pending(10.try_into().unwrap())
            .await
            .unwrap()
            .is_empty()
    );
    repo.finalize(FinalizeEventRun {
        key: first.key(),
        token: started.token,
        finished_at: now,
        execution: EventExecutionResult {
            outcome: EventRunOutcome::Failed,
            record: None,
        },
    })
    .await
    .unwrap();
    executor
        .outcomes
        .lock()
        .unwrap()
        .push_back(EventRunOutcome::Failed);
    let page = service.pending(10.try_into().unwrap()).await.unwrap();
    assert_eq!(page[0].key(), second.key());
    dispatch(&service, page[0].clone()).await.unwrap();
    let page = service.pending(10.try_into().unwrap()).await.unwrap();
    assert_eq!(page[0].key(), third.key());
    dispatch(&service, page[0].clone()).await.unwrap();
    assert_eq!(
        *executor.calls.lock().unwrap(),
        vec![second.key(), third.key()]
    );
    assert_eq!(
        repo.0.lock().unwrap().finished[2].1,
        EventRunOutcome::Succeeded
    );
}

#[test]
fn preparation_binds_receipt_to_authenticated_owner_entity_and_kind() {
    let configuration = configuration();
    let pending = pending(&configuration);
    for auth in [
        EntityAccessAuth::Internal,
        EntityAccessAuth::Unauthenticated,
        EntityAccessAuth::Authenticated(
            MacroUserIdStr::parse_from_str("macro|other@macro.com").unwrap(),
        ),
        EntityAccessAuth::Bot(BotReceiptAuth::new(
            entity_access::domain::models::BotIdStr::parse_from_str(
                "bot|01900000-0000-7000-8000-000000000004",
            )
            .unwrap(),
            BotReceiptScope::User {
                acting_user: user(),
            },
        )),
    ] {
        let receipt = EntityAccessReceipt::try_new(
            auth,
            Entity {
                entity_id: pending.event.entity_id().to_string(),
                entity_type: EntityType::Document,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::View,
            },
        )
        .unwrap();
        assert!(matches!(
            AuthorizedEventRun::prepare(
                pending.clone(),
                &configuration,
                EventAccessCapability::Document(receipt)
            ),
            Err(CancellationReason::AccessDenied)
        ));
    }
    for (id, kind) in [
        (generate_uuid_v7(), EntityType::Document),
        (pending.event.entity_id(), EntityType::Chat),
    ] {
        let receipt = EntityAccessReceipt::try_new_authenticated_user(
            user(),
            Entity {
                entity_id: id.to_string(),
                entity_type: kind,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::View,
            },
        )
        .unwrap();
        assert!(
            AuthorizedEventRun::prepare(
                pending.clone(),
                &configuration,
                EventAccessCapability::Document(receipt)
            )
            .is_err()
        );
    }
    assert!(
        AuthorizedEventRun::prepare(
            pending.clone(),
            &configuration,
            capability(user(), &pending.event)
        )
        .is_ok()
    );
    let mut channel = pending.clone();
    channel.event = serde_json::from_value(json!({"event_id": generate_uuid_v7(), "event_name":"channel.created", "entity_id": pending.event.entity_id(), "message_id":null})).unwrap();
    assert!(
        AuthorizedEventRun::prepare(
            channel.clone(),
            &configuration,
            capability(user(), &pending.event)
        )
        .is_err()
    );
    assert!(
        AuthorizedEventRun::prepare(
            channel.clone(),
            &configuration,
            capability(user(), &channel.event)
        )
        .is_ok()
    );
}
