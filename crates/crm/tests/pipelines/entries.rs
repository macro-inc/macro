//! The Pipelines card: entries for records, read from the references to them,
//! the viewer's grants on the pipelines holding them, and one live guard.

use super::*;
use std::collections::BTreeMap;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn entries_list_referencing_rows_from_visible_live_pipelines(pool: PgPool) {
    use databases::domain::storage::DatabaseStorageService;
    use models_properties::service::property_value::PropertyValue;
    let (s, db, a, team, company) = fixture(&pool).await;
    // Source ids are cached per user across this binary's parallel tests, so
    // a teammate shared with other tests could see another test's teams.
    let teammate = format!("macro|entries-{}@macro.com", Uuid::now_v7());
    let teammate_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1,$2,$2,$2)",
        teammate_id,
        teammate
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1,$1,$2)"#,
        teammate,
        teammate_id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO team_user (team_id,user_id,team_role) VALUES ($1,$2,'member')"#,
        team,
        teammate
    )
    .execute(&pool)
    .await
    .unwrap();
    let other = Uuid::now_v7();
    sqlx::query!("INSERT INTO crm_companies (id, team_id, first_interaction, last_interaction) VALUES ($1, $2, now(), now())", other, team).execute(&pool).await.unwrap();
    let private = create(&s, team, PipelineRecordType::Company).await;
    let shared = create(&s, team, PipelineRecordType::Company).await;
    s.share(
        access(&a, shared.id, EntityType::CrmPipeline, OWNER).await,
        PipelineSharing::Team,
    )
    .await
    .unwrap();
    let trashed = create(&s, team, PipelineRecordType::Company).await;
    let revenue = s
        .table(access(&a, private.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap()
        .columns
        .into_iter()
        .find(|column| column.definition.definition.display_name == "Revenue")
        .unwrap()
        .column
        .id;
    let row = |p: &Pipeline, entity: Uuid, amount: f64| {
        json!([
            {"column": p.primary_column_id, "value": {"type":"entities", "value":[{"entityType":"COMPANY", "entityId":entity.to_string()}]}},
            {"column": revenue, "value": {"type":"number", "value":amount}}
        ])
    };
    let insert_rows = |p: &Pipeline, rows: Vec<serde_json::Value>| -> DatabaseOp {
        serde_json::from_value(
            json!({"kind":"rows", "table":p.table_id, "change":{"kind":"insert", "rows":rows}}),
        )
        .unwrap()
    };
    let private_rows = write(
        &s,
        &a,
        &private,
        vec![insert_rows(
            &private,
            vec![
                row(&private, company, 1.0),
                row(&private, other, 2.0),
                row(&private, company, 3.0),
            ],
        )],
    )
    .await
    .unwrap();
    let shared_row = inserted(
        &write(&s, &a, &shared, vec![insert(&shared, company)])
            .await
            .unwrap(),
    );
    write(&s, &a, &trashed, vec![insert(&trashed, company)])
        .await
        .unwrap();
    s.set_trashed(
        access(&a, trashed.id, EntityType::CrmPipeline, OWNER).await,
        true,
    )
    .await
    .unwrap();

    let owner = s
        .entries(&user(OWNER), PipelineRecordType::Company, &[company])
        .await
        .unwrap();
    let mut pipelines = owner
        .iter()
        .map(|e| e.pipeline.pipeline.id)
        .collect::<Vec<_>>();
    pipelines.dedup();
    assert_eq!(pipelines.len(), 2);
    assert!(pipelines.contains(&private.id) && pipelines.contains(&shared.id));
    let private_entries = owner
        .iter()
        .filter(|e| e.pipeline.pipeline.id == private.id)
        .collect::<Vec<_>>();
    // Both of the company's rows, in the pipeline's row order, with their cells.
    assert_eq!(
        private_entries
            .iter()
            .map(|e| e.cells.get(&revenue).cloned())
            .collect::<Vec<_>>(),
        vec![Some(PropertyValue::Num(1.0)), Some(PropertyValue::Num(3.0))]
    );
    assert!(private_entries.iter().all(|e| e.record_id == company
        && e.pipeline.grant == AccessLevel::Owner
        && e.columns.len() == 6
        && e.cells.contains_key(&private.primary_column_id)));
    match &private_rows[0] {
        OpResult::Rows {
            change: RowsResult::Inserted { rows },
            ..
        } => assert_eq!(private_entries[0].row_id, rows[0]),
        other => panic!("{other:?}"),
    }

    // Storage reads only the asked-for rows of the named table.
    let cells = db
        .storage_row_cells(
            private.database_id,
            private.table_id,
            &[private_entries[1].row_id, shared_row],
        )
        .await
        .unwrap();
    assert_eq!(cells.len(), 1);
    assert_eq!(cells[0].row_id, private_entries[1].row_id);
    assert_eq!(cells[0].cells[&revenue], PropertyValue::Num(3.0));

    // A batch answers each record; another record type matches nothing.
    let both = s
        .entries(&user(OWNER), PipelineRecordType::Company, &[company, other])
        .await
        .unwrap();
    assert_eq!(both.iter().filter(|e| e.record_id == other).count(), 1);
    assert!(
        s.entries(&user(OWNER), PipelineRecordType::Contact, &[company])
            .await
            .unwrap()
            .is_empty()
    );

    // Teammates see only shared pipelines; outsiders see nothing.
    let member = s
        .entries(&user(&teammate), PipelineRecordType::Company, &[company])
        .await
        .unwrap();
    assert_eq!(member.len(), 1);
    assert_eq!(member[0].pipeline.pipeline.id, shared.id);
    assert_eq!(member[0].pipeline.grant, AccessLevel::Edit);
    assert!(
        s.entries(&user(OUTSIDER), PipelineRecordType::Company, &[company])
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn entries_come_only_from_primary_references_of_tracked_pipelines(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let op = |value| serde_json::from_value::<DatabaseOp>(value).unwrap();
    let names = |entity: Uuid| json!({"type":"entities","value":[{"entityType":"COMPANY","entityId":entity.to_string()}]});
    let other = Uuid::now_v7();
    sqlx::query!("INSERT INTO crm_companies (id, team_id, first_interaction, last_interaction) VALUES ($1, $2, now(), now())", other, team).execute(&pool).await.unwrap();
    // A tracked pipeline with a second company column.
    let tracked = create(&s, team, PipelineRecordType::Company).await;
    let partner = ColumnId::new();
    write(&s, &a, &tracked, vec![op(json!({
        "kind": "column", "table": tracked.table_id, "column": partner,
        "change": {"kind": "create", "definition": {"source": "new", "name": "Partner", "type": {"type": "entity", "target": "COMPANY", "multi": false}}}
    }))]).await.unwrap();
    let rows = match &write(&s, &a, &tracked, vec![op(json!({
        "kind": "rows", "table": tracked.table_id,
        "change": {"kind": "insert", "rows": [
            [{"column": tracked.primary_column_id, "value": names(other)}, {"column": partner, "value": names(company)}],
            [{"column": tracked.primary_column_id, "value": names(company)}, {"column": partner, "value": names(other)}]
        ]}
    }))]).await.unwrap()[0] {
        OpResult::Rows { change: RowsResult::Inserted { rows }, .. } => rows.clone(),
        other => panic!("{other:?}"),
    };
    // A generic pipeline whose Name became a company column.
    let generic = s
        .create(
            team_receipt(team, OWNER),
            CreatePipeline {
                name: "Partners".into(),
                record_type: None,
                sharing: PipelineSharing::Private,
            },
        )
        .await
        .unwrap()
        .pipeline;
    write(&s, &a, &generic, vec![op(json!({
        "kind": "column", "table": generic.table_id, "column": generic.primary_column_id,
        "change": {"kind": "change_type", "to": {"type": "entity", "target": "COMPANY", "multi": false}}
    }))]).await.unwrap();
    write(&s, &a, &generic, vec![op(json!({
        "kind": "rows", "table": generic.table_id,
        "change": {"kind": "insert", "rows": [[{"column": generic.primary_column_id, "value": names(company)}]]}
    }))]).await.unwrap();
    let second = create(&s, team, PipelineRecordType::Company).await;
    let second_row = inserted(
        &write(&s, &a, &second, vec![insert(&second, company)])
            .await
            .unwrap(),
    );

    // Only rows whose primary column names the company, grouped by pipeline.
    let entries = s
        .entries(
            &user(OWNER),
            PipelineRecordType::Company,
            &[company, company],
        )
        .await
        .unwrap();
    assert_eq!(
        entries
            .iter()
            .map(|e| (e.pipeline.pipeline.id, e.row_id, e.record_id))
            .collect::<Vec<_>>(),
        vec![
            (tracked.id, rows[1], company),
            (second.id, second_row, company)
        ]
    );
    assert_eq!(entries[0].columns.len(), 7);
    assert!(entries[0].cells.contains_key(&partner));
    assert_eq!(entries[1].columns.len(), 6);

    // One pipeline's rows, for each record its primary column names.
    let view = access(&a, tracked.id, EntityType::CrmPipeline, OWNER).await;
    assert_eq!(
        s.record_rows(view, &[company, other])
            .await
            .unwrap()
            .iter()
            .map(|r| (r.row_id, r.record_id))
            .collect::<Vec<_>>(),
        vec![(rows[0], other), (rows[1], company)]
    );
}

/// Copy a row's cell of `definition` onto another entity, as raw storage.
async fn copy_cell(
    pool: &PgPool,
    row: RowId,
    definition: Uuid,
    entity_id: &str,
    entity_type: &str,
) {
    let copied = sqlx::query!(
        r#"INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
           SELECT $1, $2, $3::text::property_entity_type, property_definition_id, values
           FROM entity_properties
           WHERE entity_id = $4 AND entity_type = 'DATABASE_ROW' AND property_definition_id = $5"#,
        Uuid::now_v7(),
        entity_id,
        entity_type,
        row.into_uuid().to_string(),
        definition,
    )
    .execute(pool)
    .await
    .unwrap();
    assert_eq!(copied.rows_affected(), 1);
}

/// The lookup the card starts from and the guard it takes next, each on its
/// own: cells that only look like a primary reference, and pipelines trashed
/// before the lookup or between it and the guard.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn referencing_rows_and_the_live_guard_keep_only_live_primary_references(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let repo = PgPipelineRepo::new(
        pool.clone(),
        PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone())),
    );
    let other = Uuid::now_v7();
    sqlx::query!("INSERT INTO crm_companies (id, team_id, first_interaction, last_interaction) VALUES ($1, $2, now(), now())", other, team).execute(&pool).await.unwrap();
    let tracked = create(&s, team, PipelineRecordType::Company).await;
    let held = inserted(
        &write(&s, &a, &tracked, vec![insert(&tracked, company)])
            .await
            .unwrap(),
    );
    let unrelated = inserted(
        &write(&s, &a, &tracked, vec![insert(&tracked, other)])
            .await
            .unwrap(),
    );
    let second = create(&s, team, PipelineRecordType::Company).await;
    let second_row = inserted(
        &write(&s, &a, &second, vec![insert(&second, company)])
            .await
            .unwrap(),
    );
    let trashed = create(&s, team, PipelineRecordType::Company).await;
    write(&s, &a, &trashed, vec![insert(&trashed, company)])
        .await
        .unwrap();
    s.set_trashed(
        access(&a, trashed.id, EntityType::CrmPipeline, OWNER).await,
        true,
    )
    .await
    .unwrap();

    // Copies of the tracked pipeline's cell naming the company: on another
    // entity type under a row's id, on a row of another table that also has
    // the primary column's definition, and under a row id that is no uuid.
    let definition = sqlx::query_scalar!(
        "SELECT property_definition_id FROM database_columns WHERE id = $1",
        tracked.primary_column_id.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    copy_cell(
        &pool,
        held,
        definition,
        &unrelated.into_uuid().to_string(),
        "DOCUMENT",
    )
    .await;
    sqlx::query!(
        "INSERT INTO database_columns (id, table_id, property_definition_id, position) VALUES ($1, $2, $3, 'zz')",
        Uuid::now_v7(),
        second.table_id.into_uuid(),
        definition
    )
    .execute(&pool)
    .await
    .unwrap();
    copy_cell(
        &pool,
        held,
        definition,
        &second_row.into_uuid().to_string(),
        "DATABASE_ROW",
    )
    .await;
    // The row-membership trigger refuses a cell under a row id that is no
    // uuid; one written around it must neither match nor fail the lookup.
    sqlx::query!("ALTER TABLE entity_properties DISABLE TRIGGER database_row_cell_membership")
        .execute(&pool)
        .await
        .unwrap();
    copy_cell(&pool, held, definition, "not-a-row", "DATABASE_ROW").await;
    sqlx::query!("ALTER TABLE entity_properties ENABLE TRIGGER database_row_cell_membership")
        .execute(&pool)
        .await
        .unwrap();

    let found = |references: Vec<PipelineReference>| {
        references
            .into_iter()
            .map(|r| (r.pipeline_id, r.row_id, r.record_id))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        found(
            repo.referencing_rows(PipelineRecordType::Company, &[company], None)
                .await
                .unwrap()
        ),
        vec![
            (tracked.id, held, company),
            (second.id, second_row, company)
        ],
        "only primary cells of live company pipelines"
    );
    assert_eq!(
        found(
            repo.referencing_rows(PipelineRecordType::Company, &[company], Some(second.id))
                .await
                .unwrap()
        ),
        vec![(second.id, second_row, company)]
    );
    assert!(
        repo.referencing_rows(PipelineRecordType::Contact, &[company], None)
            .await
            .unwrap()
            .is_empty(),
        "a contact lookup reads no company pipeline"
    );

    // Trashed after the lookup: the guard leaves it out.
    s.set_trashed(
        access(&a, second.id, EntityType::CrmPipeline, OWNER).await,
        true,
    )
    .await
    .unwrap();
    let (guard, live) = repo.lock_live_many(&[tracked.id, second.id]).await.unwrap();
    assert_eq!(
        live.iter().map(|p| p.id).collect::<Vec<_>>(),
        vec![tracked.id]
    );
    drop(guard);
}

