use super::*;
use email_db_client::messages::scheduled::delivery::{
    begin_submission, claim_delivery, pause_delivery,
};

async fn preserve_attempt(pool: Pool<Postgres>, unconfirmed: bool) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let cached = repo
        .get_simple_message(message(), &[link()])
        .await?
        .unwrap();
    assert!(cached.is_draft);
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let mut input = prepared();
    input.undo_delay_secs = 0;
    repo.admit_send(&actor(), link(), attempt, input).await?;
    let claim = claim_delivery(&pool, link(), message(), 300)
        .await?
        .unwrap();
    assert!(begin_submission(&pool, &claim, 300).await?);
    if unconfirmed {
        pause_delivery(&pool, &claim, true, 300).await?;
    }
    // The trash caller retained a draft snapshot from before admission.
    assert!(
        repo.delete_scheduled_messages_batch(&[cached.db_id], link())
            .await?
            .is_empty()
    );
    let expected = if unconfirmed {
        SendAttemptStatus::DeliveryUnconfirmed
    } else {
        SendAttemptStatus::Sending
    };
    assert_eq!(
        repo.read_send_attempt(&actor(), link(), attempt, None)
            .await?
            .unwrap()
            .status,
        expected
    );
    assert_eq!(
        repo.cancel_send(&actor(), link(), attempt).await?.status,
        expected
    );
    assert!(
        !repo
            .get_simple_message(message(), &[link()])
            .await?
            .unwrap()
            .is_draft
    );
    assert!(
        repo.admit_send(
            &actor(),
            link(),
            SendAttemptId(macro_uuid::generate_uuid_v7()),
            prepared()
        )
        .await
        .is_err()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn trash_preserves_submitted_attempt(pool: Pool<Postgres>) -> anyhow::Result<()> {
    preserve_attempt(pool, false).await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn trash_preserves_unconfirmed_attempt(pool: Pool<Postgres>) -> anyhow::Result<()> {
    preserve_attempt(pool, true).await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn trash_rechecks_draft_state_after_admission(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let cached = repo
        .get_simple_message(message(), &[link()])
        .await?
        .unwrap();
    assert!(cached.is_draft);
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let mut input = prepared();
    input.undo_delay_secs = 0;
    repo.admit_send(&actor(), link(), attempt, input).await?;
    let claim = claim_delivery(&pool, link(), message(), 300)
        .await?
        .unwrap();
    assert!(
        repo.delete_scheduled_messages_batch(&[cached.db_id], link())
            .await?
            .is_empty()
    );
    assert!(begin_submission(&pool, &claim, 300).await?);
    Ok(())
}
