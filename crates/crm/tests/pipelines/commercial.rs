use super::*;

/// The backfill files as the migration runner applies them, against a pipeline
/// put back into its pre-migration shape: the schema file in a transaction, the
/// row seeding as one statement outside one, since it commits per pipeline.
/// Their functions are dropped at the end, so they rerun.
async fn run_backfill(pool: &PgPool) {
    let mut transaction = pool.begin().await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../macro_db_client/migrations/20261113162435_crm_pipeline_commercial_fields_backfill.sql"
    ))
    .execute(&mut *transaction)
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../macro_db_client/migrations/20261113174353_crm_pipeline_commercial_fields_seed_rows.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
}

async fn forget_commercial_fields(pool: &PgPool, pipeline: Uuid) {
    sqlx::query!(
        r#"UPDATE crm_pipeline_entities SET commercial_fields = '{"outcome": null, "money": []}' WHERE id = $1"#,
        pipeline,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn backfill_preserves_reserved_fields_and_explicit_currency(pool: PgPool) {
    let (s, _, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let row = inserted(&write(&s, &a, &p, vec![insert(&p, company)]).await.unwrap());
    // With the roles forgotten, the existing Outcome and Revenue currency columns
    // are ordinary user fields holding the reserved names.
    forget_commercial_fields(&pool, p.id).await;
    run_backfill(&pool).await;
    let upgraded = s
        .get(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap()
        .pipeline;
    let table = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let old_outcome = p.commercial_fields.outcome.unwrap();
    assert_ne!(upgraded.commercial_fields.outcome, Some(old_outcome));
    assert!(
        table
            .columns
            .iter()
            .find(|column| column.column.id == old_outcome)
            .unwrap()
            .name()
            .starts_with("Outcome (legacy ")
    );
    let old_row = s
        .read_rows(
            access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
            &[row],
        )
        .await
        .unwrap();
    assert!(
        matches!(old_row[0].cells.get(&old_outcome), Some(models_properties::service::property_value::PropertyValue::SelectOption(values)) if values.len() == 1)
    );

    let currency = upgraded.commercial_fields.money[0].currency;
    let operation = serde_json::from_value(json!({"kind":"rows", "table":p.table_id,
        "change":{"kind":"insert", "rows":[[
            {"column":p.primary_column_id,"value":{"type":"entities","value":[{"entityType":"COMPANY","entityId":company.to_string()}]}},
            {"column":currency,"value":{"type":"options","value":[{"label":"EUR"}]}}
        ]]}})).unwrap();
    let explicit = inserted(&write(&s, &a, &upgraded, vec![operation]).await.unwrap());
    // A second run seeds nothing over a currency the entry already chose.
    run_backfill(&pool).await;
    let reloaded = s
        .read_rows(
            access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
            &[explicit],
        )
        .await
        .unwrap();
    let eur = table
        .columns
        .iter()
        .find(|column| column.column.id == currency)
        .unwrap()
        .definition
        .property_options
        .iter()
        .find(|option| option.value.as_string() == Some("EUR"))
        .unwrap()
        .id;
    assert_eq!(
        reloaded[0].cells.get(&currency),
        Some(&models_properties::service::property_value::PropertyValue::SelectOption(vec![eur]))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn commercial_backfill_preserves_amounts_stages_and_row_identity(pool: PgPool) {
    let (s, _, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let table = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let stage = table
        .columns
        .iter()
        .find(|column| column.name() == "Stage")
        .unwrap();
    let revenue = p.commercial_fields.money[0].amount;
    let operations: Vec<DatabaseOp> = serde_json::from_value(json!([
        {"kind":"column", "table":p.table_id, "column":stage.column.id, "change":{"kind":"update_option", "option":stage.definition.property_options[0].id, "label":"Closed won"}},
        {"kind":"rows", "table":p.table_id, "change":{"kind":"insert", "rows":[[
            {"column":p.primary_column_id, "value":{"type":"entities","value":[{"entityType":"COMPANY","entityId":company.to_string()}]}},
            {"column":stage.column.id, "value":{"type":"options","value":[{"label":"Closed won"}]}},
            {"column":revenue, "value":{"type":"number","value":1234.567}}
        ]]}}
    ])).unwrap();
    let result = write(&s, &a, &p, operations).await.unwrap();
    let row_id = inserted(&result[1..]);
    // Model the deployed schema before this migration inside this disposable test DB.
    let commercial_columns: Vec<Uuid> = p
        .commercial_fields
        .outcome
        .into_iter()
        .chain(p.commercial_fields.money.iter().map(|pair| pair.currency))
        .map(|id| id.into_uuid())
        .collect();
    sqlx::query!(
        "DELETE FROM database_column_protections WHERE column_id = ANY($1)",
        &commercial_columns
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "DELETE FROM database_columns WHERE id = ANY($1)",
        &commercial_columns
    )
    .execute(&pool)
    .await
    .unwrap();
    forget_commercial_fields(&pool, p.id).await;
    let stale = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap()
        .table
        .version;
    let generic = s
        .create(
            team_receipt(team, OWNER),
            CreatePipeline {
                name: "Launch".into(),
                record_type: None,
                sharing: PipelineSharing::Private,
            },
        )
        .await
        .unwrap()
        .pipeline;
    run_backfill(&pool).await;
    // The schema and the seeded rows are each a new, journaled table version,
    // so an editor holding the old schema reloads and its edits conflict.
    let journaled = sqlx::query_scalar!(
        "SELECT version FROM database_changes WHERE table_id = $1 AND version > $2 ORDER BY version",
        p.table_id.into_uuid(),
        stale.0,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(journaled, [stale.0 + 1, stale.0 + 2]);
    let mut outdated: databases::domain::models::OpBatch = vec![insert(&p, company)].into();
    outdated.base_versions.insert(p.table_id, stale);
    assert!(matches!(
        s.apply_ops(
            access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
            None,
            outdated,
        )
        .await,
        Err(PipelineError::Database(DatabaseError::VersionConflict))
    ));
    let generic_table = s
        .table(access(&a, generic.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    assert_eq!(generic_table.columns.len(), 1);
    assert!(
        !s.get(access(&a, generic.id, EntityType::CrmPipeline, OWNER).await)
            .await
            .unwrap()
            .pipeline
            .commercial_fields
            .has_system_fields()
    );
    let upgraded = s
        .get(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap()
        .pipeline;
    let table = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let rows = s
        .rows(access(&a, p.id, EntityType::CrmPipeline, OWNER).await, None)
        .await
        .unwrap();
    assert_eq!(rows.rows[0].row_id, row_id);
    assert_eq!(
        rows.rows[0].cells.get(&revenue),
        Some(&models_properties::service::property_value::PropertyValue::Num(1234.567))
    );
    let outcome = upgraded.commercial_fields.outcome.unwrap();
    let won = table
        .columns
        .iter()
        .find(|column| column.column.id == outcome)
        .unwrap()
        .definition
        .property_options
        .iter()
        .find(|option| option.value.as_string() == Some("Won"))
        .unwrap()
        .id;
    assert_eq!(
        rows.rows[0].cells.get(&outcome),
        Some(&models_properties::service::property_value::PropertyValue::SelectOption(vec![won]))
    );
    assert_eq!(upgraded.commercial_fields.money[0].amount, revenue);
    let currency = upgraded.commercial_fields.money[0].currency;
    let usd = table
        .columns
        .iter()
        .find(|column| column.column.id == currency)
        .unwrap()
        .definition
        .property_options
        .iter()
        .find(|option| option.value.as_string() == Some("USD"))
        .unwrap()
        .id;
    assert_eq!(
        rows.rows[0].cells.get(&currency),
        Some(&models_properties::service::property_value::PropertyValue::SelectOption(vec![usd]))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn board_moves_cannot_clear_system_fields_even_after_regrouping(pool: PgPool) {
    let (s, _, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let row = inserted(&write(&s, &a, &p, vec![insert(&p, company)]).await.unwrap());
    let table = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let stage = table
        .columns
        .iter()
        .find(|column| column.name() == "Stage")
        .unwrap()
        .column
        .id;
    for system in [
        p.commercial_fields.outcome.unwrap(),
        p.commercial_fields.money[0].currency,
    ] {
        let view = ViewId::new();
        let create: DatabaseOp = serde_json::from_value(json!({"kind":"view", "table":p.table_id, "view":view,
            "change":{"kind":"create", "view":{"name":format!("Board {system}"), "layout":{"kind":"board", "groupBy":stage,"lanes":[],"cardFields":[],"hideEmptyLanes":false}}}})).unwrap();
        write(&s, &a, &p, vec![create]).await.unwrap();
        let changes = serde_json::from_value(json!([
            {"kind":"view", "table":p.table_id, "view":view,"change":{"kind":"update", "layout":{"kind":"board", "groupBy":system,"lanes":[],"cardFields":[],"hideEmptyLanes":false}}},
            {"kind":"view", "table":p.table_id, "view":view,"change":{"kind":"move_card", "row":row,"lane":{"kind":"none"}}}
        ])).unwrap();
        assert!(matches!(
            write(&s, &a, &p, changes).await,
            Err(PipelineError::Invalid(_))
        ));
        let reloaded = s
            .read_rows(
                access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
                &[row],
            )
            .await
            .unwrap();
        assert!(
            matches!(reloaded[0].cells.get(&system), Some(models_properties::service::property_value::PropertyValue::SelectOption(values)) if values.len() == 1)
        );
    }
}

async fn run_declined_migration(pool: &PgPool) {
    sqlx::raw_sql(include_str!(
        "../../../macro_db_client/migrations/20261120183025_crm_pipeline_outcome_declined.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
}

/// The labels of a pipeline's Outcome options in order, and its table version.
async fn outcome_options(
    s: &Service,
    a: &Access,
    p: &Pipeline,
) -> (Vec<String>, databases::domain::models::TableVersion) {
    let table = s
        .table(access(a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let labels = table
        .columns
        .iter()
        .find(|column| Some(column.column.id) == p.commercial_fields.outcome)
        .unwrap()
        .definition
        .property_options
        .iter()
        .map(|option| option.value.as_string().unwrap().to_owned())
        .collect();
    (labels, table.table.version)
}

/// Returns a pipeline's Outcome to the options it had before Declined.
async fn forget_declined(pool: &PgPool, p: &Pipeline) {
    sqlx::query!(
        "DELETE FROM property_options o USING database_columns c
         WHERE c.id = $1 AND o.property_definition_id = c.property_definition_id
           AND o.string_value = 'Declined'",
        p.commercial_fields.outcome.unwrap().into_uuid(),
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn declined_migration_adds_the_option_once_and_skips_pipelines_in_use(pool: PgPool) {
    let (s, _, a, team, company) = fixture(&pool).await;
    let idle = create(&s, team, PipelineRecordType::Company).await;
    let busy = create(&s, team, PipelineRecordType::Company).await;
    let contended = create(&s, team, PipelineRecordType::Company).await;
    let stalled = create(&s, team, PipelineRecordType::Company).await;
    let generic = s
        .create(
            team_receipt(team, OWNER),
            CreatePipeline {
                name: "Launch".into(),
                record_type: None,
                sharing: PipelineSharing::Private,
            },
        )
        .await
        .unwrap()
        .pipeline;
    let outcome = idle.commercial_fields.outcome.unwrap();
    let won_entry: DatabaseOp = serde_json::from_value(json!({"kind":"rows", "table":idle.table_id,
        "change":{"kind":"insert", "rows":[[
            {"column":idle.primary_column_id,"value":{"type":"entities","value":[{"entityType":"COMPANY","entityId":company.to_string()}]}},
            {"column":outcome,"value":{"type":"options","value":[{"label":"Won"}]}}
        ]]}})).unwrap();
    let row = inserted(&write(&s, &a, &idle, vec![won_entry]).await.unwrap());
    let won = s
        .read_rows(
            access(&a, idle.id, EntityType::CrmPipeline, OWNER).await,
            &[row],
        )
        .await
        .unwrap()[0]
        .cells
        .get(&outcome)
        .cloned();
    forget_declined(&pool, &idle).await;
    forget_declined(&pool, &busy).await;
    forget_declined(&pool, &contended).await;
    forget_declined(&pool, &stalled).await;
    // As the commercial-fields backfill left them, with no colors.
    sqlx::query!(
        "UPDATE property_options o SET color = NULL FROM database_columns c
         WHERE c.id = $1 AND o.property_definition_id = c.property_definition_id",
        busy.commercial_fields.outcome.unwrap().into_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let (labels, stale) = outcome_options(&s, &a, &idle).await;
    assert_eq!(labels, ["Open", "Won", "Lost"]);
    let generic_version = s
        .table(access(&a, generic.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap()
        .table
        .version;

    // A pipeline read holds its row, and another session its Outcome's
    // definition, so the migration passes both by. A third pipeline's journal
    // entry would wait on an uncommitted one: the migration gives up on that
    // pipeline after its lock timeout and goes on.
    let mut reader = pool.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM crm_pipeline_entities WHERE id = $1 FOR SHARE",
        busy.id
    )
    .fetch_one(&mut *reader)
    .await
    .unwrap();
    let mut holder = pool.begin().await.unwrap();
    sqlx::query!(
        "SELECT d.id FROM property_definitions d JOIN database_columns c ON c.property_definition_id = d.id
         WHERE c.id = $1 FOR UPDATE OF d",
        contended.commercial_fields.outcome.unwrap().into_uuid(),
    )
    .fetch_one(&mut *holder)
    .await
    .unwrap();
    let stalled_version = outcome_options(&s, &a, &stalled).await.1;
    let mut journal = pool.begin().await.unwrap();
    sqlx::query!(
        r#"INSERT INTO database_changes (database_id, table_id, version, ops, inverse)
           VALUES ($1, $2, $3, '[]', '{}')"#,
        stalled.database_id.into_uuid(),
        stalled.table_id.into_uuid(),
        stalled_version.0 + 1,
    )
    .execute(&mut *journal)
    .await
    .unwrap();
    run_declined_migration(&pool).await;
    reader.rollback().await.unwrap();
    holder.rollback().await.unwrap();
    journal.rollback().await.unwrap();

    let (labels, version) = outcome_options(&s, &a, &idle).await;
    assert_eq!(labels, ["Open", "Won", "Lost", "Declined"]);
    assert_eq!(version.0, stale.0 + 1);
    let journaled = sqlx::query!(
        r#"SELECT cc.column_id, cc.kind FROM database_changes c
           JOIN database_change_columns cc ON cc.change_id = c.id
           WHERE c.table_id = $1 AND c.version > $2"#,
        idle.table_id.into_uuid(),
        stale.0,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(journaled.len(), 1);
    assert_eq!(journaled[0].column_id, outcome.into_uuid());
    assert_eq!(journaled[0].kind, "add_options");
    let entry = s
        .read_rows(
            access(&a, idle.id, EntityType::CrmPipeline, OWNER).await,
            &[row],
        )
        .await
        .unwrap();
    assert_eq!(entry[0].cells.get(&outcome).cloned(), won);
    for skipped in [&busy, &contended, &stalled] {
        assert_eq!(
            outcome_options(&s, &a, skipped).await.0,
            ["Open", "Won", "Lost"]
        );
    }
    // Giving up undid the stalled pipeline's version bump with its option.
    assert_eq!(outcome_options(&s, &a, &stalled).await.1, stalled_version);
    assert_eq!(
        s.table(access(&a, generic.id, EntityType::CrmPipeline, OWNER).await)
            .await
            .unwrap()
            .table
            .version,
        generic_version
    );

    // A rerun reaches the pipelines it passed by and leaves the others alone.
    run_declined_migration(&pool).await;
    for skipped in [&busy, &contended, &stalled] {
        assert_eq!(
            outcome_options(&s, &a, skipped).await.0,
            ["Open", "Won", "Lost", "Declined"]
        );
    }
    // Declined takes its position's palette color, as an appended option
    // does, but stays uncolored beside options that have no color.
    for (p, color) in [(&idle, Some("#F76B15")), (&busy, None)] {
        let stored = sqlx::query_scalar!(
            "SELECT o.color FROM property_options o JOIN database_columns c
               ON o.property_definition_id = c.property_definition_id
             WHERE c.id = $1 AND o.string_value = 'Declined'",
            p.commercial_fields.outcome.unwrap().into_uuid(),
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(stored.as_deref(), color);
    }
    assert_eq!(
        outcome_options(&s, &a, &idle).await,
        (
            vec![
                "Open".to_owned(),
                "Won".to_owned(),
                "Lost".to_owned(),
                "Declined".to_owned()
            ],
            version
        )
    );
}
