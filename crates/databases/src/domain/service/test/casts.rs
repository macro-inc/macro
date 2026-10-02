use super::*;
use crate::domain::models::{CastVerdict, ColumnConversion, ConvertedCell};
use models_databases::{EntityKind, EntityRef, RowChange};
use models_properties::shared::EntityReference;

fn version(world: &Shared) -> TableVersion {
    world.lock().unwrap().tables[0].version
}

fn retype(seeded: &Seeded, column: ColumnId, to: ColumnKind) -> OpBatch {
    OpBatch {
        ops: vec![DatabaseOp::Column {
            table: seeded.table_id,
            column,
            change: ColumnChange::ChangeType { to },
        }],
        base_versions: HashMap::from([(seeded.table_id, version(&seeded.world))]),
    }
}

#[tokio::test]
async fn a_never_cast_is_refused_with_its_reason_before_touching_data() {
    let seeded = seeded().await;
    let before = version(&seeded.world);
    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            retype(&seeded, seeded.plus_ones_column.id, ColumnKind::Date),
        )
        .await
        .unwrap_err();

    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(refusal.reason, "Numbers aren't dates.");
    let w = seeded.world.lock().unwrap();
    assert_eq!(w.definitions.len(), 3);
    assert_eq!(w.tables[0].version, before);
}

#[tokio::test]
async fn a_failed_checked_cast_counts_the_misfits_and_quotes_three() {
    let seeded = seeded().await;
    insert_names(&seeded, &["TBD", "n/a", "12.5.0", "7"]).await;
    let before = version(&seeded.world);

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            retype(&seeded, seeded.name_column.id, ColumnKind::Number),
        )
        .await
        .unwrap_err();

    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        "4 values in \"Name\" aren't numbers: 'Sam', 'TBD', 'n/a'. \
         Fix them, or add a column of the new type for the values that convert."
    );
    let w = seeded.world.lock().unwrap();
    assert_eq!(w.definitions.len(), 3);
    assert_eq!(w.tables[0].version, before);
}

#[tokio::test]
async fn a_checked_cast_whose_values_all_fit_converts_them() {
    let seeded = seeded().await;
    let rows = insert_names(&seeded, &["12", "3.5"]).await;
    seeded
        .world
        .lock()
        .unwrap()
        .cells
        .get_mut(&seeded.row_id)
        .unwrap()
        .remove(&seeded.name_column.property_definition_id);
    let before = version(&seeded.world);

    let outcome = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            retype(&seeded, seeded.name_column.id, ColumnKind::Number),
        )
        .await
        .unwrap();

    assert_eq!(
        outcome,
        vec![OpResult::Column {
            table: seeded.table_id,
            column: seeded.name_column.id,
            table_version: TableVersion(before.0 + 1),
            change: ColumnResult::TypeChanged,
        }]
    );
    let w = seeded.world.lock().unwrap();
    let column = w
        .columns
        .iter()
        .find(|column| column.id == seeded.name_column.id)
        .unwrap();
    assert_eq!(
        w.cells[&rows[0]][&column.property_definition_id],
        PropertyValue::Num(12.0)
    );
    assert_eq!(
        w.cells[&rows[1]][&column.property_definition_id],
        PropertyValue::Num(3.5)
    );
}

#[tokio::test]
async fn a_number_cast_with_a_value_that_is_not_a_number_is_refused_and_keeps_the_cells() {
    let seeded = seeded().await;
    let rows = insert_names(&seeded, &["7", "soon"]).await;
    let (cells_before, columns_before, definitions_before) = {
        let w = seeded.world.lock().unwrap();
        (w.cells.clone(), w.columns.clone(), w.definitions.len())
    };
    let before = version(&seeded.world);

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            retype(&seeded, seeded.name_column.id, ColumnKind::Number),
        )
        .await
        .unwrap_err();

    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        "2 values in \"Name\" aren't numbers: 'Sam', 'soon'. \
         Fix them, or add a column of the new type for the values that convert."
    );
    let w = seeded.world.lock().unwrap();
    assert_eq!(
        w.cells[&rows[1]][&seeded.name_column.property_definition_id],
        PropertyValue::Str("soon".into())
    );
    assert_eq!(w.cells, cells_before);
    assert_eq!(w.columns, columns_before);
    assert_eq!(w.definitions.len(), definitions_before);
    assert_eq!(w.tables[0].version, before);
}

