use super::*;
use crate::domain::models::mailbox_action::{
    MailboxActionChunking, MailboxActionTarget, MailboxOperation, MailboxOperationState,
};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unrecognized_terminal_status_cannot_report_an_applied_action(db: PgPool) {
    let (_, repo, work, thread) = setup(&db).await;
    let targets = targets(&db, work.mailbox.link_id, thread, 1).await;
    let id = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Flagged(true),
            &targets,
        )
        .await
        .unwrap();
    // Simulate a newer binary's status in this isolated test database.
    sqlx::query!(
        "ALTER TABLE email_mailbox_commands DROP CONSTRAINT email_mailbox_commands_status_check"
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_mailbox_commands SET status='future_terminal' WHERE id=$1",
        id
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(
        repo.thread_mailbox_operations(work.mailbox.link_id, thread)
            .await
            .is_err()
    );
}

pub(super) async fn targets(
    db: &PgPool,
    link: Uuid,
    thread: Uuid,
    count: usize,
) -> Vec<MailboxActionTarget> {
    let ids: Vec<Uuid> = (0..count).map(|_| Uuid::now_v7()).collect();
    let provider_ids: Vec<String> = ids.iter().map(|id| format!("group-{id}")).collect();
    sqlx::query!(
        r#"INSERT INTO email_messages(id,thread_id,link_id,provider_id)
           SELECT input.id,$3,$4,input.provider_id
           FROM unnest($1::uuid[],$2::text[]) input(id,provider_id)"#,
        &ids,
        &provider_ids,
        thread,
        link,
    )
    .execute(db)
    .await
    .unwrap();
    ids.into_iter()
        .zip(provider_ids)
        .map(|(message_id, provider_id)| MailboxActionTarget {
            message_id,
            provider_id: Some(provider_id),
            pending: PendingMailboxState {
                is_flagged: Some(true),
                ..Default::default()
            },
        })
        .collect()
}

