use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn old_writer_inserts_and_parent_transitions_keep_target_facts_current(db: PgPool) {
    let (_, repo, work, thread) = setup(&db).await;
    let messages = repo
        .mailbox_action_messages(work.mailbox.link_id, thread)
        .await
        .unwrap();
    let id = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Read(true),
            &MailboxAction::Read(true).targets(&messages),
        )
        .await
        .unwrap();
    let parent = sqlx::query!(
        "SELECT link_id,generation,accepted_order FROM email_mailbox_commands WHERE id=$1",
        id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let inserted = sqlx::query!(
        r#"SELECT parent_link_id,parent_generation,parent_accepted_order,parent_unfinished,
               ctid::text AS "tuple!"
           FROM email_mailbox_command_targets WHERE command_id=$1"#,
        id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(inserted.parent_link_id, Some(parent.link_id));
    assert_eq!(inserted.parent_generation, Some(parent.generation));
    assert_eq!(inserted.parent_accepted_order, Some(parent.accepted_order));
    assert_eq!(inserted.parent_unfinished, Some(true));

    for status in ["running", "confirming"] {
        sqlx::query!(
            "UPDATE email_mailbox_commands SET status=$2 WHERE id=$1",
            id,
            status,
        )
        .execute(&db)
        .await
        .unwrap();
        assert!(
            sqlx::query_scalar!(
                r#"SELECT ctid::text=$2 AS "unchanged!"
                   FROM email_mailbox_command_targets WHERE command_id=$1"#,
                id,
                &inserted.tuple,
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            "nonterminal transitions must not rewrite or lock every target"
        );
    }

    sqlx::query!(
        "UPDATE email_mailbox_commands SET generation=generation+1,status='pending' WHERE id=$1",
        id,
    )
    .execute(&db)
    .await
    .unwrap();
    let rebound = sqlx::query!(
        "SELECT parent_generation,parent_accepted_order FROM email_mailbox_command_targets WHERE command_id=$1",
        id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(
        rebound.parent_generation,
        Some(parent.generation + 1),
        "generation facts must follow the parent"
    );
    assert_eq!(rebound.parent_accepted_order, Some(parent.accepted_order));

    for terminal in ["succeeded", "failed", "conflict", "cancelled", "unknown"] {
        sqlx::query!(
            "UPDATE email_mailbox_commands SET status='pending' WHERE id=$1",
            id,
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query!(
            "UPDATE email_mailbox_commands SET status=$2 WHERE id=$1",
            id,
            terminal,
        )
        .execute(&db)
        .await
        .unwrap();
        assert!(
            sqlx::query_scalar!(
                r#"SELECT parent_unfinished=false AND parent_generation=$2
                       AND parent_accepted_order=$3 AS "terminal!"
                   FROM email_mailbox_command_targets WHERE command_id=$1"#,
                id,
                parent.generation + 1,
                parent.accepted_order,
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            "terminal {terminal} must leave the predecessor index"
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_succeeded_target_of_an_unfinished_command_still_blocks_its_successor(db: PgPool) {
    let (sync, _, work, thread) = setup(&db).await;
    let message = sqlx::query_scalar!(
        "SELECT id FROM email_messages WHERE link_id=$1 AND provider_id=$2",
        work.mailbox.link_id,
        work.provider_id.as_str(),
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let other = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_messages (id,thread_id,link_id,provider_id) VALUES ($1,$2,$3,'other')",
        other,
        thread,
        work.mailbox.link_id,
    )
    .execute(&db)
    .await
    .unwrap();
    let first = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_mailbox_commands (id,link_id,generation,actor_id,intent,status)
           VALUES ($1,$2,1,'macro|outlook-test@example.com','{"kind":"read","value":true}','pending')"#,
        first,
        work.mailbox.link_id,
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO email_mailbox_command_targets (command_id,message_id,provider_id)
           VALUES ($1,$2,$4),($1,$3,'other')"#,
        first,
        message,
        other,
        work.provider_id.as_str(),
    )
    .execute(&db)
    .await
    .unwrap();
    let lease = sync
        .claim_command(Uuid::now_v7())
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(lease.id, first);
    sqlx::query!(
        "UPDATE email_mailbox_command_targets SET status='succeeded' WHERE command_id=$1 AND message_id=$2",
        first,
        message,
    )
    .execute(&db)
    .await
    .unwrap();
    let second = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_mailbox_commands (id,link_id,generation,actor_id,intent,status)
           VALUES ($1,$2,1,'macro|outlook-test@example.com','{"kind":"read","value":false}','pending')"#,
        second,
        work.mailbox.link_id,
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_mailbox_command_targets (command_id,message_id,provider_id) VALUES ($1,$2,$3)",
        second,
        message,
        work.provider_id.as_str(),
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        sync.claim_command(Uuid::now_v7()).await.unwrap(),
        SyncClaim::Progress
    ));
    sync.finish_command(&lease, CommandCompletion::Succeeded)
        .await
        .unwrap();
    let next = sync
        .claim_command(Uuid::now_v7())
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(next.id, second);
}
