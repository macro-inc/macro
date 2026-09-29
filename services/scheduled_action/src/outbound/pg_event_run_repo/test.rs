use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;

use super::*;
use crate::domain::event_runs::EventExecutionResult;
use crate::domain::models::ActionExecutionRecord;

const USER: &str = "macro|event-run@macro.com";

fn page(size: u16) -> PageSize {
    size.try_into().unwrap()
}

fn new_event(entity_id: Uuid) -> EventReference {
    serde_json::from_value(json!({
        "event_id": generate_uuid_v7(),
        "event_name": "document.updated",
        "entity_id": entity_id,
        "message_id": null,
    }))
    .unwrap()
}

async fn action(pool: &PgPool, filters: Value) -> Uuid {
    let user_id = generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2) ON CONFLICT DO NOTHING",
        user_id,
        USER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id)
           SELECT $1, $1, id FROM macro_user WHERE email = $1 ON CONFLICT DO NOTHING"#,
        USER,
    )
    .execute(pool)
    .await
    .unwrap();
    let id = generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO scheduled_action
            (id, owner, name, kind, task, enabled, trigger_type, event_filters, event_activated_at)
        VALUES ($1, $2, 'event run test', 'Agent', '{}', true, 'events', $3, $4)
        ON CONFLICT DO NOTHING
        "#,
        id,
        USER,
        filters,
        Utc::now() - chrono::Duration::days(1),
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn setup(pool: &PgPool) -> (PgEventRunRepo, Uuid, EventReference) {
    let id = action(pool, json!([{"events": ["document.updated"]}])).await;
    (
        PgEventRunRepo::new(pool.clone()),
        id,
        new_event(generate_uuid_v7()),
    )
}

async fn admit(repo: &PgEventRunRepo, action_id: Uuid, event: &EventReference) {
    assert_eq!(
        repo.admit(action_id, ConfigurationRevision::INITIAL, event)
            .await
            .unwrap(),
        AdmissionResult::Admitted,
    );
}

fn authorized(pending: PendingEventRun) -> AuthorizedEventRun {
    let access = EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str(USER).unwrap(),
        &pending.event.entity_id().to_string(),
        EntityType::Document,
    );
    AuthorizedEventRun {
        pending,
        access: crate::domain::event_runs::EventAccessCapability::Document(access),
    }
}

async fn claim(repo: &PgEventRunRepo, pending: PendingEventRun) -> Option<ClaimedEventRun> {
    let now = Utc::now();
    repo.claim(
        authorized(pending),
        ClaimToken::generate(),
        now,
        now + MAX_ACTION_TIME,
    )
    .await
    .unwrap()
}

fn completion(run: &ClaimedEventRun, outcome: EventRunOutcome) -> FinalizeEventRun {
    FinalizeEventRun {
        key: run.run.pending.key(),
        token: run.token,
        finished_at: Utc::now(),
        execution: EventExecutionResult {
            outcome,
            record: Some(ActionExecutionRecord {
                id: None,
                action_id: run.run.pending.action_id,
                resource_id: Some("run-chat".into()),
                start_time: run.started_at,
                end_time: Utc::now(),
                is_success: matches!(outcome, EventRunOutcome::Succeeded),
                result: json!({}),
                created_at: Utc::now(),
            }),
        },
    }
}

