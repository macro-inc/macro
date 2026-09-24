use super::*;
use chrono::NaiveDateTime;
use serde_json::Value;
use sqlx::{postgres::PgArguments, query::Query};

const DOCUMENTS: usize = 5_000;
const NOTIFICATIONS: usize = 50_000;
const PAGE_SIZE: i64 = 100;

// Both alternatives use the production query's bindings and access scopes.
// The SQL is generated from AST gates, so this cannot use a static SQLx macro.
fn bind_query(sql: &str) -> Query<'_, Postgres, PgArguments> {
    let links = vec![Uuid::parse_str(LINK_1).unwrap()];
    let sources = sources();
    let types = included_types(&req(None, &links, &sources, EVERYTHING));
    sqlx::query(sql)
        .bind(USER_1)
        .bind(types)
        .bind(None::<NaiveDateTime>)
        .bind(None::<String>)
        .bind(links)
        .bind(PAGE_SIZE)
        .bind(vec![USER_1, TEAM_T])
        .bind(vec!["user", "team"])
}

fn keys_with_timestamps(rows: &[sqlx::postgres::PgRow]) -> Vec<(String, String, NaiveDateTime)> {
    rows.iter()
        .map(|row| {
            (
                row.get("entity_type"),
                row.get("entity_id"),
                row.get("notified_at"),
            )
        })
        .collect()
}

fn plan_nodes(plan: &Value, nodes: &mut Vec<Value>) {
    nodes.push(serde_json::json!({
        "node": plan["Node Type"],
        "strategy": plan["Strategy"],
        "rows": plan["Actual Rows"],
        "loops": plan["Actual Loops"],
        "sort_kb": plan["Sort Space Used"],
        "hash_kb": plan["Peak Memory Usage"],
    }));
    if let Some(children) = plan["Plans"].as_array() {
        for child in children {
            plan_nodes(child, nodes);
        }
    }
}

/// Explicit local diagnostic: SQLx supplies an isolated, migrated database.
/// Compare complete candidate queries, including access gates, using the dev
/// replica's 16 MiB work_mem and no forced plans or timing assertions. The setting
/// is session-only. Never point the test harness at hosted data.
#[sqlx::test(
    fixtures(path = "../../../../../fixtures", scripts("notified_at")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
#[ignore = "local EXPLAIN diagnostic; run explicitly with --ignored --nocapture"]
async fn notified_query_explain_local(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let document_ids = (0..DOCUMENTS)
        .map(|_| Uuid::now_v7().to_string())
        .collect::<Vec<_>>();
    let notification_ids = (0..NOTIFICATIONS)
        .map(|_| Uuid::now_v7())
        .collect::<Vec<_>>();
    let entity_ids = (0..NOTIFICATIONS)
        .map(|index| document_ids[index % DOCUMENTS].clone())
        .collect::<Vec<_>>();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "createdAt", "updatedAt")
        SELECT id, 'notified benchmark', $2, '2024-06-02', '2024-06-02'
        FROM unnest($1::text[]) id"#,
        &document_ids,
        USER_1,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) SELECT id::uuid, 'document', $2, 'user', 'owner' FROM unnest($1::text[]) id",
        &document_ids,
        USER_1,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, created_at)
        SELECT id, 'document_comment', entity_id, 'document', 'test',
               timestamp '2024-06-02' + position * interval '1 second'
        FROM unnest($1::uuid[], $2::text[]) WITH ORDINALITY seeded(id, entity_id, position)"#,
        &notification_ids,
        &entity_ids,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO user_notification (user_id, notification_id, created_at, sent, state) SELECT $1, id, created_at, TRUE, 'unseen' FROM notification WHERE id = ANY($2::uuid[])",
        USER_1,
        &notification_ids,
    )
    .execute(&pool)
    .await?;
    sqlx::query!("ANALYZE").execute(&pool).await?;
    let mut connection = pool.acquire().await?;
    sqlx::query!("SET work_mem = '16MB'")
        .execute(&mut *connection)
        .await?;
    let version = sqlx::query_scalar!("SELECT version()")
        .fetch_one(&mut *connection)
        .await?;
    let work_mem = sqlx::query_scalar!("SELECT current_setting('work_mem')")
        .fetch_one(&mut *connection)
        .await?;
    println!(
        "database={version:?}; work_mem={work_mem:?}; documents={DOCUMENTS}; notifications={NOTIFICATIONS}"
    );

    let filter = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::NotificationState(
            item_filters::NotificationState::Unseen,
        )))),
        ..EntityFilterAst::default()
    };
    for (label, filter) in [("unfiltered", None), ("unseen", Some(&filter))] {
        let grouped = build_query(filter);
        // Reconstruct only the previous deduplication stage. All joins, gates,
        // cursor handling, and bindings are identical to the optimized query.
        let window = grouped
            .replace("un.created_at,", "un.created_at, n.id AS notification_id,")
            .replace(
                "max(created_at) AS created_at",
                "created_at, row_number() OVER (PARTITION BY entity_type, entity_id ORDER BY created_at DESC, notification_id DESC) AS rn",
            )
            .replace("GROUP BY entity_type, entity_id", "")
            .replace("WHERE ($3::timestamp", "WHERE rn = 1 AND ($3::timestamp");
        let expected =
            keys_with_timestamps(&bind_query(&window).fetch_all(&mut *connection).await?);
        let actual = keys_with_timestamps(&bind_query(&grouped).fetch_all(&mut *connection).await?);
        assert_eq!(actual, expected);
        assert_eq!(actual.len(), PAGE_SIZE as usize);

        for repetition in 0..5 {
            let variants = if repetition % 2 == 0 {
                [("window", &window), ("group_max", &grouped)]
            } else {
                [("group_max", &grouped), ("window", &window)]
            };
            for (variant, sql) in variants {
                let explain = format!("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}");
                let row = bind_query(&explain).fetch_one(&mut *connection).await?;
                let plan: Value = row.try_get(0)?;
                let mut nodes = Vec::new();
                plan_nodes(&plan[0]["Plan"], &mut nodes);
                println!(
                    "{}",
                    serde_json::json!({
                        "case": label,
                        "variant": variant,
                        "repetition": repetition,
                        "execution_ms": plan[0]["Execution Time"],
                        "planning_ms": plan[0]["Planning Time"],
                        "shared_hit_blocks": plan[0]["Plan"]["Shared Hit Blocks"],
                        "nodes": nodes,
                    })
                );
            }
        }
    }
    Ok(())
}