async fn flagged(
    repo: &crate::outbound::EmailPgRepo,
    link: Uuid,
    thread: Uuid,
) -> MailboxOperation {
    let mut operations: Vec<_> = repo
        .thread_mailbox_operations(link, thread)
        .await
        .unwrap()
        .into_iter()
        .filter(|operation| matches!(operation.action, MailboxAction::Flagged(true)))
        .collect();
    assert_eq!(operations.len(), 1, "one action must have one receipt");
    operations.remove(0)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_default_off_path_keeps_one_legacy_command(db: PgPool) {
    let (_, repo, work, thread) = setup(&db).await;
    let targets = targets(&db, work.mailbox.link_id, thread, 65).await;
    let action = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Flagged(true),
            &targets,
        )
        .await
        .unwrap();
    let rows = sqlx::query!(
        r#"SELECT c.id,c.action_id,
            (SELECT count(*) FROM email_mailbox_command_targets t WHERE t.command_id=c.id) AS "targets!"
            FROM email_mailbox_commands c WHERE c.link_id=$1"#,
        work.mailbox.link_id,
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, action);
    assert_eq!(rows[0].action_id, None);
    assert_eq!(rows[0].targets, 65);
    assert!(matches!(
        flagged(&repo, work.mailbox.link_id, thread).await.state,
        MailboxOperationState::Pending
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_long_action_keeps_its_early_failure_in_one_grouped_receipt(db: PgPool) {
    let (_, repo, work, thread) =
        setup_for_provider(&db, crate::domain::models::UserProvider::Imap).await;
    let switch = MailboxActionChunking::default();
    switch.set(true);
    let repo = repo.with_action_chunking(switch);
    let targets = targets(&db, work.mailbox.link_id, thread, 5000).await;
    let action = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Flagged(true),
            &targets,
        )
        .await
        .unwrap();
    let rows = sqlx::query!(
        r#"SELECT c.id,c.action_id,
            (SELECT count(*) FROM email_mailbox_command_targets t WHERE t.command_id=c.id) AS "targets!"
            FROM email_mailbox_commands c WHERE c.link_id=$1 ORDER BY c.accepted_order"#,
        work.mailbox.link_id,
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert!(rows.len() > 1);
    assert_eq!(rows[0].id, action);
    assert!(
        rows.iter()
            .all(|row| row.action_id == Some(action) && row.targets <= 64)
    );
    assert_eq!(rows.iter().map(|row| row.targets).sum::<i64>(), 5000);
    sqlx::query!(
        "UPDATE email_mailbox_commands SET status='failed' WHERE id=$1",
        action
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        flagged(&repo, work.mailbox.link_id, thread).await.state,
        MailboxOperationState::Pending
    ));
    sqlx::query!(
        "UPDATE email_mailbox_commands SET status='succeeded' WHERE action_id=$1 AND id<>$1",
        action
    )
    .execute(&db)
    .await
    .unwrap();
    let receipt = flagged(&repo, work.mailbox.link_id, thread).await;
    assert!(
        matches!(receipt.state, MailboxOperationState::Failed),
        "a successful tail must not hide an early failed chunk"
    );
    assert_eq!(receipt.id, action);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cancellation_and_unknown_keep_the_single_command_precedence(db: PgPool) {
    let (_, repo, work, thread) = setup(&db).await;
    let switch = MailboxActionChunking::default();
    switch.set(true);
    let repo = repo.with_action_chunking(switch);
    let targets = targets(&db, work.mailbox.link_id, thread, 129).await;
    let action = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Flagged(true),
            &targets,
        )
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE email_mailbox_commands SET status='failed' WHERE id=$1",
        action
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!("UPDATE email_mailbox_commands SET status='unknown' WHERE id=(SELECT id FROM email_mailbox_commands WHERE action_id=$1 AND id<>$1 ORDER BY accepted_order LIMIT 1)", action).execute(&db).await.unwrap();
    assert!(matches!(
        flagged(&repo, work.mailbox.link_id, thread).await.state,
        MailboxOperationState::Pending
    ));
    sqlx::query!("UPDATE email_mailbox_commands SET status='succeeded' WHERE action_id=$1 AND status='pending'", action).execute(&db).await.unwrap();
    // The existing single-command reader maps both unknown and cancelled to
    // Cancelled; cancellation after an earlier target failure wins there too.
    assert!(matches!(
        flagged(&repo, work.mailbox.link_id, thread).await.state,
        MailboxOperationState::Cancelled
    ));
    sqlx::query!("UPDATE email_mailbox_commands SET status='cancelled' WHERE action_id=$1 AND status='unknown'", action).execute(&db).await.unwrap();
    assert!(matches!(
        flagged(&repo, work.mailbox.link_id, thread).await.state,
        MailboxOperationState::Cancelled
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_does_not_hide_an_early_failed_chunk(db: PgPool) {
    let (_, repo, work, thread) = setup(&db).await;
    let switch = MailboxActionChunking::default();
    switch.set(true);
    let repo = repo.with_action_chunking(switch);
    let targets = targets(&db, work.mailbox.link_id, thread, 65).await;
    let action = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Flagged(true),
            &targets,
        )
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE email_mailbox_commands SET status='failed' WHERE id=$1",
        action
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_links SET sync_generation=2 WHERE id=$1",
        work.mailbox.link_id
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!("UPDATE email_mailbox_commands SET generation=2,status='succeeded' WHERE action_id=$1 AND id<>$1", action).execute(&db).await.unwrap();
    let receipt = flagged(&repo, work.mailbox.link_id, thread).await;
    assert!(matches!(receipt.state, MailboxOperationState::Failed));
    assert_eq!(receipt.id, action);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_later_chunk_enqueue_failure_rolls_back_the_whole_action(db: PgPool) {
    let (_, repo, work, thread) = setup(&db).await;
    let switch = MailboxActionChunking::default();
    switch.set(true);
    let repo = repo.with_action_chunking(switch);
    let mut targets = targets(&db, work.mailbox.link_id, thread, 65).await;
    targets[64].provider_id = Some("not-the-current-provider-id".into());
    let before = sqlx::query_scalar!(
        "SELECT count(*) FROM email_mailbox_commands WHERE link_id=$1",
        work.mailbox.link_id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(
        repo.enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Flagged(true),
            &targets
        )
        .await
        .is_err()
    );
    let after = sqlx::query_scalar!(
        "SELECT count(*) FROM email_mailbox_commands WHERE link_id=$1",
        work.mailbox.link_id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(before, after);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_pending_mailbox_state WHERE message_id=ANY($1)",
            &targets
                .iter()
                .map(|target| target.message_id)
                .collect::<Vec<_>>()
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(0)
    );
}