/// Each pipeline the entries come from, with the grant they carry.
async fn entry_grants(s: &Service, viewer: &str, record: Uuid) -> BTreeMap<Uuid, AccessLevel> {
    s.entries(&user(viewer), PipelineRecordType::Company, &[record])
        .await
        .unwrap()
        .into_iter()
        .map(|e| (e.pipeline.pipeline.id, e.pipeline.grant))
        .collect()
}

/// Another team's pipeline can hold a record this team works on. Its entries
/// reach only those it is shared with, never this team's viewer, whatever
/// grants the viewer holds on their own team's pipelines.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn entries_leave_out_another_teams_pipeline_holding_the_record(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let lead = fresh_user(&pool, Some(team)).await;
    let viewer = fresh_user(&pool, Some(team)).await;
    let to_viewer = direct_message(&pool, &[&lead, &viewer]).await;
    let other_team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Other CRM', $2)",
        other_team,
        OUTSIDER
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, true)",
        other_team
    )
    .execute(&pool)
    .await
    .unwrap();
    let rival = fresh_user(&pool, Some(other_team)).await;
    let rival_teammate = fresh_user(&pool, Some(other_team)).await;

    // The viewer owns one pipeline holding the company, edits one shared with
    // the team, and views one shared with them in a direct message.
    let owned = create_by(&s, team, &viewer, PipelineRecordType::Company).await;
    let edited = create_by(&s, team, &lead, PipelineRecordType::Company).await;
    s.share(
        access(&a, edited.id, EntityType::CrmPipeline, &lead).await,
        PipelineSharing::Team,
    )
    .await
    .unwrap();
    let viewed = create_by(&s, team, &lead, PipelineRecordType::Company).await;
    s.update_share_permissions(
        access(&a, viewed.id, EntityType::CrmPipeline, &lead).await,
        channel_grants(&[(to_viewer, Some(AccessLevel::View))]),
    )
    .await
    .unwrap();
    for (p, actor) in [(&owned, &viewer), (&edited, &lead), (&viewed, &lead)] {
        write_by(&s, &a, p, actor, vec![insert(p, company)])
            .await
            .unwrap();
    }
    // The other team's pipeline, shared with that team. Membership is limited
    // to one team, so moving its owner keeps their owner grant while giving
    // them the company to reference.
    let rivals = create_by(&s, other_team, &rival, PipelineRecordType::Company).await;
    s.share(
        access(&a, rivals.id, EntityType::CrmPipeline, &rival).await,
        PipelineSharing::Team,
    )
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE team_user SET team_id = $1 WHERE user_id = $2",
        team,
        rival
    )
    .execute(&pool)
    .await
    .unwrap();
    write_by(&s, &a, &rivals, &rival, vec![insert(&rivals, company)])
        .await
        .unwrap();

    assert_eq!(
        entry_grants(&s, &viewer, company).await,
        BTreeMap::from([
            (owned.id, AccessLevel::Owner),
            (edited.id, AccessLevel::Edit),
            (viewed.id, AccessLevel::View),
        ])
    );
    // The other team's pipeline does hold the company, for those it is shared with.
    assert_eq!(
        entry_grants(&s, &rival_teammate, company).await,
        BTreeMap::from([(rivals.id, AccessLevel::Edit)])
    );
    // Only this pipeline: whether the rival's source ids were cached before
    // the move decides whether they also see the team's shared pipeline.
    assert_eq!(
        entry_grants(&s, &rival, company).await.get(&rivals.id),
        Some(&AccessLevel::Owner)
    );
    // The owner of a shared pipeline keeps the owner's level.
    assert_eq!(
        entry_grants(&s, &lead, company).await,
        BTreeMap::from([
            (edited.id, AccessLevel::Owner),
            (viewed.id, AccessLevel::Owner),
        ])
    );
}
