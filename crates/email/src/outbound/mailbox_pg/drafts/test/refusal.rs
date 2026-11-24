//! Fenced pre-submission recovery and optional refusal projection.
use super::*;
use crate::domain::models::mailbox_operation::{
    MessageOperationStatus, SendRejectionReason, SubmissionRefusal, SubmissionRefusalClass,
    SubmissionRefusalPhase,
};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn local_submit_contention_resets_admission_and_a_stale_worker_cannot_reset_its_successor(
    db: PgPool,
) {
    let (sync, _, input, link) = setup(&db, true).await;
    let prior_claim = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_scheduled_messages
            (link_id, message_id, send_time, actor_id, delivery_claim_id)
        VALUES ($1, $2, now() - interval '1 second', $3, $4)
        "#,
        link,
        input.db_id,
        ACTOR,
        prior_claim,
    )
    .execute(&db)
    .await
    .unwrap();
    let lease = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    let mut checkpoint = checkpoint(&lease, DraftStage::Submitting);
    assert!(matches!(
        sync.start_delivery(&lease, &checkpoint).await.unwrap(),
        DeliveryStart::Started
    ));
    checkpoint.submission_started = false;
    checkpoint.advance(DraftStage::Ready);
    sync.defer_unsubmitted_delivery(&lease, &checkpoint)
        .await
        .unwrap();
    let state = sqlx::query!(
        r#"
        SELECT
            s.processing,
            s.delivery_started_at,
            s.delivery_claim_id,
            s.delivery_status,
            s.sent,
            d.checkpoint
        FROM
            email_scheduled_messages s
        JOIN
            email_mailbox_drafts d ON d.message_id = s.message_id
        WHERE
            s.message_id = $1
        "#,
        input.db_id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!state.processing);
    assert!(!state.sent);
    assert_eq!(state.delivery_status, "ready");
    assert!(state.delivery_started_at.is_none());
    assert!(state.delivery_claim_id.is_none());
    let stored: DraftCheckpoint = serde_json::from_value(state.checkpoint.unwrap()).unwrap();
    assert_eq!(stored.stage, DraftStage::Ready);
    assert!(!stored.submission_started);
    sync.release_draft(&lease, 0).await.unwrap();
    let next = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    checkpoint.advance(DraftStage::Submitting);
    checkpoint.submission_started = true;
    assert!(matches!(
        sync.start_delivery(&next, &checkpoint).await.unwrap(),
        DeliveryStart::Started
    ));
    assert!(matches!(
        sync.defer_unsubmitted_delivery(&lease, &stored).await,
        Err(MailboxError::Stale)
    ));
    assert!(
        sqlx::query_scalar!(
            r#"
        SELECT
            processing
        FROM
            email_scheduled_messages
        WHERE
            message_id = $1
        "#,
            input.db_id
        )
        .fetch_one(&db)
        .await
        .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_edited_draft_does_not_name_a_recipient_from_the_old_rejected_revision(db: PgPool) {
    let (sync, repo, lease, _) = super::delivery_status::submitted_send(&db).await;
    let mut checkpoint = checkpoint(&lease, DraftStage::Submitting);
    checkpoint.send_rejection_reason = Some(SendRejectionReason::ProviderRejected);
    checkpoint.send_refusal = Some(SubmissionRefusal {
        phase: SubmissionRefusalPhase::Recipient,
        recipient_index: Some(0),
        reply_class: Some(SubmissionRefusalClass::Permanent),
    });
    sync.checkpoint_draft(&lease, &checkpoint).await.unwrap();
    sync.fail_draft(&lease, DraftFailure::SendRejected)
        .await
        .unwrap();
    let before = repo
        .message_operation_facts(&[lease.message_id])
        .await
        .unwrap()
        .remove(&lease.message_id)
        .unwrap();
    assert_eq!(
        MessageOperationStatus::from(before).send_refusal,
        checkpoint.send_refusal
    );
    sqlx::query!(
        r#"
        UPDATE
            email_mailbox_drafts
        SET
            revision = revision + 1
        WHERE
            message_id = $1
        "#,
        lease.message_id
    )
    .execute(&db)
    .await
    .unwrap();
    let after = repo
        .message_operation_facts(&[lease.message_id])
        .await
        .unwrap()
        .remove(&lease.message_id)
        .unwrap();
    assert_eq!(MessageOperationStatus::from(after).send_refusal, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_started_delivery_cannot_be_reset_as_unsubmitted(db: PgPool) {
    let (sync, _, input, link) = setup(&db, true).await;
    let prior_claim = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_scheduled_messages
            (link_id, message_id, send_time, actor_id, delivery_claim_id)
        VALUES ($1, $2, now() - interval '1 second', $3, $4)
        "#,
        link,
        input.db_id,
        ACTOR,
        prior_claim,
    )
    .execute(&db)
    .await
    .unwrap();
    let lease = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    let mut checkpoint = checkpoint(&lease, DraftStage::Submitting);
    assert!(matches!(
        sync.start_delivery(&lease, &checkpoint).await.unwrap(),
        DeliveryStart::Started
    ));
    sqlx::query!(
        r#"
        UPDATE
            email_scheduled_messages
        SET
            delivery_started_at = now()
        WHERE
            message_id = $1
        "#,
        input.db_id,
    )
    .execute(&db)
    .await
    .unwrap();

    let before = sqlx::query!(
        r#"
        SELECT
            s.processing,
            s.delivery_started_at,
            s.delivery_claim_id,
            s.delivery_status,
            s.sent,
            d.checkpoint
        FROM
            email_scheduled_messages s
        JOIN
            email_mailbox_drafts d ON d.message_id = s.message_id
        WHERE
            s.message_id = $1
        "#,
        input.db_id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    checkpoint.submission_started = false;
    checkpoint.advance(DraftStage::Ready);
    assert!(matches!(
        sync.defer_unsubmitted_delivery(&lease, &checkpoint).await,
        Err(MailboxError::Stale)
    ));
    let after = sqlx::query!(
        r#"
        SELECT
            s.processing,
            s.delivery_started_at,
            s.delivery_claim_id,
            s.delivery_status,
            s.sent,
            d.checkpoint
        FROM
            email_scheduled_messages s
        JOIN
            email_mailbox_drafts d ON d.message_id = s.message_id
        WHERE
            s.message_id = $1
        "#,
        input.db_id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(after.processing);
    assert!(after.delivery_started_at.is_some());
    assert_eq!(after.processing, before.processing);
    assert_eq!(after.delivery_started_at, before.delivery_started_at);
    assert_eq!(after.delivery_claim_id, before.delivery_claim_id);
    assert_eq!(after.checkpoint, before.checkpoint);
}
