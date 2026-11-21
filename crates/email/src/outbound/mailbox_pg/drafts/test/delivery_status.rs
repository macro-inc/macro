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
async fn definite_pre_data_refusal_reports_failed_and_is_not_claimed_again(db: PgPool) {
    let (sync, repo, lease, link) = submitted_send(&db).await;
    let attempt = pending_attempt(&repo, link).await.attempt_id;
    sync.fail_draft(&lease, DraftFailure::SendRejected)
        .await
        .unwrap();
    assert_eq!(
        repo.read_send_attempt(&actor(), link, attempt, None)
            .await
            .unwrap()
            .unwrap()
            .status,
        SendAttemptStatus::Failed,
    );
    assert!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deliberate_retry_does_not_project_the_previous_send_rejection_reason(db: PgPool) {
    use crate::domain::models::mailbox_operation::*;

    let (sync, repo, lease, _) = submitted_send(&db).await;
    let mut checkpoint = checkpoint(&lease, DraftStage::Submitting);
    checkpoint.send_rejection_reason = Some(SendRejectionReason::ConnectionUnavailable);
    sync.checkpoint_draft(&lease, &checkpoint).await.unwrap();
    sync.fail_draft(&lease, DraftFailure::SendRejected)
        .await
        .unwrap();
    let facts = repo
        .message_operation_facts(&[lease.message_id])
        .await
        .unwrap()
        .remove(&lease.message_id)
        .unwrap();
    assert_eq!(
        MessageOperationStatus::from(facts.clone()).send_rejection_reason,
        Some(SendRejectionReason::ConnectionUnavailable)
    );
    let retry = plan_resolution(
        facts.clone(),
        MessageResolutionRequest {
            message_id: lease.message_id,
            revision: facts.revision,
            remote_version: facts.remote_version,
            action: MessageResolutionAction::RetrySend,
            accept_duplicate_risk: false,
        },
    )
    .unwrap();
    repo.commit_message_resolution(&actor(), retry)
        .await
        .unwrap();
    let status = MessageOperationStatus::from(
        repo.message_operation_facts(&[lease.message_id])
            .await
            .unwrap()
            .remove(&lease.message_id)
            .unwrap(),
    );
    assert_eq!(status.state, MessageOperationState::Pending);
    assert_eq!(status.issue, None);
    assert_eq!(status.send_rejection_reason, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn confirmed_delivery_reports_sent_and_is_not_claimed_again(db: PgPool) {
    let (sync, repo, lease, link) = submitted_send(&db).await;
    let attempt = pending_attempt(&repo, link).await.attempt_id;
    let mut cp = checkpoint(&lease, DraftStage::Confirming);
    cp.draft.as_mut().unwrap().is_draft = false;
    sync.confirm_sent(&lease, &cp).await.unwrap();
    assert_eq!(
        repo.read_send_attempt(&actor(), link, attempt, None)
            .await
            .unwrap()
            .unwrap()
            .status,
        SendAttemptStatus::Sent,
    );
    assert!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .is_none()
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cancelling_rejected_schedule_restores_draft_and_fences_retry(db: PgPool) {
    use crate::domain::{
        models::mailbox_operation::*,
        scheduled::{EmailSchedulingRepo, ScheduleChange},
    };
    let (sync, repo, input, link) = setup(&db, true).await;
    sqlx::query!("INSERT INTO email_scheduled_messages (link_id,message_id,send_time,actor_id) VALUES ($1,$2,now() - interval '1 second',$3)",link,input.db_id,ACTOR).execute(&db).await.unwrap();
    let lease = claim(&sync).await;
    let cp = checkpoint(&lease, DraftStage::Submitting);
    assert!(matches!(
        sync.start_delivery(&lease, &cp).await.unwrap(),
        DeliveryStart::Started
    ));
    let actor = actor();
    assert!(matches!(
        repo.change_schedule(link, input.db_id, &actor, ScheduleChange::Cancel, None, 0)
            .await,
        Err(crate::domain::models::EmailErr::MessageDeliveryConflict(_))
    ));
    sync.fail_draft(&lease, DraftFailure::SendRejected)
        .await
        .unwrap();
    let facts = repo
        .message_operation_facts(&[input.db_id])
        .await
        .unwrap()
        .remove(&input.db_id)
        .unwrap();
    let retry = plan_resolution(
        facts.clone(),
        MessageResolutionRequest {
            message_id: input.db_id,
            revision: facts.revision,
            remote_version: facts.remote_version.clone(),
            action: MessageResolutionAction::RetrySend,
            accept_duplicate_risk: false,
        },
    )
    .unwrap();

    repo.change_schedule(link, input.db_id, &actor, ScheduleChange::Cancel, None, 0)
        .await
        .unwrap();
    assert!(matches!(
        repo.commit_message_resolution(&actor, retry).await,
        Err(crate::domain::models::EmailErr::MessageDeliveryConflict(_))
    ));
    let facts = repo
        .message_operation_facts(&[input.db_id])
        .await
        .unwrap()
        .remove(&input.db_id)
        .unwrap();
    let status = MessageOperationStatus::from(facts);
    assert_eq!(status.state, MessageOperationState::Pending);
    assert_eq!(status.issue, None);
    let resumed = claim(&sync).await;
    let cp = resumed.checkpoint.as_ref().unwrap();
    assert_eq!(cp.stage, DraftStage::Ready);
    assert!(!cp.submission_started);
    assert!(matches!(
        sync.start_delivery(&resumed, cp).await.unwrap(),
        DeliveryStart::NotDue
    ));
}
