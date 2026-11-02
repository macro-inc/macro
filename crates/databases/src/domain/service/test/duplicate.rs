//! Duplicating a database: a new one, owned by whoever duplicates it, with
//! everything the source holds under new ids.

use models_databases::views::{
    Conjunction, FilterCondition, FilterGroup, FilterNode, FilterTest, Lane, LaneKey, NewView,
    SetOperator, ViewLayout, ViewQuery,
};

use super::*;
use crate::domain::duplicate::DatabaseDuplicateService;
use crate::domain::models::ColumnConfig;

/// The seeded `Offsite` database with a `Sessions(Title)` table holding
/// `Keynote`, a `Sessions` relation on `Guests` whose Sam cell names it, a
/// red `Going` option, and a `Stages` board of `Guests` by `Status`,
/// filtered to `Going`, where Sam's card was placed by hand.
struct Source {
    seeded: Seeded,
    sessions_table: TableId,
    title_column: ColumnId,
    keynote_row: RowId,
    relation_column: ColumnId,
    board: ViewId,
}

async fn source() -> Source {
    let seeded = seeded().await;
    let (sessions_table, title_column, relation_column, board) = (
        TableId::new(),
        ColumnId::new(),
        ColumnId::new(),
        ViewId::new(),
    );
    let status = seeded.status_column.property_definition_id;
    let going = option_id(&seeded.world, status, "Going");
    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![
                DatabaseOp::Table {
                    table: sessions_table,
                    change: TableChange::Create {
                        name: "Sessions".into(),
                    },
                },
                DatabaseOp::Column {
                    table: sessions_table,
                    column: title_column,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Title".into(),
                            kind: ColumnKind::Text,
                            options: vec![],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Column {
                    table: seeded.table_id,
                    column: relation_column,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Sessions".into(),
                            kind: ColumnKind::Relation {
                                database: seeded.database_id,
                                table: sessions_table,
                            },
                            options: vec![],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Column {
                    table: seeded.table_id,
                    column: seeded.status_column.id,
                    change: ColumnChange::UpdateOption {
                        option: going,
                        label: None,
                        color: Some(Some("#FF0000".into())),
                    },
                },
                DatabaseOp::View {
                    table: seeded.table_id,
                    view: board,
                    change: ViewChange::Create {
                        view: NewView {
                            name: "Stages".into(),
                            query: ViewQuery {
                                filter: Some(FilterGroup {
                                    conjunction: Conjunction::And,
                                    conditions: vec![FilterNode::Condition(FilterCondition {
                                        column: seeded.status_column.id,
                                        test: FilterTest::Options {
                                            operator: SetOperator::IsAnyOf,
                                            options: vec![going],
                                        },
                                    })],
                                }),
                                sort: vec![],
                            },
                            layout: ViewLayout::Board {
                                group_by: seeded.status_column.id,
                                title: seeded.name_column.id,
                                lanes: vec![Lane {
                                    key: LaneKey::Option(going),
                                    hidden: false,
                                }],
                                card_fields: vec![relation_column],
                                hide_empty_lanes: false,
                            }
                            .into(),
                        },
                    },
                },
            ]),
        )
        .await
        .unwrap();
    let keynote = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: sessions_table,
                change: RowsChange::Insert {
                    rows: vec![vec![CellWrite {
                        column: title_column,
                        value: CellValue::Text("Keynote".into()),
                    }]],
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
    ] = keynote.as_slice()
    else {
        panic!("expected one insert, got {keynote:?}");
    };
    let keynote_row = inserted[0];
    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![
                DatabaseOp::Rows {
                    table: seeded.table_id,
                    change: RowsChange::Update {
                        changes: RowChanges::Uniform {
                            rows: vec![seeded.row_id],
                            cells: vec![CellWrite {
                                column: relation_column,
                                value: CellValue::Rows(vec![keynote_row]),
                            }],
                        },
                    },
                },
                DatabaseOp::View {
                    table: seeded.table_id,
                    view: board,
                    change: ViewChange::MoveCard {
                        row: seeded.row_id,
                        lane: LaneKey::Option(going),
                        before: None,
                        after: None,
                    },
                },
            ]),
        )
        .await
        .unwrap();
    seeded.world.lock().unwrap().write_batches = 0;
    Source {
        seeded,
        sessions_table,
        title_column,
        keynote_row,
        relation_column,
        board,
    }
}

