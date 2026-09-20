use super::*;
use crate::domain::{
    calendar_invitation_parser::{InvitationPart, parse_invitation_parts},
    invitation_extraction::{InvitationExtractionRepository, PendingInvitationPart},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_thread"))
)]
async fn invitation_retry_is_durable_idempotent_and_fenced(pool: PgPool) -> Result<(), Report> {
    let repo = InvitationPgRepository(pool.clone());
    let message = uuid::uuid!("11111111-aaaa-0001-aaaa-111111111111");
    assert!(!repo.is_processed(message).await?);
    assert_eq!(
        load(&pool, &[message]).await?[&message].status,
        InvitationExtractionStatus::Unprocessed
    );
    let bytes = b"BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:example\nDTSTART:20260924T170000Z\nEND:VEVENT\nEND:VCALENDAR\n";
    let parsed = parse_invitation_parts(&[InvitationPart {
        part_id: "inline",
        attachment_id: None,
        bytes,
    }]);
    let pending = [PendingInvitationPart {
        part_id: "attached".into(),
        attachment_id: "provider-attachment".into(),
    }];
    assert!(repo.save(message, &parsed, &pending, None).await?);
    assert!(!repo.save(message, &parsed, &[], None).await?);
    assert_eq!(
        load(&pool, &[message]).await?[&message].status,
        InvitationExtractionStatus::Pending
    );
    sqlx::query!(
        "UPDATE email_message_calendar_extraction SET retry_after = now() WHERE message_id = $1",
        message
    )
    .execute(&pool)
    .await?;
    let first = repo
        .claim()
        .await?
        .into_iter()
        .find(|j| j.message_id == message)
        .unwrap();
    sqlx::query!(
        "UPDATE email_message_calendar_extraction SET retry_after = now() WHERE message_id = $1",
        message
    )
    .execute(&pool)
    .await?;
    let second = repo
        .claim()
        .await?
        .into_iter()
        .find(|j| j.message_id == message)
        .unwrap();
    assert!(second.generation > first.generation);
    assert!(
        !repo
            .save(message, &parsed, &[], Some(first.generation))
            .await?
    );
    assert!(
        repo.save(message, &parsed, &[], Some(second.generation))
            .await?
    );
    let loaded = load(&pool, &[message]).await?;
    assert_eq!(loaded[&message].invitations.len(), 1);
    assert_eq!(loaded[&message].status, InvitationExtractionStatus::Ready);
    repo.notified(message, first.generation).await?;
    assert!(sqlx::query_scalar!("SELECT notification_pending FROM email_message_calendar_extraction WHERE message_id = $1", message).fetch_one(&pool).await?);
    repo.notified(message, second.generation).await?;
    assert!(!sqlx::query_scalar!("SELECT notification_pending FROM email_message_calendar_extraction WHERE message_id = $1", message).fetch_one(&pool).await?);
    sqlx::query!("DELETE FROM email_messages WHERE id = $1", message)
        .execute(&pool)
        .await?;
    assert!(load(&pool, &[message]).await?.is_empty());
    Ok(())
}