#[tokio::test]
async fn a_cell_with_two_options_refuses_a_single_select_and_keeps_both() {
    let seeded = seeded().await;
    let svc = &seeded.service;
    let tags = ColumnId::new();
    svc.apply_ops(
        edit(seeded.database_id),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Column {
            table: seeded.table_id,
            column: tags,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Diet".into(),
                    kind: ColumnKind::Select { multi: true },
                    options: vec![
                        NewOption {
                            id: OptionId::new(),
                            label: "Vegan".into(),
                        },
                        NewOption {
                            id: OptionId::new(),
                            label: "Nut-free".into(),
                        },
                    ],
                    infer_type: false,
                },
                after: None,
            },
        }]),
    )
    .await
    .unwrap();
    svc.apply_ops(
        receipt(seeded.database_id, OWNER, AccessLevel::Edit),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Rows {
            table: seeded.table_id,
            change: RowsChange::Update {
                changes: RowChanges::Uniform {
                    rows: vec![seeded.row_id],
                    cells: vec![CellWrite {
                        column: tags,
                        value: CellValue::Options(vec![
                            OptionRef::Label("Vegan".into()),
                            OptionRef::Label("Nut-free".into()),
                        ]),
                    }],
                },
            },
        }]),
    )
    .await
    .unwrap();
    let (cells_before, columns_before, definitions_before) = {
        let w = seeded.world.lock().unwrap();
        (w.cells.clone(), w.columns.clone(), w.definitions.len())
    };

    let error = svc
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            retype(&seeded, tags, ColumnKind::Select { multi: false }),
        )
        .await
        .unwrap_err();

    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        "1 cell in \"Diet\" has more than one value: 'Vegan, Nut-free'. \
         Fix it, or add a column of the new type for the values that convert."
    );
    let diet = seeded
        .world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|column| column.id == tags)
        .unwrap()
        .property_definition_id;
    let vegan = option_id(&seeded.world, diet, "Vegan");
    let nut_free = option_id(&seeded.world, diet, "Nut-free");
    assert_eq!(
        cell(&seeded.world, seeded.row_id, diet),
        Some(PropertyValue::SelectOption(vec![
            vegan.into_uuid(),
            nut_free.into_uuid()
        ]))
    );
    let w = seeded.world.lock().unwrap();
    assert!(w.definitions[&diet].definition.is_multi_select);
    assert_eq!(w.cells, cells_before);
    assert_eq!(w.columns, columns_before);
    assert_eq!(w.definitions.len(), definitions_before);
}

#[tokio::test]
async fn a_date_cast_with_a_value_that_is_not_a_date_is_refused_and_keeps_the_cells() {
    let seeded = seeded().await;
    let rows = insert_names(&seeded, &["2026-09-30", "next week"]).await;
    let (cells_before, columns_before, definitions_before) = {
        let w = seeded.world.lock().unwrap();
        (w.cells.clone(), w.columns.clone(), w.definitions.len())
    };
    let before = version(&seeded.world);

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            retype(&seeded, seeded.name_column.id, ColumnKind::Date),
        )
        .await
        .unwrap_err();

    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        "2 values in \"Name\" aren't dates: 'Sam', 'next week'. \
         Fix them, or add a column of the new type for the values that convert."
    );
    let w = seeded.world.lock().unwrap();
    assert_eq!(
        w.cells[&rows[0]][&seeded.name_column.property_definition_id],
        PropertyValue::Str("2026-09-30".into())
    );
    assert_eq!(w.cells, cells_before);
    assert_eq!(w.columns, columns_before);
    assert_eq!(w.definitions.len(), definitions_before);
    assert_eq!(w.tables[0].version, before);
}