fn view_receipt(
    database_id: DatabaseId,
    user: &'static str,
) -> EntityAccessReceipt<ViewAccessLevel> {
    receipt::<ViewAccessLevel>(database_id, user, AccessLevel::View)
}

#[tokio::test]
async fn a_viewer_duplicates_every_table_column_view_and_row_into_a_database_they_own() {
    let Source {
        seeded,
        sessions_table,
        title_column,
        keynote_row,
        relation_column,
        board,
    } = source().await;
    let source_status = seeded.status_column.property_definition_id;
    let source_going = option_id(&seeded.world, source_status, "Going");

    let copy = seeded
        .service
        .duplicate_database(view_receipt(seeded.database_id, VIEWER), user(VIEWER), None)
        .await
        .unwrap();

    assert_eq!(copy.name, "Offsite copy");
    assert_eq!(copy.owner_id, VIEWER);
    assert_ne!(copy.id, seeded.database_id);
    let w = seeded.world.lock().unwrap();
    // One write batch: the copy commits whole or not at all.
    assert_eq!(w.write_batches, 1);
    assert!(
        w.grants[VIEWER].contains(&(copy.id, AccessLevel::Owner)),
        "the duplicator owns the copy"
    );
    assert!(
        !w.grants[OWNER].iter().any(|(id, _)| *id == copy.id),
        "the source's grants stay with the source"
    );

    // Tables, in the source's order, under new ids.
    let tables: Vec<&Table> = w
        .tables
        .iter()
        .filter(|t| t.database_id == copy.id)
        .collect();
    assert_eq!(
        tables.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        vec!["Guests", "Sessions"]
    );
    let (guests, sessions) = (tables[0].id, tables[1].id);
    assert_ne!(guests, seeded.table_id);
    assert_ne!(sessions, sessions_table);

    // Columns, in the source's order, on new definitions the copy owns.
    let columns = |table: TableId| -> Vec<Column> {
        let mut columns: Vec<Column> = w
            .columns
            .iter()
            .filter(|c| c.table_id == table)
            .cloned()
            .collect();
        columns.sort_by(|a, b| a.position.cmp(&b.position));
        columns
    };
    let name_of = |column: &Column| {
        column.display_name.clone().unwrap_or_else(|| {
            w.definitions[&column.property_definition_id]
                .definition
                .display_name
                .clone()
        })
    };
    let guest_columns = columns(guests);
    assert_eq!(
        guest_columns.iter().map(name_of).collect::<Vec<_>>(),
        columns(seeded.table_id)
            .iter()
            .map(name_of)
            .collect::<Vec<_>>()
    );
    for column in guest_columns.iter().chain(&columns(sessions)) {
        assert_eq!(
            w.definitions[&column.property_definition_id]
                .definition
                .owner,
            PropertyOwner::Database {
                database_id: copy.id.into_uuid()
            }
        );
    }
    let find = |columns: &[Column], name: &str| {
        columns.iter().find(|c| name_of(c) == name).unwrap().clone()
    };
    let (name, status, plus_ones, relation) = (
        find(&guest_columns, "Name"),
        find(&guest_columns, "Status"),
        find(&guest_columns, "Plus ones"),
        find(&guest_columns, "Sessions"),
    );
    let title = find(&columns(sessions), "Title");
    assert_ne!(relation.id, relation_column);
    assert_ne!(title.id, title_column);
    assert_eq!(
        relation.config,
        Some(ColumnConfig::Link {
            database_id: copy.id,
            table_id: sessions,
        }),
        "a relation inside the database points into the copy"
    );

    // Options: same labels, order and colours, new ids.
    let options = &w.definitions[&status.property_definition_id].property_options;
    assert_eq!(
        options
            .iter()
            .map(|o| (o.value.clone(), o.color.clone()))
            .collect::<Vec<_>>(),
        w.definitions[&source_status]
            .property_options
            .iter()
            .map(|o| (o.value.clone(), o.color.clone()))
            .collect::<Vec<_>>()
    );
    let going = options
        .iter()
        .find(|o| o.value == PropertyOptionValue::String("Going".into()))
        .unwrap();
    assert_eq!(going.color.as_deref(), Some("#FF0000"));
    assert_ne!(going.id, source_going.into_uuid());

    // Rows, in place, under new ids, with cells naming the copy's options
    // and rows.
    let sam = w.rows[&guests][0].clone();
    let keynote = w.rows[&sessions][0].clone();
    assert_eq!(w.rows[&guests].len(), 1);
    assert_ne!(sam.id, seeded.row_id);
    assert_ne!(keynote.id, keynote_row);
    assert_eq!(sam.position, w.rows[&seeded.table_id][0].position);
    let sam_cells = &w.cells[&sam.id];
    assert_eq!(
        sam_cells[&name.property_definition_id],
        PropertyValue::Str("Sam".into())
    );
    assert_eq!(
        sam_cells[&status.property_definition_id],
        PropertyValue::SelectOption(vec![going.id])
    );
    assert_eq!(
        sam_cells[&plus_ones.property_definition_id],
        PropertyValue::Num(2.0)
    );
    assert_eq!(
        sam_cells[&relation.property_definition_id],
        PropertyValue::EntityRef(vec![models_properties::EntityReference {
            entity_id: keynote.id.to_string(),
            entity_type: PropertyEntityType::DatabaseRow,
            specific_message_id: None,
        }])
    );
    assert_eq!(
        w.cells[&keynote.id][&title.property_definition_id],
        PropertyValue::Str("Keynote".into())
    );

    // The board: grouped, filtered and laned on the copy's column and
    // option, with Sam's card where it was placed.
    let views: Vec<&DatabaseView> = w
        .views
        .iter()
        .filter(|v| v.database_id == copy.id)
        .collect();
    assert_eq!(views.len(), 1);
    let stages = views[0];
    assert_ne!(stages.id, board);
    assert_eq!(stages.table_id, guests);
    assert_eq!(stages.name, "Stages");
    let going_id = OptionId::from_uuid(going.id);
    assert_eq!(
        stages.query.filter,
        Some(FilterGroup {
            conjunction: Conjunction::And,
            conditions: vec![FilterNode::Condition(FilterCondition {
                column: status.id,
                test: FilterTest::Options {
                    operator: SetOperator::IsAnyOf,
                    options: vec![going_id],
                },
            })],
        })
    );
    assert_eq!(
        stages.layout,
        ViewLayout::Board {
            group_by: status.id,
            title: name.id,
            lanes: vec![Lane {
                key: LaneKey::Option(going_id),
                hidden: false,
            }],
            card_fields: vec![relation.id],
            hide_empty_lanes: false,
        }
    );
    let source_place = w.positions[&board][0].clone();
    assert_eq!(
        w.positions[&stages.id],
        vec![CardPosition {
            row: sam.id,
            lane: LaneKey::Option(going_id),
            position: source_place.position,
        }]
    );
}

