//! View ops over the fakes: typed views of a table, a board's hand-arranged
//! cards, and what removing or retyping a column or an option does to the
//! views that refer to it.

use models_databases::views::{
    CardPosition, Conjunction, FilterCondition, FilterGroup, FilterNode, FilterTest, Lane, LaneKey,
    NewView, NumberOperator, RequestedLayout, SetOperator, SortDirection, SortKey, ViewColumn,
    ViewLayout, ViewPosition, ViewQuery,
};

use models_databases::{EntityKind, EntityRef};

use super::*;

fn refusal(error: DatabaseError) -> OpRefusal {
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    refusal
}

fn board(seeded: &Seeded) -> ViewLayout {
    ViewLayout::Board {
        group_by: seeded.status_column.id,
        title: seeded.name_column.id,
        lanes: vec![],
        card_fields: vec![seeded.name_column.id],
        hide_empty_lanes: false,
    }
}

/// Create a view, answering it as stored.
async fn create_view(
    seeded: &Seeded,
    name: &str,
    query: ViewQuery,
    layout: ViewLayout,
) -> DatabaseView {
    let id = ViewId::new();
    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: id,
                change: ViewChange::Create {
                    view: NewView {
                        name: name.into(),
                        query,
                        layout: layout.into(),
                    },
                },
            }]),
        )
        .await
        .unwrap();
    let [
        OpResult::View {
            change: ViewResult::Created { view },
            ..
        },
    ] = results.as_slice()
    else {
        panic!("expected a written view, got {results:?}");
    };
    assert_eq!(view.id, id);
    *view.clone()
}

/// Rows Alex (Going) and Robin (Declined) after the seeded Sam (Going),
/// answering `[sam, alex, robin]`.
async fn three_guests(seeded: &Seeded) -> [RowId; 3] {
    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Insert {
                    rows: [("Alex", "Going"), ("Robin", "Declined")]
                        .into_iter()
                        .map(|(name, status)| {
                            vec![
                                CellWrite {
                                    column: seeded.name_column.id,
                                    value: CellValue::Text(name.into()),
                                },
                                CellWrite {
                                    column: seeded.status_column.id,
                                    value: CellValue::Options(vec![OptionRef::Label(
                                        status.into(),
                                    )]),
                                },
                            ]
                        })
                        .collect(),
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
    ] = results.as_slice()
    else {
        panic!("expected one insert, got {results:?}");
    };
    [seeded.row_id, inserted[0], inserted[1]]
}

#[tokio::test]
async fn a_new_view_goes_after_the_tables_others_and_comes_with_the_detail() {
    let seeded = seeded().await;
    let before = table_version(&seeded.world, seeded.table_id);

    let table_view = create_view(
        &seeded,
        "  Everyone ",
        ViewQuery::default(),
        ViewLayout::Table {
            columns: vec![ViewColumn {
                column: seeded.name_column.id,
                width: Some(240),
            }],
        },
    )
    .await;
    let stages = create_view(&seeded, "Stages", ViewQuery::default(), board(&seeded)).await;

    assert_eq!(
        (
            table_view.database_id,
            table_view.table_id,
            table_view.name.as_str(),
            table_view.position.as_str()
        ),
        (seeded.database_id, seeded.table_id, "Everyone", "80")
    );
    assert_eq!(
        table_view.layout,
        ViewLayout::Table {
            columns: vec![ViewColumn {
                column: seeded.name_column.id,
                width: Some(240),
            }],
        }
    );
    assert_eq!(
        (stages.name.as_str(), stages.position.as_str()),
        ("Stages", "8180")
    );
    assert_eq!(
        table_version(&seeded.world, seeded.table_id),
        TableVersion(before.0 + 2)
    );
    let detail = seeded
        .service
        .get_database(receipt::<ViewAccessLevel>(
            seeded.database_id,
            OWNER,
            AccessLevel::Owner,
        ))
        .await
        .unwrap();
    assert_eq!(detail.tables[0].views, vec![table_view, stages]);
}