#[tokio::test]
async fn a_link_cast_with_a_value_that_is_not_a_url_is_refused_and_keeps_the_cells() {
    let seeded = seeded().await;
    let rows = insert_names(&seeded, &["https://macro.com", "macro dot com"]).await;
    let (cells_before, columns_before, definitions_before) = {
        let w = seeded.world.lock().unwrap();
        (w.cells.clone(), w.columns.clone(), w.definitions.len())
    };
    let before = version(&seeded.world);

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            retype(&seeded, seeded.name_column.id, ColumnKind::Link),
        )
        .await
        .unwrap_err();

    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        "2 values in \"Name\" aren't complete URLs: 'Sam', 'macro dot com'. \
         Fix them, or add a column of the new type for the values that convert."
    );
    let w = seeded.world.lock().unwrap();
    assert_eq!(
        w.cells[&rows[0]][&seeded.name_column.property_definition_id],
        PropertyValue::Str("https://macro.com".into())
    );
    assert_eq!(w.cells, cells_before);
    assert_eq!(w.columns, columns_before);
    assert_eq!(w.definitions.len(), definitions_before);
    assert_eq!(w.tables[0].version, before);
}

#[tokio::test]
async fn a_cell_with_two_references_refuses_a_single_reference_and_keeps_both() {
    let seeded = seeded().await;
    let svc = &seeded.service;
    let hosts = ColumnId::new();
    svc.apply_ops(
        edit(seeded.database_id),
        viewer(OWNER),
        OpBatch::from(vec![
            DatabaseOp::Column {
                table: seeded.table_id,
                column: hosts,
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Hosts".into(),
                        kind: ColumnKind::Entity {
                            target: EntityKind::User,
                            multi: true,
                        },
                        options: vec![],
                        infer_type: false,
                    },
                    after: None,
                },
            },
            DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Update {
                    changes: RowChanges::Uniform {
                        rows: vec![seeded.row_id],
                        cells: vec![CellWrite {
                            column: hosts,
                            value: CellValue::Entities(vec![
                                EntityRef {
                                    entity_type: EntityKind::User,
                                    entity_id: "macro|ana@macro.com".into(),
                                },
                                EntityRef {
                                    entity_type: EntityKind::User,
                                    entity_id: "macro|ben@macro.com".into(),
                                },
                            ]),
                        }],
                    },
                },
            },
        ]),
    )
    .await
    .unwrap();
    let (cells_before, columns_before, definitions_before) = {
        let w = seeded.world.lock().unwrap();
        (w.cells.clone(), w.columns.clone(), w.definitions.len())
    };
    let before = version(&seeded.world);

    let error = svc
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            retype(
                &seeded,
                hosts,
                ColumnKind::Entity {
                    target: EntityKind::User,
                    multi: false,
                },
            ),
        )
        .await
        .unwrap_err();

    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        "1 cell in \"Hosts\" has more than one value: \
         'macro|ana@macro.com, macro|ben@macro.com'. \
         Fix it, or add a column of the new type for the values that convert."
    );
    let w = seeded.world.lock().unwrap();
    let definition = w
        .columns
        .iter()
        .find(|column| column.id == hosts)
        .unwrap()
        .property_definition_id;
    assert_eq!(
        w.cells[&seeded.row_id][&definition],
        PropertyValue::EntityRef(vec![
            EntityReference {
                entity_id: "macro|ana@macro.com".into(),
                entity_type: PropertyEntityType::User,
                specific_message_id: None,
            },
            EntityReference {
                entity_id: "macro|ben@macro.com".into(),
                entity_type: PropertyEntityType::User,
                specific_message_id: None,
            },
        ])
    );
    assert_eq!(w.cells, cells_before);
    assert_eq!(w.columns, columns_before);
    assert_eq!(w.definitions.len(), definitions_before);
    assert_eq!(w.tables[0].version, before);
}

