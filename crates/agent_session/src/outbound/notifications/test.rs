use super::*;
use agent_runtime_protocol::domain::notification::NotificationEvent;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn outbox_is_transactional_deduplicated_and_cascades(pool: PgPool) {
    sqlx::raw_sql("INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace) VALUES ('00000000-0000-0000-0000-000000000001','macro|owner@example.com','00000000-0000-0000-0000-00000000a9e7','test','macrod','/workspace')").execute(&pool).await.unwrap();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let store = PgNotificationStore(pool.clone());
    let pending = PendingNotification::new(ProduceNotification {
        session_id: session,
        subject_id: "connection".into(),
        event: NotificationEvent::AppConnected {
            app: "Calendar".into(),
        },
        dedupe_key: None,
        wake: true,
    })
    .unwrap();
    let mut transaction = pool.begin().await.unwrap();
    store.produce(&mut *transaction, &pending).await.unwrap();
    transaction.rollback().await.unwrap();
    assert!(store.pending_sessions(None).await.unwrap().is_empty());
    store.enqueue(pending.clone()).await.unwrap();
    store.enqueue(pending).await.unwrap();
    let batch = store.claim(session, false).await.unwrap().unwrap();
    assert_eq!(batch.notifications.len(), 1);
    assert!(store.claim(session, false).await.unwrap().is_none());
    store
        .complete(batch.lease_id, NotificationOutcome::Noop)
        .await
        .unwrap();
    assert!(store.claim(session, false).await.unwrap().is_none());
    let row = sqlx::query!("SELECT attempts, outcome, delivered_at FROM agent_session_notification WHERE session_id = $1", session.as_uuid()).fetch_one(&pool).await.unwrap();
    assert_eq!(row.attempts, 1);
    assert_eq!(row.outcome.as_deref(), Some("noop"));
    assert!(row.delivered_at.is_some());
    sqlx::query!("DELETE FROM agent_session WHERE id = $1", session.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM agent_session_notification")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn quiet_events_coalesce_and_expired_leases_keep_their_action_identity(pool: PgPool) {
    sqlx::raw_sql("INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace) VALUES ('00000000-0000-0000-0000-000000000001','macro|owner@example.com','00000000-0000-0000-0000-00000000a9e7','test','macrod','/workspace')").execute(&pool).await.unwrap();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let store = PgNotificationStore(pool.clone());
    for subject in ["one", "two"] {
        store
            .enqueue(
                PendingNotification::new(ProduceNotification {
                    session_id: session,
                    subject_id: subject.into(),
                    event: NotificationEvent::AppConnected {
                        app: "Calendar".into(),
                    },
                    dedupe_key: None,
                    wake: false,
                })
                .unwrap(),
            )
            .await
            .unwrap();
    }
    assert!(store.pending_sessions(None).await.unwrap().is_empty());
    assert!(store.claim(session, false).await.unwrap().is_none());
    let first = store.claim(session, true).await.unwrap().unwrap();
    assert_eq!(first.notifications.len(), 2);
    sqlx::query!("UPDATE agent_session_notification SET lease_until = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    store
        .enqueue(
            PendingNotification::new(ProduceNotification {
                session_id: session,
                subject_id: "new".into(),
                event: NotificationEvent::AppConnected {
                    app: "Calendar".into(),
                },
                dedupe_key: None,
                wake: true,
            })
            .unwrap(),
        )
        .await
        .unwrap();
    let retry = store.claim(session, true).await.unwrap().unwrap();
    assert_eq!(retry.action_id, first.action_id);
    assert_ne!(retry.lease_id, first.lease_id);
    assert_eq!(
        retry.notifications.len(),
        2,
        "new events must not reuse an accepted action id"
    );
    store
        .complete(first.lease_id, NotificationOutcome::Delivered)
        .await
        .unwrap();
    assert!(
        store.claim(session, true).await.unwrap().is_none(),
        "stale completion cannot consume a new lease"
    );
    store
        .complete(retry.lease_id, NotificationOutcome::Delivered)
        .await
        .unwrap();
    let next = store.claim(session, false).await.unwrap().unwrap();
    assert_eq!(next.notifications.len(), 1);
    assert_ne!(next.action_id, first.action_id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn waking_turn_leaves_quiet_events_for_a_real_prompt(pool: PgPool) {
    sqlx::raw_sql("INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace) VALUES ('00000000-0000-0000-0000-000000000001','macro|owner@example.com','00000000-0000-0000-0000-00000000a9e7','test','macrod','/workspace')").execute(&pool).await.unwrap();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let store = PgNotificationStore(pool);
    for (subject, wake) in [("quiet", false), ("wake", true)] {
        store
            .enqueue(
                PendingNotification::new(ProduceNotification {
                    session_id: session,
                    subject_id: subject.into(),
                    event: NotificationEvent::AppConnected {
                        app: "Calendar".into(),
                    },
                    dedupe_key: None,
                    wake,
                })
                .unwrap(),
            )
            .await
            .unwrap();
    }
    let waking = store.claim(session, false).await.unwrap().unwrap();
    assert_eq!(waking.notifications.len(), 1);
    assert_eq!(waking.notifications[0].subject_id, "wake");
    store
        .complete(waking.lease_id, NotificationOutcome::Delivered)
        .await
        .unwrap();
    assert!(store.claim(session, false).await.unwrap().is_none());
    let quiet = store.claim(session, true).await.unwrap().unwrap();
    assert_eq!(quiet.notifications.len(), 1);
    assert_eq!(quiet.notifications[0].subject_id, "quiet");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_review_writes_during_rollout_enter_the_typed_outbox_once(pool: PgPool) {
    sqlx::raw_sql("INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace) VALUES ('00000000-0000-0000-0000-000000000001','macro|owner@example.com','00000000-0000-0000-0000-00000000a9e7','test','macrod','/workspace')").execute(&pool).await.unwrap();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let review = macro_uuid::generate_uuid_v7();
    let action = macro_uuid::generate_uuid_v7();
    let mut record = serde_json::json!({"notificationId":action,"items":[{"id": macro_uuid::generate_uuid_v7(),"status":"submitting"}]});
    sqlx::query!(
        "INSERT INTO agent_session_review (id, agent_session_id, record) VALUES ($1,$2,$3)",
        review,
        session.as_uuid(),
        record
    )
    .execute(&pool)
    .await
    .unwrap();
    let store = PgNotificationStore(pool.clone());
    assert!(store.pending_sessions(None).await.unwrap().is_empty());
    record["items"][0]["status"] = serde_json::json!("completed");
    for _ in 0..2 {
        sqlx::query!(
            "UPDATE agent_session_review SET record = $2 WHERE id = $1",
            review,
            record
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    set_owner_prompt(&pool, session, action).await;
    let batch = store.claim(session, false).await.unwrap().unwrap();
    assert_eq!(batch.action_id.as_uuid(), action);
    assert_eq!(batch.notifications.len(), 1);
    assert_eq!(batch.notifications[0].subject_id, review.to_string());
    assert!(matches!(
        batch.notifications[0].event,
        NotificationEvent::ReviewSettled(_)
    ));
    assert_eq!(
        read_prompter(&pool, session).await,
        (Some(action), "system".into(), None)
    );
    store
        .complete(batch.lease_id, NotificationOutcome::Delivered)
        .await
        .unwrap();

    let newer = macro_uuid::generate_uuid_v7();
    set_owner_prompt(&pool, session, newer).await;
    record["notificationId"] = serde_json::json!(macro_uuid::generate_uuid_v7());
    sqlx::query!(
        "UPDATE agent_session_review SET record = $2 WHERE id = $1",
        review,
        record
    )
    .execute(&pool)
    .await
    .unwrap();
    store.claim(session, false).await.unwrap().unwrap();
    assert_eq!(
        read_prompter(&pool, session).await,
        (
            Some(newer),
            "user".into(),
            Some("macro|owner@example.com".into())
        )
    );
}

async fn set_owner_prompt(pool: &PgPool, session: AgentSessionId, action: Uuid) {
    sqlx::query!("UPDATE agent_session SET turn_action_id = $2, turn_prompter = 'macro|owner@example.com', turn_prompter_kind = 'user' WHERE id = $1", session.as_uuid(), action)
        .execute(pool).await.unwrap();
}
async fn read_prompter(
    pool: &PgPool,
    session: AgentSessionId,
) -> (Option<Uuid>, String, Option<String>) {
    let row = sqlx::query!(
        "SELECT turn_action_id, turn_prompter_kind, turn_prompter FROM agent_session WHERE id = $1",
        session.as_uuid()
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (
        row.turn_action_id,
        row.turn_prompter_kind,
        row.turn_prompter,
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn prior_actions_reconcile_before_fresh_inputs_and_interrupted_quiet_events_defer(
    pool: PgPool,
) {
    sqlx::raw_sql("INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace) VALUES ('00000000-0000-0000-0000-000000000001','macro|owner@example.com','00000000-0000-0000-0000-00000000a9e7','test','macrod','/workspace')").execute(&pool).await.unwrap();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let store = PgNotificationStore(pool.clone());
    let pending = |subject: &str, wake| {
        PendingNotification::new(ProduceNotification {
            session_id: session,
            subject_id: subject.into(),
            event: NotificationEvent::AppConnected {
                app: "Calendar".into(),
            },
            dedupe_key: None,
            wake,
        })
        .unwrap()
    };
    store.enqueue(pending("older quiet", false)).await.unwrap();
    store.enqueue(pending("wake", true)).await.unwrap();
    let first = store.claim(session, false).await.unwrap().unwrap();
    sqlx::query!("UPDATE agent_session_notification SET lease_until = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    let recovered = store.claim(session, true).await.unwrap().unwrap();
    assert_eq!(recovered.action_id, first.action_id);
    assert_eq!(recovered.notifications[0].subject_id, "wake");
    store
        .complete(recovered.lease_id, NotificationOutcome::Delivered)
        .await
        .unwrap();
    let quiet = store.claim(session, true).await.unwrap().unwrap();
    store.release(quiet.lease_id).await.unwrap();
    store.enqueue(pending("later wake", true)).await.unwrap();
    let recovered = store.claim(session, false).await.unwrap().unwrap();
    assert_eq!(recovered.action_id, quiet.action_id);
    assert!(!recovered.wake);
    store.defer_until_prompt(recovered.lease_id).await.unwrap();
    let waking = store.claim(session, false).await.unwrap().unwrap();
    assert_eq!(waking.notifications[0].subject_id, "later wake");
    store
        .complete(waking.lease_id, NotificationOutcome::Delivered)
        .await
        .unwrap();
    assert!(store.claim(session, false).await.unwrap().is_none());
    let next_prompt = store.claim(session, true).await.unwrap().unwrap();
    assert_eq!(next_prompt.notifications[0].id, quiet.notifications[0].id);
    assert_ne!(next_prompt.action_id, quiet.action_id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn discovery_pages_advance_while_previous_sessions_remain_eligible(pool: PgPool) {
    sqlx::query!("INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace) SELECT lpad(to_hex(n),32,'0')::uuid,'macro|owner@example.com','00000000-0000-0000-0000-00000000a9e7','test','macrod','/workspace' FROM generate_series(1,101) n").execute(&pool).await.unwrap();
    let store = PgNotificationStore(pool.clone());
    let mut transaction = pool.begin().await.unwrap();
    for value in 1..=101 {
        let pending = PendingNotification::new(ProduceNotification {
            session_id: AgentSessionId::new_from_uuid(Uuid::from_u128(value)),
            subject_id: "connection".into(),
            event: NotificationEvent::AppConnected {
                app: "Calendar".into(),
            },
            dedupe_key: None,
            wake: true,
        })
        .unwrap();
        store.produce(&mut *transaction, &pending).await.unwrap();
    }
    transaction.commit().await.unwrap();
    let first = store.pending_sessions(None).await.unwrap();
    assert_eq!(first.len(), 100);
    let last = store.pending_sessions(first.last().copied()).await.unwrap();
    assert_eq!(
        last,
        vec![AgentSessionId::new_from_uuid(Uuid::from_u128(101))]
    );
    assert!(
        store
            .pending_sessions(last.last().copied())
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(store.pending_sessions(None).await.unwrap(), first);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unreadable_fresh_events_wait_without_blocking_or_sharing_a_delivered_action(pool: PgPool) {
    sqlx::query!("INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace) VALUES ('00000000-0000-0000-0000-000000000001','macro|owner@example.com','00000000-0000-0000-0000-00000000a9e7','test','macrod','/workspace')").execute(&pool).await.unwrap();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let store = PgNotificationStore(pool.clone());
    for subject in ["future", "malformed", "valid"] {
        store
            .enqueue(
                PendingNotification::new(ProduceNotification {
                    session_id: session,
                    subject_id: subject.into(),
                    event: NotificationEvent::AppConnected {
                        app: "Calendar".into(),
                    },
                    dedupe_key: None,
                    wake: true,
                })
                .unwrap(),
            )
            .await
            .unwrap();
    }
    sqlx::query!(
        "UPDATE agent_session_notification SET kind = 'future.event' WHERE subject_id = 'future'"
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE agent_session_notification SET payload = '{}' WHERE subject_id = 'malformed'"
    )
    .execute(&pool)
    .await
    .unwrap();
    let first = store.claim(session, false).await.unwrap().unwrap();
    assert_eq!(first.notifications.len(), 1);
    assert_eq!(first.notifications[0].subject_id, "valid");
    store
        .complete(first.lease_id, NotificationOutcome::Delivered)
        .await
        .unwrap();
    let delayed = sqlx::query!("SELECT action_id, lease_id, delivered_at, lease_until > now() AS delayed FROM agent_session_notification WHERE subject_id != 'valid'").fetch_all(&pool).await.unwrap();
    assert_eq!(delayed.len(), 2);
    assert!(delayed.iter().all(|row| row.action_id.is_none()
        && row.lease_id.is_none()
        && row.delivered_at.is_none()
        && row.delayed == Some(true)));
    assert!(store.pending_sessions(None).await.unwrap().is_empty());
    // A compatible consumer can deliver the retained rows under a new action.
    sqlx::query!("UPDATE agent_session_notification SET kind = 'app.connected', payload = '{\"app\":\"Calendar\"}', lease_until = now() - interval '1 second' WHERE subject_id != 'valid'").execute(&pool).await.unwrap();
    let next = store.claim(session, false).await.unwrap().unwrap();
    assert_eq!(next.notifications.len(), 2);
    assert_ne!(next.action_id, first.action_id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unreadable_bound_events_keep_the_entire_original_action_for_a_compatible_consumer(
    pool: PgPool,
) {
    sqlx::query!("INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace) VALUES ('00000000-0000-0000-0000-000000000001','macro|owner@example.com','00000000-0000-0000-0000-00000000a9e7','test','macrod','/workspace')").execute(&pool).await.unwrap();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let store = PgNotificationStore(pool.clone());
    for subject in ["future", "valid"] {
        store
            .enqueue(
                PendingNotification::new(ProduceNotification {
                    session_id: session,
                    subject_id: subject.into(),
                    event: NotificationEvent::AppConnected {
                        app: "Calendar".into(),
                    },
                    dedupe_key: None,
                    wake: true,
                })
                .unwrap(),
            )
            .await
            .unwrap();
    }
    let original = store.claim(session, false).await.unwrap().unwrap();
    store.release(original.lease_id).await.unwrap();
    sqlx::query!(
        "UPDATE agent_session_notification SET kind = 'future.event' WHERE subject_id = 'future'"
    )
    .execute(&pool)
    .await
    .unwrap();
    let opaque = store.claim(session, false).await.unwrap().unwrap();
    assert!(opaque.notifications.is_empty());
    assert_eq!(opaque.action_id, original.action_id);
    let rows =
        sqlx::query!("SELECT action_id, lease_id, delivered_at FROM agent_session_notification")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(
        rows.iter()
            .all(|row| row.action_id == Some(original.action_id.as_uuid())
                && row.lease_id == Some(opaque.lease_id)
                && row.delivered_at.is_none())
    );
    sqlx::query!("UPDATE agent_session_notification SET kind = 'app.connected', lease_until = now() - interval '1 second'").execute(&pool).await.unwrap();
    let recovered = store.claim(session, false).await.unwrap().unwrap();
    assert_eq!(recovered.action_id, original.action_id);
    assert_eq!(recovered.notifications.len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stored_settlements_read_back_as_the_kind_they_were_written(pool: PgPool) {
    use agent_runtime_protocol::domain::notification::{
        DecisionOutcome, DecisionVia, ImportOutcome, ImportSettlement, ReviewOutcome,
        ReviewSettlement,
    };
    sqlx::raw_sql("INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace) VALUES ('00000000-0000-0000-0000-000000000001','macro|owner@example.com','00000000-0000-0000-0000-00000000a9e7','test','macrod','/workspace')").execute(&pool).await.unwrap();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let store = PgNotificationStore(pool.clone());
    let import = ReviewSettlement::Import {
        import: ImportSettlement {
            outcome: ImportOutcome::Cancelled,
            error: Some("Cancelled".into()),
            imported: 1,
            planned: 4,
            documents: 4,
            databases: 0,
            database_rows: 0,
            task_lists: 0,
            task_rows: 0,
            skipped: 0,
            not_written: 3,
            shared_with_team: 0,
            already_in_macro: 0,
            waiting_on_teammates: 0,
            root_folder_id: Some(Uuid::from_u128(9)),
            failures: Vec::new(),
            hand_items: Vec::new(),
        },
    };
    let actions = ReviewSettlement::Actions(ReviewOutcome {
        outcome: DecisionOutcome::Approved,
        by: "macro|owner@example.com".into(),
        via: DecisionVia::Card,
        items: Vec::new(),
    });
    for (subject, settlement) in [("import", &import), ("email", &actions)] {
        store
            .enqueue(
                PendingNotification::new(ProduceNotification {
                    session_id: session,
                    subject_id: subject.into(),
                    event: NotificationEvent::ReviewSettled(settlement.clone()),
                    dedupe_key: None,
                    wake: true,
                })
                .unwrap(),
            )
            .await
            .unwrap();
    }

    let batch = store.claim(session, false).await.unwrap().unwrap();

    let read: Vec<_> = batch
        .notifications
        .iter()
        .map(|notification| notification.event.clone())
        .collect();
    assert_eq!(
        read,
        [
            NotificationEvent::ReviewSettled(import),
            NotificationEvent::ReviewSettled(actions)
        ]
    );
}
