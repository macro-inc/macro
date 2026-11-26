use super::*;
use email::outbound::EmailPgRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn label_batches_follow_the_shared_chunking_snapshot(pool: PgPool) {
    use email::domain::models::mailbox_action::{MailboxActionChunking, PendingMailboxState};

    let link = Uuid::now_v7();
    let thread = Uuid::now_v7();
    let actor = MacroUserIdStr::try_from_email("label-test@example.com").unwrap();
    sqlx::query!("INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider) VALUES($1,$2,'label-owner','label-test@example.com','IMAP')", link, actor.as_ref())
        .execute(&pool).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_threads(id,link_id) VALUES($1,$2)",
        thread,
        link
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO email_labels(id,link_id,provider_label_id,name,type) VALUES($1,$2,'Projects','Projects','User')", Uuid::now_v7(), link)
        .execute(&pool).await.unwrap();
    let ids: Vec<_> = (0..65).map(|_| Uuid::now_v7()).collect();
    let providers: Vec<_> = ids.iter().map(ToString::to_string).collect();
    sqlx::query!("INSERT INTO email_messages(id,link_id,thread_id,provider_id) SELECT input.id,$3,$4,input.provider FROM unnest($1::uuid[],$2::text[]) input(id,provider)", &ids, &providers, link, thread)
        .execute(&pool).await.unwrap();
    let targets: Vec<_> = ids
        .into_iter()
        .zip(providers)
        .map(|(message_id, provider_id)| MailboxActionTarget {
            message_id,
            provider_id: Some(provider_id),
            pending: PendingMailboxState::default(),
        })
        .collect();
    let switch = MailboxActionChunking::default();
    let repository = PgMessageLabels(
        pool.clone(),
        EmailPgRepo::new(pool.clone()).with_action_chunking(switch.clone()),
    );
    let action = MailboxAction::Category {
        name: "Projects".into(),
        present: true,
    };
    for (enabled, expected_commands) in [(false, 1_i64), (true, 2_i64)] {
        switch.set(enabled);
        let id = repository
            .enqueue_mailbox_action(link, actor.clone(), &action, &targets)
            .await
            .unwrap();
        let chunks = sqlx::query!(r#"SELECT c.action_id,(SELECT count(*) FROM email_mailbox_command_targets t WHERE t.command_id=c.id) AS "targets!" FROM email_mailbox_commands c WHERE c.id=$1 OR c.action_id=$1"#, id)
            .fetch_all(&pool).await.unwrap();
        assert_eq!(i64::try_from(chunks.len()).unwrap(), expected_commands);
        assert_eq!(chunks.iter().map(|row| row.targets).sum::<i64>(), 65);
        if enabled {
            assert!(
                chunks
                    .iter()
                    .all(|row| row.action_id == Some(id) && row.targets <= 64)
            );
        } else {
            assert!(chunks.iter().all(|row| row.action_id.is_none()));
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_write_that_can_be_neither_queued_nor_undone_fails_the_request(pool: PgPool) {
    pool.close().await;

    let error = PgMessageLabels(pool.clone(), EmailPgRepo::new(pool))
        .revert_unsent(
            Uuid::now_v7(),
            &[Uuid::now_v7()],
            &[Uuid::now_v7()],
            Uuid::now_v7(),
        )
        .await
        .unwrap_err();

    assert!(matches!(error, MessageLabelPersistenceError::Database(_)));
}
