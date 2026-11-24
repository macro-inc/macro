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
        .into_lease()
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_conflict_resolution_runs_beside_a_population_and_gives_up_behind_a_worker(db: PgPool) {
    use crate::domain::models::{EmailErr, mailbox_operation::*};
    let (sync, repo, input, link) = setup(&db, true).await;
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    sync.fail_draft(&lease, DraftFailure::Conflict)
        .await
        .unwrap();
    let actor =
        macro_user_id::user_id::MacroUserIdStr::try_from_email("outlook-test@example.com").unwrap();
    let facts = repo
        .message_operation_facts(&[input.db_id])
        .await
        .unwrap()
        .remove(&input.db_id)
        .unwrap();
    let plan = || {
        plan_resolution(
            facts.clone(),
            MessageResolutionRequest {
                message_id: input.db_id,
                revision: facts.revision,
                remote_version: facts.remote_version.clone(),
                action: MessageResolutionAction::UseProvider,
                accept_duplicate_risk: false,
            },
        )
        .unwrap()
    };
    let resolve = |plan| {
        tokio::time::timeout(
            std::time::Duration::from_secs(10),
            repo.commit_message_resolution(&actor, plan),
        )
    };
    let state = || async {
        sqlx::query_scalar!(
            "SELECT state FROM email_mailbox_drafts WHERE message_id = $1",
            input.db_id
        )
        .fetch_one(&db)
        .await
        .unwrap()
    };
    let failed = state().await;

    // A mailbox worker or a disconnect holds the link exclusively.
    let mut worker = db.begin().await.unwrap();
    sqlx::query!("SELECT id FROM email_links WHERE id = $1 FOR UPDATE", link)
        .fetch_one(&mut *worker)
        .await
        .unwrap();
    let blocked = resolve(plan()).await.expect("waited past its lock timeout");
    assert!(matches!(blocked, Err(EmailErr::Contended)), "{blocked:?}");
    assert_eq!(state().await, failed);
    worker.rollback().await.unwrap();

    // A CRM contact population holds it this way for its whole transaction.
    let mut population = db.begin().await.unwrap();
    sqlx::query!("SELECT id FROM email_links WHERE id = $1 FOR SHARE", link)
        .fetch_one(&mut *population)
        .await
        .unwrap();
    resolve(plan())
        .await
        .expect("waited past its lock timeout")
        .unwrap();
    population.rollback().await.unwrap();
    assert_ne!(state().await, failed);
}