#[tokio::test]
async fn a_named_duplicate_takes_the_name_given() {
    let seeded = seeded().await;

    let copy = seeded
        .service
        .duplicate_database(
            view_receipt(seeded.database_id, VIEWER),
            user(VIEWER),
            Some("  Offsite 2027 ".into()),
        )
        .await
        .unwrap();

    assert_eq!(copy.name, "Offsite 2027");
}

#[tokio::test]
async fn the_source_is_left_as_it_was() {
    let Source { seeded, .. } = source().await;
    let before = {
        let w = seeded.world.lock().unwrap();
        (
            w.tables.clone(),
            w.columns.clone(),
            w.views.clone(),
            w.rows.clone(),
            w.cells.clone(),
        )
    };

    seeded
        .service
        .duplicate_database(view_receipt(seeded.database_id, VIEWER), user(VIEWER), None)
        .await
        .unwrap();

    let w = seeded.world.lock().unwrap();
    let source_tables: Vec<TableId> = before.0.iter().map(|t| t.id).collect();
    assert_eq!(
        w.tables
            .iter()
            .filter(|t| t.database_id == seeded.database_id)
            .cloned()
            .collect::<Vec<_>>()
            .len(),
        before.0.len()
    );
    assert_eq!(
        w.columns
            .iter()
            .filter(|c| source_tables.contains(&c.table_id))
            .cloned()
            .collect::<Vec<_>>(),
        before.1
    );
    assert_eq!(
        w.views
            .iter()
            .filter(|v| v.database_id == seeded.database_id)
            .cloned()
            .collect::<Vec<_>>(),
        before.2
    );
    for table in &source_tables {
        assert_eq!(w.rows[table], before.3[table]);
    }
    for (row, cells) in &before.4 {
        assert_eq!(&w.cells[row], cells);
    }
}

