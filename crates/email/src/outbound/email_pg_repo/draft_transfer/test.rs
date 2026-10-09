use super::*;
use crate::domain::{models::mailbox_operation::*, ports::EmailRepo};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

const ACTOR: &str = "macro|transfer@example.com";

async fn fixture(db: &PgPool) -> (EmailPgRepo, DraftTransferRequest) {
    let source = Uuid::now_v7();
    let target = Uuid::now_v7();
    let draft = Uuid::now_v7();
    let thread = Uuid::now_v7();
    for (id, address, provider) in [
        (source, "source@example.com", "OUTLOOK"),
        (target, "target@example.com", "GMAIL"),
    ] {
        sqlx::query!("INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider,is_sync_active) VALUES($1,$2,'transfer-owner',$3,$4::text::email_user_provider_enum,true)",id,ACTOR,address,provider).execute(db).await.unwrap();
    }
    sqlx::query!(
        "INSERT INTO email_threads(id,link_id) VALUES($1,$2)",
        thread,
        source
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO email_messages(id,thread_id,link_id,is_draft,subject,body_html_sanitized) VALUES($1,$2,$3,true,'Keep this subject','<p>Body</p>')",draft,thread,source).execute(db).await.unwrap();
    (
        EmailPgRepo::new(db.clone()),
        DraftTransferRequest {
            id: Uuid::now_v7(),
            source_id: draft,
            source_link_id: source,
            destination_link_id: target,
        },
    )
}
async fn prepare(repo: &EmailPgRepo, request: &DraftTransferRequest) -> DraftTransferPlan {
    match repo.begin_transfer(ACTOR, request).await.unwrap() {
        TransferPreparation::Pending(plan) => *plan,
        _ => panic!("expected uncommitted move"),
    }
}
fn contacts() -> UpsertedContacts {
    UpsertedContacts {
        from_contact_id: None,
        recipients: vec![],
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn transfer_preserves_uploads_and_fences_old_saves_deletes_and_delivery(db: PgPool) {
    let (repo, request) = fixture(&db).await;
    let upload = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_attachments_drafts(id,draft_id,file_name,content_type,sha,size,s3_key) VALUES($1,$2,'notes.txt','text/plain','sha',9,'shared-object')",upload,request.source_id).execute(&db).await.unwrap();
    let plan = prepare(&repo, &request).await;
    let concurrent = prepare(&repo, &request).await;
    assert_eq!(plan.input.db_id, concurrent.input.db_id);
    let moved = repo
        .commit_transfer(&plan, &contacts(), vec![])
        .await
        .unwrap();
    assert_ne!(moved.message_id, request.source_id);
    assert_ne!(moved.attachments[0].id, upload);
    assert_eq!(moved.attachments[0].s3_key, "shared-object");
    assert_eq!(
        moved.attachments[0].content_id,
        Some(format!("{upload}@attachments.macro.com"))
    );
    let TransferPreparation::Completed(replayed) =
        repo.begin_transfer(ACTOR, &request).await.unwrap()
    else {
        panic!("lost response must replay")
    };
    assert_eq!(moved.message_id, replayed.message_id);
    let mut tx = db.begin().await.unwrap();
    assert!(
        draft::require_completed_uploads(&mut tx, moved.message_id)
            .await
            .is_err()
    );
    tx.rollback().await.unwrap();
    let mut stale = plan.input.clone();
    stale.db_id = request.source_id;
    stale.thread_db_id = plan.source_thread_id;
    assert!(
        draft::insert_message(&db, &stale, &contacts(), request.source_link_id, None, true)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        message::delete_draft_message(
            &db,
            request.source_id,
            plan.source_thread_id,
            &[request.source_link_id],
            Some(ACTOR)
        )
        .await
        .unwrap()
        .is_none()
    );
    let lease = Uuid::now_v7();
    let claimed = repo.claim_transfer_cleanup(lease).await.unwrap().unwrap();
    repo.finish_transfer_cleanup(&claimed, lease, RetirementOutcome::Removed)
        .await
        .unwrap();
    let mut tx = db.begin().await.unwrap();
    draft::require_completed_uploads(&mut tx, moved.message_id)
        .await
        .unwrap();
    tx.rollback().await.unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_attachments_drafts WHERE s3_key='shared-object'"
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(1)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_materialization_cannot_commit_over_newer_edits_or_replanned_transfer(db: PgPool) {
    let (repo, request) = fixture(&db).await;
    let original = prepare(&repo, &request).await;
    sqlx::query!("UPDATE email_messages SET subject='Newer content',updated_at=now()+interval '1 second' WHERE id=$1",request.source_id).execute(&db).await.unwrap();
    assert!(
        repo.commit_transfer(&original, &contacts(), vec![])
            .await
            .is_err()
    );
    let current = prepare(&repo, &request).await;
    assert_eq!(current.input.subject, "Newer content");
    assert_ne!(current.input.db_id, original.input.db_id);
    assert!(
        repo.commit_transfer(&original, &contacts(), vec![])
            .await
            .is_err()
    );
    repo.commit_transfer(&current, &contacts(), vec![])
        .await
        .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn transfer_rechecks_both_inboxes_and_refuses_a_scheduled_source(db: PgPool) {
    let (repo, request) = fixture(&db).await;
    assert!(matches!(
        repo.begin_transfer("macro|stranger@example.com", &request)
            .await,
        Err(EmailErr::Unauthorized)
    ));
    let plan = prepare(&repo, &request).await;
    sqlx::query!(
        "UPDATE email_links SET macro_id='macro|another@example.com' WHERE id=$1",
        request.destination_link_id
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.commit_transfer(&plan, &contacts(), vec![]).await,
        Err(EmailErr::Unauthorized)
    ));
    sqlx::query!(
        "UPDATE email_links SET macro_id=$2 WHERE id=$1",
        request.destination_link_id,
        ACTOR
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO email_scheduled_messages(link_id,message_id,send_time,sent,processing) VALUES($1,$2,now()+interval '1 day',false,false)",request.source_link_id,request.source_id).execute(&db).await.unwrap();
    assert!(
        repo.commit_transfer(&plan, &contacts(), vec![])
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn disconnect_keeps_destination_blocked_until_explicit_duplicate_acknowledgement(db: PgPool) {
    let (repo, request) = fixture(&db).await;
    let plan = prepare(&repo, &request).await;
    let moved = repo
        .commit_transfer(&plan, &contacts(), vec![])
        .await
        .unwrap();
    sqlx::query!(
        "DELETE FROM email_links WHERE id=$1",
        request.source_link_id
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(
        repo.transfer_cleanup_binding(&plan)
            .await
            .unwrap()
            .is_none()
    );
    let facts = draft::operation_facts(&db, &[moved.message_id])
        .await
        .unwrap()
        .remove(&moved.message_id)
        .unwrap();
    assert_eq!(facts.issue, Some(MessageOperationIssue::MovePending));
    let mut resolution = MessageResolutionRequest {
        message_id: moved.message_id,
        revision: facts.revision,
        remote_version: facts.remote_version.clone(),
        action: MessageResolutionAction::KeepOriginal,
        accept_duplicate_risk: false,
    };
    assert!(plan_resolution(facts.clone(), resolution.clone()).is_err());
    resolution.accept_duplicate_risk = true;
    let decision = plan_resolution(facts, resolution).unwrap();
    super::super::draft_resolution::commit(
        &db,
        &MacroUserIdStr::parse_from_str(ACTOR).unwrap(),
        decision,
    )
    .await
    .unwrap();
    let mut tx = db.begin().await.unwrap();
    draft::require_completed_uploads(&mut tx, moved.message_id)
        .await
        .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn native_attachment_bytes_are_referenced_before_source_retirement(db: PgPool) {
    let (repo, request) = fixture(&db).await;
    let attachment = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_attachments(id,message_id,provider_attachment_id,filename,mime_type,size_bytes,content_id) VALUES($1,$2,'opaque','inline.png','image/png',4,'image@cid')",attachment,request.source_id).execute(&db).await.unwrap();
    let plan = prepare(&repo, &request).await;
    assert_eq!(plan.files.len(), 1);
    assert!(
        repo.commit_transfer(&plan, &contacts(), vec![])
            .await
            .is_err()
    );
    repo.reserve_transfer_object("transfer-bytes")
        .await
        .unwrap();
    let upload = AttachmentDraft {
        id: plan.files[0].destination_id,
        draft_id: plan.input.db_id,
        file_name: "inline.png".into(),
        content_type: "image/png".into(),
        sha: "sha".into(),
        size: 4,
        s3_key: "transfer-bytes".into(),
        upload_pending: false,
        content_id: Some("image@cid".into()),
        is_inline: true,
    };
    let result = repo
        .commit_transfer(
            &plan,
            &contacts(),
            vec![MaterializedTransferFile {
                source_id: attachment,
                upload,
            }],
        )
        .await
        .unwrap();
    assert_eq!(result.attachments.len(), 1);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT object_key FROM email_attachment_blobs WHERE attachment_id=$1",
            attachment
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        "transfer-bytes"
    );
    let message = repo
        .get_simple_message(result.message_id, &[request.destination_link_id])
        .await
        .unwrap()
        .unwrap();
    assert!(message.is_draft);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recovery_before_a_delayed_request_prevents_it_from_committing(db: PgPool) {
    let (repo, request) = fixture(&db).await;
    assert!(
        repo.recover_transfer(ACTOR, request.id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(repo.begin_transfer(ACTOR, &request).await.is_err());
    assert!(
        repo.recover_transfer("macro|stranger@example.com", request.id)
            .await
            .is_err()
    );
    let retry = DraftTransferRequest {
        id: Uuid::now_v7(),
        ..request
    };
    let plan = prepare(&repo, &retry).await;
    repo.commit_transfer(&plan, &contacts(), vec![])
        .await
        .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recovery_during_materialization_fences_the_delayed_commit(db: PgPool) {
    let (repo, request) = fixture(&db).await;
    let plan = prepare(&repo, &request).await;
    assert!(
        repo.recover_transfer(ACTOR, request.id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        repo.commit_transfer(&plan, &contacts(), vec![])
            .await
            .is_err()
    );
    let source = repo
        .get_simple_message(request.source_id, &[request.source_link_id])
        .await
        .unwrap()
        .unwrap();
    assert!(source.is_draft);
    assert!(
        repo.get_simple_message(plan.input.db_id, &[request.destination_link_id])
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_lost_commit_response_is_recoverable_after_the_source_disconnects(db: PgPool) {
    let (repo, request) = fixture(&db).await;
    let plan = prepare(&repo, &request).await;
    let receipt = repo
        .commit_transfer(&plan, &contacts(), vec![])
        .await
        .unwrap();
    sqlx::query!(
        "DELETE FROM email_links WHERE id=$1",
        request.source_link_id
    )
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(
        repo.recover_transfer(ACTOR, request.id)
            .await
            .unwrap()
            .unwrap()
            .message_id,
        receipt.message_id
    );
    assert!(
        repo.recover_transfer("macro|stranger@example.com", request.id)
            .await
            .is_err()
    );
    sqlx::query!(
        "UPDATE email_links SET macro_id='macro|stranger@example.com' WHERE id=$1",
        request.destination_link_id
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(repo.recover_transfer(ACTOR, request.id).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expired_or_replaced_cleanup_cannot_renew_or_complete(db: PgPool) {
    let (repo, request) = fixture(&db).await;
    let plan = prepare(&repo, &request).await;
    repo.commit_transfer(&plan, &contacts(), vec![])
        .await
        .unwrap();
    let lease = Uuid::now_v7();
    repo.claim_transfer_cleanup(lease).await.unwrap().unwrap();
    repo.renew_transfer_cleanup(&plan, lease).await.unwrap();
    sqlx::query!(
        "UPDATE email_draft_transfers SET lease_until=now()-interval '1 second' WHERE id=$1",
        request.id
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(repo.renew_transfer_cleanup(&plan, lease).await.is_err());
    let next = Uuid::now_v7();
    repo.claim_transfer_cleanup(next).await.unwrap().unwrap();
    assert!(
        repo.finish_transfer_cleanup(&plan, lease, RetirementOutcome::Removed)
            .await
            .is_err()
    );
    repo.renew_transfer_cleanup(&plan, next).await.unwrap();
    sqlx::query!("UPDATE email_draft_transfers SET state='retained',lease_id=NULL,lease_until=NULL WHERE id=$1",request.id).execute(&db).await.unwrap();
    assert!(repo.renew_transfer_cleanup(&plan, next).await.is_err());
    assert!(
        repo.finish_transfer_cleanup(&plan, next, RetirementOutcome::Removed)
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returning_a_reply_to_its_original_inbox_never_rebinds_the_old_draft(db: PgPool) {
    let (repo, request) = fixture(&db).await;
    let parent = Uuid::now_v7();
    let thread = sqlx::query_scalar!(
        "SELECT thread_id FROM email_messages WHERE id=$1",
        request.source_id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO email_messages(id,thread_id,link_id,is_draft,subject) VALUES($1,$2,$3,false,'Parent')",parent,thread,request.source_link_id).execute(&db).await.unwrap();
    sqlx::query!(
        "UPDATE email_messages SET replying_to_id=$2 WHERE id=$1",
        request.source_id,
        parent
    )
    .execute(&db)
    .await
    .unwrap();
    let first = prepare(&repo, &request).await;
    let moved = repo
        .commit_transfer(&first, &contacts(), vec![])
        .await
        .unwrap();
    let lease = Uuid::now_v7();
    repo.claim_transfer_cleanup(lease).await.unwrap().unwrap();
    repo.finish_transfer_cleanup(&first, lease, RetirementOutcome::Removed)
        .await
        .unwrap();
    let back = DraftTransferRequest {
        id: Uuid::now_v7(),
        source_id: moved.message_id,
        source_link_id: request.destination_link_id,
        destination_link_id: request.source_link_id,
    };
    let second = prepare(&repo, &back).await;
    let returned = repo
        .commit_transfer(&second, &contacts(), vec![])
        .await
        .unwrap();
    assert_eq!(returned.thread_id, thread);
    assert_ne!(returned.message_id, request.source_id);
    assert_eq!(
        repo.get_draft_replying_to(request.source_link_id, parent)
            .await
            .unwrap()
            .unwrap()
            .db_id,
        returned.message_id
    );
    let mut stale = first.input.clone();
    stale.db_id = request.source_id;
    stale.thread_db_id = thread;
    stale.subject = "Stale tab".into();
    assert!(
        repo.insert_message(&stale, &contacts(), request.source_link_id, None, true)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT subject FROM email_messages WHERE id=$1",
            returned.message_id
        )
        .fetch_one(&db)
        .await
        .unwrap()
        .as_deref(),
        Some("Keep this subject")
    );
}