async fn state(pool: &PgPool, key: EventRunKey) -> (String, Option<Value>, Option<Uuid>) {
    let row = sqlx::query!(
        "SELECT state, outcome, execution_record_id FROM scheduled_action_event_run WHERE action_id = $1 AND event_id = $2",
        key.action_id,
        key.event_id.as_uuid(),
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (row.state, row.outcome, row.execution_record_id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_duplicate_admission_and_cascade_cleanup(pool: PgPool) {
    let (repo, id, event) = setup(&pool).await;
    let (a, b) = tokio::join!(
        repo.admit(id, ConfigurationRevision::INITIAL, &event),
        repo.admit(id, ConfigurationRevision::INITIAL, &event),
    );
    let results = [a.unwrap(), b.unwrap()];
    assert!(results.contains(&AdmissionResult::Admitted));
    assert!(results.contains(&AdmissionResult::AlreadyPresent));
    let pending = repo.pending_runs(page(100)).await.unwrap();
    assert_eq!(pending.len(), 1);
    let started = claim(&repo, pending[0].clone()).await.unwrap();
    repo.finalize(completion(&started, EventRunOutcome::Succeeded))
        .await
        .unwrap();
    assert_eq!(
        repo.admit(id, ConfigurationRevision::INITIAL, &event)
            .await
            .unwrap(),
        AdmissionResult::AlreadyPresent
    );
    sqlx::query!("DELETE FROM scheduled_action WHERE id = $1", id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM scheduled_action_event_run")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM action_execution_record")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    assert_eq!(
        repo.admit(id, ConfigurationRevision::INITIAL, &event)
            .await
            .unwrap(),
        AdmissionResult::Ineligible
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn candidates_exact_recheck_activation_and_keyset_pages(pool: PgPool) {
    let entity_id = generate_uuid_v7();
    let event = new_event(entity_id);
    // Containment matches the name, but an ID from a different filter cannot
    // satisfy that filter. Empty IDs must not turn into unrestricted selectors.
    action(
        &pool,
        json!([
            {"events": ["document.updated"], "ids": [generate_uuid_v7()]},
            {"events": ["document.created"], "ids": [entity_id]},
        ]),
    )
    .await;
    action(&pool, json!([{"events": ["document.updated"], "ids": []}])).await;
    let null_ids = action(
        &pool,
        json!([{"events": ["document.updated"], "ids": null}]),
    )
    .await;
    let exact = action(
        &pool,
        json!([
            {"events": ["document.updated"], "ids": [entity_id]},
            {"events": ["document.updated"]},
        ]),
    )
    .await;
    let repo = PgEventRunRepo::new(pool.clone());
    let first = repo.candidate_actions(&event, None, page(1)).await.unwrap();
    let second = repo
        .candidate_actions(&event, first.next_after, page(1))
        .await
        .unwrap();
    assert_eq!(
        [
            first.configurations[0].action_id,
            second.configurations[0].action_id
        ],
        [null_ids, exact]
    );
    assert!(
        repo.candidate_actions(&event, Some(exact), page(1))
            .await
            .unwrap()
            .next_after
            .is_none()
    );
    admit(&repo, exact, &event).await;
    assert_eq!(repo.pending_runs(page(100)).await.unwrap().len(), 1);
    sqlx::query!(
        "UPDATE scheduled_action SET event_activated_at = $2 WHERE id = $1",
        null_ids,
        Utc::now() + chrono::Duration::days(1)
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.admit(null_ids, ConfigurationRevision::INITIAL, &event)
            .await
            .unwrap(),
        AdmissionResult::Ineligible
    );
    assert_eq!(
        repo.candidate_actions(&event, None, page(100))
            .await
            .unwrap()
            .configurations
            .len(),
        1
    );
}

struct AllowAccess;

impl crate::domain::event_runs::CurrentOwnerAccess for AllowAccess {
    async fn authorize(
        &self,
        owner: &MacroUserIdStr<'static>,
        event: &EventReference,
    ) -> Result<Option<crate::domain::event_runs::EventAccessCapability>, Report> {
        Ok(Some(
            crate::domain::event_runs::EventAccessCapability::Document(
                EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_authenticated_user(
                    owner.clone(),
                    &event.entity_id().to_string(),
                    EntityType::Document,
                ),
            ),
        ))
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn admission_skips_invalid_first_and_middle_pages_without_truncating_fanout(pool: PgPool) {
    use crate::domain::event_runs::{
        EventIngestion, EventIngestionResult, admission::EventAdmissionService,
    };
    use crate::domain::event_trigger::{EventPayload, IncomingEvent};
    use std::sync::Arc;

    let valid = json!([{"events": ["document.updated"]}]);
    let malformed_owner = action(&pool, valid.clone()).await;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id)
           SELECT $1, $1, id FROM macro_user WHERE email = $2"#,
        "invalid private owner",
        USER,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE scheduled_action SET owner = $2 WHERE id = $1",
        malformed_owner,
        "invalid private owner"
    )
    .execute(&pool)
    .await
    .unwrap();
    let too_many_events = action(&pool, json!([{"events": vec!["document.updated"; 8]}])).await;
    let first_valid = action(&pool, valid.clone()).await;
    let second_valid = action(&pool, valid.clone()).await;
    // Another entirely invalid page after valid candidates have been admitted.
    action(&pool, json!([{"events": ["document.updated"], "ids": vec![generate_uuid_v7().to_string(); 101]}, {"events": ["document.updated"]}])).await;
    action(
        &pool,
        json!([{"events": ["document.updated", "unknown.event"]}]),
    )
    .await;
    let last_valid = action(&pool, valid).await;
    let incoming = IncomingEvent {
        event_id: generate_uuid_v7(),
        schema_version: 1,
        payload: EventPayload::Document(
            serde_json::from_value(json!({
                "event_type": "document.updated", "metadata": {
                    "document_id": generate_uuid_v7(), "owner": USER,
                    "actor_user_id": USER, "share_permission_updated": false,
                }
            }))
            .unwrap(),
        ),
    };
    let repo = Arc::new(PgEventRunRepo::new(pool.clone()));
    let first = repo
        .candidate_actions(&incoming.normalize().unwrap(), None, page(2))
        .await
        .unwrap();
    assert!(first.configurations.is_empty());
    assert_eq!(first.next_after, Some(too_many_events));
    let service = EventAdmissionService::new(repo.clone(), Arc::new(AllowAccess), page(2));
    assert_eq!(
        service.ingest(&incoming).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 3 }
    );
    let mut admitted: Vec<_> = repo
        .pending_runs(page(100))
        .await
        .unwrap()
        .into_iter()
        .map(|run| run.action_id)
        .collect();
    admitted.sort();
    assert_eq!(admitted, vec![first_valid, second_valid, last_valid]);
    assert_eq!(
        service.ingest(&incoming).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 0 }
    );
    // A repository outage is not a malformed configuration and must defer intake.
    pool.close().await;
    assert!(service.ingest(&incoming).await.is_err());
}

#[test]
fn invalid_configuration_classifications_do_not_include_persisted_content() {
    fn row() -> ConfigurationRow {
        ConfigurationRow {
            action_id: generate_uuid_v7(),
            owner: USER.into(),
            enabled: true,
            configuration_revision: 1,
            event_filters: json!([{"events": ["document.updated"]}]),
            event_activated_at: Utc::now(),
        }
    }
    let mut owner = row();
    owner.owner = "private malformed owner".into();
    assert_eq!(
        EventActionConfiguration::try_from(owner)
            .unwrap_err()
            .to_string(),
        "invalid_owner"
    );
    let mut revision = row();
    revision.configuration_revision = 0;
    assert_eq!(
        EventActionConfiguration::try_from(revision)
            .unwrap_err()
            .to_string(),
        "invalid_revision"
    );
    let mut filters = row();
    filters.event_filters = json!([{"events": ["private malformed event"]}]);
    assert_eq!(
        EventActionConfiguration::try_from(filters)
            .unwrap_err()
            .to_string(),
        "invalid_filters"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn two_workers_fifo_and_independent_actions(pool: PgPool) {
    let (repo, id, earlier_event) = setup(&pool).await;
    let later_event = new_event(earlier_event.entity_id());
    // Admission order, deliberately opposite publication order.
    admit(&repo, id, &later_event).await;
    admit(&repo, id, &earlier_event).await;
    let other_id = action(&pool, json!([{"events": ["document.updated"]}])).await;
    admit(&repo, other_id, &earlier_event).await;
    let pending = repo.pending_runs(page(100)).await.unwrap();
    assert_eq!(pending.len(), 2);
    assert_eq!(pending[0].event, later_event);
    let mut not_head = pending[0].clone();
    not_head.event = earlier_event.clone();
    assert!(claim(&repo, not_head).await.is_none());
    let (a, b) = tokio::join!(
        claim(&repo, pending[0].clone()),
        claim(&repo, pending[0].clone())
    );
    assert_eq!(usize::from(a.is_some()) + usize::from(b.is_some()), 1);
    let started = a.or(b).unwrap();
    let remaining = repo.pending_runs(page(1)).await.unwrap();
    assert_eq!(remaining[0].action_id, other_id);
    assert!(claim(&repo, remaining[0].clone()).await.is_some());
    repo.finalize(completion(&started, EventRunOutcome::Failed))
        .await
        .unwrap();
    let next = repo.pending_runs(page(1)).await.unwrap();
    assert_eq!(next[0].event, earlier_event);
    assert!(claim(&repo, next[0].clone()).await.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn manual_claim_blocks_events_and_foreign_tokens_cannot_finalize(pool: PgPool) {
    let (repo, id, event) = setup(&pool).await;
    admit(&repo, id, &event).await;
    let pending = repo.pending_runs(page(1)).await.unwrap().remove(0);
    // Deployed writers only set claimed; fenced manual writers set both.
    sqlx::query!(
        "UPDATE scheduled_action SET claimed = now() WHERE id = $1",
        id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(repo.pending_runs(page(1)).await.unwrap().is_empty());
    assert!(claim(&repo, pending.clone()).await.is_none());
    sqlx::query!(
        "UPDATE scheduled_action SET claimed = NULL WHERE id = $1",
        id
    )
    .execute(&pool)
    .await
    .unwrap();
    let started = claim(&repo, pending).await.unwrap();
    let mut foreign = completion(&started, EventRunOutcome::Succeeded);
    foreign.token = ClaimToken::generate();
    assert_eq!(
        repo.finalize(foreign).await.unwrap(),
        FinalizationResult::StaleClaim
    );
    assert_eq!(state(&pool, started.run.pending.key()).await.0, "started");
    assert_eq!(
        repo.finalize(completion(&started, EventRunOutcome::Succeeded))
            .await
            .unwrap(),
        FinalizationResult::Finalized
    );
    let finished = state(&pool, started.run.pending.key()).await;
    assert!(finished.2.is_some());
    assert_eq!(
        repo.finalize(completion(&started, EventRunOutcome::Failed))
            .await
            .unwrap(),
        FinalizationResult::AlreadyFinalized
    );
    assert_eq!(state(&pool, started.run.pending.key()).await, finished);
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM action_execution_record")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expired_started_is_interrupted_and_never_requeued(pool: PgPool) {
    let (repo, id, first) = setup(&pool).await;
    let second = new_event(first.entity_id());
    admit(&repo, id, &first).await;
    admit(&repo, id, &second).await;
    let pending = repo.pending_runs(page(1)).await.unwrap().remove(0);
    let started = claim(&repo, pending).await.unwrap();
    assert_eq!(repo.reconcile(started.deadline, page(1)).await.unwrap(), 1);
    assert_eq!(repo.reconcile(started.deadline, page(1)).await.unwrap(), 0);
    assert_eq!(
        state(&pool, started.run.pending.key()).await.1,
        Some(json!({"type": "interrupted"}))
    );
    let pending = repo.pending_runs(page(1)).await.unwrap();
    assert_eq!(pending[0].event, second);
    let newer = claim(&repo, pending[0].clone()).await.unwrap();
    assert_eq!(
        repo.finalize(completion(&started, EventRunOutcome::Succeeded))
            .await
            .unwrap(),
        FinalizationResult::AlreadyFinalized
    );
    let token = sqlx::query_scalar!("SELECT claim_token FROM scheduled_action WHERE id = $1", id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(token, Some(newer.token.as_uuid()));
    assert_eq!(
        repo.admit(id, ConfigurationRevision::INITIAL, &first)
            .await
            .unwrap(),
        AdmissionResult::AlreadyPresent
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconcile_does_not_release_a_replaced_token(pool: PgPool) {
    let (repo, id, event) = setup(&pool).await;
    admit(&repo, id, &event).await;
    let pending = repo.pending_runs(page(1)).await.unwrap().remove(0);
    let started = claim(&repo, pending).await.unwrap();
    let replacement = ClaimToken::generate();
    sqlx::query!(
        "UPDATE scheduled_action SET claim_token = $2 WHERE id = $1",
        id,
        replacement.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.finalize(completion(&started, EventRunOutcome::Succeeded))
            .await
            .unwrap(),
        FinalizationResult::StaleClaim
    );
    assert_eq!(repo.reconcile(started.deadline, page(1)).await.unwrap(), 1);
    assert_eq!(
        sqlx::query_scalar!("SELECT claim_token FROM scheduled_action WHERE id = $1", id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(replacement.as_uuid())
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cancellation_claim_race_has_one_terminal_direction(pool: PgPool) {
    let (repo, id, event) = setup(&pool).await;
    admit(&repo, id, &event).await;
    let pending = repo.pending_runs(page(1)).await.unwrap().remove(0);
    let key = pending.key();
    let (started, cancelled) = tokio::join!(
        claim(&repo, pending),
        repo.cancel_pending(
            key,
            ConfigurationRevision::INITIAL,
            CancellationReason::AccessDenied
        ),
    );
    cancelled.unwrap();
    let stored = state(&pool, key).await;
    if started.is_some() {
        assert_eq!(stored.0, "started");
        assert!(stored.1.is_none());
    } else {
        assert_eq!(stored.0, "finished");
        assert_eq!(
            stored.1,
            Some(json!({"type": "cancelled", "reason": "access_denied"}))
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn revision_disable_and_cancellation_rechecks(pool: PgPool) {
    let (repo, id, event) = setup(&pool).await;
    admit(&repo, id, &event).await;
    let pending = repo.pending_runs(page(1)).await.unwrap().remove(0);
    repo.cancel_pending(
        pending.key(),
        ConfigurationRevision::INITIAL.next().unwrap(),
        CancellationReason::Disabled,
    )
    .await
    .unwrap();
    assert_eq!(state(&pool, pending.key()).await.0, "pending");
    sqlx::query!("UPDATE scheduled_action SET configuration_revision = configuration_revision + 1 WHERE id = $1", id).execute(&pool).await.unwrap();
    assert!(claim(&repo, pending.clone()).await.is_none());
    assert_eq!(
        repo.admit(id, ConfigurationRevision::INITIAL, &event)
            .await
            .unwrap(),
        AdmissionResult::Ineligible
    );
    assert_eq!(repo.reconcile(Utc::now(), page(1)).await.unwrap(), 1);
    assert_eq!(
        state(&pool, pending.key()).await.1,
        Some(json!({"type": "cancelled", "reason": "superseded"}))
    );
    let next_event = new_event(event.entity_id());
    assert_eq!(
        repo.admit(
            id,
            ConfigurationRevision::INITIAL.next().unwrap(),
            &next_event
        )
        .await
        .unwrap(),
        AdmissionResult::Admitted
    );
    let next = repo.pending_runs(page(1)).await.unwrap().remove(0);
    sqlx::query!(
        "UPDATE scheduled_action SET enabled = false WHERE id = $1",
        id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(claim(&repo, next.clone()).await.is_none());
    assert_eq!(repo.reconcile(Utc::now(), page(1)).await.unwrap(), 1);
    assert_eq!(
        state(&pool, next.key()).await.1,
        Some(json!({"type": "cancelled", "reason": "disabled"}))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rejected_claims_release_locks_for_immediate_retry(pool: PgPool) {
    let (repo, id, event) = setup(&pool).await;
    admit(&repo, id, &event).await;
    let pending = repo.pending_runs(page(1)).await.unwrap().remove(0);

    for _ in 0..16 {
        // Reserve another connection first so checking the lock cannot implicitly
        // flush a queued rollback by reusing the claim's connection.
        let mut observer = pool.begin().await.unwrap();
        let mut stale = pending.clone();
        stale.event = new_event(event.entity_id());
        assert!(claim(&repo, stale).await.is_none());
        assert!(lock_action(&mut observer, id).await.unwrap());
        observer.rollback().await.unwrap();
    }

    repo.cancel_pending(
        pending.key(),
        pending.revision,
        CancellationReason::AccessDenied,
    )
    .await
    .unwrap();
    // The no-pending-head rejection must release the action lock as well.
    let mut observer = pool.begin().await.unwrap();
    assert!(claim(&repo, pending).await.is_none());
    assert!(lock_action(&mut observer, id).await.unwrap());
    observer.rollback().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn locked_actions_do_not_block_independent_dispatch(pool: PgPool) {
    let (repo, id, event) = setup(&pool).await;
    admit(&repo, id, &event).await;
    let other = action(&pool, json!([{"events": ["document.updated"]}])).await;
    admit(&repo, other, &event).await;
    let pending = repo.pending_runs(page(100)).await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert!(lock_action(&mut tx, id).await.unwrap());
    let available = repo.pending_runs(page(1)).await.unwrap();
    assert_eq!(available[0].action_id, other);
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        claim(&repo, pending[0].clone()),
    )
    .await
    .unwrap();
    assert!(result.is_none());
    assert!(claim(&repo, pending[1].clone()).await.is_some());
    tx.rollback().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_bookkeeping_rolls_back_history_and_claim(pool: PgPool) {
    let (repo, id, event) = setup(&pool).await;
    admit(&repo, id, &event).await;
    let pending = repo.pending_runs(page(1)).await.unwrap().remove(0);
    let started = claim(&repo, pending).await.unwrap();
    let mut invalid = completion(&started, EventRunOutcome::Succeeded);
    invalid.execution.record.as_mut().unwrap().action_id = generate_uuid_v7();
    assert!(repo.finalize(invalid).await.is_err());
    assert_eq!(state(&pool, started.run.pending.key()).await.0, "started");
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM action_execution_record")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    let (a, b) = tokio::join!(
        repo.finalize(completion(&started, EventRunOutcome::Succeeded)),
        repo.finalize(completion(&started, EventRunOutcome::Succeeded)),
    );
    let results = [a.unwrap(), b.unwrap()];
    assert!(results.contains(&FinalizationResult::Finalized));
    assert!(results.contains(&FinalizationResult::AlreadyFinalized));
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM action_execution_record")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expired_manual_claim_can_be_replaced_without_stale_release(pool: PgPool) {
    let (repo, id, event) = setup(&pool).await;
    admit(&repo, id, &event).await;
    let manual_token = ClaimToken::generate();
    sqlx::query!(
        "UPDATE scheduled_action SET claimed = $2, claim_token = $3 WHERE id = $1",
        id,
        Utc::now() - MAX_ACTION_TIME - chrono::Duration::seconds(1),
        manual_token.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let pending = repo.pending_runs(page(1)).await.unwrap().remove(0);
    let started = claim(&repo, pending).await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    release_claim(&mut tx, id, manual_token.as_uuid())
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT claim_token FROM scheduled_action WHERE id = $1", id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(started.token.as_uuid())
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn admission_waits_for_configuration_lock_and_rechecks_disable(pool: PgPool) {
    let (repo, id, event) = setup(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    sqlx::query!(
        "UPDATE scheduled_action SET enabled = false WHERE id = $1",
        id
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    let admitting_repo = repo.clone();
    let mut admitting = tokio::spawn(async move {
        admitting_repo
            .admit(id, ConfigurationRevision::INITIAL, &event)
            .await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut admitting)
            .await
            .is_err()
    );
    tx.commit().await.unwrap();
    assert_eq!(
        admitting.await.unwrap().unwrap(),
        AdmissionResult::Ineligible
    );
    assert!(repo.pending_runs(page(1)).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconcile_is_bounded_and_stale_configuration_does_not_cancel_started(pool: PgPool) {
    let (repo, id, first) = setup(&pool).await;
    let second = new_event(first.entity_id());
    let third = new_event(first.entity_id());
    admit(&repo, id, &first).await;
    admit(&repo, id, &second).await;
    admit(&repo, id, &third).await;
    let pending = repo.pending_runs(page(1)).await.unwrap().remove(0);
    let started = claim(&repo, pending).await.unwrap();
    sqlx::query!(
        "UPDATE scheduled_action SET enabled = false WHERE id = $1",
        id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(repo.reconcile(Utc::now(), page(1)).await.unwrap(), 1);
    assert_eq!(repo.reconcile(Utc::now(), page(1)).await.unwrap(), 1);
    assert_eq!(repo.reconcile(Utc::now(), page(1)).await.unwrap(), 0);
    assert_eq!(state(&pool, started.run.pending.key()).await.0, "started");
    assert_eq!(
        repo.finalize(completion(&started, EventRunOutcome::Succeeded))
            .await
            .unwrap(),
        FinalizationResult::Finalized
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn invalid_deadlines_leave_the_run_pending(pool: PgPool) {
    let (repo, id, event) = setup(&pool).await;
    admit(&repo, id, &event).await;
    let pending = repo.pending_runs(page(1)).await.unwrap().remove(0);
    let now = Utc::now();
    for (start, deadline) in [
        (now, now),
        (now, now + MAX_ACTION_TIME + chrono::Duration::seconds(1)),
        (now - MAX_ACTION_TIME, now - chrono::Duration::seconds(1)),
    ] {
        assert!(
            repo.claim(
                authorized(pending.clone()),
                ClaimToken::generate(),
                start,
                deadline
            )
            .await
            .is_err()
        );
    }
    assert_eq!(state(&pool, pending.key()).await.0, "pending");
    let configuration = repo.current_configuration(id).await.unwrap().unwrap();
    assert_eq!(configuration.action_id, id);
    assert_eq!(configuration.revision, pending.revision);
    assert!(
        configuration
            .filters
            .matches(&event, configuration.activated_at)
    );
    assert!(
        repo.current_configuration(generate_uuid_v7())
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delayed_bookkeeping_can_finish_before_reconciliation(pool: PgPool) {
    let (repo, id, event) = setup(&pool).await;
    admit(&repo, id, &event).await;
    let pending = repo.pending_runs(page(1)).await.unwrap().remove(0);
    let started = claim(&repo, pending).await.unwrap();
    // Simulate persistence becoming available after the execution deadline.
    sqlx::query!(
        r#"
        UPDATE scheduled_action_event_run SET started_at = $3, deadline = $4
        WHERE action_id = $1 AND event_id = $2
        "#,
        id,
        event.event_id().as_uuid(),
        Utc::now() - MAX_ACTION_TIME,
        Utc::now() - chrono::Duration::seconds(1),
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.finalize(completion(&started, EventRunOutcome::Failed))
            .await
            .unwrap(),
        FinalizationResult::Finalized
    );
    assert_eq!(repo.reconcile(Utc::now(), page(1)).await.unwrap(), 0);
    let finished = state(&pool, started.run.pending.key()).await;
    assert_eq!(finished.1, Some(json!({"type": "failed"})));
    assert!(finished.2.is_some());
}
