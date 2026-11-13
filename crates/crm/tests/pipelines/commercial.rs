use super::*;

/// The backfill as the migration runner applies it, against a pipeline put back
/// into its pre-migration shape. Its functions are dropped at the end, so it reruns.
async fn run_backfill(pool: &PgPool) {
    sqlx::raw_sql(include_str!(
        "../../../macro_db_client/migrations/20261113162435_crm_pipeline_commercial_fields_backfill.sql"
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