#[tokio::test]
async fn a_view_is_refused_when_it_does_not_fit_its_table() {
    let seeded = seeded().await;
    create_view(&seeded, "Everyone", ViewQuery::default(), board(&seeded)).await;
    let create = |name: &str, query: ViewQuery, layout: ViewLayout| DatabaseOp::View {
        table: seeded.table_id,
        view: ViewId::new(),
        change: ViewChange::Create {
            view: NewView {
                name: name.into(),
                query,
                layout: layout.into(),
            },
        },
    };
    let cases = [
        (
            create("everyone", ViewQuery::default(), board(&seeded)),
            "a view named `everyone` already exists on this table".to_string(),
        ),
        (
            create(" ", ViewQuery::default(), board(&seeded)),
            "a view's name must not be empty".to_string(),
        ),
        (
            create(
                "Big parties",
                ViewQuery {
                    filter: Some(FilterGroup {
                        conjunction: Conjunction::And,
                        conditions: vec![FilterNode::Condition(FilterCondition {
                            column: seeded.name_column.id,
                            test: FilterTest::Number {
                                operator: NumberOperator::GreaterThan,
                                value: 2.0,
                            },
                        })],
                    }),
                    sort: vec![],
                },
                ViewLayout::Table { columns: vec![] },
            ),
            "\"Name\" holds text values; a number test does not fit it".to_string(),
        ),
        (
            create(
                "By name",
                ViewQuery::default(),
                ViewLayout::Board {
                    group_by: seeded.name_column.id,
                    title: seeded.name_column.id,
                    lanes: vec![],
                    card_fields: vec![],
                    hide_empty_lanes: false,
                },
            ),
            "a board is grouped by a single-select or single-person column, so each card has one \
             lane; \"Name\" is neither"
                .to_string(),
        ),
    ];
    for (op, reason) in cases {
        let error = seeded
            .service
            .apply_ops(
                edit(seeded.database_id),
                viewer(OWNER),
                OpBatch::from(vec![op]),
            )
            .await
            .unwrap_err();
        assert_eq!(
            refusal(error),
            OpRefusal {
                op: 0,
                row: None,
                column: None,
                taken: None,
                reason: reason.clone(),
            },
            "{reason}"
        );
    }
    assert_eq!(seeded.world.lock().unwrap().views.len(), 1);
}

#[tokio::test]
async fn an_update_changes_what_it_names_and_a_regrouped_board_forgets_its_cards() {
    let seeded = seeded().await;
    let stages = create_view(&seeded, "Stages", ViewQuery::default(), board(&seeded)).await;
    seeded.world.lock().unwrap().positions.insert(
        stages.id,
        vec![CardPosition {
            row: seeded.row_id,
            lane: LaneKey::None,
            position: "80".parse::<Position>().unwrap(),
        }],
    );
    let sorted = ViewQuery {
        filter: None,
        sort: vec![SortKey {
            column: seeded.plus_ones_column.id,
            direction: SortDirection::Descending,
        }],
    };

    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: stages.id,
                change: ViewChange::Update {
                    name: Some("By size".into()),
                    query: Some(sorted.clone()),
                    layout: None,
                },
            }]),
        )
        .await
        .unwrap();
    {
        let w = seeded.world.lock().unwrap();
        let stored = &w.views[0];
        assert_eq!(
            (stored.name.as_str(), &stored.query, &stored.layout),
            ("By size", &sorted, &board(&seeded))
        );
        assert_eq!(w.positions[&stages.id].len(), 1);
    }

    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: stages.id,
                change: ViewChange::Update {
                    name: None,
                    query: None,
                    layout: Some(RequestedLayout::Table { columns: vec![] }),
                },
            }]),
        )
        .await
        .unwrap();
    assert_eq!(seeded.world.lock().unwrap().positions.get(&stages.id), None);
}

#[tokio::test]
async fn views_reorder_when_the_order_names_each_of_them_once() {
    let seeded = seeded().await;
    let first = create_view(&seeded, "First", ViewQuery::default(), board(&seeded)).await;
    let second = create_view(&seeded, "Second", ViewQuery::default(), board(&seeded)).await;
    let third = create_view(&seeded, "Third", ViewQuery::default(), board(&seeded)).await;
    let reorder = |order: Vec<ViewId>| DatabaseOp::Table {
        table: seeded.table_id,
        change: TableChange::ReorderViews { order },
    };

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![reorder(vec![third.id, first.id])]),
        )
        .await
        .unwrap_err();
    assert_eq!(
        refusal(error).reason,
        "the order must name every view of this table exactly once"
    );

    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![reorder(vec![third.id, first.id, second.id])]),
        )
        .await
        .unwrap();
    let [
        OpResult::Table {
            change: TableResult::ViewsReordered { positions },
            ..
        },
    ] = results.as_slice()
    else {
        panic!("expected a reorder, got {results:?}");
    };
    assert_eq!(
        positions,
        &vec![
            ViewPosition {
                view: third.id,
                position: "7f80".parse::<Position>().unwrap(),
            },
            ViewPosition {
                view: first.id,
                position: "80".parse::<Position>().unwrap(),
            },
            ViewPosition {
                view: second.id,
                position: "8180".parse::<Position>().unwrap(),
            },
        ]
    );
    let detail = seeded
        .service
        .get_database(receipt::<ViewAccessLevel>(
            seeded.database_id,
            OWNER,
            AccessLevel::Owner,
        ))
        .await
        .unwrap();
    let names: Vec<&str> = detail.tables[0]
        .views
        .iter()
        .map(|view| view.name.as_str())
        .collect();
    assert_eq!(names, vec!["Third", "First", "Second"]);
}

