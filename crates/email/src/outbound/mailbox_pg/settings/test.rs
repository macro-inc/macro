use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|outlook-test@example.com").unwrap()
}
async fn category(db: &PgPool, link: Uuid) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_labels(id,link_id,provider_label_id,name,type) VALUES($1,$2,'Projects','Projects','User')",id,link)
        .execute(db).await.unwrap();
    id
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_category_is_durable_and_foreign_inbox_cannot_queue_cleanup(db: PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;
    let label = category(&db, link).await;
    let outsider = MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap();
    assert!(repo.delete_label(&outsider, link, label).await.is_err());
    assert!(
        repo.claim_settings(Uuid::now_v7(), true, true)
            .await
            .unwrap()
            .is_none()
    );
    repo.delete_label(&actor(), link, label).await.unwrap();
    let lease = repo
        .claim_settings(Uuid::now_v7(), true, true)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(lease.resource, "Projects");
    assert_eq!(lease.kind, "delete_label");
    assert!(
        repo.claim_settings(Uuid::now_v7(), true, true)
            .await
            .unwrap()
            .is_none()
    );
    repo.finish_settings(&lease, false, 0, None).await.unwrap();
    let retry = repo
        .claim_settings(Uuid::now_v7(), true, true)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(lease.id, retry.id);
    assert!(matches!(
        repo.finish_settings(&lease, true, 0, None).await,
        Err(MailboxError::Stale)
    ));
    repo.finish_settings(&retry, true, 0, None).await.unwrap();
    assert!(
        sqlx::query!("SELECT id FROM email_labels WHERE id=$1", label)
            .fetch_optional(&db)
            .await
            .unwrap()
            .is_none()
    );
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sender_changes_keep_rule_ownership_and_old_revision_cannot_ack_a_new_intent(db: PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;
    repo.sender_block(&actor(), link, "blocked@example.com", true)
        .await
        .unwrap();
    let first = repo
        .claim_settings(Uuid::now_v7(), true, true)
        .await
        .unwrap()
        .unwrap();
    repo.sender_block(&actor(), link, "blocked@example.com", false)
        .await
        .unwrap();
    assert!(matches!(
        repo.finish_settings(&first, true, 0, None).await,
        Err(MailboxError::Stale)
    ));
    sqlx::query!(
        "UPDATE email_mailbox_settings_work SET lease_until=now()-interval '1 second' WHERE id=$1",
        first.id
    )
    .execute(&db)
    .await
    .unwrap();
    let second = repo
        .claim_settings(Uuid::now_v7(), true, true)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first.id, second.id);
    assert!(second.revision > first.revision);
    assert!(!second.desired);
    repo.finish_settings(&second, true, 0, None).await.unwrap();
    assert!(
        repo.claim_settings(Uuid::now_v7(), true, true)
            .await
            .unwrap()
            .is_none()
    );
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_fences_old_settings_work_without_losing_accepted_intent(db: PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;
    repo.sender_block(&actor(), link, "blocked@example.com", true)
        .await
        .unwrap();
    let first = repo
        .claim_settings(Uuid::now_v7(), true, true)
        .await
        .unwrap()
        .unwrap();
    sqlx::query!(
        "UPDATE email_links SET sync_generation=sync_generation+1 WHERE id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.renew_settings(&first).await,
        Err(MailboxError::Stale)
    ));
    sqlx::query!(
        "UPDATE email_mailbox_settings_work SET lease_until=now()-interval '1 second' WHERE id=$1",
        first.id
    )
    .execute(&db)
    .await
    .unwrap();
    let second = repo
        .claim_settings(Uuid::now_v7(), true, true)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(
        second.mailbox.key.sync_generation,
        first.mailbox.key.sync_generation + 1
    );
    repo.finish_settings(&second, true, 0, None).await.unwrap();
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn catalog_refresh_cannot_restore_a_category_while_cleanup_is_pending(db: PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;
    let label = category(&db, link).await;
    repo.delete_label(&actor(), link, label).await.unwrap();
    let mailbox = repo.accessible(&actor(), link).await.unwrap();
    let normalized = Label {
        id: None,
        link_id: link,
        provider_label_id: "Projects".into(),
        name: Some("Projects".into()),
        created_at: chrono::Utc::now(),
        message_list_visibility: None,
        label_list_visibility: None,
        type_: Some(models_email::service::label::LabelType::User),
    };
    assert!(matches!(
        repo.store_label(&actor(), mailbox, normalized).await,
        Err(MailboxError::Provider(EmailApiError::Conflict))
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn paused_outlook_settings_do_not_run_until_writes_resume(db: PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;
    repo.sender_block(&actor(), link, "blocked@example.com", true)
        .await
        .unwrap();
    assert!(
        repo.claim_settings(Uuid::now_v7(), true, false)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        repo.claim_settings(Uuid::now_v7(), false, false)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        repo.claim_settings(Uuid::now_v7(), false, true)
            .await
            .unwrap()
            .unwrap()
            .resource,
        "blocked@example.com"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn category_creation_is_durable_paused_and_fenced_by_deletion(db: PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;
    let mailbox = repo.accessible(&actor(), link).await.unwrap();
    let outsider = MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap();
    assert!(
        repo.queue_label_creation(&outsider, mailbox, "New category")
            .await
            .is_err()
    );
    let label = repo
        .queue_label_creation(&actor(), mailbox, "New category")
        .await
        .unwrap();
    let retry = repo
        .queue_label_creation(&actor(), mailbox, "New category")
        .await
        .unwrap();
    assert_eq!(label.id, retry.id);
    assert!(
        repo.claim_settings(Uuid::now_v7(), true, false)
            .await
            .unwrap()
            .is_none()
    );
    let create = repo
        .claim_settings(Uuid::now_v7(), true, true)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(create.kind, "create_label");
    assert_eq!(create.revision, 1);
    repo.delete_label(&actor(), link, label.id.unwrap())
        .await
        .unwrap();
    assert!(matches!(
        repo.commit_created_label(&create, label.clone()).await,
        Err(MailboxError::Stale)
    ));
    assert!(
        repo.queue_label_creation(&actor(), mailbox, "New category")
            .await
            .is_err()
    );
    assert!(
        repo.claim_settings(Uuid::now_v7(), true, true)
            .await
            .unwrap()
            .is_none()
    );
    sqlx::query!(
        "UPDATE email_mailbox_settings_work SET lease_until=now()-interval '1 second' WHERE id=$1",
        create.id
    )
    .execute(&db)
    .await
    .unwrap();
    let delete = repo
        .claim_settings(Uuid::now_v7(), true, true)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(delete.kind, "delete_label");
    repo.finish_settings(&delete, true, 0, None).await.unwrap();
    let recreated = repo
        .queue_label_creation(&actor(), mailbox, "New category")
        .await
        .unwrap();
    assert_ne!(recreated.id, label.id);
    let fresh = repo
        .claim_settings(Uuid::now_v7(), true, true)
        .await
        .unwrap()
        .unwrap();
    repo.commit_created_label(&fresh, recreated).await.unwrap();
    assert!(
        repo.claim_settings(Uuid::now_v7(), true, true)
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn catalog_refresh_keeps_optimistic_category_until_creation_finishes(db: PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;
    let mailbox = repo.accessible(&actor(), link).await.unwrap();
    let label = repo
        .queue_label_creation(&actor(), mailbox, "Pending category")
        .await
        .unwrap();
    sqlx::query!("INSERT INTO email_mailbox_settings_work(id,link_id,kind,resource_key,next_run_at) VALUES($1,$2,'catalog','',now()-interval '1 hour')",Uuid::now_v7(),link).execute(&db).await.unwrap();
    let catalog = repo
        .claim_settings(Uuid::now_v7(), true, true)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(catalog.kind, "catalog");
    repo.commit_labels(&catalog, &[]).await.unwrap();
    assert!(
        sqlx::query!("SELECT id FROM email_labels WHERE id=$1", label.id)
            .fetch_optional(&db)
            .await
            .unwrap()
            .is_some()
    );
    repo.finish_settings(&catalog, true, 300, None)
        .await
        .unwrap();
    let create = repo
        .claim_settings(Uuid::now_v7(), true, true)
        .await
        .unwrap()
        .unwrap();
    repo.commit_created_label(&create, label).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pending_settings_status_tracks_confirmation_and_current_grant(db: PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;
    let mailbox = repo.accessible(&actor(), link).await.unwrap();
    repo.sender_block(&actor(), link, "pending@example.com", true)
        .await
        .unwrap();
    let pending = repo.pending_operations(mailbox).await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].resource, "pending@example.com");
    assert!(!pending[0].needs_attention);
    let lease = repo
        .claim_settings(Uuid::now_v7(), true, true)
        .await
        .unwrap()
        .unwrap();
    repo.finish_settings(&lease, false, 0, Some("retry"))
        .await
        .unwrap();
    assert!(repo.pending_operations(mailbox).await.unwrap()[0].needs_attention);
    let lease = repo
        .claim_settings(Uuid::now_v7(), true, true)
        .await
        .unwrap()
        .unwrap();
    repo.finish_settings(&lease, true, 0, None).await.unwrap();
    assert!(repo.pending_operations(mailbox).await.unwrap().is_empty());
    repo.sender_block(&actor(), link, "pending@example.com", false)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE email_links SET grant_generation=grant_generation+1 WHERE id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(repo.pending_operations(mailbox).await.unwrap().is_empty());
    let current = repo.accessible(&actor(), link).await.unwrap();
    assert_eq!(repo.pending_operations(current).await.unwrap().len(), 1);
    assert!(
        repo.accessible(
            &MacroUserIdStr::parse_from_str("macro|stranger@example.com").unwrap(),
            link
        )
        .await
        .is_err()
    );
}