#[tokio::test]
async fn a_date_becomes_its_calendar_day_as_text_unless_it_has_a_time() {
    let seeded = seeded().await;
    let svc = &seeded.service;
    let arrives = ColumnId::new();
    svc.apply_ops(
        edit(seeded.database_id),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Column {
            table: seeded.table_id,
            column: arrives,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Arrives".into(),
                    kind: ColumnKind::Date,
                    options: vec![],
                    infer_type: false,
                },
                after: None,
            },
        }]),
    )
    .await
    .unwrap();
    let midnight = "2026-09-30T00:00:00Z".parse().unwrap();
    let afternoon = "2026-09-30T14:05:00Z".parse().unwrap();
    let inserted = svc
        .apply_ops(
            receipt(seeded.database_id, OWNER, AccessLevel::Edit),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Insert {
                    rows: vec![
                        vec![CellWrite {
                            column: arrives,
                            value: CellValue::Date(midnight),
                        }],
                        vec![CellWrite {
                            column: arrives,
                            value: CellValue::Date(afternoon),
                        }],
                    ],
                },
            }]),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows: inserted },
            ..
        },
    ] = inserted.as_slice()
    else {
        panic!("expected one insert, got {inserted:?}");
    };

    svc.apply_ops(
        edit(seeded.database_id),
        viewer(OWNER),
        retype(&seeded, arrives, ColumnKind::Text),
    )
    .await
    .unwrap();

    let w = seeded.world.lock().unwrap();
    let column = w
        .columns
        .iter()
        .find(|column| column.id == arrives)
        .unwrap();
    assert_eq!(
        w.cells[&inserted[0]][&column.property_definition_id],
        PropertyValue::Str("2026-09-30".into())
    );
    assert_eq!(
        w.cells[&inserted[1]][&column.property_definition_id],
        PropertyValue::Str("2026-09-30T14:05:00+00:00".into())
    );
}

#[tokio::test]
async fn changing_a_column_to_its_own_type_changes_nothing() {
    let seeded = seeded().await;
    let before = version(&seeded.world);
    let outcome = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            retype(&seeded, seeded.plus_ones_column.id, ColumnKind::Number),
        )
        .await
        .unwrap();

    assert_eq!(
        outcome,
        vec![OpResult::Column {
            table: seeded.table_id,
            column: seeded.plus_ones_column.id,
            table_version: before,
            change: ColumnResult::TypeChanged,
        }]
    );
    let w = seeded.world.lock().unwrap();
    assert_eq!(w.definitions.len(), 3);
    assert_eq!(
        w.columns
            .iter()
            .find(|column| column.id == seeded.plus_ones_column.id)
            .unwrap()
            .property_definition_id,
        seeded.plus_ones_column.property_definition_id
    );
}

#[tokio::test]
async fn the_dry_run_answers_every_menu_target_for_a_viewer() {
    let seeded = seeded().await;
    insert_names(&seeded, &["12", "https://macro.com"]).await;
    let target = |data_type: DataType, is_multi_select: bool| ColumnCast {
        data_type,
        is_multi_select,
        specific_entity_type: None,
        relation: false,
        cast: CastVerdict::Safe,
        reason: None,
        failures: 0,
        summary: None,
        examples: vec![],
    };
    let never = |specific_entity_type: Option<PropertyEntityType>, relation: bool, reason: &str| {
        ColumnCast {
            specific_entity_type,
            relation,
            is_multi_select: relation,
            cast: CastVerdict::Never,
            reason: Some(reason.into()),
            ..target(DataType::Entity, false)
        }
    };
    let checked = |data_type: DataType,
                   is_multi_select: bool,
                   failures: usize,
                   summary: Option<&str>,
                   examples: &[&str]| ColumnCast {
        cast: CastVerdict::Checked,
        failures,
        summary: summary.map(Into::into),
        examples: examples.iter().map(|example| example.to_string()).collect(),
        ..target(data_type, is_multi_select)
    };

    let casts = seeded
        .service
        .column_casts(
            receipt(seeded.database_id, VIEWER, AccessLevel::View),
            seeded.table_id,
            seeded.name_column.id,
        )
        .await
        .unwrap();

    assert_eq!(
        casts,
        vec![
            target(DataType::String, false),
            checked(
                DataType::Number,
                false,
                2,
                Some("2 values aren't numbers"),
                &["Sam", "https://macro.com"]
            ),
            checked(DataType::SelectString, false, 0, None, &[]),
            checked(DataType::SelectString, true, 0, None, &[]),
            checked(
                DataType::Date,
                false,
                3,
                Some("3 values aren't dates"),
                &["Sam", "12", "https://macro.com"]
            ),
            checked(
                DataType::Boolean,
                false,
                3,
                Some("3 values aren't true or false"),
                &["Sam", "12", "https://macro.com"]
            ),
            checked(
                DataType::Link,
                false,
                2,
                Some("2 values aren't complete URLs"),
                &["Sam", "12"]
            ),
            never(
                Some(PropertyEntityType::User),
                false,
                "Only an empty column can become a reference column."
            ),
            never(
                Some(PropertyEntityType::Document),
                false,
                "Only an empty column can become a reference column."
            ),
            never(
                Some(PropertyEntityType::Task),
                false,
                "Only an empty column can become a reference column."
            ),
            never(
                None,
                true,
                "Only an empty column can become a relation: existing values aren't rows."
            ),
        ]
    );
}