#[tokio::test]
async fn a_deleted_view_takes_its_card_places_with_it() {
    let seeded = seeded().await;
    let stages = create_view(&seeded, "Stages", ViewQuery::default(), board(&seeded)).await;
    seeded.world.lock().unwrap().positions.insert(
        stages.id,
        vec![CardPosition {
            row: seeded.row_id,
            lane: LaneKey::None,
            position: "80".parse::<Position>().unwrap(),
        }],
    );

    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: stages.id,
                change: ViewChange::Delete,
            }]),
        )
        .await
        .unwrap();

    assert!(matches!(
        results.as_slice(),
        [OpResult::View {
            change: ViewResult::Deleted,
            ..
        }]
    ));
    let w = seeded.world.lock().unwrap();
    assert!(w.views.is_empty());
    assert_eq!(w.positions.get(&stages.id), None);
}

#[tokio::test]
async fn moving_a_card_to_another_lane_sets_its_cell_and_places_it_there() {
    let seeded = seeded().await;
    let [sam, _alex, robin] = three_guests(&seeded).await;
    let stages = create_view(&seeded, "Stages", ViewQuery::default(), board(&seeded)).await;
    let status = seeded.status_column.property_definition_id;
    let declined = option_id(&seeded.world, status, "Declined");
    let before = table_version(&seeded.world, seeded.table_id);

    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: stages.id,
                change: ViewChange::MoveCard {
                    row: sam,
                    lane: LaneKey::Option(declined),
                    before: None,
                    after: Some(robin),
                },
            }]),
        )
        .await
        .unwrap();

    assert_eq!(
        results,
        vec![OpResult::View {
            table: seeded.table_id,
            view: stages.id,
            table_version: TableVersion(before.0 + 1),
            change: ViewResult::CardMoved {
                positions: vec![CardPosition {
                    row: sam,
                    lane: LaneKey::Option(declined),
                    position: "80".parse::<Position>().unwrap(),
                }],
            },
        }]
    );
    assert_eq!(
        cell(&seeded.world, sam, status),
        Some(PropertyValue::SelectOption(vec![declined.into_uuid()]))
    );

    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: stages.id,
                change: ViewChange::MoveCard {
                    row: sam,
                    lane: LaneKey::None,
                    before: None,
                    after: None,
                },
            }]),
        )
        .await
        .unwrap();
    assert_eq!(cell(&seeded.world, sam, status), None);
}

/// A person column naming Sam in Sam's row, holding several people when
/// `multi`; answers the column.
async fn person_column(seeded: &Seeded, name: &str, multi: bool) -> ColumnId {
    let host = ColumnId::new();
    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![
                DatabaseOp::Column {
                    table: seeded.table_id,
                    column: host,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: name.into(),
                            kind: ColumnKind::Entity {
                                target: EntityKind::User,
                                multi,
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
                                column: host,
                                value: CellValue::Entities(vec![EntityRef {
                                    entity_type: EntityKind::User,
                                    entity_id: "macro|sam@macro.com".into(),
                                }]),
                            }],
                        },
                    },
                },
            ]),
        )
        .await
        .unwrap();
    host
}

