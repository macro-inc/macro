use super::*;
use crate::domain::{
    calendar_invitation_parser::parse_invitation_parts,
    invitation_extraction::InvitationExtractionRepository,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const MESSAGE: Uuid = uuid::uuid!("11111111-aaaa-0001-aaaa-111111111111");
const THREAD: Uuid = uuid::uuid!("11111111-1111-1111-1111-111111111111");

fn request(uid: &str) -> Vec<CalendarInvitation> {
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

async fn thread_flagged(pool: &PgPool) -> Result<bool, Report> {
    Ok(sqlx::query_scalar!(
        "SELECT has_calendar_attachment FROM email_threads WHERE id = $1",
        THREAD
    )
    .fetch_one(pool)
    .await?)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_thread"))
)]
async fn saving_is_idempotent_and_flags_the_thread(pool: PgPool) -> Result<(), Report> {
    let repo = InvitationPgRepository(pool.clone());
    repo.save(MESSAGE, &[]).await?;
    assert!(!thread_flagged(&pool).await?);
    let parsed = request("example");
    repo.save(MESSAGE, &parsed).await?;
    repo.save(MESSAGE, &parsed).await?;
    assert_eq!(saved(&pool, MESSAGE).await?, parsed);
    assert!(thread_flagged(&pool).await?);
    // Distinct components, such as an attached revision, are kept side by side.
    repo.save(MESSAGE, &request("attached")).await?;
    assert_eq!(saved(&pool, MESSAGE).await?.len(), 2);
    sqlx::query!("DELETE FROM email_messages WHERE id = $1", MESSAGE)
        .execute(&pool)
        .await?;
    assert!(load(&pool, &[MESSAGE]).await?.is_empty());
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
    repo.save(MESSAGE, &request("oldest")).await?;
    repo.save(newest, &request("newest")).await?;
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
