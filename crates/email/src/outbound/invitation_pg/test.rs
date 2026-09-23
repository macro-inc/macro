use super::*;
use crate::domain::{
    calendar_invitation_parser::parse_invitation_parts,
    invitation_extraction::{InvitationExtractionRepository, PendingInvitationPart},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const MESSAGE: Uuid = uuid::uuid!("11111111-aaaa-0001-aaaa-111111111111");

fn request(uid: &str) -> ParsedInvitations {
    let bytes = format!(
        "BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:{uid}\nDTSTART:20260924T170000Z\nEND:VEVENT\nEND:VCALENDAR\n"
    );
    parse_invitation_parts(&[bytes.as_bytes()])
}

async fn saved(pool: &PgPool, message: Uuid) -> Result<Vec<CalendarInvitation>, Report> {
    Ok(load(pool, &[message])
        .await?
        .remove(&message)
        .unwrap_or_default())
}

async fn extraction(pool: &PgPool, message: Uuid) -> Result<Option<(String, bool)>, Report> {
    Ok(sqlx::query!(
        "SELECT status, notification_pending FROM email_message_calendar_extraction WHERE message_id = $1",
        message
    )
    .fetch_optional(pool)
    .await?
    .map(|row| (row.status, row.notification_pending)))
}

async fn make_due(pool: &PgPool, message: Uuid) -> Result<(), Report> {
    sqlx::query!(
        "UPDATE email_message_calendar_extraction SET retry_after = now() WHERE message_id = $1",
        message
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_thread"))
)]
async fn invitation_retry_is_durable_idempotent_and_fenced(pool: PgPool) -> Result<(), Report> {
    let repo = InvitationPgRepository(pool.clone());
    assert!(!repo.is_processed(MESSAGE).await?);
    // Messages keep no extraction state until calendar content is ingested.
    assert_eq!(extraction(&pool, MESSAGE).await?, None);
    let parsed = request("example");
    let pending = [PendingInvitationPart {
        attachment_id: "provider-attachment".into(),
    }];
    assert!(repo.save(MESSAGE, &parsed, &pending, None).await?);
    assert!(!repo.save(MESSAGE, &parsed, &[], None).await?);
    assert_eq!(
        extraction(&pool, MESSAGE).await?,
        Some(("pending".into(), true))
    );
    make_due(&pool, MESSAGE).await?;
    let first = repo
        .claim()
        .await?
        .into_iter()
        .find(|j| j.message_id == MESSAGE)
        .unwrap();
    make_due(&pool, MESSAGE).await?;
    let second = repo
        .claim()
        .await?
        .into_iter()
        .find(|j| j.message_id == MESSAGE)
        .unwrap();
    assert!(second.generation > first.generation);
    let attached = request("attached");
    assert!(
        !repo
            .save(MESSAGE, &attached, &[], Some(first.generation))
            .await?
    );
    assert!(
        repo.save(MESSAGE, &attached, &[], Some(second.generation))
            .await?
    );
    assert_eq!(saved(&pool, MESSAGE).await?.len(), 2);
    repo.notified(MESSAGE, first.generation).await?;
    assert_eq!(
        extraction(&pool, MESSAGE).await?,
        Some(("ready".into(), true))
    );
    // An undelivered refresh stays due even when a retry finds nothing new.
    assert!(
        repo.save(MESSAGE, &attached, &[], Some(second.generation))
            .await?
    );
    repo.notified(MESSAGE, second.generation).await?;
    assert_eq!(
        extraction(&pool, MESSAGE).await?,
        Some(("ready".into(), false))
    );
    // Once delivered, a retry that finds nothing new needs no refresh.
    assert!(
        !repo
            .save(MESSAGE, &attached, &[], Some(second.generation))
            .await?
    );
    sqlx::query!("DELETE FROM email_messages WHERE id = $1", MESSAGE)
        .execute(&pool)
        .await?;
    assert!(load(&pool, &[MESSAGE]).await?.is_empty());
    assert_eq!(extraction(&pool, MESSAGE).await?, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_thread"))
)]
async fn unusable_calendar_content_needs_no_refresh(pool: PgPool) -> Result<(), Report> {
    let repo = InvitationPgRepository(pool.clone());
    let unsupported = parse_invitation_parts(&[b"not a calendar"]);
    assert!(!repo.save(MESSAGE, &unsupported, &[], None).await?);
    assert_eq!(
        extraction(&pool, MESSAGE).await?,
        Some(("unsupported".into(), false))
    );
    make_due(&pool, MESSAGE).await?;
    assert!(
        repo.claim()
            .await?
            .iter()
            .all(|job| job.message_id != MESSAGE)
    );
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
    let mut parsed = parse_invitation_parts(&[b"BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:example\nSUMMARY:Correct title\nDTSTART:20260924T170000Z\nEND:VEVENT\nEND:VCALENDAR\n"]);
    let mut old = parsed.clone();
    old.invitations[0].title = Some("Old parser output".into());
    let mut obsolete = old.invitations[0].clone();
    obsolete.id = "obsolete-component".into();
    old.invitations.push(obsolete);
    let pending = [PendingInvitationPart {
        attachment_id: "provider-attachment".into(),
    }];
    assert!(repo.save(MESSAGE, &old, &pending, None).await?);
    sqlx::query!(
        "UPDATE email_message_calendar_extraction SET parser_version = 0, notification_pending = false, retry_after = now() WHERE message_id = $1",
        MESSAGE
    )
    .execute(&pool)
    .await?;
    assert!(!repo.is_processed(MESSAGE).await?);
    let job = repo
        .claim()
        .await?
        .into_iter()
        .find(|j| j.message_id == MESSAGE)
        .unwrap();
    assert!(job.discover);
    assert!(!job.notification_only);
    assert!(job.parts.is_empty());
    // Incomplete reinspection keeps the last usable snapshot, so nothing changes.
    assert!(
        !repo
            .save(MESSAGE, &parsed, &pending, Some(job.generation))
            .await?
    );
    let loaded = saved(&pool, MESSAGE).await?;
    assert_eq!(loaded.len(), 2);
    assert!(
        loaded
            .iter()
            .all(|invite| invite.title.as_deref() == Some("Old parser output"))
    );
    assert_eq!(
        extraction(&pool, MESSAGE).await?,
        Some(("pending".into(), false))
    );
    assert!(!repo.is_processed(MESSAGE).await?);
    let absent = parse_invitation_parts(&[]);
    assert!(
        !repo
            .save(MESSAGE, &absent, &[], Some(job.generation))
            .await?
    );
    assert_eq!(saved(&pool, MESSAGE).await?.len(), 2);
    assert!(!repo.is_processed(MESSAGE).await?);
    make_due(&pool, MESSAGE).await?;
    let job = repo
        .claim()
        .await?
        .into_iter()
        .find(|j| j.message_id == MESSAGE)
        .unwrap();
    assert!(job.discover);
    assert!(
        repo.save(MESSAGE, &parsed, &[], Some(job.generation))
            .await?
    );
    let loaded = saved(&pool, MESSAGE).await?;
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].title.as_deref(), Some("Correct title"));
    assert_eq!(
        extraction(&pool, MESSAGE).await?,
        Some(("ready".into(), true))
    );

    parsed.invitations[0].id = "attachment-component".into();
    assert!(
        repo.save(MESSAGE, &parsed, &[], Some(job.generation))
            .await?
    );
    assert_eq!(saved(&pool, MESSAGE).await?.len(), 2);

    // An older worker cannot downgrade snapshots produced by a newer deployment.
    sqlx::query!(
        "UPDATE email_message_calendar_extraction SET parser_version = $2, retry_after = now() WHERE message_id = $1",
        MESSAGE,
        crate::domain::models::calendar_invitation::INVITATION_PARSER_VERSION as i16 + 1
    )
    .execute(&pool)
    .await?;
    assert!(repo.is_processed(MESSAGE).await?);
    assert!(!repo.save(MESSAGE, &old, &[], Some(job.generation)).await?);
    assert!(
        repo.claim()
            .await?
            .iter()
            .all(|job| job.message_id != MESSAGE)
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
    let parsed = parse_invitation_parts(&[include_bytes!("../../../fixtures/calendar/google.ics")]);
    assert!(repo.save(MESSAGE, &parsed, &[], None).await?);
    sqlx::query!(
        "UPDATE email_message_calendar_extraction SET parser_version = 0, retry_after = now() WHERE message_id = $1",
        MESSAGE
    )
    .execute(&pool)
    .await?;
    let job = repo
        .claim()
        .await?
        .into_iter()
        .find(|j| j.message_id == MESSAGE)
        .unwrap();
    assert!(job.notification_only);
    assert!(!job.discover);
    repo.notified(MESSAGE, job.generation).await?;
    assert_eq!(saved(&pool, MESSAGE).await?, parsed.invitations);
    Ok(())
}

#[cfg(feature = "calendar_resolution")]
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_thread"))
)]
async fn thread_invitations_are_newest_first_and_bounded(pool: PgPool) -> Result<(), Report> {
    use crate::domain::invitation_resolution::InvitationSnapshotRepository;
    let repo = InvitationPgRepository(pool.clone());
    let thread = uuid::uuid!("11111111-1111-1111-1111-111111111111");
    let newest = uuid::uuid!("11111111-aaaa-0003-aaaa-111111111111");
    repo.save(MESSAGE, &request("oldest"), &[], None).await?;
    repo.save(newest, &request("newest"), &[], None).await?;
    let all = repo.thread_invitations(thread, 100).await?;
    assert_eq!(
        all.iter()
            .map(|saved| (saved.message_id, saved.invitation.uid.as_str()))
            .collect::<Vec<_>>(),
        [(newest, "newest"), (MESSAGE, "oldest")]
    );
    let bounded = repo.thread_invitations(thread, 1).await?;
    assert_eq!(bounded.len(), 1);
    assert_eq!(bounded[0].message_id, newest);
    Ok(())
}