#[tokio::test]
async fn moving_a_card_to_a_persons_lane_makes_them_its_person() {
    let seeded = seeded().await;
    let [sam, alex, _robin] = three_guests(&seeded).await;
    let host = person_column(&seeded, "Host", false).await;
    let by_host = create_view(
        &seeded,
        "By host",
        ViewQuery::default(),
        ViewLayout::Board {
            group_by: host,
            title: seeded.name_column.id,
            lanes: vec![],
            card_fields: vec![],
            hide_empty_lanes: false,
        },
    )
    .await;
    let definition = seeded
        .world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|column| column.id == host)
        .unwrap()
        .property_definition_id;
    let sams_lane = LaneKey::User("macro|sam@macro.com".try_into().unwrap());

    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: by_host.id,
                change: ViewChange::MoveCard {
                    row: alex,
                    lane: sams_lane.clone(),
                    before: Some(sam),
                    after: None,
                },
            }]),
        )
        .await
        .unwrap();

    let [
        OpResult::View {
            change: ViewResult::CardMoved { positions },
            ..
        },
    ] = results.as_slice()
    else {
        panic!("expected a moved card, got {results:?}");
    };
    assert_eq!(
        positions,
        &vec![
            CardPosition {
                row: sam,
                lane: sams_lane.clone(),
                position: "7f80".parse::<Position>().unwrap(),
            },
            CardPosition {
                row: alex,
                lane: sams_lane.clone(),
                position: "80".parse::<Position>().unwrap(),
            },
        ]
    );
    assert_eq!(
        cell(&seeded.world, alex, definition),
        Some(PropertyValue::EntityRef(vec![
            models_properties::shared::EntityReference {
                entity_id: "macro|sam@macro.com".into(),
                entity_type: PropertyEntityType::User,
                specific_message_id: None,
            }
        ]))
    );

    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: by_host.id,
                change: ViewChange::MoveCard {
                    row: sam,
                    lane: LaneKey::None,
                    before: None,
                    after: None,
                },
            }]),
        )
        .await
        .unwrap();
    assert_eq!(cell(&seeded.world, sam, definition), None);
}

#[tokio::test]
async fn a_board_takes_only_lanes_its_column_groups_by() {
    let seeded = seeded().await;
    let host = person_column(&seeded, "Host", false).await;
    let helpers = person_column(&seeded, "Helpers", true).await;
    let by_host = create_view(
        &seeded,
        "By host",
        ViewQuery::default(),
        ViewLayout::Board {
            group_by: host,
            title: seeded.name_column.id,
            lanes: vec![],
            card_fields: vec![],
            hide_empty_lanes: false,
        },
    )
    .await;
    let going = option_id(
        &seeded.world,
        seeded.status_column.property_definition_id,
        "Going",
    );
    let stages = create_view(&seeded, "Stages", ViewQuery::default(), board(&seeded)).await;
    let move_to = |view: ViewId, lane: LaneKey| DatabaseOp::View {
        table: seeded.table_id,
        view,
        change: ViewChange::MoveCard {
            row: seeded.row_id,
            lane,
            before: None,
            after: None,
        },
    };
    let cases = [
        (
            DatabaseOp::View {
                table: seeded.table_id,
                view: ViewId::new(),
                change: ViewChange::Create {
                    view: NewView {
                        name: "By helpers".into(),
                        query: ViewQuery::default(),
                        layout: ViewLayout::Board {
                            group_by: helpers,
                            title: seeded.name_column.id,
                            lanes: vec![],
                            card_fields: vec![],
                            hide_empty_lanes: false,
                        }
                        .into(),
                    },
                },
            },
            None,
            "a board is grouped by a single-select or single-person column, so each card has one \
             lane; \"Helpers\" is neither",
        ),
        (
            move_to(by_host.id, LaneKey::Option(going)),
            Some(host),
            "\"Host\" groups the board by person; a lane names a person, or no one",
        ),
        (
            move_to(
                stages.id,
                LaneKey::User("macro|sam@macro.com".try_into().unwrap()),
            ),
            Some(seeded.status_column.id),
            "\"Status\" groups the board by option; a lane names one of its options, or none",
        ),
    ];
    for (op, column, reason) in cases {
        let error = seeded
            .service
            .apply_ops(
                edit(seeded.database_id),
                viewer(OWNER),
                OpBatch::from(vec![op]),
            )
            .await
            .unwrap_err();
        assert_eq!(
            refusal(error),
            OpRefusal {
                op: 0,
                row: None,
                column,
                taken: None,
                reason: reason.to_string(),
            },
            "{reason}"
        );
    }
}

