use super::*;
use crate::domain::scrub_log_credentials::scrub_log_credentials;
use crate::outbound::postgres::test::{create_session, create_test_bot, new_session, test_repo};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Value, json};
use std::num::NonZeroUsize;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn scrub_dry_run_apply_and_resume(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let original = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "session/new",
        "params": {
            "cwd": "/workspace",
            "mcpServers": [{"name": "example", "headers": {"Authorization": "placeholder-token"}}],
            "_meta": {"macro.com/permissionPolicy": "prompt", "extra": "placeholder-token"}
        }
    });
    let rows = [
        (1, "to_runtime", original.clone()),
        (
            2,
            "to_runtime",
            json!({"method": "session/load", "params": {"sessionId": "session-placeholder", "mcpServers": [{"token": "placeholder-token"}]}}),
        ),
        (
            3,
            "notification",
            json!({"method": "session/resume", "params": {"sessionId": "session-placeholder", "mcpServers": [{"token": "placeholder-token"}]}}),
        ),
        (4, "to_server", original.clone()),
        (
            5,
            "to_runtime",
            json!({"method": "session/prompt", "params": {"prompt": [{"text": "placeholder-token"}]}}),
        ),
        (6, "to_runtime", json!(["malformed-placeholder"])),
    ];
    for (number, direction, content) in rows {
        sqlx::query!(
            "INSERT INTO agent_session_log (id, agent_session_id, direction, content) VALUES ($1, $2, $3, $4)",
            Uuid::from_u128(number),
            session.id.as_uuid(),
            direction,
            content,
        )
        .execute(&pool)
        .await
        .unwrap();
    }

    let limit = NonZeroUsize::new(2).unwrap();
    let dry = scrub_log_credentials(&repo, None, limit, false)
        .await
        .unwrap();
    assert_eq!(dry.examined, 2);
    assert_eq!(dry.changed, 2);
    let before = sqlx::query_scalar!(
        "SELECT content FROM agent_session_log WHERE id = $1",
        Uuid::from_u128(1),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(before, original);

    let mut cursor = None;
    let mut examined = 0;
    let mut changed = 0;
    let mut skipped = 0;
    loop {
        let batch = scrub_log_credentials(&repo, cursor, limit, true)
            .await
            .unwrap();
        examined += batch.examined;
        changed += batch.changed;
        skipped += batch.skipped;
        cursor = batch.last_id.or(cursor);
        if batch.examined < limit.get() {
            break;
        }
    }
    assert_eq!((examined, changed, skipped), (5, 3, 1));
    assert_eq!(cursor, Some(Uuid::from_u128(6)));

    for number in 1..=6 {
        let content: Value = sqlx::query_scalar!(
            "SELECT content FROM agent_session_log WHERE id = $1",
            Uuid::from_u128(number),
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        match number {
            1..=3 => {
                assert_eq!(content["params"]["mcpServers"], json!([]));
                assert!(!content.to_string().contains("placeholder-token"));
            }
            4 => assert_eq!(content, original),
            5 => assert_eq!(content["params"]["prompt"][0]["text"], "placeholder-token"),
            6 => assert_eq!(content, json!(["malformed-placeholder"])),
            _ => unreachable!(),
        }
    }

    let mut cursor = None;
    let mut second_changes = 0;
    loop {
        let batch = scrub_log_credentials(&repo, cursor, limit, true)
            .await
            .unwrap();
        second_changes += batch.changed;
        cursor = batch.last_id.or(cursor);
        if batch.examined < limit.get() {
            break;
        }
    }
    assert_eq!(second_changes, 0);
}
