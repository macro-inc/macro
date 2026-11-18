use super::*;
use crate::outbound::backfill_jobs::outbox::PgBackfillOutbox;
use crm::domain::email_policy::*;
use email::domain::backfill_jobs::outbox::{
    BackfillOutboxRepository, CrmOutboxTransaction, OutboxTransaction,
};

async fn schedule(
    repo: &CompaniesRepositoryImpl,
    team: Uuid,
) -> anyhow::Result<(Uuid, EmailPolicyGeneration)> {
    let mut tx = repo
        .open_email_policy(
            team,
            USER,
            OpenEmailPolicy::Initialize {
                primary_link_id: None,
            },
        )
        .await?
        .unwrap();
    let id = Uuid::now_v7();
    let generation = tx.state().generation;
    tx.request_work(id, None).await?;
    tx.commit().await?;
    Ok((id, generation))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn publication_keeps_captured_identity_and_a_recovery_signal_until_completion(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = consent(&pool).await?;
    let (id, generation) = schedule(&repo, team).await?;
    let queue = TestQueue::start().await?;
    drain(&pool, &queue.sqs).await?;
    let messages = queue.messages();
    assert_eq!(messages.len(), 1);
    let BackfillOperation::PopulateCrmPolicy(payload) = &messages[0].backfill_operation else {
        panic!("modern envelope required")
    };
    assert_eq!(payload.team_id, team);
    assert_eq!(payload.link_id, link);
    assert_eq!(payload.macro_id.as_ref(), USER);
    assert_eq!(payload.work_id, id);
    assert_eq!(payload.consent_incarnation, generation.consent_incarnation);
    assert_eq!(payload.policy_version, generation.policy_version);
    assert_eq!(pending(&pool).await?, 1);
    assert!(sqlx::query_scalar!(r#"SELECT requested_at>now() AS "deferred!" FROM crm_email_backfill_outbox WHERE team_id=$1 AND user_id=$2"#,team,USER).fetch_one(&pool).await?);
    drain(&pool, &queue.sqs).await?;
    assert_eq!(queue.messages().len(), 1, "no busy re-publication");
    // Deterministic lost-delivery recovery, without wall-clock sleeps.
    sqlx::query!(
        "UPDATE crm_email_backfill_outbox SET requested_at=now() WHERE team_id=$1 AND user_id=$2",
        team,
        USER
    )
    .execute(&pool)
    .await?;
    drain(&pool, &queue.sqs).await?;
    assert_eq!(queue.messages().len(), 2);
    assert_eq!(
        queue.messages()[0].backfill_operation,
        queue.messages()[1].backfill_operation
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_same_lifetime_work_is_delivered_for_durable_transfer_and_old_ack_cannot_delete_replacement(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, _) = consent(&pool).await?;
    let (old, generation) = schedule(&repo, team).await?;
    let db = PgBackfillOutbox(pool.clone());
    let mut tx = db.crm().await?;
    let captured = CrmOutboxTransaction::next(&mut tx).await?.unwrap();
    tx.commit().await?;
    // A version can change without a new job: the existing unfinished job must
    // still reach the worker that performs the same-lifetime hand-off.
    for enabled in [false, true] {
        sqlx::query!(
            "UPDATE crm_email_consent SET enabled=$3 WHERE team_id=$1 AND user_id=$2",
            team,
            USER,
            enabled
        )
        .execute(&pool)
        .await?;
    }
    let queue = TestQueue::start().await?;
    drain(&pool, &queue.sqs).await?;
    let messages = queue.messages();
    let BackfillOperation::PopulateCrmPolicy(payload) = &messages[0].backfill_operation else {
        panic!("captured policy required")
    };
    assert_eq!(payload.work_id, old);
    assert_eq!(payload.policy_version, generation.policy_version);
    let (replacement, _) = schedule(&repo, team).await?;
    let mut tx = db.crm().await?;
    CrmOutboxTransaction::delete(&mut tx, &captured).await?;
    tx.commit().await?;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT work_id FROM crm_email_backfill_outbox WHERE team_id=$1 AND user_id=$2",
            team,
            USER
        )
        .fetch_one(&pool)
        .await?,
        Some(replacement)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_outbox_cannot_acquire_an_initialized_lifetime(pool: PgPool) -> anyhow::Result<()> {
    let (repo, team, _) = consent(&pool).await?;
    let tx = repo
        .open_email_policy(
            team,
            USER,
            OpenEmailPolicy::Initialize {
                primary_link_id: None,
            },
        )
        .await?
        .unwrap();
    tx.commit().await?;
    let queue = TestQueue::start().await?;
    drain(&pool, &queue.sqs).await?;
    assert!(queue.messages().is_empty());
    assert_eq!(pending(&pool).await?, 0);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_email_consent WHERE mode='selected' OR selected_enabled"
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    Ok(())
}