#[tokio::test]
async fn moving_a_card_within_its_lane_places_the_unplaced_cards_before_it() {
    let seeded = seeded().await;
    let [sam, alex, _robin] = three_guests(&seeded).await;
    let extra = insert_names(&seeded, &["Kim"]).await[0];
    let going = option_id(
        &seeded.world,
        seeded.status_column.property_definition_id,
        "Going",
    );
    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Update {
                    changes: RowChanges::Uniform {
                        rows: vec![extra],
                        cells: vec![CellWrite {
                            column: seeded.status_column.id,
                            value: CellValue::Options(vec![OptionRef::Id(going)]),
                        }],
                    },
                },
            }]),
        )
        .await
        .unwrap();
    let stages = create_view(&seeded, "Stages", ViewQuery::default(), board(&seeded)).await;

    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![
                DatabaseOp::View {
                    table: seeded.table_id,
                    view: stages.id,
                    change: ViewChange::MoveCard {
                        row: sam,
                        lane: LaneKey::Option(going),
                        before: Some(alex),
                        after: Some(extra),
                    },
                },
                DatabaseOp::View {
                    table: seeded.table_id,
                    view: stages.id,
                    change: ViewChange::MoveCard {
                        row: extra,
                        lane: LaneKey::Option(going),
                        before: None,
                        after: Some(alex),
                    },
                },
            ]),
        )
        .await
        .unwrap();

    assert_eq!(
        results
            .iter()
            .map(|result| match result {
                OpResult::View {
                    change: ViewResult::CardMoved { positions },
                    ..
                } => positions.clone(),
                other => panic!("expected a moved card, got {other:?}"),
            })
            .collect::<Vec<_>>(),
        vec![
            vec![
                CardPosition {
                    row: alex,
                    lane: LaneKey::Option(going),
                    position: "7f80".parse::<Position>().unwrap(),
                },
                CardPosition {
                    row: sam,
                    lane: LaneKey::Option(going),
                    position: "80".parse::<Position>().unwrap(),
                },
            ],
            vec![CardPosition {
                row: extra,
                lane: LaneKey::Option(going),
                position: "7e80".parse::<Position>().unwrap(),
            }],
        ]
    );
    let mut stored = seeded.world.lock().unwrap().positions[&stages.id].clone();
    stored.sort_by(|left, right| left.position.cmp(&right.position));
    let order: Vec<RowId> = stored.iter().map(|placed| placed.row).collect();
    assert_eq!(order, vec![extra, alex, sam]);
}

#[tokio::test]
async fn a_sorted_board_keeps_its_cards_in_the_sorts_order() {
    let seeded = seeded().await;
    let sorted = create_view(
        &seeded,
        "By size",
        ViewQuery {
            filter: None,
            sort: vec![SortKey {
                column: seeded.plus_ones_column.id,
                direction: SortDirection::Ascending,
            }],
        },
        board(&seeded),
    )
    .await;
    let everyone = create_view(
        &seeded,
        "Everyone",
        ViewQuery::default(),
        ViewLayout::Table { columns: vec![] },
    )
    .await;
    let move_on = |view: ViewId| DatabaseOp::View {
        table: seeded.table_id,
        view,
        change: ViewChange::MoveCard {
            row: seeded.row_id,
            lane: LaneKey::None,
            before: None,
            after: None,
        },
    };

    for (view, reason) in [
        (
            sorted.id,
            "\"By size\" is sorted, so its cards keep the sort's order; remove the sort to \
             arrange them by hand",
        ),
        (
            everyone.id,
            "\"Everyone\" is a table view; only a board's cards move",
        ),
    ] {
        let error = seeded
            .service
            .apply_ops(
                edit(seeded.database_id),
                viewer(OWNER),
                OpBatch::from(vec![move_on(view)]),
            )
            .await
            .unwrap_err();
        assert_eq!(
            refusal(error),
            OpRefusal {
                op: 0,
                row: None,
                column: None,
                taken: None,
                reason: reason.into(),
            }
        );
    }
    assert!(seeded.world.lock().unwrap().positions.is_empty());
}

#[tokio::test]
async fn a_card_moves_only_next_to_cards_of_its_new_lane() {
    let seeded = seeded().await;
    let [sam, _alex, robin] = three_guests(&seeded).await;
    let stages = create_view(&seeded, "Stages", ViewQuery::default(), board(&seeded)).await;
    let going = option_id(
        &seeded.world,
        seeded.status_column.property_definition_id,
        "Going",
    );

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: stages.id,
                change: ViewChange::MoveCard {
                    row: sam,
                    lane: LaneKey::Option(going),
                    before: Some(robin),
                    after: None,
                },
            }]),
        )
        .await
        .unwrap_err();

    assert_eq!(
        refusal(error).reason,
        format!("row {robin} is not a card of that lane")
    );
}

