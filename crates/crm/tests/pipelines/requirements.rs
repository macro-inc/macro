use super::*;
use crm::domain::pipelines::requirements::StageRequirement;
use models_properties::service::property_value::PropertyValue;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_required_options_is_refused_until_the_rule_is_removed(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let detail = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let stage = detail.columns[1].column.id;
    let won = OptionId::from_uuid(detail.columns[1].definition.property_options[1].id);
    let approval = ColumnId::new();
    let approved = OptionId::new();
    write(
        &s,
        &a,
        &p,
        vec![
            serde_json::from_value(json!({
                "kind": "column", "table": p.table_id, "column": approval,
                "change": {"kind": "create", "definition": {
                    "source": "new", "name": "Approval",
                    "type": {"type": "select", "multi": false}
                }}
            }))
            .unwrap(),
            DatabaseOp::Column {
                table: p.table_id,
                column: approval,
                change: ColumnChange::AddOptions {
                    options: vec![NewOption {
                        id: approved,
                        label: "Approved".into(),
                    }],
                },
            },
        ],
    )
    .await
    .unwrap();
    let mut rule = StageRequirement {
        stage_column_id: stage,
        stage_id: won,
        required_column_ids: vec![approval],
    };
    s.set_stage_requirement(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        rule.clone(),
    )
    .await
    .unwrap();
    let mut addition = insert(&p, company);
    if let DatabaseOp::Rows {
        change: RowsChange::Insert { rows },
        ..
    } = &mut addition
    {
        rows[0].extend([
            CellWrite {
                column: stage,
                value: CellValue::Options(vec![OptionRef::Id(won)]),
            },
            CellWrite {
                column: approval,
                value: CellValue::Options(vec![OptionRef::Id(approved)]),
            },
        ]);
    }
    let row = inserted(&write(&s, &a, &p, vec![addition]).await.unwrap());
    let delete = DatabaseOp::Column {
        table: p.table_id,
        column: approval,
        change: ColumnChange::DeleteOption { option: approved },
    };
    // No row operation accompanies the schema edit, so affected_rows is empty.
    let error = write(&s, &a, &p, vec![delete.clone()])
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("before deleting its options"), "{error}");
    let saved = s
        .read_rows(
            access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
            &[row],
        )
        .await
        .unwrap();
    assert_eq!(
        saved[0].cells[&approval],
        PropertyValue::SelectOption(vec![approved.into_uuid()])
    );
    rule.required_column_ids.clear();
    s.set_stage_requirement(access(&a, p.id, EntityType::CrmPipeline, OWNER).await, rule)
        .await
        .unwrap();
    write(&s, &a, &p, vec![delete]).await.unwrap();
    let table = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    assert!(
        table
            .columns
            .iter()
            .find(|c| c.column.id == approval)
            .unwrap()
            .definition
            .property_options
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stage_requirements_reject_atomically_and_allow_combined_edits(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let detail = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let stage = detail.columns[1].column.id;
    let won = OptionId::from_uuid(detail.columns[1].definition.property_options[1].id);
    let amount = detail.columns[3].column.id;
    s.set_stage_requirement(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        StageRequirement {
            stage_column_id: stage,
            stage_id: won,
            required_column_ids: vec![amount],
        },
    )
    .await
    .unwrap();
    let mut addition = insert(&p, company);
    if let DatabaseOp::Rows {
        change: RowsChange::Insert { rows },
        ..
    } = &mut addition
    {
        rows[0].push(CellWrite {
            column: stage,
            value: CellValue::Options(vec![OptionRef::Label("Won".into())]),
        });
    }
    let error = write(&s, &a, &p, vec![addition.clone()])
        .await
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("Revenue") && error.contains("Won"),
        "{error}"
    );
    assert!(
        s.rows(access(&a, p.id, EntityType::CrmPipeline, OWNER).await, None)
            .await
            .unwrap()
            .rows
            .is_empty()
    );
    if let DatabaseOp::Rows {
        change: RowsChange::Insert { rows },
        ..
    } = &mut addition
    {
        rows[0].push(CellWrite {
            column: amount,
            value: CellValue::Number(0.0),
        });
    }
    let row = inserted(&write(&s, &a, &p, vec![addition]).await.unwrap());
    let clear = DatabaseOp::Rows {
        table: p.table_id,
        change: RowsChange::Update {
            changes: RowChanges::Uniform {
                rows: vec![row],
                cells: vec![CellWrite {
                    column: amount,
                    value: CellValue::Clear,
                }],
            },
        },
    };
    assert!(write(&s, &a, &p, vec![clear.clone()]).await.is_err());
    let saved = s
        .read_rows(
            access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
            &[row],
        )
        .await
        .unwrap();
    assert_eq!(saved[0].cells[&amount], PropertyValue::Num(0.0));
    let leave = DatabaseOp::Rows {
        table: p.table_id,
        change: RowsChange::Update {
            changes: RowChanges::Uniform {
                rows: vec![row],
                cells: vec![CellWrite {
                    column: stage,
                    value: CellValue::Clear,
                }],
            },
        },
    };
    write(&s, &a, &p, vec![clear, leave]).await.unwrap();
    let enter = DatabaseOp::Rows {
        table: p.table_id,
        change: RowsChange::Update {
            changes: RowChanges::PerRow {
                rows: vec![RowChange {
                    row,
                    cells: vec![CellWrite {
                        column: stage,
                        value: CellValue::Options(vec![OptionRef::Id(won)]),
                    }],
                }],
            },
        },
    };
    assert!(write(&s, &a, &p, vec![enter.clone()]).await.is_err());
    let fill = DatabaseOp::Rows {
        table: p.table_id,
        change: RowsChange::Update {
            changes: RowChanges::Uniform {
                rows: vec![row],
                cells: vec![CellWrite {
                    column: amount,
                    value: CellValue::Number(500.0),
                }],
            },
        },
    };
    write(&s, &a, &p, vec![enter, fill]).await.unwrap();
    let saved = s
        .read_rows(
            access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
            &[row],
        )
        .await
        .unwrap();
    assert_eq!(saved[0].cells[&amount], PropertyValue::Num(500.0));
    assert_eq!(
        saved[0].cells[&stage],
        PropertyValue::SelectOption(vec![won.into_uuid()])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rejected_required_input_edits_preserve_materialized_formulas(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let detail = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let stage = detail.columns[1].column.id;
    let won = OptionId::from_uuid(detail.columns[1].definition.property_options[1].id);
    let amount = detail.columns[3].column.id;
    let doubled = ColumnId::new();
    write(
        &s,
        &a,
        &p,
        vec![DatabaseOp::Column {
            table: p.table_id,
            column: doubled,
            change: ColumnChange::Create {
                definition: NewColumn::Derived {
                    name: "Double revenue".into(),
                    formula: Formula::Binary {
                        operator: Operator::Multiply,
                        left: Box::new(Formula::Column { column: amount }),
                        right: Box::new(Formula::Number { value: 2.0 }),
                    },
                },
                after: None,
            },
        }],
    )
    .await
    .unwrap();
    let rule = StageRequirement {
        stage_column_id: stage,
        stage_id: won,
        required_column_ids: vec![amount],
    };
    s.set_stage_requirement(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        rule.clone(),
    )
    .await
    .unwrap();
    let mut addition = insert(&p, company);
    if let DatabaseOp::Rows {
        change: RowsChange::Insert { rows },
        ..
    } = &mut addition
    {
        rows[0].extend([
            CellWrite {
                column: stage,
                value: CellValue::Options(vec![OptionRef::Id(won)]),
            },
            CellWrite {
                column: amount,
                value: CellValue::Number(50.0),
            },
        ]);
    }
    let row = inserted(&write(&s, &a, &p, vec![addition]).await.unwrap());
    let before = s
        .read_rows(
            access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
            &[row],
        )
        .await
        .unwrap();
    assert_eq!(before[0].cells[&amount], PropertyValue::Num(50.0));
    assert_eq!(before[0].cells[&doubled], PropertyValue::Num(100.0));
    assert!(
        write(
            &s,
            &a,
            &p,
            vec![DatabaseOp::Rows {
                table: p.table_id,
                change: RowsChange::Update {
                    changes: RowChanges::Uniform {
                        rows: vec![row],
                        cells: vec![CellWrite {
                            column: amount,
                            value: CellValue::Clear,
                        }],
                    },
                },
            }],
        )
        .await
        .is_err()
    );
    let after = s
        .read_rows(
            access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
            &[row],
        )
        .await
        .unwrap();
    assert_eq!(after[0].cells, before[0].cells);
    assert!(
        s.set_stage_requirement(
            access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
            StageRequirement {
                required_column_ids: vec![doubled],
                ..rule.clone()
            },
        )
        .await
        .is_err()
    );
    assert_eq!(
        s.stage_requirements(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
            .await
            .unwrap(),
        vec![rule]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn board_moves_share_stage_validation_and_keep_failed_moves_unchanged(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let detail = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let stage = detail.columns[1].column.id;
    let won = OptionId::from_uuid(detail.columns[1].definition.property_options[1].id);
    let amount = detail.columns[3].column.id;
    s.set_stage_requirement(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        StageRequirement {
            stage_column_id: stage,
            stage_id: won,
            required_column_ids: vec![amount],
        },
    )
    .await
    .unwrap();
    let row = inserted(&write(&s, &a, &p, vec![insert(&p, company)]).await.unwrap());
    let view = ViewId::new();
    let create_view: DatabaseOp = serde_json::from_value(json!({
        "kind":"view", "table":p.table_id, "view":view,
        "change":{"kind":"create", "view":{"name":"Stages", "query":{"filter":null,"sort":[]}, "layout":{"kind":"board", "groupBy":stage,"title":p.primary_column_id,"lanes":[],"cardFields":[],"hideEmptyLanes":false}}}
    })).unwrap();
    let moving = DatabaseOp::View {
        table: p.table_id,
        view,
        change: ViewChange::MoveCard {
            row,
            lane: views::LaneKey::Option(won),
            before: None,
            after: None,
        },
    };
    // A view created in this batch must use its new grouping column too.
    assert!(
        write(&s, &a, &p, vec![create_view.clone(), moving.clone()])
            .await
            .unwrap_err()
            .to_string()
            .contains("Revenue")
    );
    assert!(
        s.table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
            .await
            .unwrap()
            .views
            .iter()
            .all(|stored| stored.id != view)
    );
    write(&s, &a, &p, vec![create_view]).await.unwrap();
    assert!(
        write(&s, &a, &p, vec![moving.clone()])
            .await
            .unwrap_err()
            .to_string()
            .contains("Revenue")
    );
    let saved = s
        .read_rows(
            access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
            &[row],
        )
        .await
        .unwrap();
    assert!(!saved[0].cells.contains_key(&stage));
    // A board changed to a timeline in this batch no longer supplies a lane
    // column. Storage must reject the card move without inventing a stage edit.
    let range = ColumnId::new();
    let create_range = DatabaseOp::Column {
        table: p.table_id,
        column: range,
        change: ColumnChange::Create {
            definition: models_databases::NewColumn::New {
                name: "Schedule".into(),
                kind: models_databases::ColumnKind::DateRange,
                options: vec![],
                infer_type: false,
            },
            after: None,
        },
    };
    let timeline: DatabaseOp = serde_json::from_value(json!({
        "kind":"view", "table":p.table_id, "view":view,
        "change":{"kind":"update", "layout":{"kind":"timeline", "range":range,
            "title":p.primary_column_id, "groupBy":stage, "barFields":[], "colorBy":null}}
    }))
    .unwrap();
    let error = write(&s, &a, &p, vec![create_range, timeline, moving.clone()])
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("only a board's cards move"), "{error}");
    let fill = DatabaseOp::Rows {
        table: p.table_id,
        change: RowsChange::Update {
            changes: RowChanges::Uniform {
                rows: vec![row],
                cells: vec![CellWrite {
                    column: amount,
                    value: CellValue::Number(10.0),
                }],
            },
        },
    };
    write(&s, &a, &p, vec![fill, moving]).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rule_ids_survive_renames_and_cascade_on_explicit_deletion(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let detail = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let stage = detail.columns[1].column.id;
    let won = OptionId::from_uuid(detail.columns[1].definition.property_options[1].id);
    let amount = detail.columns[3].column.id;
    let rule = StageRequirement {
        stage_column_id: stage,
        stage_id: won,
        required_column_ids: vec![amount],
    };
    s.set_stage_requirement(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        rule.clone(),
    )
    .await
    .unwrap();
    write(
        &s,
        &a,
        &p,
        vec![
            DatabaseOp::Column {
                table: p.table_id,
                column: stage,
                change: ColumnChange::Rename {
                    name: "Milestone".into(),
                    previous_name: None,
                },
            },
            DatabaseOp::Column {
                table: p.table_id,
                column: stage,
                change: ColumnChange::UpdateOption {
                    option: won,
                    label: Some("Negotiation".into()),
                    color: None,
                },
            },
            DatabaseOp::Column {
                table: p.table_id,
                column: amount,
                change: ColumnChange::Rename {
                    name: "Amount".into(),
                    previous_name: None,
                },
            },
        ],
    )
    .await
    .unwrap();
    assert_eq!(
        s.stage_requirements(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
            .await
            .unwrap(),
        vec![rule]
    );
    let mut addition = insert(&p, company);
    if let DatabaseOp::Rows {
        change: RowsChange::Insert { rows },
        ..
    } = &mut addition
    {
        rows[0].push(CellWrite {
            column: stage,
            value: CellValue::Options(vec![OptionRef::Label("Negotiation".into())]),
        });
    }
    let error = write(&s, &a, &p, vec![addition.clone()])
        .await
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("Amount") && error.contains("Negotiation"),
        "{error}"
    );
    write(
        &s,
        &a,
        &p,
        vec![DatabaseOp::Column {
            table: p.table_id,
            column: amount,
            change: ColumnChange::Delete,
        }],
    )
    .await
    .unwrap();
    assert!(
        s.stage_requirements(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
            .await
            .unwrap()
            .is_empty()
    );
    write(&s, &a, &p, vec![addition]).await.unwrap();
    s.set_stage_requirement(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        StageRequirement {
            stage_column_id: stage,
            stage_id: won,
            required_column_ids: vec![detail.columns[2].column.id],
        },
    )
    .await
    .unwrap();
    write(
        &s,
        &a,
        &p,
        vec![DatabaseOp::Column {
            table: p.table_id,
            column: stage,
            change: ColumnChange::DeleteOption { option: won },
        }],
    )
    .await
    .unwrap();
    assert!(
        s.stage_requirements(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn requirements_refuse_foreign_columns_and_non_stage_fields(pool: PgPool) {
    let (s, _db, a, team, _) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let other = create(&s, team, PipelineRecordType::Company).await;
    let detail = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let stage = detail.columns[1].column.id;
    let won = OptionId::from_uuid(detail.columns[1].definition.property_options[1].id);
    for rule in [
        StageRequirement {
            stage_column_id: stage,
            stage_id: won,
            required_column_ids: vec![other.primary_column_id],
        },
        StageRequirement {
            stage_column_id: detail.columns[3].column.id,
            stage_id: won,
            required_column_ids: vec![stage],
        },
        StageRequirement {
            stage_column_id: stage,
            stage_id: OptionId::new(),
            required_column_ids: vec![detail.columns[3].column.id],
        },
    ] {
        assert!(
            s.set_stage_requirement(access(&a, p.id, EntityType::CrmPipeline, OWNER).await, rule)
                .await
                .is_err()
        );
    }
    assert!(
        s.stage_requirements(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stage_label_case_and_duplicate_option_requests_cannot_bypass_rules(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let detail = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let stage = detail.columns[1].column.id;
    let option = OptionId::from_uuid(detail.columns[1].definition.property_options[1].id);
    write(
        &s,
        &a,
        &p,
        vec![DatabaseOp::Column {
            table: p.table_id,
            column: stage,
            change: ColumnChange::UpdateOption {
                option,
                label: Some("Étape".into()),
                color: None,
            },
        }],
    )
    .await
    .unwrap();
    s.set_stage_requirement(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        StageRequirement {
            stage_column_id: stage,
            stage_id: option,
            required_column_ids: vec![detail.columns[3].column.id],
        },
    )
    .await
    .unwrap();
    let mut addition = insert(&p, company);
    if let DatabaseOp::Rows {
        change: RowsChange::Insert { rows },
        ..
    } = &mut addition
    {
        rows[0].push(CellWrite {
            column: stage,
            value: CellValue::Options(vec![OptionRef::Label(" ÉTAPE ".into())]),
        });
    }
    let error = write(
        &s,
        &a,
        &p,
        vec![
            DatabaseOp::Column {
                table: p.table_id,
                column: stage,
                change: ColumnChange::AddOptions {
                    options: vec![NewOption {
                        id: OptionId::new(),
                        label: "étape".into(),
                    }],
                },
            },
            addition,
        ],
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(error.contains("Revenue"), "{error}");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_stage_entry_and_required_field_clear_cannot_both_commit(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let detail = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let stage = detail.columns[1].column.id;
    let option = OptionId::from_uuid(detail.columns[1].definition.property_options[1].id);
    let amount = detail.columns[3].column.id;
    s.set_stage_requirement(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        StageRequirement {
            stage_column_id: stage,
            stage_id: option,
            required_column_ids: vec![amount],
        },
    )
    .await
    .unwrap();
    let mut addition = insert(&p, company);
    if let DatabaseOp::Rows {
        change: RowsChange::Insert { rows },
        ..
    } = &mut addition
    {
        rows[0].push(CellWrite {
            column: amount,
            value: CellValue::Number(10.0),
        });
    }
    let row = inserted(&write(&s, &a, &p, vec![addition]).await.unwrap());
    let entering = vec![DatabaseOp::Rows {
        table: p.table_id,
        change: RowsChange::Update {
            changes: RowChanges::Uniform {
                rows: vec![row],
                cells: vec![CellWrite {
                    column: stage,
                    value: CellValue::Options(vec![OptionRef::Id(option)]),
                }],
            },
        },
    }];
    let clearing = vec![DatabaseOp::Rows {
        table: p.table_id,
        change: RowsChange::Update {
            changes: RowChanges::Uniform {
                rows: vec![row],
                cells: vec![CellWrite {
                    column: amount,
                    value: CellValue::Clear,
                }],
            },
        },
    }];
    let (entered, cleared) = tokio::join!(write(&s, &a, &p, entering), write(&s, &a, &p, clearing));
    assert_ne!(entered.is_ok(), cleared.is_ok(), "{entered:?}; {cleared:?}");
    let saved = s
        .read_rows(
            access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
            &[row],
        )
        .await
        .unwrap();
    if saved[0].cells.contains_key(&stage) {
        assert_eq!(saved[0].cells[&amount], PropertyValue::Num(10.0));
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn contended_pipeline_guards_release_pool_connections(pool: PgPool) {
    use crm::outbound::pipelines::PipelineRepoError;
    use sqlx::postgres::PgPoolOptions;
    use std::time::Duration;

    let (service, _, _, team, _) = fixture(&pool).await;
    let pipeline = create(&service, team, PipelineRecordType::Company).await;
    let bounded = PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(2))
        .connect_with(pool.connect_options().as_ref().clone())
        .await
        .unwrap();
    let repo = PgPipelineRepo::new(
        bounded.clone(),
        PgCellStore::new(bounded.clone(), PropertiesPgRepo::new(bounded.clone())),
    );
    let holder = repo.lock_write(pipeline.id).await.unwrap().unwrap();

    // The waiter uses the only remaining connection. It must release that
    // connection while the holder still owns the row lock, so storage can run.
    for reader in [false, true] {
        let waiting = async {
            if reader {
                repo.lock_live(pipeline.id).await
            } else {
                repo.lock_write(pipeline.id).await
            }
        };
        let failure = tokio::time::timeout(Duration::from_secs(10), waiting)
            .await
            .expect("a queued guard must not exhaust the pool indefinitely")
            .unwrap_err();
        let PipelineRepoError::Sqlx(failure) = failure else {
            panic!("expected a PostgreSQL lock timeout");
        };
        assert_eq!(
            failure
                .as_database_error()
                .and_then(|error| error.code())
                .as_deref(),
            Some("55P03")
        );
        let connection = bounded.acquire().await.unwrap();
        drop(connection);
    }
    holder.rollback().await.unwrap();
    assert!(repo.lock_write(pipeline.id).await.unwrap().is_some());
}
