use super::*;
use crate::domain::pull_request::SessionPullRequestRepo;
use crate::domain::session_task::{SessionTaskRepo, SessionTaskWrite, TaskDocumentId};

async fn insert_task(pool: &PgPool, id: &str) {
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType") VALUES ($1, 'Task', $2, 'md')"#,
        id,
        OWNER
    )
    .execute(pool)
    .await
    .expect("insert task document");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stores_one_task_per_session_and_returns_the_pull_request(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let owner = session.owner_user().unwrap();
    let first = TaskDocumentId::parse("0199c0a8-7d3e-7c1a-9b5e-3f2a1c4d5e6f").unwrap();
    let second = TaskDocumentId::parse("0199c0a8-7d3e-7c1a-9b5e-3f2a1c4d5e70").unwrap();
    insert_task(&pool, first.as_str()).await;
    insert_task(&pool, second.as_str()).await;

    assert_eq!(repo.task(session.id).await.unwrap(), None);
    assert_eq!(
        repo.set_task(session.id, owner, &first).await.unwrap(),
        SessionTaskWrite {
            changed: true,
            pull_request_url: None,
        }
    );
    assert_eq!(
        repo.set_task(session.id, owner, &first).await.unwrap(),
        SessionTaskWrite {
            changed: false,
            pull_request_url: None,
        }
    );
    let url = "https://github.com/org/repo/pull/7";
    repo.record_pull_request(session.id, owner, url, None)
        .await
        .unwrap();
    assert_eq!(
        repo.set_task(session.id, owner, &second).await.unwrap(),
        SessionTaskWrite {
            changed: true,
            pull_request_url: Some(url.to_owned()),
        }
    );
    assert_eq!(repo.task(session.id).await.unwrap(), Some(second.clone()));
    assert_eq!(
        AgentSessionRepo::get(&repo, session.id)
            .await
            .unwrap()
            .task_id
            .as_deref(),
        Some(second.as_str())
    );

    let other = user_id("macro|someone-else@example.com");
    assert!(matches!(
        repo.set_task(session.id, &other, &first).await,
        Err(AgentSessionError::Forbidden)
    ));
    assert_eq!(repo.task(session.id).await.unwrap(), Some(second.clone()));

    // Deleting the task unlinks it and keeps the session.
    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, second.as_str())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(repo.task(session.id).await.unwrap(), None);
    assert_eq!(
        AgentSessionRepo::get(&repo, session.id)
            .await
            .unwrap()
            .task_id,
        None
    );
}
