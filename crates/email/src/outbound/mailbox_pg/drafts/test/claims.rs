use super::*;
use std::time::Duration;

mod budget;

// The other half of the 64-key window is reserved for legacy NULL routing.
const NATIVE_DRAFT_WINDOW: usize = 32;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_old_binary_draft_lease_is_not_claimed_again_after_its_commit(db: PgPool) {
    let (sync, _, input, _) = setup(&db, false).await;
    let mut old = db.begin().await.unwrap();
    sqlx::query!("SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('email.outlook.mutation-claims',0))")
        .fetch_one(&mut *old).await.unwrap();
    sqlx::query!("UPDATE email_mailbox_drafts SET claimed_content=desired_content,state='running',lease_id=$2,lease_until=now()+interval '3 minutes' WHERE message_id=$1",input.db_id,Uuid::now_v7())
        .execute(&mut *old).await.unwrap();
    // The held-key probe tests establish exclusion. Once the old lease
    // commits, a new claimer must respect it rather than lease it again.
    old.commit().await.unwrap();
    assert!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .into_lease()
            .is_none()
    );
}

async fn second_draft(
    db: &PgPool,
    repo: &EmailPgRepo,
    input: &ResolvedDraftInput,
    link: Uuid,
) -> Uuid {
    let second = ResolvedDraftInput {
        db_id: Uuid::now_v7(),
        ..input.clone()
    };
    repo.insert_message(
        &second,
        &UpsertedContacts {
            from_contact_id: None,
            recipients: Vec::new(),
        },
        link,
        None,
        true,
    )
    .await
    .unwrap()
    .unwrap();
    sqlx::query!(
        r#"
        UPDATE
            email_mailbox_drafts
        SET
            available_at = now() - interval '2 minutes'
        WHERE
            message_id = $1
        "#,
        input.db_id,
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        UPDATE
            email_mailbox_drafts
        SET
            available_at = now() - interval '1 minute'
        WHERE
            message_id = $1
        "#,
        second.db_id,
    )
    .execute(db)
    .await
    .unwrap();
    second.db_id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_locked_head_does_not_hide_its_same_mailbox_successor(db: PgPool) {
    let (sync, repo, input, link) = setup(&db, false).await;
    let second = second_draft(&db, &repo, &input, link).await;
    let mut editor = db.begin().await.unwrap();
    sqlx::query!(
        r#"
        SELECT
            message_id
        FROM
            email_mailbox_drafts
        WHERE
            message_id = $1
        FOR UPDATE
        "#,
        input.db_id,
    )
    .fetch_one(&mut *editor)
    .await
    .unwrap();
    let claim = tokio::time::timeout(
        Duration::from_secs(3),
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All),
    )
    .await
    .unwrap()
    .unwrap()
    .into_lease()
    .unwrap();
    assert_eq!(claim.message_id, second);
    editor.rollback().await.unwrap();
    let next = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(next.message_id, input.db_id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_definite_pre_data_failure_releases_the_same_link_for_its_next_draft(db: PgPool) {
    let (sync, repo, input, link) =
        setup_for_provider(&db, false, crate::domain::models::UserProvider::Imap).await;

    let second = second_draft(&db, &repo, &input, link).await;
    let first = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(first.message_id, input.db_id);
    let mut progress = checkpoint(&first, DraftStage::Submitting);
    progress.send_rejection_reason =
        Some(email_api_client::domain::models::SendRejectionReason::ConnectionUnavailable);
    sync.checkpoint_draft(&first, &progress).await.unwrap();
    sync.fail_draft(&first, DraftFailure::SendRejected)
        .await
        .unwrap();
    let failed = sqlx::query!(
        r#"
        SELECT
            state,
            error_code,
            checkpoint->>'stage' AS stage,
            checkpoint->>'submission_started' AS submission_started
        FROM
            email_mailbox_drafts
        WHERE
            message_id = $1
        "#,
        input.db_id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(failed.state, "failed");
    assert_eq!(failed.error_code.as_deref(), Some("send_rejected"));
    assert_eq!(failed.stage.as_deref(), Some("ready"));
    assert_eq!(failed.submission_started.as_deref(), Some("false"));
    let facts = repo
        .message_operation_facts(&[input.db_id, second])
        .await
        .unwrap();
    assert_eq!(
        facts[&input.db_id].send_rejection_reason,
        Some(email_api_client::domain::models::SendRejectionReason::ConnectionUnavailable)
    );
    assert_eq!(facts[&second].send_rejection_reason, None);
    let next = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(next.message_id, second);
    assert_eq!(next.mailbox.link_id, first.mailbox.link_id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_contended_queue_yields_after_its_candidate_budget(db: PgPool) {
    let (sync, repo, input, link) = setup(&db, false).await;
    let mut locked = vec![input.db_id];
    for _ in 1..NATIVE_DRAFT_WINDOW {
        locked.push(second_draft(&db, &repo, &input, link).await);
    }
    let successor = second_draft(&db, &repo, &input, link).await;
    let mut editor = db.begin().await.unwrap();
    for id in &locked {
        sqlx::query!(
            r#"
            SELECT
                message_id
            FROM
                email_mailbox_drafts
            WHERE
                message_id = $1
            FOR UPDATE
            "#,
            id,
        )
        .fetch_one(&mut *editor)
        .await
        .unwrap();
    }
    // A free successor exists, but this attempt must yield before reaching it.
    assert!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .into_lease()
            .is_none()
    );
    editor.rollback().await.unwrap();
    for expected in locked.into_iter().chain([successor]) {
        let claimed = sync
            .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .into_lease()
            .unwrap();
        assert_eq!(claimed.message_id, expected);
    }
}