#[tokio::test]
async fn removing_a_column_takes_it_out_of_views_unless_a_board_groups_by_it() {
    let seeded = seeded().await;
    let filtered = create_view(
        &seeded,
        "Big parties",
        ViewQuery {
            filter: Some(FilterGroup {
                conjunction: Conjunction::And,
                conditions: vec![FilterNode::Condition(FilterCondition {
                    column: seeded.plus_ones_column.id,
                    test: FilterTest::Number {
                        operator: NumberOperator::GreaterThan,
                        value: 1.0,
                    },
                })],
            }),
            sort: vec![SortKey {
                column: seeded.plus_ones_column.id,
                direction: SortDirection::Descending,
            }],
        },
        ViewLayout::Board {
            group_by: seeded.status_column.id,
            title: seeded.name_column.id,
            lanes: vec![],
            card_fields: vec![seeded.name_column.id, seeded.plus_ones_column.id],
            hide_empty_lanes: false,
        },
    )
    .await;
    let seeded = &seeded;
    let delete = |column: ColumnId| async move {
        let version = table_version(&seeded.world, seeded.table_id);
        seeded
            .service
            .apply_ops(
                edit(seeded.database_id),
                viewer(OWNER),
                OpBatch {
                    ops: vec![DatabaseOp::Column {
                        table: seeded.table_id,
                        column,
                        change: ColumnChange::Delete,
                    }],
                    base_versions: HashMap::from([(seeded.table_id, version)]),
                },
            )
            .await
    };

    delete(seeded.plus_ones_column.id).await.unwrap();
    {
        let w = seeded.world.lock().unwrap();
        let stored = w.views.iter().find(|view| view.id == filtered.id).unwrap();
        assert_eq!(stored.query, ViewQuery::default());
        assert_eq!(
            stored.layout,
            ViewLayout::Board {
                group_by: seeded.status_column.id,
                title: seeded.name_column.id,
                lanes: vec![],
                card_fields: vec![seeded.name_column.id],
                hide_empty_lanes: false,
            }
        );
    }

    let error = delete(seeded.status_column.id).await.unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused removal, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        SchemaError::BoardGroupsByRemovedColumn {
            board: "Big parties".into()
        }
        .to_string()
    );

    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: filtered.id,
                change: ViewChange::Delete,
            }]),
        )
        .await
        .unwrap();
    delete(seeded.status_column.id).await.unwrap();
}

#[tokio::test]
async fn a_new_view_under_an_existing_views_id_is_refused_as_taken() {
    let seeded = seeded().await;
    let everyone = create_view(&seeded, "Everyone", ViewQuery::default(), board(&seeded)).await;
    let taken = everyone.id;
    let before = table_version(&seeded.world, seeded.table_id);

    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: taken,
                change: ViewChange::Create {
                    view: NewView {
                        name: "Stages".into(),
                        query: ViewQuery::default(),
                        layout: RequestedLayout::Table { columns: vec![] },
                    },
                },
            }]),
        )
        .await
        .unwrap_err();

    assert_eq!(
        refusal(error),
        OpRefusal {
            op: 0,
            row: None,
            column: None,
            taken: Some(TakenId::View(taken)),
            reason: format!(
                "{taken} already names a view; mint a new id for each view a request creates"
            ),
        }
    );
    let w = seeded.world.lock().unwrap();
    assert_eq!(w.views, vec![everyone]);
    assert_eq!(
        w.tables
            .iter()
            .find(|table| table.id == seeded.table_id)
            .unwrap()
            .version,
        before
    );
}

#[tokio::test]
async fn a_board_created_without_a_title_is_titled_by_the_first_column() {
    let seeded = seeded().await;
    let stages = ViewId::new();
    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: stages,
                change: ViewChange::Create {
                    view: NewView {
                        name: "Stages".into(),
                        query: ViewQuery::default(),
                        layout: RequestedLayout::Board {
                            group_by: seeded.status_column.id,
                            title: None,
                            lanes: vec![],
                            card_fields: vec![seeded.plus_ones_column.id],
                            hide_empty_lanes: false,
                        },
                    },
                },
            }]),
        )
        .await
        .unwrap();
    let [
        OpResult::View {
            view: written,
            change: ViewResult::Created { view },
            ..
        },
    ] = results.as_slice()
    else {
        panic!("expected a written view, got {results:?}");
    };

    assert_eq!((*written, view.id), (stages, stages));
    assert_eq!(
        view.layout,
        ViewLayout::Board {
            group_by: seeded.status_column.id,
            title: seeded.name_column.id,
            lanes: vec![],
            card_fields: vec![seeded.plus_ones_column.id],
            hide_empty_lanes: false,
        }
    );
    assert_eq!(seeded.world.lock().unwrap().views[0].layout, view.layout);
}

