use super::*;
use crate::domain::send_attempt::{
    EmailSendRepo, EmailSendService, PreparedSendContent, SendAttemptId, SendSnapshot,
};
use email_db_client::messages::scheduled::delivery::claim_delivery;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn durable_send_freezes_the_authorized_alias_through_contact_sync(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = super::super::thread_unread::service(pool.clone()).with_sender_provider(Provider);
    let snapshot = SendSnapshot {
        message: draft(),
        attachment_ids: vec![],
        forwarded_attachment_ids: vec![],
        restore_body_html: None,
        restore_body_text: None,
        restore_body_macro: None,
    };
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let admitted = service
        .send_email(actor(), inbox_id(), attempt, snapshot.clone())
        .await?;
    assert_eq!(
        admitted
            .message
            .as_ref()
            .unwrap()
            .from
            .as_ref()
            .unwrap()
            .email,
        "resident@test.com"
    );
    // Provider synchronization may rewrite contacts while the send is queued.
    sqlx::query!("UPDATE email_contacts SET email_address = id::text || '@changed.example', name = 'Changed contact' WHERE link_id = $1", inbox_id()).execute(&pool).await?;
    let claim = claim_delivery(&pool, inbox_id(), admitted.message_id.unwrap(), 300)
        .await?
        .unwrap();
    let content: PreparedSendContent = serde_json::from_value(claim.prepared_content.unwrap())?;
    assert_eq!(content.sender.email, "resident@test.com");
    assert_eq!(content.sender.name.as_deref(), Some("Property manager"));
    assert_eq!(
        claim.approved_snapshot.unwrap()["message"]["sender_email"],
        "resident@test.com"
    );
    let mut changed = snapshot;
    changed.message.sender_email = Some(EmailStr::try_from("user1@test.com".to_owned())?);
    assert!(matches!(
        service
            .email_repo
            .read_send_attempt(&actor(), inbox_id(), attempt, Some(&changed))
            .await,
        Err(EmailErr::SendAttemptConflict)
    ));
    Ok(())
}
