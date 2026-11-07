use super::*;
use sqlx::{Connection, Row};

const UPDATE_RECORD_SQL: &str = include_str!("../update_record.sql");

/// Table accesses in an `EXPLAIN (ANALYZE, FORMAT JSON)` plan:
/// (node type, index name, actual rows, rows removed by filter).
fn table_accesses(node: &serde_json::Value, accesses: &mut Vec<(String, String, f64, f64)>) {
    let relation = node["Relation Name"].as_str() == Some("password_item_entities");
    if relation || node["Index Name"].is_string() {
        accesses.push((
            node["Node Type"].as_str().unwrap_or_default().to_owned(),
            node["Index Name"].as_str().unwrap_or_default().to_owned(),
            node["Actual Rows"].as_f64().unwrap_or_default(),
            node["Rows Removed by Filter"].as_f64().unwrap_or_default(),
        ));
    }
    for child in node["Plans"].as_array().into_iter().flatten() {
        table_accesses(child, accesses);
    }
}

/// With no column statistics (a large team written before ANALYZE runs), the
/// planner can reach the update target through the partial team search index
/// and filter every item in the team, most of all when the version guard
/// fails. Under custom and generic plans, matching and failing guards alike,
/// the guarded update must touch only the primary-key row.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_guarded_update_reads_one_row_without_statistics(pool: PgPool) {
    let (_, actor, record) = folder_fixture(pool.clone()).await;
    let team = record.metadata.team_id.0;
    let mut connection = pool.acquire().await.expect("connection");
    sqlx::raw_sql(
        "ALTER TABLE password_item_entities SET (autovacuum_enabled = false); \
         SET random_page_cost = 1.1; SET work_mem = '16MB'; SET jit = off;",
    )
    .execute(&mut *connection)
    .await
    .expect("planner settings");
    sqlx::query!(
        r#"INSERT INTO password_item_entities(team_id,id,user_id,metadata,version)
        SELECT $1, gen_random_uuid(), $2, jsonb_build_object('name','item '||(n%50)), 1
        FROM generate_series(1,2000) n"#,
        team,
        actor.user_id.as_ref()
    )
    .execute(&mut *connection)
    .await
    .expect("items");
    let item = sqlx::query_scalar!(
        "SELECT id FROM password_item_entities WHERE team_id=$1 ORDER BY id OFFSET 1000 LIMIT 1",
        team
    )
    .fetch_one(&mut *connection)
    .await
    .expect("target item");
    sqlx::raw_sql(&format!(
        "PREPARE guarded_update(uuid,uuid,jsonb,int,jsonb,int,bool,uuid,bigint) AS {UPDATE_RECORD_SQL}"
    ))
    .execute(&mut *connection)
    .await
    .expect("prepare");
    for plan_cache_mode in ["force_custom_plan", "force_generic_plan"] {
        sqlx::raw_sql(&format!("SET plan_cache_mode = {plan_cache_mode}"))
            .execute(&mut *connection)
            .await
            .expect("plan mode");
        // (expected version, revision): the stored item is version 1, revision 1.
        for (guard, expected_version, revision) in [("matches", 1, 1), ("fails", 9, 9)] {
            let mut transaction = connection.begin().await.expect("transaction");
            let plan: serde_json::Value = sqlx::raw_sql(&format!(
                "EXPLAIN (ANALYZE, FORMAT JSON) EXECUTE guarded_update('{team}','{item}','{{\"name\":\"x\"}}',2,'[]',{expected_version},false,NULL,{revision})"
            ))
            .fetch_one(&mut *transaction)
            .await
            .expect("explain")
            .try_get(0)
            .expect("plan json");
            transaction.rollback().await.expect("rollback");
            let mut accesses = Vec::new();
            table_accesses(&plan[0]["Plan"], &mut accesses);
            assert!(
                !accesses.is_empty()
                    && accesses.iter().all(|(_, index, rows, removed)| {
                        index != "password_item_entities_search" && *rows <= 1.0 && *removed <= 1.0
                    }),
                "{plan_cache_mode}, guard {guard}: {accesses:?}"
            );
        }
    }
}
