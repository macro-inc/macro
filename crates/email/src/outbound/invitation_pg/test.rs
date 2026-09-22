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

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_thread"))
)]
async fn parser_upgrade_replaces_components_then_appends_retries(
    pool: PgPool,
) -> Result<(), Report> {
    let repo = InvitationPgRepository(pool.clone());
    let message = uuid::uuid!("11111111-aaaa-0001-aaaa-111111111111");
    let mut parsed = parse_invitation_parts(&[InvitationPart {
        part_id: "inline",
        attachment_id: None,
        bytes: b"BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:example\nSUMMARY:Correct title\nDTSTART:20260924T170000Z\nEND:VEVENT\nEND:VCALENDAR\n",
    }]);
    let mut old = parsed.clone();
    old.invitations[0].title = Some("Old parser output".into());
    let mut obsolete = old.invitations[0].clone();
    obsolete.id = "obsolete-component".into();
    old.invitations.push(obsolete);
    let pending = [PendingInvitationPart {
        part_id: "attachment".into(),
        attachment_id: "provider-attachment".into(),
    }];
    assert!(repo.save(message, &old, &pending, None).await?);
    sqlx::query!(
        "UPDATE email_message_calendar_extraction SET parser_version = 0, notification_pending = false, retry_after = now() WHERE message_id = $1",
        message
    )
    .execute(&pool)
    .await?;
    assert!(!repo.is_processed(message).await?);
    let job = repo
        .claim()
        .await?
        .into_iter()
        .find(|j| j.message_id == message)
        .unwrap();
    assert!(job.discover);
    assert!(!job.notification_only);
    assert!(job.parts.is_empty());
    assert!(
        repo.save(message, &parsed, &pending, Some(job.generation))
            .await?
    );
    let loaded = load(&pool, &[message]).await?;
    assert_eq!(loaded[&message].invitations.len(), 2);
    assert!(
        loaded[&message]
            .invitations
            .iter()
            .all(|invite| invite.title.as_deref() == Some("Old parser output"))
    );
    assert_eq!(loaded[&message].status, InvitationExtractionStatus::Pending);
    assert!(!repo.is_processed(message).await?);
    let absent = parse_invitation_parts(&[]);
    assert!(
        repo.save(message, &absent, &[], Some(job.generation))
            .await?
    );
    assert_eq!(
        load(&pool, &[message]).await?[&message].invitations.len(),
        2
    );
    assert!(!repo.is_processed(message).await?);
    sqlx::query!(
        "UPDATE email_message_calendar_extraction SET retry_after = now() WHERE message_id = $1",
        message
    )
    .execute(&pool)
    .await?;
    let job = repo
        .claim()
        .await?
        .into_iter()
        .find(|j| j.message_id == message)
        .unwrap();
    assert!(job.discover);
    assert!(
        repo.save(message, &parsed, &[], Some(job.generation))
            .await?
    );
    let loaded = load(&pool, &[message]).await?;
    assert_eq!(loaded[&message].invitations.len(), 1);
    assert_eq!(
        loaded[&message].invitations[0].title.as_deref(),
        Some("Correct title")
    );
    assert_eq!(loaded[&message].status, InvitationExtractionStatus::Ready);

    parsed.invitations[0].id = "attachment-component".into();
    assert!(
        repo.save(message, &parsed, &[], Some(job.generation))
            .await?
    );
    let loaded = load(&pool, &[message]).await?;
    assert_eq!(loaded[&message].invitations.len(), 2);
    assert_eq!(loaded[&message].status, InvitationExtractionStatus::Ready);

    // An older worker cannot downgrade snapshots produced by a newer deployment.
    sqlx::query!(
        "UPDATE email_message_calendar_extraction SET parser_version = $2, retry_after = now() WHERE message_id = $1",
        message,
        crate::domain::models::calendar_invitation::INVITATION_PARSER_VERSION as i16 + 1
    )
    .execute(&pool)
    .await?;
    assert!(repo.is_processed(message).await?);
    assert!(!repo.save(message, &old, &[], Some(job.generation)).await?);
    assert!(
        repo.claim()
            .await?
            .iter()
            .all(|job| job.message_id != message)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_thread"))
)]
async fn older_parser_notification_retries_do_not_reinspect_saved_content(
    pool: PgPool,
) -> Result<(), Report> {
    let repo = InvitationPgRepository(pool.clone());
    let message = uuid::uuid!("11111111-aaaa-0001-aaaa-111111111111");
    let parsed = parse_invitation_parts(&[InvitationPart {
        part_id: "inline",
        attachment_id: None,
        bytes: include_bytes!("../../../fixtures/calendar/google.ics"),
    }]);
    assert!(repo.save(message, &parsed, &[], None).await?);
    sqlx::query!(
        "UPDATE email_message_calendar_extraction SET parser_version = 0, retry_after = now() WHERE message_id = $1",
        message
    )
    .execute(&pool)
    .await?;
    let job = repo
        .claim()
        .await?
        .into_iter()
        .find(|j| j.message_id == message)
        .unwrap();
    assert!(job.notification_only);
    assert!(!job.discover);
    repo.notified(message, job.generation).await?;
    assert_eq!(
        load(&pool, &[message]).await?[&message].invitations,
        parsed.invitations
    );
    Ok(())
}