#[tokio::test]
async fn a_trashed_database_is_not_duplicated() {
    let seeded = seeded().await;
    seeded
        .service
        .trash_database(receipt::<OwnerAccessLevel>(
            seeded.database_id,
            OWNER,
            AccessLevel::Owner,
        ))
        .await
        .unwrap();

    let error = seeded
        .service
        .duplicate_database(view_receipt(seeded.database_id, VIEWER), user(VIEWER), None)
        .await
        .unwrap_err();

    assert!(matches!(error, DatabaseError::NotFound), "{error:?}");
    assert_eq!(seeded.world.lock().unwrap().databases.len(), 1);
}

#[tokio::test]
async fn a_refused_write_leaves_no_copy_behind() {
    let seeded = seeded().await;
    seeded.world.lock().unwrap().table_write_not_found = true;

    let error = seeded
        .service
        .duplicate_database(view_receipt(seeded.database_id, VIEWER), user(VIEWER), None)
        .await
        .unwrap_err();

    assert!(matches!(error, DatabaseError::NotFound), "{error:?}");
    let w = seeded.world.lock().unwrap();
    assert_eq!(w.databases.len(), 1);
    assert!(
        !w.grants[VIEWER]
            .iter()
            .any(|(id, level)| *id != seeded.database_id && *level == AccessLevel::Owner)
    );
}

/// A relation into another database the duplicator can see keeps its
/// target and cells; one into a database they cannot see is left out of
/// the copy, with the views naming it.
#[tokio::test]
async fn relations_into_other_databases_follow_what_the_duplicator_can_see() {
    let seeded = seeded().await;
    let other = seeded
        .service
        .create_database(CreateDatabase {
            name: "Venues".into(),
            owner_id: user(OWNER),
            acting_bot: None,
        })
        .await
        .unwrap();
    let venues_table = seeded
        .world
        .lock()
        .unwrap()
        .tables
        .iter()
        .find(|t| t.database_id == other.id)
        .unwrap()
        .id;
    let venue = ColumnId::new();
    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: seeded.table_id,
                column: venue,
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Venue".into(),
                        kind: ColumnKind::Relation {
                            database: other.id,
                            table: venues_table,
                        },
                        options: vec![],
                        infer_type: false,
                    },
                    after: None,
                },
            }]),
        )
        .await
        .unwrap();
    let copied_names = |copy: &Database| -> Vec<Option<ColumnConfig>> {
        let w = seeded.world.lock().unwrap();
        let guests = w
            .tables
            .iter()
            .find(|t| t.database_id == copy.id)
            .unwrap()
            .id;
        w.columns
            .iter()
            .filter(|c| c.table_id == guests)
            .map(|c| c.config.clone())
            .filter(Option::is_some)
            .collect()
    };

    // VIEWER cannot see Venues.
    let hidden = seeded
        .service
        .duplicate_database(view_receipt(seeded.database_id, VIEWER), user(VIEWER), None)
        .await
        .unwrap();
    assert_eq!(copied_names(&hidden), vec![]);

    seeded
        .world
        .lock()
        .unwrap()
        .grants
        .entry(VIEWER.into())
        .or_default()
        .push((other.id, AccessLevel::View));
    let seen = seeded
        .service
        .duplicate_database(view_receipt(seeded.database_id, VIEWER), user(VIEWER), None)
        .await
        .unwrap();
    assert_eq!(
        copied_names(&seen),
        vec![Some(ColumnConfig::Link {
            database_id: other.id,
            table_id: venues_table,
        })]
    );
}

