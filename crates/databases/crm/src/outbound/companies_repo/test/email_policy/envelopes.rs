use super::*;
use chrono::{Duration, Utc};
use serde_json::json;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retries_and_audit_are_stamped_and_atomic_with_consent_identity(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let mut tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link),
            },
        )
        .await?
        .expect("initialize");
    let first = tx.state().generation;
    let result = NewEmailPolicyIdempotency {
        request_id: Uuid::now_v7(),
        expected_policy_version: 0,
        request_hash: vec![7; 32],
        outcome: json!({"revision": 1}),
    };
    let event = NewEmailPolicyAudit {
        event_id: Uuid::now_v7(),
        action: EmailPolicyAuditAction::Withdrawn,
        actor_kind: EmailPolicyActorKind::Agent,
        agent_id: Some(Uuid::now_v7()),
        agent_session_id: None,
        previous_revision: None,
        next_revision: None,
        details: json!({"reason": "explicit"}),
    };
    assert!(tx.record_idempotency(&result).await?);
    assert!(tx.record_audit(&event).await?);
    // Dropping the transaction must not leave an initialized token or a partial
    // result. A caller may issue the token only after the commit succeeds.
    drop(tx);
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_email_consent")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_email_policy_idempotency")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_email_policy_audit")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );

    let mut tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link),
            },
        )
        .await?
        .expect("initialize after rollback");
    let generation = tx.state().generation;
    assert_ne!(generation.consent_incarnation, first.consent_incarnation);
    assert!(tx.record_idempotency(&result).await?);
    assert!(tx.record_audit(&event).await?);
    assert!(
        !tx.record_idempotency(&NewEmailPolicyIdempotency {
            outcome: json!({"revision": 99}),
            ..result.clone()
        })
        .await?
    );
    assert!(!tx.record_audit(&event).await?);
    tx.commit().await?;
    // A later policy change cannot rewrite the recorded response's version.
    consent_to_mailbox(&pool, team, link).await?;
    let mut tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Existing {
                consent_incarnation: generation.consent_incarnation,
            },
        )
        .await?
        .expect("same incarnation");
    assert_eq!(tx.state().generation.policy_version, 1);
    let replay = tx
        .idempotency(result.request_id)
        .await?
        .expect("committed result");
    assert_eq!(replay.policy_version, 0);
    assert_eq!(replay.outcome, result.outcome);
    assert_eq!(replay.request_hash, result.request_hash);
    let history = tx.audit_page(None).await?;
    assert_eq!(history.len(), 1);
    assert_eq!(
        history[0].consent_incarnation,
        Some(generation.consent_incarnation)
    );
    assert_eq!(history[0].policy_version, 0);
    assert_eq!(history[0].entry.actor_kind, EmailPolicyActorKind::Agent);
    assert_eq!(history[0].entry.agent_id, event.agent_id);
    assert!(tx.audit_page(Some(event.event_id)).await?.is_empty());
    tx.commit().await?;

    sqlx::query!(
        "DELETE FROM crm_email_consent WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    let mut tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link),
            },
        )
        .await?
        .expect("replacement");
    assert!(tx.idempotency(result.request_id).await?.is_none());
    assert!(tx.record_idempotency(&result).await?);
    tx.commit().await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn preview_replacement_context_terminal_state_and_generation_fence_checkpoints(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let mut tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link),
            },
        )
        .await?
        .expect("initialize");
    let generation = tx.state().generation;
    let preview = Uuid::now_v7();
    let context = Uuid::now_v7();
    let definition = EmailRuleSet {
        schema_version: 1,
        include: vec![EmailInclusionRule::Domain {
            domain: "example.org".into(),
        }],
    };
    tx.start_preview(
        preview,
        context,
        &definition,
        Utc::now() + Duration::minutes(5),
    )
    .await?;
    let initial = tx.preview(preview).await?.expect("preview");
    assert_eq!(initial.definition, definition);
    assert_eq!(initial.generation, generation);
    assert_eq!(initial.status, EmailPolicyPreviewStatus::Pending);
    let thread = Uuid::now_v7();
    let progress = EmailPolicyPreviewProgress {
        status: EmailPolicyPreviewStatus::Running,
        counts: EmailPolicyPreviewCounts {
            proposed: 1,
            added: 1,
            ..Default::default()
        },
        after_thread_id: Some(thread),
        scanned_threads: 10,
    };
    assert!(
        !tx.checkpoint_preview(preview, generation, Uuid::now_v7(), &progress)
            .await?
    );
    assert!(
        tx.checkpoint_preview(preview, generation, context, &progress)
            .await?
    );
    assert!(
        !tx.checkpoint_preview(
            preview,
            generation,
            context,
            &EmailPolicyPreviewProgress {
                scanned_threads: 9,
                ..progress.clone()
            }
        )
        .await?
    );
    tx.start_preview(preview, context, &definition, initial.expires_at)
        .await?;
    let retried = tx
        .preview(preview)
        .await?
        .expect("progress retained on retry");
    assert_eq!(retried.scanned_threads, 10);
    assert_eq!(retried.after_thread_id, Some(thread));
    assert_eq!(retried.status, EmailPolicyPreviewStatus::Running);
    assert_eq!(retried.created_at, initial.created_at);
    assert!(
        tx.start_preview(preview, Uuid::now_v7(), &definition, initial.expires_at)
            .await
            .is_err()
    );
    let next_preview = Uuid::now_v7();
    tx.start_preview(
        next_preview,
        context,
        &definition,
        Utc::now() + Duration::minutes(5),
    )
    .await?;
    let replacement = tx.preview(next_preview).await?.expect("replacement");
    tx.start_preview(preview, context, &definition, initial.expires_at)
        .await?;
    assert!(tx.preview(preview).await?.is_none());
    assert_eq!(
        tx.preview(next_preview)
            .await?
            .expect("newer job survives delayed start")
            .preview_id,
        next_preview
    );
    assert!(
        !tx.checkpoint_preview(preview, generation, context, &progress)
            .await?
    );
    assert!(
        tx.checkpoint_preview(
            next_preview,
            generation,
            context,
            &EmailPolicyPreviewProgress {
                status: EmailPolicyPreviewStatus::Partial,
                ..progress.clone()
            }
        )
        .await?
    );
    assert!(
        !tx.checkpoint_preview(next_preview, generation, context, &progress)
            .await?
    );
    tx.start_preview(next_preview, context, &definition, replacement.expires_at)
        .await?;
    let terminal = tx.preview(next_preview).await?.expect("terminal retry");
    assert_eq!(terminal.status, EmailPolicyPreviewStatus::Partial);
    assert_eq!(terminal.scanned_threads, 10);
    tx.commit().await?;
    consent_to_mailbox(&pool, team, link).await?;
    let mut tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Existing {
                consent_incarnation: generation.consent_incarnation,
            },
        )
        .await?
        .expect("updated generation");
    assert!(tx.preview(next_preview).await?.is_none());
    assert!(
        !tx.checkpoint_preview(next_preview, generation, context, &progress)
            .await?
    );
    tx.commit().await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expired_preview_refuses_completion(pool: PgPool) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let mut tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link),
            },
        )
        .await?
        .expect("initialize");
    let generation = tx.state().generation;
    let preview = Uuid::now_v7();
    let context = Uuid::now_v7();
    tx.start_preview(
        preview,
        context,
        &EmailRuleSet {
            schema_version: 1,
            include: vec![],
        },
        Utc::now() + Duration::minutes(5),
    )
    .await?;
    tx.commit().await?;
    let mut tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Existing {
                consent_incarnation: generation.consent_incarnation,
            },
        )
        .await?
        .expect("existing");
    // Expire the fixture after opening the checkpoint transaction. A transaction-
    // start now() predicate would still accept completion; wall-clock time must
    // refuse it without sleeping through the preview's budget.
    sqlx::query!("UPDATE crm_email_policy_previews SET expires_at = clock_timestamp() WHERE team_id = $1 AND user_id = $2", team, OWNER).execute(&pool).await?;
    assert!(
        !tx.checkpoint_preview(
            preview,
            generation,
            context,
            &EmailPolicyPreviewProgress {
                status: EmailPolicyPreviewStatus::Complete,
                counts: Default::default(),
                after_thread_id: None,
                scanned_threads: 0,
            }
        )
        .await?
    );
    tx.commit().await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replacing_work_fences_old_completion_and_preserves_a_retried_checkpoint(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let mut tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link),
            },
        )
        .await?
        .expect("initialize");
    let generation = tx.state().generation;
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();
    tx.request_work(first, None).await?;
    let checkpoint = Uuid::now_v7();
    assert!(tx.checkpoint_work(first, generation, checkpoint).await?);
    tx.request_work(first, None).await?;
    assert_eq!(
        tx.work().await?.expect("same request").after_thread_id,
        Some(checkpoint)
    );
    assert!(!tx.checkpoint_work(first, generation, Uuid::nil()).await?);
    tx.request_work(second, None).await?;
    tx.request_work(first, None).await?;
    assert_eq!(
        tx.work()
            .await?
            .expect("newer work survives delayed start")
            .work_id,
        second
    );
    assert!(!tx.complete_work(first, generation).await?);
    assert!(!tx.checkpoint_work(first, generation, checkpoint).await?);
    assert_eq!(tx.work().await?.expect("replacement").after_thread_id, None);
    tx.commit().await?;
    consent_to_mailbox(&pool, team, link).await?;
    let mut tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Existing {
                consent_incarnation: generation.consent_incarnation,
            },
        )
        .await?
        .expect("new version");
    assert_ne!(
        tx.work()
            .await?
            .expect("newly granted history is scheduled")
            .work_id,
        second
    );
    assert!(!tx.complete_work(second, generation).await?);
    // Even reusing a stable request ID after a version change must not let
    // an old worker delete the new generation's replacement.
    assert!(tx.request_work(second, None).await.is_err());
    // Simulate a generation transfer by a future worker: completion must still
    // compare the old token even if the durable request identity was retained.
    sqlx::query!(
        "UPDATE crm_email_policy_work SET policy_version = $3, work_id = $4 WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER,
        tx.state().generation.policy_version,
        second
    )
    .execute(&pool)
    .await?;
    assert!(!tx.complete_work(second, generation).await?);
    assert!(!tx.checkpoint_work(second, generation, checkpoint).await?);
    assert_eq!(
        tx.work().await?.expect("same ID, new version").generation,
        tx.state().generation
    );
    let third = Uuid::now_v7();
    tx.request_work(third, None).await?;
    assert!(!tx.complete_work(second, generation).await?);
    assert!(tx.complete_work(third, tx.state().generation).await?);
    assert!(tx.work().await?.is_none());
    tx.request_work(third, None).await?;
    assert!(
        tx.work().await?.is_none(),
        "a completed start cannot resurrect its job"
    );
    tx.commit().await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn modern_work_captures_grants_and_survives_outbox_publication(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let mut tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link),
            },
        )
        .await?
        .expect("initialize");
    let generation = tx.state().generation;
    let work = Uuid::now_v7();
    tx.request_work(work, None).await?;
    tx.commit().await?;
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_email_backfill_outbox")
            .fetch_one(&pool)
            .await?,
        Some(1)
    );
    consent_to_mailbox(&pool, team, link).await?;
    let outbox = sqlx::query!("SELECT link_id, consent_incarnation, policy_version, work_id FROM crm_email_backfill_outbox WHERE team_id = $1 AND user_id = $2", team, OWNER).fetch_one(&pool).await?;
    assert!(
        outbox.link_id == Some(link)
            && outbox.consent_incarnation == Some(generation.consent_incarnation)
            && outbox.policy_version == Some(generation.policy_version + 1)
            && outbox.work_id.is_some()
    );
    let error = sqlx::query!("UPDATE crm_email_backfill_outbox SET link_id = NULL WHERE team_id = $1 AND user_id = $2 AND consent_incarnation = $3", team, OWNER, generation.consent_incarnation).execute(&pool).await.unwrap_err();
    assert_eq!(
        error.as_database_error().and_then(|e| e.code()).as_deref(),
        Some("23514")
    );
    sqlx::query!(
        "DELETE FROM crm_email_backfill_outbox WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT work_id FROM crm_email_policy_work WHERE team_id = $1 AND user_id = $2",
            team,
            OWNER
        )
        .fetch_one(&pool)
        .await?,
        outbox.work_id.unwrap()
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_email_consent WHERE mode = 'selected' OR selected_enabled"
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mailbox_deletion_cleans_private_envelopes(pool: PgPool) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let mut tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link),
            },
        )
        .await?
        .expect("initialize");
    tx.request_work(Uuid::now_v7(), None).await?;
    tx.start_preview(
        Uuid::now_v7(),
        Uuid::now_v7(),
        &EmailRuleSet {
            schema_version: 1,
            include: vec![],
        },
        Utc::now() + Duration::minutes(5),
    )
    .await?;
    tx.record_idempotency(&NewEmailPolicyIdempotency {
        request_id: Uuid::now_v7(),
        expected_policy_version: 0,
        request_hash: vec![0; 32],
        outcome: json!({}),
    })
    .await?;
    tx.record_audit(&NewEmailPolicyAudit {
        event_id: Uuid::now_v7(),
        action: EmailPolicyAuditAction::Withdrawn,
        actor_kind: EmailPolicyActorKind::Member,
        agent_id: None,
        agent_session_id: None,
        previous_revision: None,
        next_revision: None,
        details: json!({}),
    })
    .await?;
    tx.commit().await?;
    sqlx::query!("DELETE FROM email_links WHERE id = $1", link)
        .execute(&pool)
        .await?;
    let remaining = sqlx::query!(
        r#"SELECT (SELECT count(*) FROM crm_email_consent) AS consent,
                  (SELECT count(*) FROM crm_email_policy_work) AS work,
                  (SELECT count(*) FROM crm_email_policy_previews) AS previews,
                  (SELECT count(*) FROM crm_email_policy_idempotency) AS retries,
                  (SELECT count(*) FROM crm_email_policy_audit) AS audit"#
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        (
            remaining.consent,
            remaining.work,
            remaining.previews,
            remaining.retries,
            remaining.audit
        ),
        (Some(0), Some(0), Some(0), Some(0), Some(0))
    );
    Ok(())
}
