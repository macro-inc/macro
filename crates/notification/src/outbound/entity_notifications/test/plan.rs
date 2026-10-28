use super::*;

/// Reproduce a generic prepared plan for a viewer with a much larger history
/// than the average user. Work must scale with entity matches, not that history
/// multiplied by the number of requested entities.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn generic_plan_probes_membership_by_notification_id(pool: PgPool) {
    let ids: Vec<_> = (0..51_900).map(|_| Uuid::now_v7()).collect();
    sqlx::query!(
        r#"
        INSERT INTO notification(id, notification_event_type, event_item_id,
                                 event_item_type, service_sender, metadata)
        SELECT id, 'channel_mention',
               CASE WHEN ord <= 900 THEN 'channel-' || ((ord - 1) / 20)::text
                    ELSE 'unrelated' END,
               'channel', 'test', '{}'::jsonb
        FROM unnest($1::uuid[]) WITH ORDINALITY AS records(id, ord)
        "#,
        &ids
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO user_notification(user_id, notification_id, state)
        SELECT CASE WHEN ord <= 50900 THEN 'macro|viewer@example.com'
                    ELSE 'macro|other-' || ((ord - 50901) / 10)::text || '@example.com' END,
               id, 'unseen'::notification_state
        FROM unnest($1::uuid[]) WITH ORDINALITY AS records(id, ord)
        "#,
        &ids
    )
    .execute(&pool)
    .await
    .unwrap();

    let mut connection = pool.acquire().await.unwrap();
    sqlx::raw_sql(
        "ANALYZE notification; ANALYZE user_notification;
         SET random_page_cost = 1.1; SET work_mem = '16MB'; SET jit = off;
         SET plan_cache_mode = force_generic_plan;",
    )
    .execute(&mut *connection)
    .await
    .unwrap();
    // Use the production SQL verbatim; PREPARE/EXPLAIN cannot use SQLx row macros.
    sqlx::raw_sql(&format!(
        "PREPARE notification_edges(text, text[], text[], notification_state[], text[], bigint, bool, bool, notification_state[]) AS {}",
        include_str!("../query.sql")
    ))
    .execute(&mut *connection)
    .await
    .unwrap();
    let entities = (0..45)
        .map(|i| format!("'channel-{i}'"))
        .collect::<Vec<_>>()
        .join(",");

    for channel_feed_only in [false, true] {
        // Interpolate only locally generated fixture literals, never user input.
        let explain = format!(
            "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
             EXECUTE notification_edges('macro|viewer@example.com', ARRAY[{entities}],
                 array_fill('channel'::text, ARRAY[45]), '{{unseen}}', '{{}}', 1,
                 false, {channel_feed_only}, '{{unseen,seen}}')"
        );
        let row = sqlx::raw_sql(&explain)
            .fetch_one(&mut *connection)
            .await
            .unwrap();
        let plan: serde_json::Value = sqlx::Row::get(&row, 0);
        let mut pending = vec![&plan[0]["Plan"]];
        let mut examined = 0.0;
        let mut membership_scans = 0;
        while let Some(node) = pending.pop() {
            if node["Relation Name"] == "user_notification"
                && node["Actual Loops"].as_f64().unwrap_or(0.0) > 0.0
            {
                membership_scans += 1;
                let condition = node["Index Cond"].as_str().unwrap_or("");
                assert!(
                    condition.contains("notification_id"),
                    "membership must use a notification-ID index probe, not scan user history: {node}"
                );
                examined += (node["Actual Rows"].as_f64().unwrap_or(0.0)
                    + node["Rows Removed by Filter"].as_f64().unwrap_or(0.0))
                    * node["Actual Loops"].as_f64().unwrap();
            }
            if let Some(children) = node["Plans"].as_array() {
                pending.extend(children);
            }
        }
        assert!(
            membership_scans > 0,
            "the plan must exercise viewer ownership"
        );
        assert!(
            examined <= 1_800.0,
            "expected at most two membership probes per entity match, got {examined}"
        );
        assert_eq!(
            plan[0]["Plan"]["Actual Rows"].as_f64(),
            Some(if channel_feed_only { 0.0 } else { 45.0 })
        );
        eprintln!(
            "channel_feed_only={channel_feed_only}: membership rows={examined}, buffers={}, time_ms={}",
            plan[0]["Plan"]["Shared Hit Blocks"], plan[0]["Execution Time"]
        );
    }
}