#[tokio::test]
async fn an_update_without_a_title_keeps_the_boards_title() {
    let seeded = seeded().await;
    let stages = create_view(
        &seeded,
        "Stages",
        ViewQuery::default(),
        ViewLayout::Board {
            group_by: seeded.status_column.id,
            title: seeded.plus_ones_column.id,
            lanes: vec![],
            card_fields: vec![],
            hide_empty_lanes: false,
        },
    )
    .await;

    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: stages.id,
                change: ViewChange::Update {
                    name: None,
                    query: None,
                    layout: Some(RequestedLayout::Board {
                        group_by: seeded.status_column.id,
                        title: None,
                        lanes: vec![],
                        card_fields: vec![],
                        hide_empty_lanes: true,
                    }),
                },
            }]),
        )
        .await
        .unwrap();

    assert_eq!(
        seeded.world.lock().unwrap().views[0].layout,
        ViewLayout::Board {
            group_by: seeded.status_column.id,
            title: seeded.plus_ones_column.id,
            lanes: vec![],
            card_fields: vec![],
            hide_empty_lanes: true,
        }
    );
}

#[tokio::test]
async fn a_board_titled_by_an_unknown_column_is_refused() {
    let seeded = seeded().await;
    let ghost = ColumnId::new();
    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::View {
                table: seeded.table_id,
                view: ViewId::new(),
                change: ViewChange::Create {
                    view: NewView {
                        name: "Stages".into(),
                        query: ViewQuery::default(),
                        layout: RequestedLayout::Board {
                            group_by: seeded.status_column.id,
                            title: Some(ghost),
                            lanes: vec![],
                            card_fields: vec![],
                            hide_empty_lanes: false,
                        },
                    },
                },
            }]),
        )
        .await
        .unwrap_err();

    assert_eq!(
        refusal(error).reason,
        format!("no column {ghost} in this table")
    );
    assert!(seeded.world.lock().unwrap().views.is_empty());
}

#[tokio::test]
async fn removing_a_boards_title_column_titles_it_by_the_next_first_column() {
    let seeded = seeded().await;
    let stages = create_view(
        &seeded,
        "Stages",
        ViewQuery::default(),
        ViewLayout::Board {
            group_by: seeded.status_column.id,
            title: seeded.name_column.id,
            lanes: vec![],
            card_fields: vec![seeded.name_column.id, seeded.plus_ones_column.id],
            hide_empty_lanes: false,
        },
    )
    .await;
    let version = table_version(&seeded.world, seeded.table_id);

    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch {
                ops: vec![DatabaseOp::Column {
                    table: seeded.table_id,
                    column: seeded.name_column.id,
                    change: ColumnChange::Delete,
                }],
                base_versions: HashMap::from([(seeded.table_id, version)]),
            },
        )
        .await
        .unwrap();

    let w = seeded.world.lock().unwrap();
    let stored = w.views.iter().find(|view| view.id == stages.id).unwrap();
    assert_eq!(
        stored.layout,
        ViewLayout::Board {
            group_by: seeded.status_column.id,
            title: seeded.status_column.id,
            lanes: vec![],
            card_fields: vec![seeded.plus_ones_column.id],
            hide_empty_lanes: false,
        }
    );
}

