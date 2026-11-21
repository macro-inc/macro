use super::*;

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../fixtures", scripts("email_crm_selected"))
)]
async fn complete_recipient_probes_do_not_scan_unrelated_messages(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    let contact = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0032);
    let mut connection = pool.acquire().await?;
    sqlx::raw_sql(
        "ALTER TABLE email_messages SET (autovacuum_enabled = false); \
         ALTER TABLE email_message_recipients SET (autovacuum_enabled = false); \
         ANALYZE email_messages; ANALYZE email_message_recipients; \
         SET random_page_cost = 1.1; SET work_mem = '16MB'; \
         SET jit = off; SET statement_timeout = '10s';",
    )
    .execute(&mut *connection)
    .await?;
    sqlx::query!(
        r#"INSERT INTO email_messages
               (id, thread_id, link_id, from_contact_id, is_sent, is_draft)
           SELECT md5('recipient-plan-' || n)::uuid,
                  CASE WHEN n <= 1000
                       THEN '00000000-0000-4000-8000-000000000021'::uuid
                       ELSE '00000000-0000-4000-8000-000000000022'::uuid END,
                  CASE WHEN n <= 1000
                       THEN '00000000-0000-4000-8000-000000000011'::uuid
                       ELSE '00000000-0000-4000-8000-000000000012'::uuid END,
                  CASE WHEN n <= 1000
                       THEN '00000000-0000-4000-8000-000000000031'::uuid
                       ELSE '00000000-0000-4000-8000-000000000034'::uuid END,
                  FALSE, FALSE
           FROM generate_series(1, 21000) n"#
    )
    .execute(&mut *connection)
    .await?;
    sqlx::query!(
        r#"INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
           SELECT md5('recipient-plan-' || n)::uuid,
                  CASE WHEN n <= 1000
                       THEN '00000000-0000-4000-8000-000000000032'::uuid
                       ELSE '00000000-0000-4000-8000-000000000035'::uuid END,
                  'TO'
           FROM generate_series(1, 21000) n"#
    )
    .execute(&mut *connection)
    .await?;

    for fresh in [false, true] {
        if fresh {
            sqlx::raw_sql("ANALYZE email_messages; ANALYZE email_message_recipients;")
                .execute(&mut *connection)
                .await?;
        }
        for all_roles in [false, true] {
            let mut builder =
                sqlx::QueryBuilder::<sqlx::Postgres>::new("SELECT count(*) FROM (SELECT 1 FROM (");
            contacts_recipient_branch(
                &[contact],
                &AddressKinds {
                    sender: false,
                    to: true,
                    cc: all_roles,
                    bcc: all_roles,
                },
                BranchFacts::Skipped {
                    probe_limit: Some(5001),
                },
            )
            .push_into(&mut builder, "unused");
            builder.push(") matches LIMIT 5001) capped");
            sqlx::raw_sql(&format!(
                "PREPARE complete_recipient_probe(uuid[]) AS {}",
                builder.sql()
            ))
            .execute(&mut *connection)
            .await?;
            // EXECUTE cannot bind its arguments; this literal contains only
            // the typed fixture UUID, in the actual builder's bind order.
            let execute = format!("EXECUTE complete_recipient_probe('{{{contact}}}')");
            for mode in ["force_custom_plan", "force_generic_plan"] {
                sqlx::query!("SELECT set_config('plan_cache_mode', $1, false)", mode)
                    .fetch_one(&mut *connection)
                    .await?;
                let rows: i64 = sqlx::query_scalar(&execute)
                    .fetch_one(&mut *connection)
                    .await?;
                assert_eq!(rows, 1001, "{fresh} {mode} {all_roles}");
                let plan: serde_json::Value = sqlx::query_scalar(&format!(
                    "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {execute}"
                ))
                .fetch_one(&mut *connection)
                .await?;
                // All-role probes follow matched recipients, regardless of
                // the unrelated mailbox's size. Restricted-role plans retain
                // their original choices for dense contacts with rare roles.
                if all_roles {
                    for table in ["email_messages", "email_message_recipients"] {
                        let touched = rows_touched(&plan[0]["Plan"], table);
                        assert!(
                            touched <= 1001,
                            "{fresh} {mode} {all_roles}: touched {touched} {table}: {plan}"
                        );
                    }
                }
                let counts = sqlx::query!(
                    "SELECT generic_plans, custom_plans FROM pg_prepared_statements \
                     WHERE name = 'complete_recipient_probe'"
                )
                .fetch_one(&mut *connection)
                .await?;
                if mode == "force_generic_plan" {
                    assert!(counts.generic_plans.unwrap() >= 2);
                } else {
                    assert!(counts.custom_plans.unwrap() >= 2);
                    assert_eq!(counts.generic_plans, Some(0));
                }
            }
            sqlx::raw_sql("DEALLOCATE complete_recipient_probe")
                .execute(&mut *connection)
                .await?;
        }
    }
    // The existing recipients are TO only. The unchanged role-specific
    // branch must still reject them when a different role is requested.
    for (cc, bcc) in [(true, false), (false, true)] {
        let mut builder = sqlx::QueryBuilder::<sqlx::Postgres>::new("SELECT count(*) FROM (");
        contacts_recipient_branch(
            &[contact],
            &AddressKinds {
                sender: false,
                to: false,
                cc,
                bcc,
            },
            BranchFacts::Skipped {
                probe_limit: Some(5001),
            },
        )
        .push_into(&mut builder, "unused");
        builder.push(") matches");
        let rows: i64 = builder
            .build_query_scalar()
            .fetch_one(&mut *connection)
            .await?;
        assert_eq!(rows, 0, "CC={cc}, BCC={bcc}");
    }
    Ok(())
}

fn rows_touched(plan: &serde_json::Value, table: &str) -> u64 {
    let own = if plan["Relation Name"] == table {
        (plan["Actual Rows"].as_u64().unwrap_or(0)
            + plan["Rows Removed by Filter"].as_u64().unwrap_or(0))
            * plan["Actual Loops"].as_u64().unwrap_or(0)
    } else {
        0
    };
    own + plan["Plans"].as_array().map_or(0, |children| {
        children
            .iter()
            .map(|child| rows_touched(child, table))
            .sum::<u64>()
    })
}