#[tokio::test]
async fn a_text_column_converts_into_a_new_number_column_beside_it() {
    let seeded = seeded().await;
    let svc = &seeded.service;
    let size = ColumnId::new();
    svc.apply_ops(
        edit(seeded.database_id),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Column {
            table: seeded.table_id,
            column: size,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Party size".into(),
                    kind: ColumnKind::Text,
                    options: vec![],
                    infer_type: false,
                },
                after: None,
            },
        }]),
    )
    .await
    .unwrap();
    let inserted = svc
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Insert {
                    rows: vec![
                        vec![CellWrite {
                            column: size,
                            value: CellValue::Text("1".into()),
                        }],
                        vec![CellWrite {
                            column: size,
                            value: CellValue::Text("2".into()),
                        }],
                        vec![CellWrite {
                            column: size,
                            value: CellValue::Text("soon".into()),
                        }],
                    ],
                },
            }]),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows },
            ..
        },
    ] = inserted.as_slice()
    else {
        panic!("expected one insert, got {inserted:?}");
    };
    let size_definition = seeded
        .world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|column| column.id == size)
        .unwrap()
        .property_definition_id;
    let original_cells = |world: &Shared| -> HashMap<RowId, PropertyValue> {
        world
            .lock()
            .unwrap()
            .cells
            .iter()
            .filter_map(|(row, cells)| Some((*row, cells.get(&size_definition)?.clone())))
            .collect()
    };
    let before = original_cells(&seeded.world);

    let conversion = svc
        .column_conversion(
            receipt(seeded.database_id, VIEWER, AccessLevel::View),
            seeded.table_id,
            size,
            ColumnKind::Number,
        )
        .await
        .unwrap();

    assert_eq!(
        conversion,
        ColumnConversion {
            table_version: version(&seeded.world),
            options: vec![],
            cells: vec![
                ConvertedCell {
                    row: rows[0],
                    value: CellValue::Number(1.0),
                },
                ConvertedCell {
                    row: rows[1],
                    value: CellValue::Number(2.0),
                },
            ],
            misfits: 1,
        }
    );

    let as_number = ColumnId::new();
    svc.apply_ops(
        edit(seeded.database_id),
        viewer(OWNER),
        OpBatch {
            ops: vec![
                DatabaseOp::Column {
                    table: seeded.table_id,
                    column: as_number,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Party size (number)".into(),
                            kind: ColumnKind::Number,
                            options: vec![],
                            infer_type: false,
                        },
                        after: Some(size),
                    },
                },
                DatabaseOp::Rows {
                    table: seeded.table_id,
                    change: RowsChange::Update {
                        changes: RowChanges::PerRow {
                            rows: conversion
                                .cells
                                .into_iter()
                                .map(|cell| RowChange {
                                    row: cell.row,
                                    cells: vec![CellWrite {
                                        column: as_number,
                                        value: cell.value,
                                    }],
                                })
                                .collect(),
                        },
                    },
                },
            ],
            base_versions: HashMap::from([(seeded.table_id, conversion.table_version)]),
        },
    )
    .await
    .unwrap();

    assert_eq!(original_cells(&seeded.world), before);
    assert_eq!(
        before,
        HashMap::from([
            (rows[0], PropertyValue::Str("1".into())),
            (rows[1], PropertyValue::Str("2".into())),
            (rows[2], PropertyValue::Str("soon".into())),
        ])
    );
    let number_definition = seeded
        .world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|column| column.id == as_number)
        .unwrap()
        .property_definition_id;
    assert_eq!(
        cell(&seeded.world, rows[0], number_definition),
        Some(PropertyValue::Num(1.0))
    );
    assert_eq!(
        cell(&seeded.world, rows[1], number_definition),
        Some(PropertyValue::Num(2.0))
    );
    assert_eq!(cell(&seeded.world, rows[2], number_definition), None);
    assert_eq!(cell(&seeded.world, seeded.row_id, number_definition), None);
}

