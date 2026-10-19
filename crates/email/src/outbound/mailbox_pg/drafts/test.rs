use super::*;
use crate::{
    domain::{
        models::{ResolvedDraftInput, UpsertedContacts},
        ports::EmailRepo,
    },
    outbound::{
        EmailPgRepo,
        mailbox_pg::test::{fixture, page, snapshot},
    },
};
use email_api_client::domain::models::{MailboxState, SendRequest};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const ACTOR: &str = "macro|outlook-test@example.com";

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sent_sync_settles_uncertainty_and_fences_a_late_coordinator(db: PgPool) {
    let (sync, _, input, link) = setup(&db, true).await;
    sqlx::query!("INSERT INTO email_scheduled_messages (link_id,message_id,send_time,actor_id,processing) VALUES ($1,$2,now(),$3,true)",link,input.db_id,ACTOR).execute(&db).await.unwrap();
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    let mut cp = checkpoint(&lease, DraftStage::Confirming);
    sync.checkpoint_draft(&lease, &cp).await.unwrap();
    sync.fail_draft(&lease, DraftFailure::SendUnknown)
        .await
        .unwrap();
    let stream = sync.claim_stream(Uuid::now_v7()).await.unwrap().unwrap();
    sync.commit_page(&stream, &page()).await.unwrap();
    let work = sync.claim_message(Uuid::now_v7()).await.unwrap().unwrap();
    let mut remote = snapshot(link, "a", MailboxState::default(), "v3");
    remote.content.message.is_sent = true;
    sync.ingest(&work, remote.clone()).await.unwrap();
    sync.ingest(&work, remote).await.unwrap();
    let row = sqlx::query!("SELECT d.state,d.error_code,s.sent,s.processing FROM email_mailbox_drafts d JOIN email_scheduled_messages s ON s.message_id = d.message_id WHERE d.message_id = $1",input.db_id).fetch_one(&db).await.unwrap();
    assert_eq!(row.state, "sent");
    assert!(row.error_code.is_none());
    assert!(row.sent);
    assert!(!row.processing);
    cp.draft.as_mut().unwrap().is_draft = false;
    assert!(matches!(
        sync.confirm_sent(&lease, &cp).await,
        Err(MailboxError::Stale)
    ));
    let events = sqlx::query!("SELECT payload FROM email_projection_outbox WHERE link_id = $1 AND payload->>'was_draft' = 'true'",link).fetch_all(&db).await.unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].payload["actor"], ACTOR);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sending_in_outlook_is_not_attributed_to_the_last_macro_editor(db: PgPool) {
    let (sync, _, input, link) = setup(&db, true).await;
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    let cp = checkpoint(&lease, DraftStage::Ready);
    sync.settle_draft(&lease, &cp).await.unwrap();
    let work = sync.claim_message(Uuid::now_v7()).await.unwrap().unwrap();
    let mut remote = snapshot(link, "a", MailboxState::default(), "v3");
    remote.content.message.is_sent = true;
    sync.ingest(&work, remote).await.unwrap();
    let state = sqlx::query_scalar!(
        "SELECT state FROM email_mailbox_drafts WHERE message_id = $1",
        input.db_id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(state, "sent");
    let event = sqlx::query!("SELECT payload FROM email_projection_outbox WHERE link_id = $1 AND payload->>'was_draft' = 'true'",link).fetch_one(&db).await.unwrap();
    assert!(event.payload["actor"].is_null());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn explicit_retry_and_read_only_recheck_have_different_delivery_effects(db: PgPool) {
    use crate::domain::models::mailbox_operation::*;
    let (sync, repo, input, link) = setup(&db, true).await;
    sqlx::query!("INSERT INTO email_scheduled_messages (link_id,message_id,send_time,actor_id,processing) VALUES ($1,$2,now(),$3,true)",link,input.db_id,ACTOR).execute(&db).await.unwrap();
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    let cp = checkpoint(&lease, DraftStage::Confirming);
    sync.checkpoint_draft(&lease, &cp).await.unwrap();
    sync.fail_draft(&lease, DraftFailure::SendUnknown)
        .await
        .unwrap();
    let actor =
        macro_user_id::user_id::MacroUserIdStr::try_from_email("outlook-test@example.com").unwrap();
    let facts = repo
        .message_operation_facts(&[input.db_id])
        .await
        .unwrap()
        .remove(&input.db_id)
        .unwrap();
    let recheck = plan_resolution(
        facts.clone(),
        MessageResolutionRequest {
            message_id: input.db_id,
            revision: facts.revision,
            remote_version: facts.remote_version.clone(),
            action: MessageResolutionAction::Recheck,
            accept_duplicate_risk: false,
        },
    )
    .unwrap();
    repo.commit_message_resolution(&actor, recheck)
        .await
        .unwrap();
    let row=sqlx::query!("SELECT s.processing,d.checkpoint->>'stage' AS stage FROM email_mailbox_drafts d JOIN email_scheduled_messages s ON s.message_id = d.message_id WHERE d.message_id = $1",input.db_id).fetch_one(&db).await.unwrap();
    assert!(row.processing);
    assert_eq!(row.stage.as_deref(), Some("confirming"));
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    sync.fail_draft(&lease, DraftFailure::SendUnknown)
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
            accept_duplicate_risk: true,
        },
    )
    .unwrap();
    repo.commit_message_resolution(&actor, retry).await.unwrap();
    let row=sqlx::query!("SELECT s.processing,d.checkpoint->>'stage' AS stage FROM email_mailbox_drafts d JOIN email_scheduled_messages s ON s.message_id = d.message_id WHERE d.message_id = $1",input.db_id).fetch_one(&db).await.unwrap();
    assert!(!row.processing);
    assert_eq!(row.stage.as_deref(), Some("ready"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn conflict_resolution_rechecks_version_at_commit_and_requires_a_fresh_send(db: PgPool) {
    use crate::domain::models::mailbox_operation::*;
    let (sync, repo, input, link) = setup(&db, true).await;
    sqlx::query!("INSERT INTO email_scheduled_messages (link_id,message_id,send_time,actor_id) VALUES ($1,$2,now(),$3)",link,input.db_id,ACTOR).execute(&db).await.unwrap();
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    sync.fail_draft(&lease, DraftFailure::Conflict)
        .await
        .unwrap();
    let actor =
        macro_user_id::user_id::MacroUserIdStr::try_from_email("outlook-test@example.com").unwrap();
    let facts = repo
        .message_operation_facts(&[input.db_id])
        .await
        .unwrap()
        .remove(&input.db_id)
        .unwrap();
    let plan = plan_resolution(
        facts.clone(),
        MessageResolutionRequest {
            message_id: input.db_id,
            revision: facts.revision,
            remote_version: facts.remote_version.clone(),
            action: MessageResolutionAction::UseProvider,
            accept_duplicate_risk: false,
        },
    )
    .unwrap();
    sqlx::query!(
        "UPDATE email_messages SET provider_version = 'newer-remote-version' WHERE id = $1",
        input.db_id
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.commit_message_resolution(&actor, plan).await,
        Err(crate::domain::models::EmailErr::MessageDeliveryConflict(_))
    ));
    let facts = repo
        .message_operation_facts(&[input.db_id])
        .await
        .unwrap()
        .remove(&input.db_id)
        .unwrap();
    let plan = plan_resolution(
        facts.clone(),
        MessageResolutionRequest {
            message_id: input.db_id,
            revision: facts.revision,
            remote_version: facts.remote_version.clone(),
            action: MessageResolutionAction::UseProvider,
            accept_duplicate_risk: false,
        },
    )
    .unwrap();
    repo.commit_message_resolution(&actor, plan).await.unwrap();
    let schedule = sqlx::query_scalar!(
        "SELECT count(*) FROM email_scheduled_messages WHERE message_id = $1",
        input.db_id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(schedule, Some(0));
    let facts = repo
        .message_operation_facts(&[input.db_id])
        .await
        .unwrap()
        .remove(&input.db_id)
        .unwrap();
    assert_eq!(
        MessageOperationStatus::from(facts).state,
        MessageOperationState::Pending
    );
    let work = sync.claim_message(Uuid::now_v7()).await.unwrap().unwrap();
    let mut remote = snapshot(
        link,
        "a",
        MailboxState {
            is_draft: true,
            ..Default::default()
        },
        "newer-remote-version",
    );
    remote.content.message.is_draft = true;
    remote.content.message.body_text = Some("Provider's chosen revision".into());
    sync.ingest(&work, remote).await.unwrap();
    let body = sqlx::query_scalar!(
        "SELECT body_text FROM email_messages WHERE id = $1",
        input.db_id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(body.as_deref(), Some("Provider's chosen revision"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_save_keeps_the_acknowledged_version_before_sync_catches_up(db: PgPool) {
    let (sync, repo, mut input, link) = setup(&db, true).await;
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    let cp = checkpoint(&lease, DraftStage::Ready);
    sync.settle_draft(&lease, &cp).await.unwrap();
    input.body_text = Some("Next revision".into());
    repo.insert_message(
        &input,
        &UpsertedContacts {
            from_contact_id: None,
            recipients: Vec::new(),
        },
        link,
        None,
        true,
    )
    .await
    .unwrap()
    .unwrap();
    let row=sqlx::query!("SELECT m.provider_version,d.base_version FROM email_messages m JOIN email_mailbox_drafts d ON d.message_id = m.id WHERE m.id = $1",input.db_id).fetch_one(&db).await.unwrap();
    assert_eq!(row.provider_version.as_deref(), Some("v1"));
    assert_eq!(row.base_version.as_deref(), Some("v2"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn confirmed_sent_copy_uses_provider_content_and_retains_local_recovery_data(db: PgPool) {
    let (sync, _, input, link) = setup(&db, true).await;
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    let mut cp = checkpoint(&lease, DraftStage::Confirming);
    cp.draft.as_mut().unwrap().is_draft = false;
    sync.confirm_sent(&lease, &cp).await.unwrap();
    let work = sync.claim_message(Uuid::now_v7()).await.unwrap().unwrap();
    let mut remote = snapshot(link, "a", MailboxState::default(), "v2");
    remote.content.message.is_sent = true;
    remote.content.message.body_text = Some("Actually sent from Outlook".into());
    sync.ingest(&work, remote).await.unwrap();
    let row=sqlx::query!("SELECT m.body_text,d.desired_content,d.state FROM email_messages m JOIN email_mailbox_drafts d ON d.message_id = m.id WHERE m.id = $1",input.db_id).fetch_one(&db).await.unwrap();
    assert_eq!(row.body_text.as_deref(), Some("Actually sent from Outlook"));
    assert_eq!(row.desired_content["body_text"], "Local body");
    assert_eq!(row.state, "sent");
}

async fn setup(
    db: &PgPool,
    imported: bool,
) -> (PgMailboxSync, EmailPgRepo, ResolvedDraftInput, Uuid) {
    let (sync, link) = fixture(db).await;
    let thread = Uuid::now_v7();
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_threads (id,link_id) VALUES ($1,$2)",
        thread,
        link
    )
    .execute(db)
    .await
    .unwrap();
    if imported {
        sqlx::query!("INSERT INTO email_messages (id,link_id,thread_id,provider_id,provider_thread_id,provider_version,is_draft,body_text) VALUES ($1,$2,$3,'a','conversation','v1',true,'Original')",id,link,thread).execute(db).await.unwrap();
    }
    let input:ResolvedDraftInput=serde_json::from_value(serde_json::json!({"db_id":id,"thread_db_id":thread,"subject":"Local subject","body_text":"Local body","body_macro":"Local editor document","to":[],"cc":[],"bcc":[],"actor_id":ACTOR})).unwrap();
    let repo = EmailPgRepo::new(db.clone());
    repo.insert_message(
        &input,
        &UpsertedContacts {
            from_contact_id: None,
            recipients: Vec::new(),
        },
        link,
        None,
        true,
    )
    .await
    .unwrap()
    .unwrap();
    (sync, repo, input, link)
}

fn checkpoint(lease: &DraftLease, stage: DraftStage) -> DraftCheckpoint {
    DraftCheckpoint {
        revision:lease.revision,actor_id:lease.actor_id.clone(),stage,stage_started_at:chrono::Utc::now(),
        prepared:PreparedDraft {reply_to:None,request:SendRequest {
            message:serde_json::from_value(serde_json::json!({"db_id":lease.message_id,"link_id":lease.mailbox.link_id,"subject":"Local subject"})).unwrap(),
            from:models_email::service::address::ContactInfo {email:"outlook-test@example.com".into(),name:None,photo_url:None},parent_message_id:None,references:None,
        },files:Vec::new(),removals:Vec::new()},
        draft:Some(ProviderDraft {id:ProviderId::new("a").unwrap(),conversation_id:ProviderId::new("conversation").unwrap(),version:Some("v2".into()),is_draft:true,content_fingerprint:Some("unchanged-body".into()),app_revision:Some(lease.revision as u64)}),
        submission_started:matches!(stage,DraftStage::Submitting | DraftStage::Confirming),
        completed_files:0,completed_removals:0,transfer:None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn saving_an_imported_draft_keeps_its_provider_identity_and_baseline(db: PgPool) {
    let (_, _, input, _) = setup(&db, true).await;
    let row=sqlx::query!("SELECT m.provider_id,d.base_version,d.revision,d.desired_content FROM email_messages m JOIN email_mailbox_drafts d ON d.message_id = m.id WHERE m.id = $1",input.db_id).fetch_one(&db).await.unwrap();
    assert_eq!(row.provider_id.as_deref(), Some("a"));
    assert_eq!(row.base_version.as_deref(), Some("v1"));
    assert_eq!(row.revision, 1);
    assert_eq!(row.desired_content["body_text"], "Local body");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn remote_ingestion_preserves_an_unsynced_local_edit_and_records_remote_content(db: PgPool) {
    let (sync, _, input, link) = setup(&db, true).await;
    let stream = sync.claim_stream(Uuid::now_v7()).await.unwrap().unwrap();
    sync.commit_page(&stream, &page()).await.unwrap();
    let work = sync.claim_message(Uuid::now_v7()).await.unwrap().unwrap();
    assert_eq!(work.provider_id.as_str(), "a");
    let mut remote = snapshot(
        link,
        "a",
        MailboxState {
            is_draft: true,
            ..Default::default()
        },
        "v2",
    );
    remote.content.message.is_draft = true;
    remote.content.message.body_text = Some("Outlook edit".into());
    sync.ingest(&work, remote).await.unwrap();
    let row=sqlx::query!("SELECT m.body_text,m.body_macro,m.provider_version,d.base_version,d.remote_snapshot FROM email_messages m JOIN email_mailbox_drafts d ON d.message_id = m.id WHERE m.id = $1",input.db_id).fetch_one(&db).await.unwrap();
    assert_eq!(row.body_text.as_deref(), Some("Local body"));
    assert_eq!(row.body_macro.as_deref(), Some("Local editor document"));
    assert_eq!(row.provider_version.as_deref(), Some("v2"));
    assert_eq!(row.base_version.as_deref(), Some("v1"));
    assert_eq!(row.remote_snapshot.unwrap()["body_text"], "Outlook edit");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn acknowledgement_of_an_older_revision_leaves_a_newer_save_pending(db: PgPool) {
    let (sync, repo, mut input, link) = setup(&db, true).await;
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    let cp = checkpoint(&lease, DraftStage::Ready);
    sync.checkpoint_draft(&lease, &cp).await.unwrap();
    input.body_text = Some("Newer local edit".into());
    repo.insert_message(
        &input,
        &UpsertedContacts {
            from_contact_id: None,
            recipients: Vec::new(),
        },
        link,
        None,
        true,
    )
    .await
    .unwrap()
    .unwrap();
    sync.settle_draft(&lease, &cp).await.unwrap();
    let row=sqlx::query!("SELECT revision,synced_revision,state,checkpoint,desired_content FROM email_mailbox_drafts WHERE message_id = $1",input.db_id).fetch_one(&db).await.unwrap();
    assert_eq!(row.revision, 2);
    assert_eq!(row.synced_revision, 1);
    assert_eq!(row.state, "pending");
    assert!(row.checkpoint.is_none());
    assert_eq!(row.desired_content["body_text"], "Newer local edit");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn send_marker_and_schedule_claim_commit_together_and_survive_worker_reclaim(db: PgPool) {
    let (sync, _, input, link) = setup(&db, true).await;
    sqlx::query!("INSERT INTO email_scheduled_messages (link_id,message_id,send_time,actor_id) VALUES ($1,$2,now() - interval '1 second',$3)",link,input.db_id,ACTOR).execute(&db).await.unwrap();
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    let cp = checkpoint(&lease, DraftStage::Submitting);
    assert!(matches!(
        sync.start_delivery(&lease, &cp).await.unwrap(),
        DeliveryStart::Started
    ));
    let processing = sqlx::query_scalar!(
        "SELECT processing FROM email_scheduled_messages WHERE message_id = $1",
        input.db_id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(processing);
    sqlx::query!("UPDATE email_mailbox_drafts SET lease_until = now() - interval '1 second' WHERE message_id = $1",input.db_id).execute(&db).await.unwrap();
    let recovered = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        recovered.checkpoint.as_ref().unwrap().stage,
        DraftStage::Submitting
    );
    assert!(matches!(
        sync.checkpoint_draft(&lease, &cp).await,
        Err(MailboxError::Stale)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cancellation_that_wins_before_submission_prevents_delivery(db: PgPool) {
    let (sync, _, input, link) = setup(&db, true).await;
    sqlx::query!("INSERT INTO email_scheduled_messages (link_id,message_id,send_time,actor_id) VALUES ($1,$2,now() - interval '1 second',$3)",link,input.db_id,ACTOR).execute(&db).await.unwrap();
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    let cp = checkpoint(&lease, DraftStage::Submitting);
    sqlx::query!(
        "DELETE FROM email_scheduled_messages WHERE message_id = $1",
        input.db_id
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        sync.start_delivery(&lease, &cp).await.unwrap(),
        DeliveryStart::NotDue
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deletion_retains_a_fenced_remote_cleanup_intent(db: PgPool) {
    let (sync, repo, input, link) = setup(&db, true).await;
    assert!(
        repo.delete_draft_message(input.db_id, input.thread_db_id, &[link], Some(ACTOR))
            .await
            .unwrap()
            .is_some()
    );
    let row=sqlx::query!("SELECT d.delete_requested,m.provider_id,f.is_present FROM email_mailbox_drafts d JOIN email_messages m ON m.id = d.message_id JOIN email_message_mailbox_facts f ON f.id = m.id WHERE m.id = $1",input.db_id).fetch_one(&db).await.unwrap();
    assert!(row.delete_requested);
    assert_eq!(row.provider_id.as_deref(), Some("a"));
    assert_eq!(row.is_present, Some(false));
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    sqlx::query!(
        "UPDATE email_links SET sync_generation = sync_generation + 1 WHERE id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        sync.confirm_deleted(&lease).await,
        Err(MailboxError::Stale)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sync_before_creation_response_binds_the_existing_macro_message(db: PgPool) {
    let (sync, _, input, link) = setup(&db, false).await;
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    let mut cp = checkpoint(&lease, DraftStage::Creating);
    cp.draft = None;
    sync.checkpoint_draft(&lease, &cp).await.unwrap();
    let stream = sync.claim_stream(Uuid::now_v7()).await.unwrap().unwrap();
    sync.commit_page(&stream, &page()).await.unwrap();
    let work = sync.claim_message(Uuid::now_v7()).await.unwrap().unwrap();
    let mut remote = snapshot(
        link,
        "a",
        MailboxState {
            is_draft: true,
            ..Default::default()
        },
        "v1",
    );
    remote.content.message.is_draft = true;
    remote.draft_correlation = Some(input.db_id);
    sync.ingest(&work, remote).await.unwrap();
    let messages = sqlx::query!(
        "SELECT id,provider_id FROM email_messages WHERE link_id = $1",
        link
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].id, input.db_id);
    assert_eq!(messages[0].provider_id.as_deref(), Some("a"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn paused_writes_still_claim_uncertain_outcomes_without_claiming_new_drafts(db: PgPool) {
    let (sync, _, _, _) = setup(&db, true).await;
    assert!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::Reconciliation)
            .await
            .unwrap()
            .is_none()
    );
    let lease = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .unwrap();
    sync.checkpoint_draft(&lease, &checkpoint(&lease, DraftStage::Confirming))
        .await
        .unwrap();
    sync.release_draft(&lease, 0).await.unwrap();
    let reconciling = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::Reconciliation)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reconciling.message_id, lease.message_id);
    assert_eq!(
        reconciling.checkpoint.unwrap().stage,
        DraftStage::Confirming
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn draft_organization_waits_for_binding_and_rebases_queued_edits(db: PgPool) {
    use crate::domain::mailbox::commands::{CommandCompletion, MailboxCommandRepository};
    use crate::domain::models::mailbox_action::MailboxAction;
    let (sync, repo, input, link) = setup(&db, false).await;
    let messages = repo
        .mailbox_action_messages(link, input.thread_db_id)
        .await
        .unwrap();
    let actor = macro_user_id::user_id::MacroUserIdStr::try_from(ACTOR.to_owned()).unwrap();
    let first = repo
        .enqueue_mailbox_action(
            link,
            actor.clone(),
            &MailboxAction::Flagged(true),
            &MailboxAction::Flagged(true).targets(&messages),
        )
        .await
        .unwrap();
    let command = sync.claim_command(Uuid::now_v7()).await.unwrap().unwrap();
    assert_eq!(command.id, first);
    let target = sync
        .command_context(&command)
        .await
        .unwrap()
        .target
        .unwrap();
    assert!(target.awaiting_draft);
    assert!(target.provider_id.is_none());
    assert!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .is_none()
    );
    sync.defer_for_draft(&command).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT attempts FROM email_mailbox_commands WHERE id=$1",
            first
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        0
    );
    let draft = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .unwrap();
    let cp = checkpoint(&draft, DraftStage::Ready);
    sync.settle_draft(&draft, &cp).await.unwrap();
    // This accepted opposite action still holds the earlier null-ID snapshot.
    let second = repo
        .enqueue_mailbox_action(
            link,
            actor,
            &MailboxAction::Flagged(false),
            &MailboxAction::Flagged(false).targets(&messages),
        )
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE email_mailbox_commands SET available_at=now() WHERE id=$1",
        first
    )
    .execute(&db)
    .await
    .unwrap();
    let command = sync.claim_command(Uuid::now_v7()).await.unwrap().unwrap();
    assert_eq!(command.id, first);
    let target = sync
        .command_context(&command)
        .await
        .unwrap()
        .target
        .unwrap();
    assert!(!target.awaiting_draft);
    assert!(!target.retired);
    assert_eq!(target.provider_id.as_ref().unwrap().as_str(), "a");
    sync.record_write_version(&command, &target, "v2", "v3")
        .await
        .unwrap();
    let retained=sqlx::query!("SELECT base_version,checkpoint->'draft'->>'version' AS checkpoint_version FROM email_mailbox_drafts WHERE message_id=$1",input.db_id).fetch_one(&db).await.unwrap();
    assert_eq!(retained.base_version.as_deref(), Some("v3"));
    assert_eq!(retained.checkpoint_version.as_deref(), Some("v3"));
    // A local content edit accepted during organization keeps the verified
    // provider baseline, even before the ordinary mailbox read catches up.
    let mut edited = input.clone();
    edited.subject = "Edited while starring".into();
    repo.insert_message(
        &edited,
        &UpsertedContacts {
            from_contact_id: None,
            recipients: vec![],
        },
        link,
        None,
        true,
    )
    .await
    .unwrap();
    sync.record_write_version(&command, &target, "v3", "v4")
        .await
        .unwrap();
    assert!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .is_none()
    );
    let retained=sqlx::query!("SELECT base_version,desired_content->>'subject' AS subject FROM email_mailbox_drafts WHERE message_id=$1",input.db_id).fetch_one(&db).await.unwrap();
    assert_eq!(retained.base_version.as_deref(), Some("v4"));
    assert_eq!(retained.subject.as_deref(), Some("Edited while starring"));
    let snapshot = email_api_client::domain::models::MailboxOrganization {
        is_sent: false,
        state: MailboxState {
            is_flagged: true,
            ..Default::default()
        },
        folder_id: None,
        tags: vec![],
        version: Some("v4".into()),
    };
    sync.confirm_target(&command, &target, Some(&snapshot))
        .await
        .unwrap();
    sync.finish_command(&command, CommandCompletion::Succeeded)
        .await
        .unwrap();
    assert!(
        !sqlx::query_scalar!(
            "SELECT is_starred FROM email_messages WHERE id=$1",
            input.db_id
        )
        .fetch_one(&db)
        .await
        .unwrap()
    );
    let command = sync.claim_command(Uuid::now_v7()).await.unwrap().unwrap();
    assert_eq!(command.id, second);
    let target = sync
        .command_context(&command)
        .await
        .unwrap()
        .target
        .unwrap();
    assert_eq!(target.provider_id.as_ref().unwrap().as_str(), "a");
    sync.record_write_version(&command, &target, "unrelated-version", "unsafe")
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT base_version FROM email_mailbox_drafts WHERE message_id=$1",
            input.db_id
        )
        .fetch_one(&db)
        .await
        .unwrap()
        .as_deref(),
        Some("v4")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn queued_local_draft_command_cannot_resurrect_a_discarded_draft(db: PgPool) {
    use crate::domain::mailbox::commands::MailboxCommandRepository;
    use crate::domain::models::mailbox_action::MailboxAction;
    let (sync, repo, input, link) = setup(&db, false).await;
    let messages = repo
        .mailbox_action_messages(link, input.thread_db_id)
        .await
        .unwrap();
    let actor = macro_user_id::user_id::MacroUserIdStr::try_from(ACTOR.to_owned()).unwrap();
    repo.enqueue_mailbox_action(
        link,
        actor,
        &MailboxAction::Flagged(true),
        &MailboxAction::Flagged(true).targets(&messages),
    )
    .await
    .unwrap();
    let command = sync.claim_command(Uuid::now_v7()).await.unwrap().unwrap();
    let stale = sync
        .command_context(&command)
        .await
        .unwrap()
        .target
        .unwrap();
    sqlx::query!(
        "UPDATE email_mailbox_drafts SET delete_requested=true,state='deleted' WHERE message_id=$1",
        input.db_id
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!("UPDATE email_messages SET mailbox_state=COALESCE(mailbox_state,'{}')||'{\"provider_missing\":true}'::jsonb WHERE id=$1",input.db_id).execute(&db).await.unwrap();
    assert!(
        sync.command_context(&command)
            .await
            .unwrap()
            .target
            .unwrap()
            .retired
    );
    sync.confirm_target(&command, &stale, None).await.unwrap();
    let row=sqlx::query!("SELECT m.mailbox_state,t.status FROM email_messages m JOIN email_mailbox_command_targets t ON t.message_id=m.id WHERE m.id=$1",input.db_id).fetch_one(&db).await.unwrap();
    assert_eq!(row.mailbox_state.unwrap()["provider_missing"], true);
    assert_eq!(row.status, "failed");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn late_organization_confirmation_preserves_a_transferred_source_tombstone(db: PgPool) {
    use crate::domain::mailbox::commands::MailboxCommandRepository;
    use crate::domain::models::mailbox_action::MailboxAction;
    let (sync, repo, input, link) = setup(&db, false).await;
    let messages = repo
        .mailbox_action_messages(link, input.thread_db_id)
        .await
        .unwrap();
    let actor = macro_user_id::user_id::MacroUserIdStr::try_from(ACTOR.to_owned()).unwrap();
    repo.enqueue_mailbox_action(
        link,
        actor,
        &MailboxAction::Flagged(true),
        &MailboxAction::Flagged(true).targets(&messages),
    )
    .await
    .unwrap();
    let command = sync.claim_command(Uuid::now_v7()).await.unwrap().unwrap();
    let stale = sync
        .command_context(&command)
        .await
        .unwrap()
        .target
        .unwrap();
    sqlx::query!("INSERT INTO email_draft_transfers(id,actor_id,source_id,destination_id,source_link_id,destination_link_id,source_thread_id,destination_thread_id,plan,state) VALUES($1,$2,$3,$4,$5,$5,$6,$7,'{}','cleanup')",
        Uuid::now_v7(),ACTOR,input.db_id,Uuid::now_v7(),link,input.thread_db_id,Uuid::now_v7()).execute(&db).await.unwrap();
    assert!(
        sync.command_context(&command)
            .await
            .unwrap()
            .target
            .unwrap()
            .retired
    );
    sync.confirm_target(&command, &stale, None).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT status FROM email_mailbox_command_targets WHERE command_id=$1",
            command.id
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        "failed"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn native_draft_first_edit_adopts_proven_organization_versions_before_projection(db: PgPool) {
    use crate::domain::mailbox::commands::MailboxCommandRepository;
    use crate::domain::models::mailbox_action::MailboxAction;
    let (sync, repo, input, link) = setup(&db, true).await;
    sqlx::query!(
        "DELETE FROM email_mailbox_drafts WHERE message_id=$1",
        input.db_id
    )
    .execute(&db)
    .await
    .unwrap();
    let messages = repo
        .mailbox_action_messages(link, input.thread_db_id)
        .await
        .unwrap();
    let actor = macro_user_id::user_id::MacroUserIdStr::try_from(ACTOR.to_owned()).unwrap();
    repo.enqueue_mailbox_action(
        link,
        actor,
        &MailboxAction::Flagged(true),
        &MailboxAction::Flagged(true).targets(&messages),
    )
    .await
    .unwrap();
    let command = sync.claim_command(Uuid::now_v7()).await.unwrap().unwrap();
    let target = sync
        .command_context(&command)
        .await
        .unwrap()
        .target
        .unwrap();
    sync.record_write_version(&command, &target, "v1", "v2")
        .await
        .unwrap();
    sync.record_write_version(&command, &target, "v2", "v3")
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT provider_version FROM email_messages WHERE id=$1",
            input.db_id
        )
        .fetch_one(&db)
        .await
        .unwrap()
        .as_deref(),
        Some("v1")
    );
    let mut edited = input.clone();
    edited.subject = "First Macro edit".into();
    repo.insert_message(
        &edited,
        &UpsertedContacts {
            from_contact_id: None,
            recipients: vec![],
        },
        link,
        None,
        true,
    )
    .await
    .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT base_version FROM email_mailbox_drafts WHERE message_id=$1",
            input.db_id
        )
        .fetch_one(&db)
        .await
        .unwrap()
        .as_deref(),
        Some("v3")
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_draft_organization_versions WHERE message_id=$1",
            input.db_id
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(0)
    );
}
