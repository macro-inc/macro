use super::*;
use crate::domain::model::StoredQueuedAction;
use crate::domain::ports::AgentSessionRepo;
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn stored_prompt(text: &str) -> StoredQueuedAction {
    StoredQueuedAction {
        action_id: AgentActionId::mint(),
        action: AgentAction::prompt(text),
        actor: Some(user_id(OWNER)),
        created_at: chrono::Utc::now(),
        announce: Some(serde_json::json!({
            "parent": { "type": "channel", "id": "00000000-0000-0000-0000-0000000000f0" },
            "threadId": "00000000-0000-0000-0000-0000000000f1",
            "messageId": "00000000-0000-0000-0000-0000000000f2"
        })),
        announced_message_id: None,
        context: None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replace_lists_oldest_first_and_empty_deletes_the_row(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;

    let first = stored_prompt("first");
    let second = stored_prompt("second");
    repo.replace_queued_actions(session.id, &[first.clone(), second.clone()])
        .await
        .expect("persist queue");

    let listed = repo
        .list_queued_actions(session.id)
        .await
        .expect("list queue");
    assert_eq!(
        listed
            .iter()
            .map(|entry| entry.action_id)
            .collect::<Vec<_>>(),
        [first.action_id, second.action_id]
    );
    assert_eq!(listed[0].action, AgentAction::prompt("first"));
    assert_eq!(listed[0].announce, first.announce);

    repo.replace_queued_actions(session.id, &[])
        .await
        .expect("clear queue");
    assert!(
        repo.list_queued_actions(session.id)
            .await
            .expect("list empty queue")
            .is_empty()
    );

    let remaining = sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "count!"
        FROM agent_session_queue
        WHERE agent_session_id = $1
        "#,
        session.id.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .expect("count queue rows");
    assert_eq!(remaining, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_session_cascades_its_queue(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    repo.replace_queued_actions(session.id, &[stored_prompt("remember me")])
        .await
        .expect("persist queue");

    AgentSessionRepo::delete(&repo, session.id)
        .await
        .expect("delete session");

    let remaining = sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "count!"
        FROM agent_session_queue
        WHERE agent_session_id = $1
        "#,
        session.id.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .expect("count queue rows");
    assert_eq!(remaining, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_without_a_row_lists_empty(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot_id = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    assert!(
        repo.list_queued_actions(session.id)
            .await
            .expect("list missing queue")
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_context_entries_never_restore_as_owner_prompts(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let first = stored_prompt("real request");
    let mut legacy = serde_json::to_value(stored_prompt("")).unwrap();
    legacy["action"]["privateContext"] = serde_json::json!("legacy review outcome");
    let entries = serde_json::json!([first, legacy]);
    sqlx::query!(
        "INSERT INTO agent_session_queue (agent_session_id, entries) VALUES ($1, $2)",
        session.id.as_uuid(),
        entries
    )
    .execute(&pool)
    .await
    .unwrap();
    let restored = repo.list_queued_actions(session.id).await.unwrap();
    assert_eq!(restored, [first]);
}
