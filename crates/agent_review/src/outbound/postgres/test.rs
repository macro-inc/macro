use super::*;
use crate::domain::model::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const OWNER: &str = "macro|changes-owner@example.com";

/// A session row for the summary row's foreign key, with the user and bot
/// rows it needs in turn.
async fn seed_session(pool: &PgPool) -> AgentSessionId {
    let email = OWNER.strip_prefix("macro|").unwrap_or(OWNER);
    let macro_user_id = sqlx::query_scalar!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
        RETURNING id
        "#,
        Uuid::now_v7(),
        email,
        email,
        format!("stripe_{email}"),
    )
    .fetch_one(pool)
    .await
    .expect("insert macro_user");
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING"#,
        OWNER,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .expect("insert User");
    let bot_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO bots (id, kind, name, handle, has_agent, owner_user_id) VALUES ($1, 'owned', 'Changes Bot', $2, true, $3)"#,
        bot_id,
        format!("changes-bot-{}", bot_id.simple()),
        OWNER,
    )
    .execute(pool)
    .await
    .expect("insert bot");
    let session = AgentSessionId::new();
    sqlx::query!(
        r#"
        INSERT INTO agent_session (id, owner_id, bot_id, model, harness, repo_url, workspace, name)
        VALUES ($1, $2, $3, 'claude', 'macrod', 'https://github.com/example/example', '/workspace', 'Changes')
        "#,
        session.as_uuid(),
        OWNER,
        bot_id,
    )
    .execute(pool)
    .await
    .expect("insert agent_session");
    session
}

fn review(session: AgentSessionId) -> Review {
    Review {
        id: ReviewId(Uuid::now_v7()),
        session_id: session.as_uuid(),
        version: 1,
        title: "Review".into(),
        summary: String::new(),
        repository: "repo".into(),
        source: SourceKind::Workspace,
        revisions: vec![],
        tour: vec![],
        annotations: vec![],
        file_groups: vec![],
        anchors: vec![],
        threads: vec![],
    }
}

fn revision(number: u32) -> Revision {
    Revision {
        number,
        created_at: chrono::Utc::now(),
        comparison: Comparison {
            base: Some(format!("base-{number}")),
            head: Some(format!("head-{number}")),
            worktree: false,
        },
        files: vec![FileEntry {
            path: "src/main.rs".into(),
            old_path: None,
            content: format!("body-{number}"),
            status: diffd_core::model::FileStatus::Added,
            language: Some("rust".into()),
            added: 1,
            removed: 0,
            collapsed: None,
            labels: vec![],
            omitted: None,
        }],
        tour: vec![Chapter {
            key: "main".into(),
            title: format!("Revision {number}"),
            description: "An explanation preserved in history".into(),
            paths: vec!["src/main.rs".into()],
            focus: Location {
                path: "src/main.rs".into(),
                side: diffd_core::model::Side::New,
                line: 1,
                end_line: None,
            },
        }],
        annotations: vec![],
        file_groups: vec![FileGroup {
            key: "source".into(),
            title: "Source".into(),
            files: vec!["src/**".into()],
            hidden: false,
        }],
        symbols: vec![],
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn projected_reads_preserve_selected_history_and_scope_body_references(pool: PgPool) {
    let id = seed_session(&pool).await;
    let other = seed_session(&pool).await;
    let repo = PgReviewRepo::new(pool);
    assert!(repo.load_view(id, None).await.unwrap().is_none());
    let mut value = review(id);
    value.revisions = vec![revision(2), revision(9)];
    assert!(repo.save(&value, None, None).await.unwrap());

    for requested in [None, Some(2), Some(9), Some(3)] {
        let mut expected = value.clone();
        for revision in &mut expected.revisions {
            if revision.number != requested.unwrap_or(9) {
                revision.files.clear();
                revision.symbols.clear();
                revision.tour.clear();
                revision.annotations.clear();
                revision.file_groups.clear();
            }
        }
        let actual = repo.load_view(id, requested).await.unwrap().unwrap();
        assert_eq!(
            serde_json::to_value(actual).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
    }
    // Reader projections must never prune the stored aggregate used by writers.
    assert_eq!(
        serde_json::to_value(repo.load(id).await.unwrap().unwrap()).unwrap(),
        serde_json::to_value(&value).unwrap()
    );
    for number in [2, 9] {
        assert_eq!(
            repo.file_content(id, number, "src/main.rs").await.unwrap(),
            Some(format!("body-{number}"))
        );
    }
    assert!(
        repo.file_content(id, 1, "src/main.rs")
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        repo.file_content(id, 2, "missing.rs")
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        repo.file_content(other, 2, "src/main.rs")
            .await
            .unwrap()
            .is_none()
    );
    assert!(repo.load_view(other, Some(2)).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn capture_claims_fence_publication_and_cas_keeps_concurrent_comments(pool: PgPool) {
    let id = seed_session(&pool).await;
    let repo = PgReviewRepo::new(pool);
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();
    assert!(repo.claim_capture(id, first).await.unwrap());
    assert!(!repo.claim_capture(id, second).await.unwrap());
    let mut value = review(id);
    assert!(matches!(
        repo.save(&value, None, Some(second)).await,
        Err(ReviewError::Conflict)
    ));
    assert!(repo.save(&value, None, Some(first)).await.unwrap());
    assert!(!repo.save(&value, None, Some(first)).await.unwrap());
    value.version = 2;
    assert!(repo.save(&value, Some(1), None).await.unwrap());
    assert!(!repo.save(&value, Some(1), None).await.unwrap());
    repo.release_capture(id, second).await.unwrap();
    assert!(!repo.claim_capture(id, second).await.unwrap());
    repo.release_capture(id, first).await.unwrap();
    assert!(repo.claim_capture(id, second).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn feedback_is_atomic_and_deleting_the_session_schedules_body_cleanup(pool: PgPool) {
    let id = seed_session(&pool).await;
    let repo = PgReviewRepo::new(pool.clone());
    let mut value = review(id);
    let message = Uuid::now_v7();
    value.threads.push(Thread {
        id: Uuid::now_v7(),
        anchor: Uuid::now_v7(),
        resolved: false,
        messages: vec![Message {
            id: message,
            author: Author::User { id: OWNER.into() },
            body: "Check this".into(),
            created_at: chrono::Utc::now(),
            delivery: Some(Delivery::Pending),
        }],
    });
    assert!(repo.save(&value, None, None).await.unwrap());
    assert_eq!(repo.pending_feedback().await.unwrap(), vec![id]);
    assert!(repo.claim_feedback(id, message).await.unwrap());
    assert!(!repo.claim_feedback(id, message).await.unwrap());
    repo.finish_feedback(id, message, true).await.unwrap();
    assert!(repo.pending_feedback().await.unwrap().is_empty());
    sqlx::query!("DELETE FROM agent_session WHERE id = $1", id.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    assert!(repo.load(id).await.unwrap().is_none());
    let cleanup = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM agent_review_cleanup WHERE agent_session_id = $1)",
        id.as_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cleanup, Some(true));
}
