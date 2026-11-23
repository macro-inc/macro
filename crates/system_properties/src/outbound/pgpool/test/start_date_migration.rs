//! The Start Date migration keeps every team and personal property already
//! named Start Date working, and loses none of its values.

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::domain::model::SystemPropertyKey;

const UP: &str = include_str!(
    "../../../../../macro_db_client/migrations/20261120200342_task_start_date_property.up.sql"
);

const TEAM_START: Uuid = Uuid::from_u128(0x5d01);
const PERSONAL_START: Uuid = Uuid::from_u128(0x5d02);
const TEXT_START: Uuid = Uuid::from_u128(0x5d03);
const TAKEN_NAME: Uuid = Uuid::from_u128(0x5d04);

/// Rows the test seeds, as they stood before the migration: the custom
/// definitions it reached, and their values on tasks, a project and a page.
const SEED: &str = r#"
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('b1111111-1111-1111-1111-111111111111', 'planner@start-date.test', 'planner@start-date.test', 'cus_planner'),
    ('b2222222-2222-2222-2222-222222222222', 'writer@start-date.test', 'writer@start-date.test', 'cus_writer');
INSERT INTO "User" (id, email, name, "stripeCustomerId", macro_user_id) VALUES
    ('macro|planner@start-date.test', 'planner@start-date.test', 'Planner', 'cus_planner', 'b1111111-1111-1111-1111-111111111111'),
    ('macro|writer@start-date.test', 'writer@start-date.test', 'Writer', 'cus_writer', 'b2222222-2222-2222-2222-222222222222');
INSERT INTO team (id, name, owner_id) VALUES
    ('0e000000-0000-0000-0000-00000000aaaa', 'Planning', 'macro|planner@start-date.test');
INSERT INTO property_definitions (id, team_id, user_id, display_name, data_type, is_multi_select) VALUES
    ('00000000-0000-0000-0000-000000005d01', '0e000000-0000-0000-0000-00000000aaaa', NULL, 'Start Date', 'DATE', false),
    ('00000000-0000-0000-0000-000000005d02', NULL, 'macro|planner@start-date.test', 'start date', 'DATE', false),
    ('00000000-0000-0000-0000-000000005d03', NULL, 'macro|writer@start-date.test', 'Start Date', 'STRING', false),
    ('00000000-0000-0000-0000-000000005d04', NULL, 'macro|writer@start-date.test', 'Start Date (custom)', 'DATE', false);
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, updated_at) VALUES
    ('00000000-0000-0000-0000-00000000e001', 'task-both', 'TASK', '00000000-0000-0000-0000-000000005d01', '{"type": "Date", "value": "2026-11-23T08:00:00Z"}', '2026-11-02'),
    ('00000000-0000-0000-0000-00000000e002', 'task-both', 'TASK', '00000000-0000-0000-0000-000000005d02', '{"type": "Date", "value": "2026-11-20T08:00:00Z"}', '2026-11-01'),
    ('00000000-0000-0000-0000-00000000e003', 'project-one', 'INITIATIVE', '00000000-0000-0000-0000-000000005d01', '{"type": "Date", "value": "2026-12-01T08:00:00Z"}', '2026-11-01'),
    ('00000000-0000-0000-0000-00000000e004', 'page-one', 'DOCUMENT', '00000000-0000-0000-0000-000000005d02', '{"type": "Date", "value": "2026-10-05T23:00:00Z"}', '2026-11-01'),
    ('00000000-0000-0000-0000-00000000e005', 'task-pinned', 'TASK', '00000000-0000-0000-0000-000000005d01', NULL, '2026-11-01'),
    ('00000000-0000-0000-0000-00000000e006', 'task-text', 'TASK', '00000000-0000-0000-0000-000000005d03', '{"type": "String", "value": "after kickoff"}', '2026-11-01'),
    ('00000000-0000-0000-0000-00000000e007', 'task-taken', 'TASK', '00000000-0000-0000-0000-000000005d04', '{"type": "Date", "value": "2026-11-30T08:00:00Z"}', '2026-11-01');
"#;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn custom_start_dates_move_to_the_built_in_property_and_keep_working(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // The migrator has already added Start Date. Take it away to stand where
    // production stands before the migration: custom properties may use the name.
    sqlx::query!(
        "DELETE FROM property_definitions WHERE id = $1",
        SystemPropertyKey::START_DATE_UUID
    )
    .execute(&pool)
    .await?;
    sqlx::raw_sql(SEED).execute(&pool).await?;
    let values_before = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM entity_properties WHERE values IS NOT NULL"#
    )
    .fetch_one(&pool)
    .await?;

    sqlx::raw_sql(UP).execute(&pool).await?;

    let built_in = sqlx::query!(
        r#"SELECT display_name, data_type::text AS "data_type!", is_system FROM property_definitions WHERE id = $1"#,
        SystemPropertyKey::START_DATE_UUID
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(built_in.display_name, "Start Date");
    assert_eq!(built_in.data_type, "DATE");
    assert!(built_in.is_system);

    let mut assignments = sqlx::query!(
        r#"SELECT id, property_definition_id, values AS "values: serde_json::Value" FROM entity_properties ORDER BY id"#
    )
    .fetch_all(&pool)
    .await?
    .into_iter()
    .map(|row| (row.id, (row.property_definition_id, row.values)));
    let start = SystemPropertyKey::START_DATE_UUID;
    let date = |value: &str| Some(serde_json::json!({"type": "Date", "value": value}));
    let expected = [
        // The newer of a task's two custom start dates moves; the other stays.
        (0xe001, start, date("2026-11-23T08:00:00Z")),
        (0xe002, PERSONAL_START, date("2026-11-20T08:00:00Z")),
        (0xe003, start, date("2026-12-01T08:00:00Z")),
        (0xe004, start, date("2026-10-05T23:00:00Z")),
        // An empty assignment moves too, so its pin keeps finding it.
        (0xe005, start, None),
        (
            0xe006,
            TEXT_START,
            Some(serde_json::json!({"type": "String", "value": "after kickoff"})),
        ),
        (0xe007, TAKEN_NAME, date("2026-11-30T08:00:00Z")),
    ];
    for (id, definition, value) in expected {
        assert_eq!(
            assignments.next(),
            Some((Uuid::from_u128(id), (definition, value))),
            "assignment {id:x}"
        );
    }
    assert_eq!(assignments.next(), None);

    let values_after = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM entity_properties WHERE values IS NOT NULL"#
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(values_after, values_before);

    let names = sqlx::query!(
        "SELECT id, display_name FROM property_definitions WHERE id = ANY($1) ORDER BY id",
        &[TEAM_START, PERSONAL_START, TEXT_START, TAKEN_NAME]
    )
    .fetch_all(&pool)
    .await?
    .into_iter()
    .map(|row| (row.id, row.display_name))
    .collect::<Vec<_>>();
    assert_eq!(
        names,
        [
            (TEAM_START, "Start Date (custom)".to_string()),
            (PERSONAL_START, "start date (custom)".to_string()),
            // Its owner already has "Start Date (custom)", so it takes its id
            // instead.
            (
                TEXT_START,
                "Start Date (custom 00000000-0000-0000-0000-000000005d03)".to_string()
            ),
            (TAKEN_NAME, "Start Date (custom)".to_string()),
        ]
    );

    // Every renamed property takes edits again.
    sqlx::query!(
        "UPDATE property_definitions SET display_name = 'Kickoff' WHERE id = $1",
        TEAM_START
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE property_definitions SET updated_at = NOW() WHERE id = $1",
        TEXT_START
    )
    .execute(&pool)
    .await?;
    Ok(())
}