#[tokio::test]
async fn a_name_at_the_limit_is_cut_short_to_fit_its_copy_suffix() {
    let seeded = seeded().await;
    let long = "a".repeat(200);
    seeded.world.lock().unwrap().databases[0].name = long.clone();

    let copy = seeded
        .service
        .duplicate_database(view_receipt(seeded.database_id, VIEWER), user(VIEWER), None)
        .await
        .unwrap();

    assert_eq!(copy.name, format!("{} copy", "a".repeat(195)));
}

/// A relation cell can still name a row that was removed; the copy keeps
/// only the rows that are there instead of refusing the whole duplicate.
#[tokio::test]
async fn a_relation_naming_a_removed_row_is_copied_without_it() {
    let Source {
        seeded,
        sessions_table,
        keynote_row,
        relation_column,
        ..
    } = source().await;
    seeded
        .world
        .lock()
        .unwrap()
        .rows
        .get_mut(&sessions_table)
        .unwrap()
        .retain(|row| row.id != keynote_row);

    let copy = seeded
        .service
        .duplicate_database(view_receipt(seeded.database_id, VIEWER), user(VIEWER), None)
        .await
        .unwrap();

    let w = seeded.world.lock().unwrap();
    let guests = w
        .tables
        .iter()
        .find(|t| t.database_id == copy.id)
        .unwrap()
        .id;
    let source_relation = w.columns.iter().find(|c| c.id == relation_column).unwrap();
    let relation = w
        .columns
        .iter()
        .find(|c| {
            c.table_id == guests
                && w.definitions[&c.property_definition_id]
                    .definition
                    .display_name
                    == w.definitions[&source_relation.property_definition_id]
                        .definition
                        .display_name
        })
        .unwrap();
    let sam = w.rows[&guests][0].id;
    assert_eq!(
        w.cells
            .get(&sam)
            .and_then(|cells| cells.get(&relation.property_definition_id)),
        None
    );
}

