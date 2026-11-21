use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const BUSY: &str = "00000000-0000-0000-0000-00000000b001";
const QUEUED: &str = "00000000-0000-0000-0000-00000000b002";
const IDLE: &str = "00000000-0000-0000-0000-00000000b003";
const ARCHIVED: &str = "00000000-0000-0000-0000-00000000b004";

fn bot(id: &str) -> BotId {
    BotId::new_from_uuid(id.parse().unwrap())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bots_with_live_work_are_those_with_a_turn_under_way_or_prompts_queued(pool: sqlx::PgPool) {
    sqlx::raw_sql(&format!(
        r#"
        INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace, turn_state) VALUES
            ('00000000-0000-0000-0000-000000000001', 'macro|owner@example.com', '{BUSY}', 'test', 'macrod', '/workspace', 'running'),
            ('00000000-0000-0000-0000-000000000002', 'macro|owner@example.com', '{QUEUED}', 'test', 'macrod', '/workspace', 'idle'),
            ('00000000-0000-0000-0000-000000000003', 'macro|owner@example.com', '{IDLE}', 'test', 'macrod', '/workspace', 'idle'),
            ('00000000-0000-0000-0000-000000000004', 'macro|owner@example.com', '{ARCHIVED}', 'test', 'macrod', '/workspace', 'running');
        UPDATE agent_session SET archived_by = 'user', archived_at = now() WHERE bot_id = '{ARCHIVED}';
        INSERT INTO agent_session_queue (agent_session_id, entries)
            VALUES ('00000000-0000-0000-0000-000000000002', '[{{"prompt": "hello"}}]');
        "#
    ))
    .execute(&pool)
    .await
    .unwrap();

    let live = PgRuntimeSessions(pool)
        .bots_with_live_work(&[bot(BUSY), bot(QUEUED), bot(IDLE), bot(ARCHIVED)])
        .await
        .unwrap();
    assert_eq!(
        live,
        std::collections::HashSet::from([bot(BUSY), bot(QUEUED)])
    );
}
