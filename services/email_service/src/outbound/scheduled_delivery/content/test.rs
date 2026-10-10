use super::*;
use email::domain::{
    models::{
        ContactInfo as DomainContact, CreateDraftInput, RecipientType, ResolvedDraftInput,
        UpsertedContacts, UpsertedRecipient,
    },
    send_attempt::{EmailSendRepo, PreparedSend, SendAttemptId, SendSnapshot},
};
use email::outbound::EmailPgRepo;
use email_db_client::messages::scheduled::delivery::claim_delivery;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

fn link() -> Uuid {
    Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap()
}
fn message() -> Uuid {
    Uuid::parse_str("ee000002-0000-0000-0000-000000000002").unwrap()
}

async fn admit(pool: &PgPool) -> anyhow::Result<SendAttemptId> {
    let to = DomainContact {
        email: "bob@example.com".into(),
        name: Some("Approved recipient".into()),
        photo_url: None,
    };
    let message = ResolvedDraftInput {
        db_id: message(),
        provider_id: Some("provider-draft".into()),
        replying_to_id: None,
        provider_thread_id: Some("approved-provider-thread".into()),
        thread_db_id: Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap(),
        subject: "Approved subject".into(),
        to: vec![to.clone()],
        cc: vec![],
        bcc: vec![],
        body_text: Some("Approved body and signature".into()),
        body_html: Some("<p>Approved body</p><p>Frozen signature</p>".into()),
        body_macro: Some("approved editor state".into()),
        headers_json: None,
        send_time: Some(chrono::Utc::now()),
        actor_id: None,
        draft_client_id: None,
        thread_client_id: None,
    };
    let snapshot = SendSnapshot {
        message: CreateDraftInput {
            db_id: Some(message.db_id),
            provider_id: message.provider_id.clone(),
            replying_to_id: None,
            provider_thread_id: message.provider_thread_id.clone(),
            thread_db_id: Some(message.thread_db_id),
            subject: message.subject.clone(),
            to: vec![to],
            cc: vec![],
            bcc: vec![],
            body_text: Some("Approved body".into()),
            body_html: None,
            body_macro: None,
            headers_json: None,
            send_time: None,
            include_signature: None,
            actor: None,
            draft_client_binding: None,
            thread_client_binding: None,
        },
        attachment_ids: vec![],
        forwarded_attachment_ids: vec![],
        restore_body_html: None,
        restore_body_text: None,
        restore_body_macro: None,
    };
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    EmailPgRepo::new(pool.clone())
        .admit_send(
            &MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap(),
            link(),
            attempt,
            PreparedSend {
                source_inbox: None,
                undo_delay_secs: 0,
                snapshot,
                message,
                contacts: UpsertedContacts {
                    from_contact_id: Some(
                        Uuid::parse_str("c0000001-0000-0000-0000-000000000001").unwrap(),
                    ),
                    recipients: vec![UpsertedRecipient {
                        contact_id: Uuid::parse_str("c0000002-0000-0000-0000-000000000002")
                            .unwrap(),
                        name: Some("Approved recipient".into()),
                        recipient_type: RecipientType::To,
                    }],
                },
                new_thread: None,
                restore_html: None,
                restore_text: None,
                restore_macro: None,
            },
        )
        .await?;
    Ok(attempt)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../crates/email/fixtures",
        scripts("email_draft")
    )
)]
async fn provider_sync_cannot_replace_approved_body_envelope_or_sender(
    pool: PgPool,
) -> anyhow::Result<()> {
    let attempt = admit(&pool).await?;
    sqlx::query!(
        "UPDATE email_messages SET subject = 'Changed subject', body_text = 'Changed body', body_html_sanitized = '<p>Changed</p>', provider_thread_id = 'changed-thread' WHERE id = $1",
        message(),
    ).execute(&pool).await?;
    sqlx::query!("UPDATE email_contacts SET email_address = id::text || '@changed.example', name = 'Changed contact' WHERE link_id = $1", link()).execute(&pool).await?;
    sqlx::query!(
        "DELETE FROM email_message_recipients WHERE message_id = $1",
        message()
    )
    .execute(&pool)
    .await?;
    let claim = claim_delivery(&pool, link(), message(), 300)
        .await?
        .unwrap();
    let (prepared, sender) = load_delivery_content(&pool, &claim).await?;
    assert_eq!(prepared.subject, "Approved subject");
    assert_eq!(
        prepared.body_text.as_deref(),
        Some("Approved body and signature")
    );
    assert_eq!(
        prepared.body_html.as_deref(),
        Some("<p>Approved body</p><p>Frozen signature</p>")
    );
    assert_eq!(prepared.to.unwrap()[0].email, "bob@example.com");
    assert_eq!(
        prepared.provider_thread_id.as_deref(),
        Some("approved-provider-thread")
    );
    assert_eq!(sender.email, "user1@test.com");
    assert_eq!(sender.name.as_deref(), Some("Alice Smith"));
    let raw = sqlx::query_scalar!(
        "SELECT request FROM email_send_attempts WHERE attempt_id = $1",
        attempt.0
    )
    .fetch_one(&pool)
    .await?
    .unwrap();
    assert_eq!(raw["message"]["body_text"], "Approved body");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../crates/email/fixtures",
        scripts("email_draft")
    )
)]
async fn older_graphql_attempt_without_prepared_content_requires_review(
    pool: PgPool,
) -> anyhow::Result<()> {
    let attempt = admit(&pool).await?;
    sqlx::query!(
        "UPDATE email_send_attempts SET prepared_content = NULL WHERE attempt_id = $1",
        attempt.0
    )
    .execute(&pool)
    .await?;
    let claim = claim_delivery(&pool, link(), message(), 300)
        .await?
        .unwrap();
    let error = load_delivery_content(&pool, &claim).await.unwrap_err();
    assert!(matches!(
        super::super::classify_preparation_error(error),
        email::domain::scheduled_delivery::PreparationError::Failed(_)
    ));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../crates/email_db_client/fixtures",
        scripts("get_process_scheduled_messages")
    )
)]
async fn legacy_rest_delivery_still_loads_current_message(pool: PgPool) -> anyhow::Result<()> {
    let link = Uuid::parse_str("00000000-0000-0000-0000-000000000e01").unwrap();
    let message = Uuid::parse_str("00000000-0000-0000-0000-00000000e501").unwrap();
    let claim = claim_delivery(&pool, link, message, 300).await?.unwrap();
    assert!(claim.approved_snapshot.is_none());
    let (prepared, sender) = load_delivery_content(&pool, &claim).await?;
    assert_eq!(
        prepared.provider_id.as_deref(),
        Some("provider-scheduled-501")
    );
    assert_eq!(sender.email, "scheduled_sender@example.com");
    Ok(())
}
