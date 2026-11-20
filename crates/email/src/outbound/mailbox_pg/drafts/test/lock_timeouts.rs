use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_checkpoint_behind_a_locked_draft_message_fails_fast_then_commits(db: PgPool) {
    let (sync, _, input, _) = setup(&db, true).await;
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    let stored = sqlx::query_scalar!(
        "SELECT checkpoint FROM email_mailbox_drafts WHERE message_id = $1",
        input.db_id
    )
    .fetch_one(&db)
    .await
    .unwrap();

    // Another transaction writing the draft's message holds its row.
    let mut writer = db.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM email_messages WHERE id = $1 FOR UPDATE",
        input.db_id
    )
    .fetch_one(&mut *writer)
    .await
    .unwrap();

    let cp = checkpoint(&lease, DraftStage::Attachments);
    let blocked = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        sync.checkpoint_draft(&lease, &cp),
    )
    .await;
    assert!(
        matches!(
            &blocked,
            Ok(Err(MailboxError::Database(DatabaseFailure::Sqlstate(code)))) if code == "55P03"
        ),
        "{blocked:?}"
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT checkpoint FROM email_mailbox_drafts WHERE message_id = $1",
            input.db_id
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        stored
    );

    writer.rollback().await.unwrap();
    sync.checkpoint_draft(&lease, &cp).await.unwrap();
    let committed = sqlx::query_scalar!(
        "SELECT checkpoint FROM email_mailbox_drafts WHERE message_id = $1",
        input.db_id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(committed, Some(serde_json::to_value(&cp).unwrap()));
}
