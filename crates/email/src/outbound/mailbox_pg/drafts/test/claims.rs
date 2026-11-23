use super::*;
use std::time::Duration;

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
    .unwrap();
    assert_eq!(claim.message_id, second);
    editor.rollback().await.unwrap();
    let next = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
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
        .unwrap();
    assert_eq!(next.message_id, second);
    assert_eq!(next.mailbox.link_id, first.mailbox.link_id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_contended_queue_yields_after_its_candidate_budget(db: PgPool) {
    let (sync, repo, input, link) = setup(&db, false).await;
    let mut locked = vec![input.db_id];
    for _ in 1..MAX_DRAFT_CLAIM_CANDIDATES {
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
            .is_none()
    );
    editor.rollback().await.unwrap();
    for expected in locked.into_iter().chain([successor]) {
        let claimed = sync
            .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.message_id, expected);
    }
}