/// A column bound to a property shared beyond the database (a person's or
/// a team's) stays bound to it when the duplicator may bind it; otherwise
/// the copy gets a property of its own with the same options and values.
#[tokio::test]
async fn a_shared_property_the_duplicator_cannot_bind_is_copied_into_one_the_copy_owns() {
    let seeded = seeded().await;
    let mut shared = definition(
        "Priority",
        DataType::SelectString,
        false,
        PropertyOwner::User {
            user_id: OWNER.into(),
        },
    );
    let high = Uuid::now_v7();
    shared.property_options = vec![PropertyOption {
        id: high,
        property_definition_id: shared.definition.id,
        display_order: 0,
        value: PropertyOptionValue::String("High".into()),
        color: Some("#FF0000".into()),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }];
    let shared_id = shared.definition.id;
    {
        let mut w = seeded.world.lock().unwrap();
        let last = w
            .columns
            .iter()
            .filter(|c| c.table_id == seeded.table_id)
            .map(|c| c.position.clone())
            .max()
            .unwrap();
        w.definitions.insert(shared_id, shared);
        w.columns.push(Column {
            protections: vec![],
            nullable: true,
            id: ColumnId::new(),
            table_id: seeded.table_id,
            property_definition_id: shared_id,
            display_name: None,
            position: models_databases::position::key_between(Some(&last), None).unwrap(),
            infer_type: false,
            config: None,
        });
        w.cells
            .entry(seeded.row_id)
            .or_default()
            .insert(shared_id, PropertyValue::SelectOption(vec![high]));
    }
    let priority = |copy: &Database| {
        let w = seeded.world.lock().unwrap();
        let guests = w
            .tables
            .iter()
            .find(|t| t.database_id == copy.id)
            .unwrap()
            .id;
        let column = w
            .columns
            .iter()
            .find(|c| {
                c.table_id == guests
                    && w.definitions[&c.property_definition_id]
                        .definition
                        .display_name
                        == "Priority"
            })
            .unwrap()
            .clone();
        let definition = w.definitions[&column.property_definition_id].clone();
        let sam = w.rows[&guests][0].id;
        (
            definition,
            w.cells[&sam].get(&column.property_definition_id).cloned(),
        )
    };

    let bound = seeded
        .service
        .duplicate_database(view_receipt(seeded.database_id, VIEWER), user(VIEWER), None)
        .await
        .unwrap();
    let (definition, value) = priority(&bound);
    assert_eq!(definition.definition.id, shared_id);
    assert_eq!(value, Some(PropertyValue::SelectOption(vec![high])));

    seeded.world.lock().unwrap().unbindable.push(shared_id);
    let owned = seeded
        .service
        .duplicate_database(view_receipt(seeded.database_id, VIEWER), user(VIEWER), None)
        .await
        .unwrap();
    let (definition, value) = priority(&owned);
    assert_ne!(definition.definition.id, shared_id);
    assert_eq!(
        definition.definition.owner,
        PropertyOwner::Database {
            database_id: owned.id.into_uuid()
        }
    );
    let option = &definition.property_options[0];
    assert_eq!(option.value, PropertyOptionValue::String("High".into()));
    assert_eq!(option.color.as_deref(), Some("#FF0000"));
    assert_eq!(value, Some(PropertyValue::SelectOption(vec![option.id])));
}

/// A formula column's values are stored like other cells; the copy's are
/// computed from its own columns.
#[tokio::test]
async fn a_formula_column_is_copied_with_its_values_computed_in_the_copy() {
    let seeded = seeded().await;
    let seats = ColumnId::new();
    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: seeded.table_id,
                column: seats,
                change: ColumnChange::Create {
                    definition: NewColumn::Derived {
                        name: "Seats".into(),
                        formula: models_databases::Formula::Binary {
                            operator: models_databases::Operator::Multiply,
                            left: Box::new(models_databases::Formula::Column {
                                column: seeded.plus_ones_column.id,
                            }),
                            right: Box::new(models_databases::Formula::Number { value: 2.0 }),
                        },
                    },
                    after: None,
                },
            }]),
        )
        .await
        .unwrap();

    let copy = seeded
        .service
        .duplicate_database(view_receipt(seeded.database_id, VIEWER), user(VIEWER), None)
        .await
        .unwrap();

    let w = seeded.world.lock().unwrap();
    let guests = w
        .tables
        .iter()
        .find(|t| t.database_id == copy.id)
        .unwrap()
        .id;
    let source_seats = w.columns.iter().find(|c| c.id == seats).unwrap();
    let copied = w
        .columns
        .iter()
        .find(|c| c.table_id == guests && matches!(c.config, Some(ColumnConfig::Derived { .. })))
        .unwrap();
    assert_ne!(
        copied.property_definition_id,
        source_seats.property_definition_id
    );
    let sam = w.rows[&guests][0].id;
    assert_eq!(
        w.cells[&sam].get(&copied.property_definition_id),
        Some(&PropertyValue::Num(4.0))
    );
}