#[tokio::test]
async fn removing_an_option_takes_it_out_of_views_lanes_and_card_places() {
    let seeded = seeded().await;
    let status = seeded.status_column.property_definition_id;
    let going = option_id(&seeded.world, status, "Going");
    let declined = option_id(&seeded.world, status, "Declined");
    let stages = create_view(
        &seeded,
        "Stages",
        ViewQuery {
            filter: Some(FilterGroup {
                conjunction: Conjunction::Or,
                conditions: vec![FilterNode::Condition(FilterCondition {
                    column: seeded.status_column.id,
                    test: FilterTest::Options {
                        operator: SetOperator::IsAnyOf,
                        options: vec![going, declined],
                    },
                })],
            }),
            sort: vec![],
        },
        ViewLayout::Board {
            group_by: seeded.status_column.id,
            title: seeded.name_column.id,
            lanes: vec![
                Lane {
                    key: LaneKey::Option(going),
                    hidden: false,
                },
                Lane {
                    key: LaneKey::Option(declined),
                    hidden: true,
                },
            ],
            card_fields: vec![],
            hide_empty_lanes: false,
        },
    )
    .await;
    seeded.world.lock().unwrap().positions.insert(
        stages.id,
        vec![CardPosition {
            row: seeded.row_id,
            lane: LaneKey::Option(going),
            position: "80".parse::<Position>().unwrap(),
        }],
    );

    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Column {
                table: seeded.table_id,
                column: seeded.status_column.id,
                change: ColumnChange::DeleteOption { option: going },
            }]),
        )
        .await
        .unwrap();

    let w = seeded.world.lock().unwrap();
    let stored = &w.views[0];
    assert_eq!(
        stored.query,
        ViewQuery {
            filter: Some(FilterGroup {
                conjunction: Conjunction::Or,
                conditions: vec![FilterNode::Condition(FilterCondition {
                    column: seeded.status_column.id,
                    test: FilterTest::Options {
                        operator: SetOperator::IsAnyOf,
                        options: vec![declined],
                    },
                })],
            }),
            sort: vec![],
        }
    );
    assert_eq!(
        stored.layout,
        ViewLayout::Board {
            group_by: seeded.status_column.id,
            title: seeded.name_column.id,
            lanes: vec![Lane {
                key: LaneKey::Option(declined),
                hidden: true,
            }],
            card_fields: vec![],
            hide_empty_lanes: false,
        }
    );
    assert_eq!(w.positions[&stages.id], vec![]);
}

#[tokio::test]
async fn a_new_type_drops_the_tests_of_the_old_one_but_not_under_a_board() {
    let seeded = seeded().await;
    let filtered = create_view(
        &seeded,
        "Big parties",
        ViewQuery {
            filter: Some(FilterGroup {
                conjunction: Conjunction::And,
                conditions: vec![FilterNode::Condition(FilterCondition {
                    column: seeded.plus_ones_column.id,
                    test: FilterTest::Number {
                        operator: NumberOperator::GreaterThan,
                        value: 1.0,
                    },
                })],
            }),
            sort: vec![SortKey {
                column: seeded.plus_ones_column.id,
                direction: SortDirection::Ascending,
            }],
        },
        ViewLayout::Table { columns: vec![] },
    )
    .await;
    let retype = |column: ColumnId, to: models_databases::ColumnKind| DatabaseOp::Column {
        table: seeded.table_id,
        column,
        change: ColumnChange::ChangeType { to },
    };

    seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![retype(
                seeded.plus_ones_column.id,
                models_databases::ColumnKind::Text,
            )]),
        )
        .await
        .unwrap();
    let stored = seeded
        .world
        .lock()
        .unwrap()
        .views
        .iter()
        .find(|view| view.id == filtered.id)
        .unwrap()
        .query
        .clone();
    assert_eq!(
        stored,
        ViewQuery {
            filter: None,
            sort: vec![SortKey {
                column: seeded.plus_ones_column.id,
                direction: SortDirection::Ascending,
            }],
        }
    );

    create_view(&seeded, "Stages", ViewQuery::default(), board(&seeded)).await;
    let error = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![retype(
                seeded.status_column.id,
                models_databases::ColumnKind::Text,
            )]),
        )
        .await
        .unwrap_err();
    assert_eq!(
        refusal(error).reason,
        "The board \"Stages\" groups its cards by this column; delete the board or group it by \
         another column before changing its type."
    );
}

#[tokio::test]
async fn a_boards_card_places_read_back_for_its_database_alone() {
    let seeded = seeded().await;
    let stages = create_view(&seeded, "Stages", ViewQuery::default(), board(&seeded)).await;
    let placed = vec![CardPosition {
        row: seeded.row_id,
        lane: LaneKey::None,
        position: "80".parse::<Position>().unwrap(),
    }];
    seeded
        .world
        .lock()
        .unwrap()
        .positions
        .insert(stages.id, placed.clone());
    let view = receipt::<ViewAccessLevel>(seeded.database_id, VIEWER, AccessLevel::View);

    assert_eq!(
        seeded
            .service
            .view_positions(view, stages.id)
            .await
            .unwrap(),
        placed
    );
    let elsewhere = receipt::<ViewAccessLevel>(DatabaseId::new(), OWNER, AccessLevel::Owner);
    assert!(matches!(
        seeded.service.view_positions(elsewhere, stages.id).await,
        Err(DatabaseError::NotFound)
    ));
}
