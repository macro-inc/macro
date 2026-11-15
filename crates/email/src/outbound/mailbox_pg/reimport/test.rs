use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const REVISION: i16 = 1;

/// A link whose import finished: Inbox's round predates reader revisions,
/// Sent's round started at the current one, and Archive and a user folder
/// predate them too. Only Inbox's stream is due to be claimed.
async fn imported_link(db: &PgPool) -> MailboxKey {
    let link = macro_uuid::generate_uuid_v7();
    sqlx::query!(r#"
        INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation)
        VALUES ($1,'macro|outlook-test@example.com','outlook-owner','outlook-test@example.com','OUTLOOK',1)
    "#,link).execute(db).await.unwrap();
    sqlx::query!(r#"
        INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete,next_run_at,import_started_at,import_completed_at)
        VALUES ($1,$2,1,'folder_catalog','mail',true,now() + interval '1 hour',now() - interval '1 day',now() - interval '1 day')
    "#,macro_uuid::generate_uuid_v7(),link).execute(db).await.unwrap();
    sqlx::query!(r#"
        INSERT INTO email_mailbox_folders (link_id,provider_id,display_name,role,catalog_generation,total_item_count)
        VALUES ($1,'inbox-id','Inbox','inbox',1,250),($1,'sent-id','Sent','sent',1,40),
            ($1,'archive-id','Archive','archive',1,10),($1,'projects-id','Projects','other',1,NULL)
    "#,link).execute(db).await.unwrap();
    sqlx::query!(r#"
        INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,position,initial_complete,reader_revision,next_run_at,attachments_rechecked)
        VALUES ($1,$5,1,'mail_folder','inbox-id','inbox-delta',true,NULL,now(),true),
            ($2,$5,1,'mail_folder','sent-id','sent-delta',true,1,now() + interval '1 hour',true),
            ($3,$5,1,'mail_folder','archive-id','archive-delta',true,NULL,now() + interval '1 hour',true),
            ($4,$5,1,'mail_folder','projects-id','projects-delta',true,NULL,now() + interval '1 hour',true)
    "#,macro_uuid::generate_uuid_v7(),macro_uuid::generate_uuid_v7(),macro_uuid::generate_uuid_v7(),macro_uuid::generate_uuid_v7(),link)
        .execute(db).await.unwrap();
    MailboxKey {
        link_id: link,
        sync_generation: 1,
        grant_generation: 1,
    }
}

async fn stream(
    db: &PgPool,
    mailbox: MailboxKey,
    folder: &str,
) -> (Option<String>, bool, Option<i16>, i64) {
    let row = sqlx::query!(
        "SELECT position,initial_complete,reader_revision,fence FROM email_sync_streams WHERE link_id = $1 AND kind = 'mail_folder' AND scope_id = $2",
        mailbox.link_id,
        folder
    )
    .fetch_one(db)
    .await
    .unwrap();
    (
        row.position,
        row.initial_complete,
        row.reader_revision,
        row.fence,
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inbox_and_sent_restart_alone_and_the_rest_waits_for_their_import(db: PgPool) {
    let repo = PgMailboxSync::new(db.clone());
    let mailbox = imported_link(&db).await;
    assert_eq!(
        repo.link_reimport(mailbox.link_id, REVISION).await.unwrap(),
        LinkReimport::Due {
            mailbox,
            inbox_and_sent: 1,
            other_folders: 2,
            provider_items: Some(300),
        }
    );
    let (_, _, _, inbox_fence) = stream(&db, mailbox, "inbox-id").await;

    assert_eq!(
        repo.restart_folders(mailbox, ReimportPhase::InboxAndSent, REVISION, false)
            .await
            .unwrap(),
        Some(1)
    );
    assert_eq!(
        stream(&db, mailbox, "inbox-id").await,
        (None, false, None, inbox_fence + 1)
    );
    assert_eq!(
        stream(&db, mailbox, "sent-id").await.0.as_deref(),
        Some("sent-delta"),
        "Sent's round already started at this revision"
    );
    assert_eq!(
        stream(&db, mailbox, "archive-id").await.0.as_deref(),
        Some("archive-delta"),
        "other folders wait for their own phase"
    );
    let unarmed = sqlx::query_scalar!(
        "SELECT count(*) FROM email_sync_streams WHERE link_id = $1 AND kind = 'mail_folder' AND NOT attachments_rechecked",
        mailbox.link_id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(
        unarmed,
        Some(0),
        "the attachment recheck waits for the last phase"
    );
    let run = sqlx::query!("SELECT import_started_at,import_completed_at FROM email_sync_streams WHERE link_id = $1 AND kind = 'folder_catalog'",mailbox.link_id)
        .fetch_one(&db).await.unwrap();
    assert!(run.import_completed_at.is_none());
    assert!(run.import_started_at.unwrap() > chrono::Utc::now() - chrono::Duration::minutes(1));
    assert_eq!(
        repo.link_reimport(mailbox.link_id, REVISION).await.unwrap(),
        LinkReimport::Importing
    );
    assert_eq!(
        repo.restart_folders(mailbox, ReimportPhase::OtherFolders, REVISION, true)
            .await
            .unwrap(),
        None,
        "nothing restarts while an import runs"
    );
    assert_eq!(
        repo.phase_progress(mailbox).await.unwrap(),
        PhaseProgress::Running
    );

    // The fresh Inbox round lists nothing new and ends on its deltaLink.
    let round = repo
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(round.folder.as_str(), "inbox-id");
    repo.commit_page(
        &round,
        &MailboxChangePage {
            changed: vec![],
            removed: vec![],
            position: StreamPosition::Checkpoint(StreamToken::new("fresh-delta".into())),
            reader_revision: REVISION,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        repo.phase_progress(mailbox).await.unwrap(),
        PhaseProgress::Settled
    );
    assert_eq!(
        repo.link_reimport(mailbox.link_id, REVISION).await.unwrap(),
        LinkReimport::Due {
            mailbox,
            inbox_and_sent: 0,
            other_folders: 2,
            provider_items: Some(300),
        }
    );
    assert_eq!(
        repo.restart_folders(mailbox, ReimportPhase::OtherFolders, REVISION, true)
            .await
            .unwrap(),
        Some(2)
    );

    sqlx::query!(
        "UPDATE email_links SET needs_reauth = true WHERE id = $1",
        mailbox.link_id
    )
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(
        repo.phase_progress(mailbox).await.unwrap(),
        PhaseProgress::Interrupted
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn paused_imports_leave_import_rows_and_keep_live_changes_flowing(db: PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;
    sqlx::query!(r#"
        INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import,available_at)
        VALUES ($1,1,'old-message',true,now() - interval '1 minute'),($1,1,'new-message',false,now())
    "#,link).execute(&db).await.unwrap();

    let paused = repo.clone().with_imports_paused(true);
    let live = paused
        .claim_message(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(live.provider_id.as_str(), "new-message");
    assert!(
        paused
            .claim_message(macro_uuid::generate_uuid_v7())
            .await
            .unwrap()
            .is_none()
    );

    let import = repo
        .claim_message(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(import.provider_id.as_str(), "old-message");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_restart_rechecks_the_mail_its_folders_already_hold(db: PgPool) {
    use email_api_client::domain::models::MailboxState;
    let repo = PgMailboxSync::new(db.clone());
    let mailbox = imported_link(&db).await;
    for message in ["inbox-message", "archive-message"] {
        sqlx::query!(
            "INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import) VALUES ($1,1,$2,false)",
            mailbox.link_id,
            message
        )
        .execute(&db)
        .await
        .unwrap();
        let work = repo
            .claim_message(macro_uuid::generate_uuid_v7())
            .await
            .unwrap()
            .unwrap();
        repo.ingest(
            &work,
            super::super::test::snapshot(mailbox.link_id, message, MailboxState::default(), "etag"),
        )
        .await
        .unwrap();
        repo.complete_message(&work).await.unwrap();
    }
    sqlx::query!(
        "UPDATE email_messages SET provider_folder_id = CASE provider_id WHEN 'inbox-message' THEN 'inbox-id' ELSE 'archive-id' END WHERE link_id = $1",
        mailbox.link_id
    )
    .execute(&db)
    .await
    .unwrap();

    repo.restart_folders(mailbox, ReimportPhase::InboxAndSent, REVISION, false)
        .await
        .unwrap();

    let queued = sqlx::query!(
        "SELECT provider_id,is_import FROM email_message_reconciliation WHERE link_id = $1 ORDER BY provider_id",
        mailbox.link_id
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(
        queued
            .iter()
            .map(|row| (row.provider_id.as_str(), row.is_import))
            .collect::<Vec<_>>(),
        [("inbox-message", true)],
        "only the restarted Inbox rechecks what it held"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_link_without_a_folder_catalog_is_not_restarted(db: PgPool) {
    let repo = PgMailboxSync::new(db.clone());
    let mailbox = imported_link(&db).await;
    sqlx::query!(
        "DELETE FROM email_sync_streams WHERE link_id = $1 AND kind = 'folder_catalog'",
        mailbox.link_id
    )
    .execute(&db)
    .await
    .unwrap();

    assert_eq!(
        repo.restart_folders(mailbox, ReimportPhase::InboxAndSent, REVISION, false)
            .await
            .unwrap(),
        None
    );
    let (position, complete, _, _) = stream(&db, mailbox, "inbox-id").await;
    assert_eq!(
        (position.as_deref(), complete),
        (Some("inbox-delta"), true),
        "nothing would ever report the run complete, so the folder keeps its round"
    );
}
