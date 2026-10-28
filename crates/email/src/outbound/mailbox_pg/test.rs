use super::*;
use email_api_client::domain::models::FolderRole;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

pub(super) async fn fixture(db: &PgPool) -> (PgMailboxSync, Uuid) {
    let link = macro_uuid::generate_uuid_v7();
    sqlx::query!(r#"
        INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation)
        VALUES ($1,'macro|outlook-test@example.com','outlook-owner','outlook-test@example.com','OUTLOOK',1)
    "#,link).execute(db).await.unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id)
        VALUES ($1,$2,1,'mail_folder','folder')
    "#,
        macro_uuid::generate_uuid_v7(),
        link
    )
    .execute(db)
    .await
    .unwrap();
    (PgMailboxSync::new(db.clone()), link)
}

pub(super) fn page() -> MailboxChangePage {
    MailboxChangePage {
        changed: vec![ProviderId::new("a").unwrap(), ProviderId::new("b").unwrap()],
        removed: vec![
            ProviderId::new("b").unwrap(),
            ProviderId::new("moved").unwrap(),
        ],
        position: StreamPosition::Checkpoint(StreamToken::new("opaque-checkpoint".into())),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn checkpoint_commits_with_deduplicated_changes_and_folder_removals(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let lease = repo
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    repo.commit_page(&lease, &page()).await.unwrap();
    let row = sqlx::query!(
        "SELECT position,initial_complete,lease_id FROM email_sync_streams WHERE id = $1",
        lease.id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(row.position.as_deref(), Some("opaque-checkpoint"));
    assert!(row.initial_complete);
    assert!(row.lease_id.is_none());
    let jobs = sqlx::query!("SELECT provider_id,is_import FROM email_message_reconciliation WHERE link_id = $1 ORDER BY provider_id",link).fetch_all(&db).await.unwrap();
    assert_eq!(
        jobs.iter()
            .map(|row| row.provider_id.as_str())
            .collect::<Vec<_>>(),
        vec!["a", "b", "moved"]
    );
    assert!(jobs.iter().all(|row| row.is_import));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_worker_cannot_advance_cursor_or_enqueue_work(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let stale = repo
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    sqlx::query!(
        "UPDATE email_sync_streams SET lease_until = now() - interval '1 second' WHERE id = $1",
        stale.id
    )
    .execute(&db)
    .await
    .unwrap();
    let current = repo
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    assert!(current.fence > stale.fence);
    assert!(matches!(
        repo.commit_page(&stale, &page()).await,
        Err(MailboxError::Stale)
    ));
    let count = sqlx::query_scalar!(
        "SELECT count(*) FROM email_message_reconciliation WHERE link_id = $1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(count, Some(0));
    repo.commit_page(&current, &page()).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn wakeup_arriving_during_reconciliation_survives_old_acknowledgement(db: PgPool) {
    let (repo, _) = fixture(&db).await;
    let stream = repo
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    repo.commit_page(&stream, &page()).await.unwrap();
    let work = repo
        .claim_message(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at = now() WHERE id = $1",
        stream.id
    )
    .execute(&db)
    .await
    .unwrap();
    let stream = repo
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    repo.commit_page(&stream, &page()).await.unwrap();
    repo.complete_message(&work).await.unwrap();
    let row = sqlx::query!("SELECT revision,lease_id,is_import FROM email_message_reconciliation WHERE link_id = $1 AND provider_id = $2",work.mailbox.link_id,work.provider_id.as_str()).fetch_one(&db).await.unwrap();
    assert_eq!(row.revision, work.revision + 1);
    assert!(row.lease_id.is_none());
    assert!(!row.is_import);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expired_stream_reset_preserves_other_streams_and_pending_work(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let stream = repo
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    repo.commit_page(&stream, &page()).await.unwrap();
    let known = repo
        .claim_message(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    repo.ingest(
        &known,
        snapshot(link, known.provider_id.as_str(), Default::default(), "v1"),
    )
    .await
    .unwrap();
    repo.complete_message(&known).await.unwrap();
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at = now(),attachments_rechecked=true WHERE id = $1",
        stream.id
    )
    .execute(&db)
    .await
    .unwrap();
    let lease = repo
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    repo.reset_stream(&lease).await.unwrap();
    let row = sqlx::query!(
        "SELECT position,initial_complete,attachments_rechecked FROM email_sync_streams WHERE id = $1",
        stream.id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(row.position.is_none());
    assert!(!row.initial_complete);
    assert!(!row.attachments_rechecked);
    let recheck = sqlx::query_scalar!("SELECT is_import FROM email_message_reconciliation WHERE link_id = $1 AND provider_id = $2",link,known.provider_id.as_str()).fetch_one(&db).await.unwrap();
    assert!(recheck);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_message_reconciliation WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(3)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn complete_catalog_resolves_roles_and_creates_folder_streams(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    sqlx::query!("INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id) VALUES ($1,$2,1,'folder_catalog','mail')",macro_uuid::generate_uuid_v7(),link).execute(&db).await.unwrap();
    let lease = repo
        .claim_catalog(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    repo.commit_catalog(
        &lease,
        &[MailFolder {
            id: ProviderId::new("inbox-id").unwrap(),
            parent_id: None,
            name: "Boîte de réception".into(),
            role: FolderRole::Inbox,
            has_children: false,
        }],
    )
    .await
    .unwrap();
    let folders = repo.folders(lease.mailbox).await.unwrap();
    assert_eq!(folders.len(), 1);
    assert_eq!(folders[0].role, FolderRole::Inbox);
    let count = sqlx::query_scalar!("SELECT count(*) FROM email_sync_streams WHERE link_id = $1 AND kind = 'mail_folder' AND scope_id = 'inbox-id'",link).fetch_one(&db).await.unwrap();
    assert_eq!(count, Some(1));
    assert!(matches!(
        repo.commit_catalog(&lease, &[]).await,
        Err(MailboxError::Stale)
    ));
    assert_eq!(repo.folders(lease.mailbox).await.unwrap().len(), 1);
}

pub(super) fn snapshot(
    link_id: Uuid,
    provider_id: &str,
    state: email_api_client::domain::models::MailboxState,
    version: &str,
) -> email_api_client::domain::models::MailboxMessage {
    use email_api_client::domain::models::{MailboxMessage, MessageWithCalendarParts};
    let message = serde_json::from_value(serde_json::json!({
        "db_id":macro_uuid::generate_uuid_v7(),"thread_db_id":macro_uuid::generate_uuid_v7(),"link_id":link_id,
        "provider_id":provider_id,"provider_thread_id":"conversation","subject":"Outlook message",
        "internal_date_ts":"2026-10-01T12:00:00Z","body_text":"retained content",
        "is_read":state.is_read,"is_starred":state.is_flagged,"is_draft":state.is_draft,"is_sent":false,"has_attachments":false,
        "to":[],"cc":[],"bcc":[],"labels":[],"attachments":[],"attachments_draft":[],"attachments_forwarded":[],
        "created_at":"2026-10-01T12:00:00Z","updated_at":"2026-10-01T12:00:00Z"
    })).unwrap();
    MailboxMessage {
        draft_correlation: None,
        content: MessageWithCalendarParts {
            message,
            calendar_parts: Vec::new(),
        },
        state,
        folder_id: Some(ProviderId::new("folder").unwrap()),
        tags: vec!["TRASH".into()],
        version: Some(version.into()),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ingestion_commits_content_state_and_outbox_without_treating_categories_as_folders(
    db: PgPool,
) {
    use email_api_client::domain::models::{Attention, MailboxState};
    let (repo, link) = fixture(&db).await;
    let stream = repo
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    repo.commit_page(&stream, &page()).await.unwrap();
    let work = repo
        .claim_message(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    let state = MailboxState {
        in_inbox: true,
        attention: Attention::Primary,
        ..Default::default()
    };
    repo.ingest(
        &work,
        snapshot(link, work.provider_id.as_str(), state.clone(), "v1"),
    )
    .await
    .unwrap();
    repo.ingest(
        &work,
        snapshot(link, work.provider_id.as_str(), state, "v1"),
    )
    .await
    .unwrap();
    let row = sqlx::query!("SELECT m.body_text,t.inbox_visible,t.is_signal FROM email_messages m JOIN email_threads t ON t.id = m.thread_id WHERE m.link_id = $1 AND m.provider_id = $2",link,work.provider_id.as_str()).fetch_one(&db).await.unwrap();
    assert_eq!(row.body_text.as_deref(), Some("retained content"));
    assert!(row.inbox_visible);
    assert!(row.is_signal);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_projection_outbox WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(1)
    );
    repo.absent(&work).await.unwrap();
    let row = sqlx::query!("SELECT m.body_text,t.inbox_visible FROM email_messages m JOIN email_threads t ON t.id = m.thread_id WHERE m.link_id = $1 AND m.provider_id = $2",link,work.provider_id.as_str()).fetch_one(&db).await.unwrap();
    assert_eq!(row.body_text.as_deref(), Some("retained content"));
    assert!(!row.inbox_visible);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_ingestion_cannot_overwrite_a_reconnected_mailbox(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let stream = repo
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    repo.commit_page(&stream, &page()).await.unwrap();
    let work = repo
        .claim_message(macro_uuid::generate_uuid_v7())
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
        repo.ingest(
            &work,
            snapshot(link, work.provider_id.as_str(), Default::default(), "v1")
        )
        .await,
        Err(MailboxError::Stale)
    ));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_messages WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn projection_ack_keeps_version_watermark_and_exposes_normalized_state(db: PgPool) {
    use crate::domain::mailbox::projection::MailboxProjectionRepository;
    let (repo, link) = fixture(&db).await;
    let stream = repo
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    repo.commit_page(&stream, &page()).await.unwrap();
    let work = repo
        .claim_message(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    let state = email_api_client::domain::models::MailboxState {
        in_inbox: true,
        ..Default::default()
    };
    repo.ingest(
        &work,
        snapshot(link, work.provider_id.as_str(), state.clone(), "v1"),
    )
    .await
    .unwrap();
    let event = repo
        .claim_projection(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    let context = repo.projection_context(&event).await.unwrap().unwrap();
    let message = context.message.unwrap();
    assert!(message.in_inbox);
    assert!(
        !message.in_trash,
        "user category TRASH is not a physical trash folder"
    );
    assert!(message.is_present);
    repo.renew_projection(&event).await.unwrap();
    repo.finish_projection(&event, true).await.unwrap();
    repo.ingest(
        &work,
        snapshot(link, work.provider_id.as_str(), state, "v1"),
    )
    .await
    .unwrap();
    assert!(
        repo.claim_projection(macro_uuid::generate_uuid_v7())
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn projection_crash_reclaims_work_and_old_worker_cannot_ack_successor(db: PgPool) {
    use crate::domain::mailbox::projection::MailboxProjectionRepository;
    let (repo, link) = fixture(&db).await;
    let payload = serde_json::json!({"kind":"link_connected","actor_id":"macro|outlook-test@example.com","is_new":true});
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload) VALUES ($1,$2,1,$3)",
        macro_uuid::generate_uuid_v7(),
        link,
        payload
    )
    .execute(&db)
    .await
    .unwrap();
    let old = repo
        .claim_projection(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    sqlx::query!("UPDATE email_projection_outbox SET lease_until = now() - interval '1 second' WHERE id = $1",old.id).execute(&db).await.unwrap();
    let successor = repo
        .claim_projection(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(
        repo.renew_projection(&old).await,
        Err(MailboxError::Stale)
    ));
    repo.finish_projection(&old, true).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_projection_outbox WHERE id = $1",
            old.id
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(1)
    );
    repo.finish_projection(&successor, true).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mailbox_previews_distinguish_categories_trash_and_imported_drafts(db: PgPool) {
    use crate::domain::{
        models::{PreviewCursorQuery, PreviewView, PreviewViewStandardLabel},
        ports::EmailRepo,
    };
    use macro_user_id::user_id::MacroUserIdStr;
    use models_pagination::{Query, SimpleSortMethod};
    let (sync, link) = fixture(&db).await;
    let stream = sync
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    sync.commit_page(&stream, &page()).await.unwrap();
    let work = sync
        .claim_message(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    let repo = crate::outbound::EmailPgRepo::new(db.clone());
    let state = email_api_client::domain::models::MailboxState {
        in_inbox: true,
        ..Default::default()
    };
    sync.ingest(
        &work,
        snapshot(link, work.provider_id.as_str(), state, "one"),
    )
    .await
    .unwrap();
    let read = |view| {
        repo.previews_for_view_cursor(
            PreviewCursorQuery {
                view: PreviewView::StandardLabel(view),
                link_ids: vec![link],
                limit: 50,
                query: Query::new(None, SimpleSortMethod::UpdatedAt, None),
                team_id: None,
            },
            MacroUserIdStr::try_from_email("outlook-test@example.com").unwrap(),
        )
    };
    assert_eq!(
        read(PreviewViewStandardLabel::Inbox).await.unwrap().len(),
        1,
        "a TRASH category is still inbox mail"
    );
    assert_eq!(read(PreviewViewStandardLabel::All).await.unwrap().len(), 1);
    sync.ingest(
        &work,
        snapshot(
            link,
            work.provider_id.as_str(),
            email_api_client::domain::models::MailboxState {
                in_trash: true,
                ..Default::default()
            },
            "two",
        ),
    )
    .await
    .unwrap();
    assert!(
        read(PreviewViewStandardLabel::Inbox)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        read(PreviewViewStandardLabel::All)
            .await
            .unwrap()
            .is_empty()
    );
    sync.ingest(
        &work,
        snapshot(
            link,
            work.provider_id.as_str(),
            email_api_client::domain::models::MailboxState {
                is_draft: true,
                ..Default::default()
            },
            "three",
        ),
    )
    .await
    .unwrap();
    assert_eq!(
        read(PreviewViewStandardLabel::Drafts).await.unwrap().len(),
        1,
        "imported drafts have provider timestamps"
    );
    sync.absent(&work).await.unwrap();
    assert!(
        read(PreviewViewStandardLabel::Drafts)
            .await
            .unwrap()
            .is_empty(),
        "a deleted remote draft must disappear unless a local edit needs recovery"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn folder_delete_and_restore_reprojects_unchanged_message_etags(db: PgPool) {
    use email_api_client::domain::models::MailboxState;
    let (repo, link) = fixture(&db).await;
    sqlx::query!("INSERT INTO email_sync_streams(id,link_id,generation,kind,scope_id) VALUES($1,$2,1,'folder_catalog','mail')",Uuid::new_v4(),link).execute(&db).await.unwrap();
    let mut folders = vec![
        MailFolder {
            id: ProviderId::new("trash").unwrap(),
            parent_id: None,
            name: "Trash".into(),
            role: FolderRole::Trash,
            has_children: true,
        },
        MailFolder {
            id: ProviderId::new("parent").unwrap(),
            parent_id: None,
            name: "Projects".into(),
            role: FolderRole::Other,
            has_children: true,
        },
        MailFolder {
            id: ProviderId::new("folder").unwrap(),
            parent_id: Some(ProviderId::new("parent").unwrap()),
            name: "Invoices".into(),
            role: FolderRole::Other,
            has_children: false,
        },
    ];
    let catalog = repo.claim_catalog(Uuid::new_v4()).await.unwrap().unwrap();
    repo.commit_catalog(&catalog, &folders).await.unwrap();
    sqlx::query!("INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import) VALUES($1,1,'same-message',true)",link).execute(&db).await.unwrap();
    let initial = repo.claim_message(Uuid::new_v4()).await.unwrap().unwrap();
    repo.ingest(
        &initial,
        snapshot(
            link,
            "same-message",
            MailboxState::default(),
            "unchanged-etag",
        ),
    )
    .await
    .unwrap();
    repo.complete_message(&initial).await.unwrap();
    for deleted in [true, false] {
        folders[1].parent_id = deleted.then(|| ProviderId::new("trash").unwrap());
        sqlx::query!("UPDATE email_sync_streams SET next_run_at=now() WHERE link_id=$1 AND kind='folder_catalog'",link).execute(&db).await.unwrap();
        let catalog = repo.claim_catalog(Uuid::new_v4()).await.unwrap().unwrap();
        repo.commit_catalog(&catalog, &folders).await.unwrap();
        let work = repo.claim_message(Uuid::new_v4()).await.unwrap().unwrap();
        assert_eq!(work.provider_id.as_str(), "same-message");
        repo.ingest(
            &work,
            snapshot(
                link,
                "same-message",
                MailboxState {
                    in_trash: deleted,
                    ..Default::default()
                },
                "unchanged-etag",
            ),
        )
        .await
        .unwrap();
        repo.complete_message(&work).await.unwrap();
        let state=sqlx::query_scalar!("SELECT (mailbox_state->>'in_trash')::boolean FROM email_messages WHERE link_id=$1 AND provider_id='same-message'",link).fetch_one(&db).await.unwrap();
        assert_eq!(state, Some(deleted));
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn completed_import_rechecks_attachments_after_later_sent_correspondence(db: PgPool) {
    use email_api_client::domain::models::MailboxState;
    use models_email::service::address::ContactInfo;
    let (repo, link) = fixture(&db).await;
    sqlx::query!("INSERT INTO email_sync_streams(id,link_id,generation,kind,scope_id,initial_complete) VALUES($1,$2,1,'folder_catalog','mail',true)",Uuid::new_v4(),link).execute(&db).await.unwrap();
    let stream = repo.claim_stream(Uuid::new_v4()).await.unwrap().unwrap();
    repo.commit_page(
        &stream,
        &MailboxChangePage {
            changed: vec![
                ProviderId::new("a-incoming").unwrap(),
                ProviderId::new("z-sent").unwrap(),
            ],
            removed: vec![],
            position: StreamPosition::Checkpoint(StreamToken::new("finished".into())),
        },
    )
    .await
    .unwrap();
    let incoming = repo.claim_message(Uuid::new_v4()).await.unwrap().unwrap();
    assert_eq!(incoming.provider_id.as_str(), "a-incoming");
    let mut received = snapshot(link, "a-incoming", MailboxState::default(), "received-v1");
    received.content.message.from = Some(ContactInfo {
        email: "friend@external.invalid".into(),
        name: None,
        photo_url: None,
    });
    received.content.message.attachments=vec![serde_json::from_value(serde_json::json!({"db_id":Uuid::new_v4(),"provider_id":"pdf","filename":"contract.pdf","mime_type":"application/pdf","size_bytes":10})).unwrap()];
    received.content.message.has_attachments = true;
    repo.ingest(&incoming, received).await.unwrap();
    repo.complete_message(&incoming).await.unwrap();
    assert!(
        email_db_client::attachments::provider::upload::new_email_document_atts(
            &db,
            link,
            "a-incoming"
        )
        .await
        .unwrap()
        .is_empty()
    );
    let sent = repo.claim_message(Uuid::new_v4()).await.unwrap().unwrap();
    let mut sent_message = snapshot(link, "z-sent", MailboxState::default(), "sent-v1");
    sent_message.content.message.provider_thread_id = Some("different-conversation".into());
    sent_message.content.message.is_sent = true;
    sent_message.content.message.from = Some(ContactInfo {
        email: "outlook-test@example.com".into(),
        name: None,
        photo_url: None,
    });
    sent_message.content.message.to = vec![ContactInfo {
        email: "friend@external.invalid".into(),
        name: None,
        photo_url: None,
    }];
    repo.ingest(&sent, sent_message).await.unwrap();
    repo.complete_message(&sent).await.unwrap();
    repo.complete_message(&sent).await.unwrap();
    let queued=sqlx::query!("SELECT generation,payload FROM email_projection_outbox WHERE link_id=$1 AND payload->>'kind'='attachment_recheck'",link).fetch_all(&db).await.unwrap();
    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0].generation, 1);
    let eligible = email_db_client::attachments::provider::upload::new_email_document_atts(
        &db,
        link,
        "a-incoming",
    )
    .await
    .unwrap();
    assert_eq!(eligible.len(), 1);
    assert_eq!(
        queued[0].payload["message_id"],
        eligible[0].message_db_id.to_string()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn native_outlook_attachment_identity_survives_metadata_collisions_and_empty_snapshots(
    db: PgPool,
) {
    use email_api_client::domain::models::MailboxState;
    let (repo, link) = fixture(&db).await;
    let mut retained = None;
    for (revision, ids) in [
        (1, vec!["file-a", "file-b"]),
        (2, vec!["file-b"]),
        (3, vec!["replacement"]),
        (4, vec![]),
    ] {
        sqlx::query!("INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import) VALUES($1,1,'native-draft',false)",link).execute(&db).await.unwrap();
        let work = repo.claim_message(Uuid::new_v4()).await.unwrap().unwrap();
        let mut message = snapshot(
            link,
            "native-draft",
            MailboxState {
                is_draft: true,
                ..Default::default()
            },
            &format!("v{revision}"),
        );
        message.content.message.attachments=ids.iter().map(|id|serde_json::from_value(serde_json::json!({"db_id":Uuid::new_v4(),"provider_id":id,"filename":"same.pdf","mime_type":"application/pdf","size_bytes":8})).unwrap()).collect();
        message.content.message.has_attachments = !ids.is_empty();
        repo.ingest(&work, message).await.unwrap();
        repo.complete_message(&work).await.unwrap();
        let attachments=sqlx::query!("SELECT a.id,a.provider_attachment_id FROM email_attachments a JOIN email_messages m ON m.id=a.message_id WHERE m.link_id=$1 ORDER BY a.provider_attachment_id",link).fetch_all(&db).await.unwrap();
        assert_eq!(
            attachments
                .iter()
                .map(|a| a.provider_attachment_id.as_deref().unwrap())
                .collect::<Vec<_>>(),
            ids
        );
        if revision == 1 {
            retained = Some(attachments[1].id);
        }
        if revision == 2 {
            assert_eq!(Some(attachments[0].id), retained);
        }
        if revision == 3 {
            assert_ne!(Some(attachments[0].id), retained);
        }
    }
}
