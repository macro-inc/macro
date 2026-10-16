use super::*;
use crate::domain::models::AttachmentDraft;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const ACTOR: &str = "macro|attachment-owner@example.com";
async fn fixture(db: &PgPool) -> (EmailPgRepo, Uuid, Uuid) {
    let link = Uuid::now_v7();
    let thread = Uuid::now_v7();
    let draft = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider) VALUES ($1,$2,'owner','attachment-owner@example.com','OUTLOOK')",link,ACTOR).execute(db).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_threads (id,link_id) VALUES ($1,$2)",
        thread,
        link
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_messages (id,link_id,thread_id,is_draft) VALUES ($1,$2,$3,true)",
        draft,
        link,
        thread
    )
    .execute(db)
    .await
    .unwrap();
    (EmailPgRepo::new(db.clone()), link, draft)
}
fn upload(draft: Uuid, size: i32) -> AttachmentDraft {
    let id = Uuid::now_v7();
    AttachmentDraft {
        upload_pending: false,
        content_id: None,
        is_inline: false,
        id,
        draft_id: draft,
        file_name: "report.pdf".into(),
        content_type: "application/pdf".into(),
        sha: "a".repeat(64),
        size,
        s3_key: format!("draft/{draft}/{id}"),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn upload_reservations_are_idempotent_and_never_send_unverified_bytes(db: PgPool) {
    let (repo, link, draft) = fixture(&db).await;
    let mut file = upload(draft, 120_000_000);
    file.upload_pending = true;
    for _ in 0..2 {
        repo.commit_attachment_change(ACTOR, link, draft, AttachmentChange::Upload(file.clone()))
            .await
            .unwrap();
    }
    let content = sqlx::query_scalar!(
        "SELECT desired_content FROM email_mailbox_drafts WHERE message_id=$1",
        draft
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(content["_attachments"]["uploads"], serde_json::json!([]));
    let mut tx = db.begin().await.unwrap();
    assert!(
        super::super::draft::require_completed_uploads(&mut tx, draft)
            .await
            .is_err()
    );
    tx.rollback().await.unwrap();
    let mut wrong = file.clone();
    wrong.sha = "b".repeat(64);
    assert!(
        repo.commit_attachment_change(ACTOR, link, draft, AttachmentChange::Upload(wrong))
            .await
            .is_err()
    );
    assert!(matches!(
        repo.commit_attachment_change(
            "macro|other@example.com",
            link,
            draft,
            AttachmentChange::CompleteUpload(file.clone())
        )
        .await,
        Err(AttachmentError::Forbidden)
    ));
    repo.commit_attachment_change(
        ACTOR,
        link,
        draft,
        AttachmentChange::CompleteUpload(file.clone()),
    )
    .await
    .unwrap();
    repo.commit_attachment_change(
        ACTOR,
        link,
        draft,
        AttachmentChange::CompleteUpload(file.clone()),
    )
    .await
    .unwrap();
    assert!(
        !repo
            .draft_upload(link, draft, file.id)
            .await
            .unwrap()
            .unwrap()
            .upload_pending
    );
    let mut tx = db.begin().await.unwrap();
    super::super::draft::require_completed_uploads(&mut tx, draft)
        .await
        .unwrap();
    tx.rollback().await.unwrap();
    repo.commit_attachment_change(
        ACTOR,
        link,
        draft,
        AttachmentChange::Remove {
            attachment_id: file.id,
            kind: RemovalKind::UploadedOrNative,
        },
    )
    .await
    .unwrap();
    assert!(
        repo.commit_attachment_change(
            ACTOR,
            link,
            draft,
            AttachmentChange::CompleteUpload(file.clone())
        )
        .await
        .is_err()
    );
    assert!(
        repo.commit_attachment_change(ACTOR, link, draft, AttachmentChange::Upload(file))
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_expired_upload_requires_an_explicit_reservation_retry(db: PgPool) {
    let (repo, link, draft) = fixture(&db).await;
    let mut file = upload(draft, 123);
    file.upload_pending = true;
    repo.commit_attachment_change(ACTOR, link, draft, AttachmentChange::Upload(file.clone()))
        .await
        .unwrap();
    sqlx::query!("UPDATE email_attachments_drafts SET upload_expires_at=now()-interval '1 second' WHERE id=$1",file.id).execute(&db).await.unwrap();
    assert!(
        repo.commit_attachment_change(
            ACTOR,
            link,
            draft,
            AttachmentChange::CompleteUpload(file.clone())
        )
        .await
        .is_err()
    );
    repo.commit_attachment_change(ACTOR, link, draft, AttachmentChange::Upload(file.clone()))
        .await
        .unwrap();
    repo.commit_attachment_change(ACTOR, link, draft, AttachmentChange::CompleteUpload(file))
        .await
        .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn file_changes_commit_with_frozen_revision_and_defer_byte_cleanup(db: PgPool) {
    let (repo, link, draft) = fixture(&db).await;
    let file = upload(draft, 123);
    repo.commit_attachment_change(ACTOR, link, draft, AttachmentChange::Upload(file.clone()))
        .await
        .unwrap();
    let before = sqlx::query!(
        "SELECT revision,desired_content FROM email_mailbox_drafts WHERE message_id = $1",
        draft
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(before.revision, 1);
    assert_eq!(
        before.desired_content["_attachments"]["uploads"][0]["s3_key"],
        file.s3_key
    );
    repo.commit_attachment_change(
        ACTOR,
        link,
        draft,
        AttachmentChange::Remove {
            attachment_id: file.id,
            kind: RemovalKind::UploadedOrNative,
        },
    )
    .await
    .unwrap();
    let after = sqlx::query!(
        "SELECT revision,desired_content FROM email_mailbox_drafts WHERE message_id = $1",
        draft
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(after.revision, 2);
    assert_eq!(
        after.desired_content["_attachments"]["uploads"],
        serde_json::json!([])
    );
    assert_eq!(
        after.desired_content["_attachments"]["removals"][0]["kind"],
        "content_id"
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT object_key FROM email_draft_object_cleanup")
            .fetch_one(&db)
            .await
            .unwrap(),
        file.s3_key
    );
    assert_eq!(
        before.desired_content["_attachments"]["uploads"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn send_and_attachment_edits_share_the_same_transaction_boundary(db: PgPool) {
    let (repo, link, draft) = fixture(&db).await;
    sqlx::query!(
        "INSERT INTO email_scheduled_messages (message_id,link_id,send_time) VALUES ($1,$2,now())",
        draft,
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.commit_attachment_change(
            ACTOR,
            link,
            draft,
            AttachmentChange::Upload(upload(draft, 123))
        )
        .await,
        Err(AttachmentError::DeliveryConflict)
    ));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_attachments_drafts WHERE draft_id = $1",
            draft
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(0)
    );
    assert!(matches!(
        repo.commit_attachment_change(
            "macro|intruder@example.com",
            link,
            draft,
            AttachmentChange::Upload(upload(draft, 123))
        )
        .await,
        Err(AttachmentError::Forbidden)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_additions_cannot_overrun_the_aggregate_limit(db: PgPool) {
    let (repo, link, draft) = fixture(&db).await;
    let (one, two) = tokio::join!(
        repo.commit_attachment_change(
            ACTOR,
            link,
            draft,
            AttachmentChange::Upload(upload(draft, 100_000_000))
        ),
        repo.commit_attachment_change(
            ACTOR,
            link,
            draft,
            AttachmentChange::Upload(upload(draft, 100_000_000))
        )
    );
    assert_ne!(one.is_ok(), two.is_ok());
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT sum(size)::bigint FROM email_attachments_drafts WHERE draft_id = $1",
            draft
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(100_000_000)
    );
}

#[cfg(feature = "mailbox")]
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cleanup_retains_active_claims_and_recovery_checkpoints(db: PgPool) {
    use crate::domain::{
        attachment_cleanup::DraftObjectCleanupRepository, mailbox::drafts::ports::DraftRepository,
    };
    let (repo, link, draft) = fixture(&db).await;
    let file = upload(draft, 123);
    repo.commit_attachment_change(ACTOR, link, draft, AttachmentChange::Upload(file.clone()))
        .await
        .unwrap();
    let sync = crate::outbound::mailbox_pg::PgMailboxSync::new(db.clone());
    let _lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    repo.commit_attachment_change(
        ACTOR,
        link,
        draft,
        AttachmentChange::Remove {
            attachment_id: file.id,
            kind: RemovalKind::UploadedOrNative,
        },
    )
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_draft_object_cleanup SET available_at = now() WHERE object_key = $1",
        file.s3_key
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(
        repo.claim_object_cleanup(Uuid::now_v7())
            .await
            .unwrap()
            .is_none()
    );
    let checkpoint = serde_json::json!({"prepared":{"files":[{"source":{"kind":"uploaded","key":file.s3_key}}]}});
    sqlx::query!("UPDATE email_mailbox_drafts SET lease_until = now() - interval '1 second',checkpoint = $2 WHERE message_id = $1",draft,checkpoint).execute(&db).await.unwrap();
    assert!(
        repo.claim_object_cleanup(Uuid::now_v7())
            .await
            .unwrap()
            .is_none()
    );
    sqlx::query!(
        "UPDATE email_mailbox_drafts SET checkpoint = NULL WHERE message_id = $1",
        draft
    )
    .execute(&db)
    .await
    .unwrap();
    let cleanup = repo
        .claim_object_cleanup(Uuid::now_v7())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(cleanup.key, file.s3_key);
    repo.finish_object_cleanup(&cleanup).await.unwrap();
    assert!(
        repo.claim_object_cleanup(Uuid::now_v7())
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn transferred_upload_provider_echo_does_not_consume_quota_twice(db: PgPool) {
    let (repo, link, draft) = fixture(&db).await;
    let mut original = upload(draft, 80_000_000);
    original.content_id = Some("<original@cid>".into());
    repo.commit_attachment_change(
        ACTOR,
        link,
        draft,
        AttachmentChange::Upload(original.clone()),
    )
    .await
    .unwrap();
    sqlx::query!("INSERT INTO email_attachments(id,message_id,provider_attachment_id,filename,mime_type,size_bytes,content_id) VALUES($1,$2,'provider-echo','report.pdf','application/pdf',80000000,'original@cid')",Uuid::new_v4(),draft).execute(&db).await.unwrap();
    let source_message = Uuid::new_v4();
    sqlx::query!("INSERT INTO email_messages(id,link_id,thread_id,provider_id) SELECT $2,link_id,thread_id,'source' FROM email_messages WHERE id=$1",draft,source_message).execute(&db).await.unwrap();
    let source_id = Uuid::new_v4();
    sqlx::query!("INSERT INTO email_attachments(id,message_id,provider_attachment_id,filename,mime_type,size_bytes,content_id) VALUES($1,$2,'original-forward','notes.pdf','application/pdf',50000000,'forwarded@cid')",source_id,source_message).execute(&db).await.unwrap();
    let forwarded = repo.attachment_reference(source_id).await.unwrap().unwrap();
    repo.commit_attachment_change(ACTOR, link, draft, AttachmentChange::Forward(forwarded))
        .await
        .unwrap();
    sqlx::query!("INSERT INTO email_attachments(id,message_id,provider_attachment_id,filename,mime_type,size_bytes,content_id) VALUES($1,$2,'forward-echo','notes.pdf','application/pdf',50000000,'<forwarded@cid>')",Uuid::new_v4(),draft).execute(&db).await.unwrap();
    repo.commit_attachment_change(
        ACTOR,
        link,
        draft,
        AttachmentChange::Upload(upload(draft, 100)),
    )
    .await
    .unwrap();
    let native = super::super::message::attachments_by_message_ids(&db, &[draft])
        .await
        .unwrap();
    assert!(native.get(&draft).is_none_or(Vec::is_empty));
    for (attachment_id, kind) in [
        (original.id, RemovalKind::UploadedOrNative),
        (source_id, RemovalKind::Forwarded),
    ] {
        repo.commit_attachment_change(
            ACTOR,
            link,
            draft,
            AttachmentChange::Remove {
                attachment_id,
                kind,
            },
        )
        .await
        .unwrap();
    }
    let native = super::super::message::attachments_by_message_ids(&db, &[draft])
        .await
        .unwrap();
    assert!(
        native.get(&draft).is_none_or(Vec::is_empty),
        "removed provider echoes must remain hidden"
    );
    repo.commit_attachment_change(
        ACTOR,
        link,
        draft,
        AttachmentChange::Upload(upload(draft, 149_000_000)),
    )
    .await
    .unwrap();
}
