use email::domain::scheduled_delivery::{PreparationError, SubmissionError};
use email_api_client::domain::models::{EmailApiError, RateLimitOrigin, SentIds};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::service::message::MessageToSend;
use uuid::Uuid;

use super::{apply_sent_ids, classify_preparation_error, classify_submission_error};

#[test]
fn response_decode_failure_is_ambiguous_only_after_submission() {
    let error = EmailApiError::Permanent {
        message: "invalid provider response".into(),
    };
    assert!(matches!(
        classify_preparation_error(error.clone().into()),
        PreparationError::Failed(_)
    ));
    assert!(matches!(
        classify_submission_error(error),
        SubmissionError::Uncertain(_)
    ));
}

#[test]
fn transient_failure_can_retry_only_before_submission() {
    let error = EmailApiError::Transient {
        message: "request timed out".into(),
    };
    assert!(matches!(
        classify_preparation_error(error.clone().into()),
        PreparationError::Retry(_)
    ));
    assert!(matches!(
        classify_submission_error(error),
        SubmissionError::Uncertain(_)
    ));
}

#[test]
fn explicit_provider_refusal_is_safe_to_restore() {
    for error in [
        EmailApiError::AuthRequired,
        EmailApiError::Forbidden,
        EmailApiError::NotFound,
        EmailApiError::Conflict,
        EmailApiError::SendRejected {
            message: "message exceeded the provider size limit".into(),
        },
        EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Provider,
        },
    ] {
        assert!(matches!(
            classify_submission_error(error),
            SubmissionError::Rejected(_)
        ));
    }
}

#[test]
fn sent_ids_are_written_back_for_existing_persistence_flow() {
    let mut message = message_to_send();

    apply_sent_ids(
        &mut message,
        SentIds {
            provider_message_id: "provider-message".to_string(),
            provider_thread_id: "provider-thread".to_string(),
        },
    );

    assert_eq!(message.provider_id.as_deref(), Some("provider-message"));
    assert_eq!(
        message.provider_thread_id.as_deref(),
        Some("provider-thread")
    );
}

fn message_to_send() -> MessageToSend {
    MessageToSend {
        db_id: Some(Uuid::new_v4()),
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: None,
        thread_db_id: Some(Uuid::new_v4()),
        link_id: Uuid::new_v4(),
        subject: "subject".to_string(),
        to: None,
        cc: None,
        bcc: None,
        body_text: Some("body".to_string()),
        body_html: None,
        body_macro: None,
        attachments: None,
        headers_json: None,
        send_time: None,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../crates/email_db_client/fixtures",
        scripts("mark_message_as_sent")
    )
)]
async fn recovered_completion_publishes_canonical_thread_and_keeps_message_identity(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    let link = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000001);
    let original_thread = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000101);
    let canonical_thread = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000102);
    let original_message = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000201);
    let imported_message = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000202);
    sqlx::query!(
        "INSERT INTO email_scheduled_messages (link_id, message_id, send_time) VALUES ($1, $2, NOW() - INTERVAL '1 second')",
        link, original_message,
    ).execute(&pool).await?;
    let claim = super::delivery::claim_delivery(&pool, link, original_message, 300)
        .await?
        .unwrap();
    assert!(super::delivery::begin_submission(&pool, &claim, 300).await?);
    sqlx::query!(
        "UPDATE email_threads SET provider_id = 'confirmed-thread' WHERE id = $1",
        canonical_thread,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE email_messages SET provider_id = 'confirmed-message', provider_thread_id = 'confirmed-thread', is_sent = TRUE WHERE id = $1",
        imported_message,
    ).execute(&pool).await?;
    let mut sent = message_to_send();
    sent.db_id = Some(original_message);
    sent.thread_db_id = Some(original_thread);
    sent.link_id = link;
    apply_sent_ids(
        &mut sent,
        SentIds {
            provider_message_id: "confirmed-message".into(),
            provider_thread_id: "confirmed-thread".into(),
        },
    );
    let mut tx = pool.begin().await?;
    email_db_client::threads::provider_identity::lock_provider_thread(
        &mut tx,
        link,
        "confirmed-thread",
    )
    .await?;
    assert!(super::delivery::complete_delivery(&mut tx, &claim).await?);
    super::process_sent_message(&mut tx, &mut sent).await?;
    tx.commit().await?;

    // The worker publishes its message_sent event from this updated value.
    assert_eq!(sent.db_id, Some(original_message));
    assert_eq!(sent.thread_db_id, Some(canonical_thread));
    let persisted = sqlx::query!(
        "SELECT id, thread_id, is_sent FROM email_messages WHERE link_id = $1 AND provider_id = 'confirmed-message'",
        link,
    ).fetch_one(&pool).await?;
    assert_eq!(persisted.id, original_message);
    assert_eq!(persisted.thread_id, canonical_thread);
    assert!(persisted.is_sent);
    assert!(
        sqlx::query_scalar!(
            "SELECT sent FROM email_scheduled_messages WHERE message_id = $1",
            original_message,
        )
        .fetch_one(&pool)
        .await?
    );
    Ok(())
}