#[tokio::test]
async fn a_text_column_converts_into_a_new_select_column_with_its_labels_as_options() {
    let seeded = seeded().await;
    let svc = &seeded.service;
    let diet = ColumnId::new();
    svc.apply_ops(
        edit(seeded.database_id),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Column {
            table: seeded.table_id,
            column: diet,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Diet".into(),
                    kind: ColumnKind::Text,
                    options: vec![],
                    infer_type: false,
                },
                after: None,
            },
        }]),
    )
    .await
    .unwrap();
    let inserted = svc
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Insert {
                    rows: vec![
                        vec![CellWrite {
                            column: diet,
                            value: CellValue::Text("Vegan".into()),
                        }],
                        vec![CellWrite {
                            column: diet,
                            value: CellValue::Text("Nut-free".into()),
                        }],
                        vec![CellWrite {
                            column: diet,
                            value: CellValue::Text("Vegan".into()),
                        }],
                    ],
                },
            }]),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows },
            ..
        },
    ] = inserted.as_slice()
    else {
        panic!("expected one insert, got {inserted:?}");
    };
    let diet_definition = seeded
        .world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|column| column.id == diet)
        .unwrap()
        .property_definition_id;

    let conversion = svc
        .column_conversion(
            receipt(seeded.database_id, VIEWER, AccessLevel::View),
            seeded.table_id,
            diet,
            ColumnKind::Select { multi: false },
        )
        .await
        .unwrap();

    assert_eq!(
        conversion,
        ColumnConversion {
            table_version: version(&seeded.world),
            options: vec!["Vegan".into(), "Nut-free".into()],
            cells: vec![
                ConvertedCell {
                    row: rows[0],
                    value: CellValue::Options(vec![OptionRef::Label("Vegan".into())]),
                },
                ConvertedCell {
                    row: rows[1],
                    value: CellValue::Options(vec![OptionRef::Label("Nut-free".into())]),
                },
                ConvertedCell {
                    row: rows[2],
                    value: CellValue::Options(vec![OptionRef::Label("Vegan".into())]),
                },
            ],
            misfits: 0,
        }
    );

    let (as_select, vegan, nut_free) = (ColumnId::new(), OptionId::new(), OptionId::new());
    svc.apply_ops(
        edit(seeded.database_id),
        viewer(OWNER),
        OpBatch {
            ops: vec![
                DatabaseOp::Column {
                    table: seeded.table_id,
                    column: as_select,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Diet (select)".into(),
                            kind: ColumnKind::Select { multi: false },
                            options: vec![
                                NewOption {
                                    id: vegan,
                                    label: conversion.options[0].clone(),
                                },
                                NewOption {
                                    id: nut_free,
                                    label: conversion.options[1].clone(),
                                },
                            ],
                            infer_type: false,
                        },
                        after: Some(diet),
                    },
                },
                DatabaseOp::Rows {
                    table: seeded.table_id,
                    change: RowsChange::Update {
                        changes: RowChanges::PerRow {
                            rows: conversion
                                .cells
                                .into_iter()
                                .map(|cell| RowChange {
                                    row: cell.row,
                                    cells: vec![CellWrite {
                                        column: as_select,
                                        value: cell.value,
                                    }],
                                })
                                .collect(),
                        },
                    },
                },
            ],
            base_versions: HashMap::from([(seeded.table_id, conversion.table_version)]),
        },
    )
    .await
    .unwrap();

    let select_definition = seeded
        .world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|column| column.id == as_select)
        .unwrap()
        .property_definition_id;
    assert_eq!(
        cell(&seeded.world, rows[0], select_definition),
        Some(PropertyValue::SelectOption(vec![vegan.into_uuid()]))
    );
    assert_eq!(
        cell(&seeded.world, rows[1], select_definition),
        Some(PropertyValue::SelectOption(vec![nut_free.into_uuid()]))
    );
    assert_eq!(
        cell(&seeded.world, rows[2], select_definition),
        Some(PropertyValue::SelectOption(vec![vegan.into_uuid()]))
    );
    assert_eq!(
        cell(&seeded.world, rows[1], diet_definition),
        Some(PropertyValue::Str("Nut-free".into()))
    );
}
