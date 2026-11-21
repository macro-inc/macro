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
