use super::*;
use crate::domain::send_attempt::{EmailSendRepo, SendAttempt, SendAttemptStatus};
use macro_user_id::user_id::MacroUserIdStr;

async fn claim(sync: &PgMailboxSync) -> DraftLease {
    sync.claim_draft(
        Uuid::now_v7(),
        crate::domain::mailbox::drafts::models::DraftClaimMode::All,
    )
    .await
    .unwrap()
    .unwrap()
}

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(ACTOR).unwrap()
}

async fn submitted_send(db: &PgPool) -> (PgMailboxSync, EmailPgRepo, DraftLease, Uuid) {
    let (sync, repo, input, link) = setup(db, true).await;
    sqlx::query!("INSERT INTO email_scheduled_messages (link_id,message_id,send_time,actor_id,processing) VALUES ($1,$2,now(),$3,true)",link,input.db_id,ACTOR).execute(db).await.unwrap();
    sqlx::query!("INSERT INTO email_send_attempts (user_id,link_id,attempt_id,message_id,thread_id,send_time) VALUES ($1,$2,$3,$4,$5,now())",ACTOR,link,Uuid::now_v7(),input.db_id,input.thread_db_id).execute(db).await.unwrap();
    let lease = claim(&sync).await;
    sync.checkpoint_draft(&lease, &checkpoint(&lease, DraftStage::Confirming))
        .await
        .unwrap();
    (sync, repo, lease, link)
}

async fn pending_attempt(repo: &EmailPgRepo, link: Uuid) -> SendAttempt {
    let mut attempts = repo
        .pending_send_attempts(&actor(), &[link], None)
        .await
        .unwrap();
    assert_eq!(attempts.len(), 1);
    attempts.remove(0).1
}

async fn pending_status(repo: &EmailPgRepo, link: Uuid) -> SendAttemptStatus {
    pending_attempt(repo, link).await.status
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn routine_outlook_confirmation_reads_as_sending_until_delivery_is_unknown(db: PgPool) {
    let (sync, repo, lease, link) = submitted_send(&db).await;
    assert_eq!(
        pending_status(&repo, link).await,
        SendAttemptStatus::Sending
    );
    sync.release_draft(&lease, 0).await.unwrap();
    assert_eq!(
        pending_status(&repo, link).await,
        SendAttemptStatus::Sending,
        "waiting between confirmation polls is still sending"
    );
    let lease = claim(&sync).await;
    sync.fail_draft(&lease, DraftFailure::SendUnknown)
        .await
        .unwrap();
    assert_eq!(
        pending_status(&repo, link).await,
        SendAttemptStatus::DeliveryUnconfirmed
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cancelling_while_outlook_confirms_is_too_late(db: PgPool) {
    let (_, repo, lease, link) = submitted_send(&db).await;
    let attempt = pending_attempt(&repo, link).await.attempt_id;
    let cancelled = repo.cancel_send(&actor(), link, attempt).await.unwrap();
    assert_eq!(cancelled.status, SendAttemptStatus::Sending);
    let processing = sqlx::query_scalar!(
        "SELECT processing FROM email_scheduled_messages WHERE message_id = $1",
        lease.message_id
    )
    .fetch_optional(&db)
    .await
    .unwrap();
    assert_eq!(processing, Some(true), "the submitted delivery is kept");
    assert_eq!(
        pending_status(&repo, link).await,
        SendAttemptStatus::Sending,
        "the attempt is still pending, not cancelled"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn losing_access_after_submission_reads_as_unconfirmed_not_failed(db: PgPool) {
    let (sync, repo, lease, link) = submitted_send(&db).await;
    sync.fail_draft(&lease, DraftFailure::Denied).await.unwrap();
    assert_eq!(
        pending_status(&repo, link).await,
        SendAttemptStatus::DeliveryUnconfirmed,
        "the provider may already have sent it, so a resend risks a duplicate"
    );
}
