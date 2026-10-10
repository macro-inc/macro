use super::*;
use crate::domain::scheduled::{EmailSchedulingRepo, ScheduleChange};
use email_db_client::messages::scheduled::delivery::{
    DeliveryClaim, begin_submission, claim_delivery, pause_delivery, release_preparation,
};

async fn admit_and_claim(pool: &Pool<Postgres>) -> anyhow::Result<(SendAttemptId, DeliveryClaim)> {
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let mut input = prepared();
    input.undo_delay_secs = 0;
    EmailPgRepo::new(pool.clone())
        .admit_send(&actor(), link(), attempt, input)
        .await?;
    let claim = claim_delivery(pool, link(), message(), 300)
        .await?
        .expect("due send must be claimable");
    Ok((attempt, claim))
}

async fn expire(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_scheduled_messages SET delivery_lease_expires_at = NOW() - INTERVAL '1 second', updated_at = NOW() - INTERVAL '1 day' WHERE message_id = $1",
        message(),
    ).execute(pool).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn active_backed_off_and_expired_preparation_can_be_cancelled(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    for backoff in [None, Some(false), Some(true)] {
        let (attempt, claim) = admit_and_claim(&pool).await?;
        if let Some(expired) = backoff {
            release_preparation(&pool, &claim, 300).await?;
            if expired {
                expire(&pool).await?;
            }
        }
        assert_eq!(
            repo.read_send_attempt(&actor(), link(), attempt, None)
                .await?
                .unwrap()
                .status,
            SendAttemptStatus::Accepted,
            "managed preparation must expose cancellation during {backoff:?}"
        );
        assert_eq!(
            repo.cancel_send(&actor(), link(), attempt).await?.status,
            SendAttemptStatus::Cancelled
        );
        assert!(!begin_submission(&pool, &claim, 300).await?);
        release_preparation(&pool, &claim, 300).await?;
        pause_delivery(&pool, &claim, true, 300).await?;
        let restored = sqlx::query!(
            "SELECT is_draft, body_text FROM email_messages WHERE id = $1",
            message(),
        )
        .fetch_one(&pool)
        .await?;
        assert!(restored.is_draft);
        assert_eq!(restored.body_text.as_deref(), Some("Editable body"));
        assert!(
            claim_delivery(&pool, link(), message(), 300)
                .await?
                .is_none()
        );

        // Reusing the draft creates a different delivery authority. The cancelled
        // worker must not revive itself against the replacement schedule.
        let (replacement, next_claim) = admit_and_claim(&pool).await?;
        assert!(!begin_submission(&pool, &claim, 300).await?);
        assert_ne!(claim.token, next_claim.token);
        repo.cancel_send(&actor(), link(), replacement).await?;
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn schedule_cancellation_fences_managed_preparation_during_backoff(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    for expired in [false, true] {
        let (attempt, claim) = admit_and_claim(&pool).await?;
        release_preparation(&pool, &claim, 300).await?;
        if expired {
            expire(&pool).await?;
        }
        assert!(matches!(
            repo.change_schedule(
                link(),
                message(),
                &actor(),
                ScheduleChange::Set(Utc::now() + chrono::Duration::hours(1)),
                None
            )
            .await,
            Err(EmailErr::MessageDeliveryConflict(_))
        ));
        repo.change_schedule(link(), message(), &actor(), ScheduleChange::Cancel, None)
            .await?;
        assert!(!begin_submission(&pool, &claim, 300).await?);
        assert_eq!(
            repo.read_send_attempt(&actor(), link(), attempt, None)
                .await?
                .unwrap()
                .status,
            SendAttemptStatus::Cancelled
        );
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn submitted_delivery_remains_locked_after_lease_expiry(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let (attempt, claim) = admit_and_claim(&pool).await?;
    assert!(begin_submission(&pool, &claim, 300).await?);
    expire(&pool).await?;
    assert_eq!(
        repo.cancel_send(&actor(), link(), attempt).await?.status,
        SendAttemptStatus::Sending
    );
    assert!(matches!(
        repo.change_schedule(link(), message(), &actor(), ScheduleChange::Cancel, None)
            .await,
        Err(EmailErr::MessageDeliveryConflict(_))
    ));
    let recovered = claim_delivery(&pool, link(), message(), 300)
        .await?
        .unwrap();
    assert!(recovered.requires_reconciliation);
    pause_delivery(&pool, &recovered, true, 300).await?;
    assert_eq!(
        repo.cancel_send(&actor(), link(), attempt).await?.status,
        SendAttemptStatus::DeliveryUnconfirmed
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn expired_legacy_claim_cannot_be_mistaken_for_safe_preparation(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    sqlx::query!(
        "UPDATE email_scheduled_messages SET processing = true WHERE message_id = $1",
        message(),
    )
    .execute(&pool)
    .await?;
    expire(&pool).await?;
    assert_eq!(
        repo.cancel_send(&actor(), link(), attempt).await?.status,
        SendAttemptStatus::Sending
    );
    assert!(matches!(
        repo.change_schedule(link(), message(), &actor(), ScheduleChange::Cancel, None)
            .await,
        Err(EmailErr::MessageDeliveryConflict(_))
    ));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn cancellation_and_submission_race_has_exactly_one_winner(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    for _ in 0..12 {
        let (attempt, claim) = admit_and_claim(&pool).await?;
        let caller = actor();
        let (cancelled, submitted) = tokio::join!(
            repo.cancel_send(&caller, link(), attempt),
            begin_submission(&pool, &claim, 300),
        );
        let cancelled = cancelled?;
        if submitted? {
            assert_eq!(cancelled.status, SendAttemptStatus::Sending);
            // A definite provider rejection makes another attempt safe.
            pause_delivery(&pool, &claim, false, 300).await?;
            repo.cancel_send(&caller, link(), attempt).await?;
        } else {
            assert_eq!(cancelled.status, SendAttemptStatus::Cancelled);
        }
        assert_eq!(
            repo.read_send_attempt(&caller, link(), attempt, None)
                .await?
                .unwrap()
                .status,
            SendAttemptStatus::Cancelled
        );
    }
    Ok(())
}
