use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_held_successor_claim_cannot_roll_back_a_fenced_finish(db: PgPool) {
    let (sync, repo, work, thread) = setup(&db).await;
    let messages = repo
        .mailbox_action_messages(work.mailbox.link_id, thread)
        .await
        .unwrap();
    let first = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Read(true),
            &MailboxAction::Read(true).targets(&messages),
        )
        .await
        .unwrap();
    let lease = sync
        .claim_command(Uuid::now_v7())
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(lease.id, first);
    let second = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Flagged(true),
            &MailboxAction::Flagged(true).targets(&messages),
        )
        .await
        .unwrap();
    assert!(matches!(
        sync.claim_command(Uuid::now_v7()).await.unwrap(),
        SyncClaim::Progress
    ));
    let mut held = db.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM email_mailbox_commands WHERE id=$1 FOR UPDATE",
        second
    )
    .fetch_one(&mut *held)
    .await
    .unwrap();

    tokio::time::timeout(
        std::time::Duration::from_secs(4),
        sync.finish_command(&lease, CommandCompletion::Succeeded),
    )
    .await
    .expect("settlement must skip the held row before the five-second lock timeout")
    .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT status FROM email_mailbox_commands WHERE id=$1",
            first
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        "succeeded"
    );
    held.rollback().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn crossed_settlements_commit_before_waking_each_others_heads(db: PgPool) {
    use crate::outbound::mailbox_pg::mutation_claims::MutationWake;

    let (sync, repo, work, thread) = setup(&db).await;
    let messages = repo
        .mailbox_action_messages(work.mailbox.link_id, thread)
        .await
        .unwrap();
    let first = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Read(true),
            &MailboxAction::Read(true).targets(&messages),
        )
        .await
        .unwrap();
    let second = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Flagged(true),
            &MailboxAction::Flagged(true).targets(&messages),
        )
        .await
        .unwrap();
    let mut left = sync.begin_claim().await.unwrap();
    let mut right = sync.begin_claim().await.unwrap();
    // Both settlements own their parent before either wake can inspect the
    // other's still-uncommitted terminal transition.
    sqlx::query!(
        "UPDATE email_mailbox_commands SET status='succeeded' WHERE id=$1",
        first
    )
    .execute(&mut *left)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_mailbox_commands SET status='succeeded' WHERE id=$1",
        second
    )
    .execute(&mut *right)
    .await
    .unwrap();
    let (left, right) = tokio::join!(
        sync.commit_mutation_and_wake(left, work.mailbox, MutationWake::Command(first)),
        sync.commit_mutation_and_wake(right, work.mailbox, MutationWake::Command(second)),
    );
    left.unwrap();
    right.unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_mailbox_commands WHERE id=ANY($1) AND status='succeeded'",
            &[first, second]
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(2)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delayed_leased_and_confirming_predecessors_block_only_overlapping_targets(db: PgPool) {
    let (sync, _, work, thread) = setup(&db).await;
    let message = sqlx::query_scalar!(
        "SELECT id FROM email_messages WHERE link_id = $1 AND provider_id = $2",
        work.mailbox.link_id,
        work.provider_id.as_str(),
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let other = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_messages (id,thread_id,link_id,provider_id) VALUES ($1,$2,$3,'unrelated')",
        other,
        thread,
        work.mailbox.link_id,
    )
    .execute(&db)
    .await
    .unwrap();

    for status in ["pending", "running", "confirming"] {
        let earlier = Uuid::now_v7();
        let later = Uuid::now_v7();
        let unrelated = Uuid::now_v7();
        sqlx::query!(
            r#"
            INSERT INTO email_mailbox_commands
                (id,link_id,generation,actor_id,intent,status,available_at,lease_id,lease_until)
            VALUES ($1,$2,1,'macro|outlook-test@example.com',
                '{"kind":"read","value":true}', $3,now()+interval '1 day',$4,now()+interval '3 minutes')
            "#,
            earlier,
            work.mailbox.link_id,
            status,
            Uuid::now_v7(),
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query!(
            r#"
            INSERT INTO email_mailbox_commands (id,link_id,generation,actor_id,intent,status,available_at)
            VALUES ($1,$3,1,'macro|outlook-test@example.com','{"kind":"read","value":false}','pending',now()-interval '2 minutes'),
                ($2,$3,1,'macro|outlook-test@example.com','{"kind":"flagged","value":true}','pending',now()-interval '1 minute')
            "#,
            later,
            unrelated,
            work.mailbox.link_id,
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query!(
            r#"
            INSERT INTO email_mailbox_command_targets (command_id,provider_id,message_id)
            VALUES ($1,$4,$5),($2,$4,$5),($3,'unrelated',$6)
            "#,
            earlier,
            later,
            unrelated,
            work.provider_id.as_str(),
            message,
            other,
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
        assert_eq!(
            lease.id, unrelated,
            "{status} must block only its own target"
        );
        assert!(
            sync.claim_command(Uuid::now_v7())
                .await
                .unwrap()
                .into_lease()
                .is_none()
        );
        assert!(
            sqlx::query_scalar!(
                r#"SELECT blocked_until > now() AND blocked_until <= now()+interval '60 seconds' AS "bounded!"
                   FROM email_mailbox_commands WHERE id=$1"#,
                later,
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            "a blocked target must return through the 60-second local backstop"
        );
        sqlx::query!(
            "UPDATE email_mailbox_commands SET status='cancelled',lease_id=NULL,lease_until=NULL WHERE link_id=$1",
            work.mailbox.link_id,
        )
        .execute(&db)
        .await
        .unwrap();
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn every_terminal_predecessor_unblocks_its_target(db: PgPool) {
    let (sync, _, work, _) = setup(&db).await;
    let message = sqlx::query_scalar!(
        "SELECT id FROM email_messages WHERE link_id = $1 AND provider_id = $2",
        work.mailbox.link_id,
        work.provider_id.as_str(),
    )
    .fetch_one(&db)
    .await
    .unwrap();
    for status in ["succeeded", "conflict", "failed", "unknown", "cancelled"] {
        let earlier = Uuid::now_v7();
        let later = Uuid::now_v7();
        sqlx::query!(
            r#"
            INSERT INTO email_mailbox_commands (id,link_id,generation,actor_id,intent,status,available_at)
            VALUES ($1,$2,1,'macro|outlook-test@example.com','{"kind":"read","value":true}',$3,now()+interval '1 day')
            "#,
            earlier,
            work.mailbox.link_id,
            status,
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query!(
            r#"
            INSERT INTO email_mailbox_commands (id,link_id,generation,actor_id,intent,status,available_at)
            VALUES ($1,$2,1,'macro|outlook-test@example.com','{"kind":"read","value":false}','pending',now())
            "#,
            later,
            work.mailbox.link_id,
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO email_mailbox_command_targets (command_id,provider_id,message_id) VALUES ($1,$3,$4),($2,$3,$4)",
            earlier,
            later,
            work.provider_id.as_str(),
            message,
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
        assert_eq!(
            lease.id, later,
            "terminal {status} must not block a successor"
        );
        sync.finish_command(&lease, CommandCompletion::Succeeded)
            .await
            .unwrap();
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_enqueue_and_fenced_finish_do_not_lose_the_successor_wake(db: PgPool) {
    let (sync, repo, work, thread) = setup(&db).await;
    let messages = repo
        .mailbox_action_messages(work.mailbox.link_id, thread)
        .await
        .unwrap();
    let first = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Read(true),
            &MailboxAction::Read(true).targets(&messages),
        )
        .await
        .unwrap();
    let lease = sync
        .claim_command(Uuid::now_v7())
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(lease.id, first);
    let messages = repo
        .mailbox_action_messages(work.mailbox.link_id, thread)
        .await
        .unwrap();
    let second = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Read(false),
            &MailboxAction::Read(false).targets(&messages),
        )
        .await
        .unwrap();
    assert!(matches!(
        sync.claim_command(Uuid::now_v7()).await.unwrap(),
        SyncClaim::Progress
    ));
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(3));
    let finish_barrier = barrier.clone();
    let finisher = sync.clone();
    let finish = tokio::spawn(async move {
        finish_barrier.wait().await;
        finisher
            .finish_command(&lease, CommandCompletion::Succeeded)
            .await
    });
    let enqueue_barrier = barrier.clone();
    let enqueue = tokio::spawn(async move {
        enqueue_barrier.wait().await;
        repo.enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Flagged(true),
            &MailboxAction::Flagged(true).targets(&messages),
        )
        .await
    });
    barrier.wait().await;
    finish.await.unwrap().unwrap();
    let third = enqueue.await.unwrap().unwrap();
    assert!(
        sqlx::query_scalar!(
            r#"SELECT blocked_until IS NULL AS "awake!" FROM email_mailbox_commands WHERE id=$1"#,
            second,
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        "the fenced finish must wake its successor without waiting for the backstop"
    );
    let next = sync
        .claim_command(Uuid::now_v7())
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(
        next.id, second,
        "the deferred successor must run immediately after the fenced finish"
    );
    sync.finish_command(&next, CommandCompletion::Succeeded)
        .await
        .unwrap();
    let last = sync
        .claim_command(Uuid::now_v7())
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(
        last.id, third,
        "the concurrent enqueue keeps its accepted target order"
    );
}
