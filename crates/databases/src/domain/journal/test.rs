//! Explicit literal tests of inverting each kind of op.

use models_databases::views::LaneKey;
use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use models_databases::position::{Position, key_between};
use models_databases::views::{
    CardPosition, DatabaseView, NewView, RequestedLayout, ViewColumn, ViewId, ViewLayout, ViewQuery,
};
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnId, ColumnKind, DatabaseId, DatabaseOp, NewColumn,
    NewOption, OptionId, OptionRef, PropertyId, RowChange, RowChanges, RowId, RowsChange,
    TableChange, TableId, TableVersion, ViewChange,
};
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use uuid::Uuid;

use super::*;
use crate::domain::models::{Column, ColumnReplacement, NewDefinition, Write};

const DATABASE: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(0xd0));
const GUESTS: TableId = TableId::from_uuid(Uuid::from_u128(0x10));
const VENUES: TableId = TableId::from_uuid(Uuid::from_u128(0x11));
const NAME: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc1));
const RSVP: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc2));
const PLUS_ONES: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc3));
const NAME_DEFINITION: Uuid = Uuid::from_u128(0xe1);
const RSVP_DEFINITION: Uuid = Uuid::from_u128(0xe2);
const PLUS_ONES_DEFINITION: Uuid = Uuid::from_u128(0xe3);
const YES: OptionId = OptionId::from_uuid(Uuid::from_u128(0xa1));
const NO: OptionId = OptionId::from_uuid(Uuid::from_u128(0xa2));
const MAYBE: OptionId = OptionId::from_uuid(Uuid::from_u128(0xa3));
const MARIA: RowId = RowId::from_uuid(Uuid::from_u128(0xb1));
const OMAR: RowId = RowId::from_uuid(Uuid::from_u128(0xb2));
const GRID: ViewId = ViewId::from_uuid(Uuid::from_u128(0xf1));
const BOARD: ViewId = ViewId::from_uuid(Uuid::from_u128(0xf2));

fn first_key() -> Position {
    key_between(None, None).unwrap()
}

fn second_key() -> Position {
    key_between(Some(&first_key()), None).unwrap()
}

fn written() -> DateTime<Utc> {
    DateTime::UNIX_EPOCH
}

/// The guest list's views as stored: a grid sorted by Plus Ones, and a board
/// grouped by RSVP.
fn views() -> [DatabaseView; 2] {
    [
        DatabaseView {
            id: GRID,
            database_id: DATABASE,
            table_id: GUESTS,
            name: "Everyone".into(),
            position: first_key(),
            query: ViewQuery {
                filter: None,
                sort: vec![models_databases::views::SortKey {
                    column: PLUS_ONES,
                    direction: models_databases::views::SortDirection::Descending,
                }],
            },
            layout: ViewLayout::Table {
                columns: vec![ViewColumn {
                    column: PLUS_ONES,
                    width: Some(80),
                }],
            },
            created_at: written(),
            updated_at: written(),
        },
        DatabaseView {
            id: BOARD,
            database_id: DATABASE,
            table_id: GUESTS,
            name: "By RSVP".into(),
            position: second_key(),
            query: ViewQuery::default(),
            layout: ViewLayout::Board {
                group_by: RSVP,
                title: NAME,
                lanes: Vec::new(),
                card_fields: Vec::new(),
                hide_empty_lanes: false,
            },
            created_at: written(),
            updated_at: written(),
        },
    ]
}

/// The wedding database as its planner read it: Guests (Name, RSVP, Plus
/// Ones) and Venues.
fn schema() -> SchemaImage {
    SchemaImage {
        tables: vec![
            TableImage {
                id: GUESTS,
                name: "Guests".into(),
                version: TableVersion(7),
            },
            TableImage {
                id: VENUES,
                name: "Venues".into(),
                version: TableVersion(2),
            },
        ],
        columns: vec![
            ColumnImage {
                nullable: true,
                id: NAME,
                infer_type: false,
                table: GUESTS,
                name: "Name".into(),
                definition_name: "Name".into(),
                definition: NAME_DEFINITION,
                kind: Some(ColumnKind::Text),
                options: Vec::new(),
                formula: None,
            },
            ColumnImage {
                nullable: true,
                id: RSVP,
                infer_type: false,
                table: GUESTS,
                name: "RSVP".into(),
                definition_name: "RSVP".into(),
                definition: RSVP_DEFINITION,
                kind: Some(ColumnKind::Select { multi: false }),
                options: vec![
                    OptionImage {
                        id: YES,
                        label: "Yes".into(),
                        color: Some("#00AA00".into()),
                    },
                    OptionImage {
                        id: NO,
                        label: "No".into(),
                        color: Some("#AA0000".into()),
                    },
                    OptionImage {
                        id: MAYBE,
                        label: "Maybe".into(),
                        color: None,
                    },
                ],
                formula: None,
            },
            ColumnImage {
                nullable: true,
                id: PLUS_ONES,
                infer_type: false,
                table: GUESTS,
                name: "Plus Ones".into(),
                definition_name: "Extra guests".into(),
                definition: PLUS_ONES_DEFINITION,
                kind: Some(ColumnKind::Number),
                options: Vec::new(),
                formula: None,
            },
        ],
        views: views().to_vec(),
    }
}

/// Maria (RSVP Yes, Plus Ones 1) and Omar (RSVP No) as they were.
fn guests() -> BTreeMap<RowId, RowImage> {
    BTreeMap::from([
        (
            MARIA,
            RowImage {
                table: GUESTS,
                position: first_key(),
                cells: BTreeMap::from([
                    (NAME, CellValue::Text("Maria".into())),
                    (RSVP, CellValue::Options(vec![OptionRef::Id(YES)])),
                    (PLUS_ONES, CellValue::Number(1.0)),
                ]),
            },
        ),
        (
            OMAR,
            RowImage {
                table: GUESTS,
                position: second_key(),
                cells: BTreeMap::from([
                    (NAME, CellValue::Text("Omar".into())),
                    (RSVP, CellValue::Options(vec![OptionRef::Id(NO)])),
                ]),
            },
        ),
    ])
}

#[test]
fn a_row_insert_is_undone_by_deleting_the_rows_it_inserted() {
    let op = DatabaseOp::Rows {
        table: GUESTS,
        change: RowsChange::Insert {
            rows: vec![vec![CellWrite {
                column: NAME,
                value: CellValue::Text("Maria".into()),
            }]],
        },
    };
    let write = Write::InsertRows {
        table_id: GUESTS,
        rows: vec![vec![(NAME_DEFINITION, PropertyValue::Str("Maria".into()))]],
        restored: Vec::new(),
    };
    let before = Before {
        schema: schema(),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[MARIA],
        }],
        &before,
    );

    assert_eq!(
        inverse,
        ChangeInverse {
            ops: vec![DatabaseOp::Rows {
                table: GUESTS,
                change: RowsChange::Delete { rows: vec![MARIA] },
            }],
            ..ChangeInverse::default()
        }
    );
}

#[test]
fn a_cell_update_is_undone_by_writing_back_the_old_value_or_clearing_an_empty_cell() {
    let op = DatabaseOp::Rows {
        table: GUESTS,
        change: RowsChange::Update {
            changes: RowChanges::Uniform {
                rows: vec![MARIA, OMAR],
                cells: vec![
                    CellWrite {
                        column: RSVP,
                        value: CellValue::Options(vec![OptionRef::Id(MAYBE)]),
                    },
                    CellWrite {
                        column: PLUS_ONES,
                        value: CellValue::Number(2.0),
                    },
                ],
            },
        },
    };
    let write = Write::UpdateRows {
        table_id: GUESTS,
        rows: vec![
            (
                MARIA,
                vec![
                    (
                        RSVP_DEFINITION,
                        Some(PropertyValue::SelectOption(vec![MAYBE.into_uuid()])),
                    ),
                    (PLUS_ONES_DEFINITION, Some(PropertyValue::Num(2.0))),
                ],
            ),
            (
                OMAR,
                vec![
                    (
                        RSVP_DEFINITION,
                        Some(PropertyValue::SelectOption(vec![MAYBE.into_uuid()])),
                    ),
                    (PLUS_ONES_DEFINITION, Some(PropertyValue::Num(2.0))),
                ],
            ),
        ],
    };
    let before = Before {
        schema: schema(),
        rows: guests(),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse.ops,
        vec![DatabaseOp::Rows {
            table: GUESTS,
            change: RowsChange::Update {
                changes: RowChanges::PerRow {
                    rows: vec![
                        RowChange {
                            row: MARIA,
                            cells: vec![
                                CellWrite {
                                    column: RSVP,
                                    value: CellValue::Options(vec![OptionRef::Id(YES)]),
                                },
                                CellWrite {
                                    column: PLUS_ONES,
                                    value: CellValue::Number(1.0),
                                },
                            ],
                        },
                        RowChange {
                            row: OMAR,
                            cells: vec![
                                CellWrite {
                                    column: RSVP,
                                    value: CellValue::Options(vec![OptionRef::Id(NO)]),
                                },
                                CellWrite {
                                    column: PLUS_ONES,
                                    value: CellValue::Clear,
                                },
                            ],
                        },
                    ],
                },
            },
        }]
    );
}

#[test]
fn a_row_delete_is_undone_by_reinserting_the_rows_under_their_ids_and_positions() {
    let op = DatabaseOp::Rows {
        table: GUESTS,
        change: RowsChange::Delete { rows: vec![OMAR] },
    };
    let write = Write::DeleteRows {
        only_if_unreferenced: false,
        table_id: GUESTS,
        rows: vec![OMAR],
    };
    let before = Before {
        schema: schema(),
        rows: guests(),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse,
        ChangeInverse {
            ops: vec![DatabaseOp::Rows {
                table: GUESTS,
                change: RowsChange::Insert {
                    rows: vec![vec![
                        CellWrite {
                            column: NAME,
                            value: CellValue::Text("Omar".into()),
                        },
                        CellWrite {
                            column: RSVP,
                            value: CellValue::Options(vec![OptionRef::Id(NO)]),
                        },
                    ]],
                },
            }],
            restored_rows: BTreeMap::from([(
                0,
                vec![RestoredRow {
                    id: OMAR,
                    position: second_key(),
                }],
            )]),
            ..ChangeInverse::default()
        }
    );
}

#[test]
fn a_column_create_is_undone_by_deleting_the_column() {
    let seats = ColumnId::from_uuid(Uuid::from_u128(0xc9));
    let op = DatabaseOp::Column {
        table: GUESTS,
        column: seats,
        change: ColumnChange::Create {
            definition: NewColumn::New {
                name: "Seats".into(),
                kind: ColumnKind::Number,
                options: Vec::new(),
                infer_type: false,
            },
            after: None,
        },
    };
    let write = Write::CreateColumn {
        column: Column {
            protections: vec![],
            nullable: true,
            id: seats,
            table_id: GUESTS,
            property_definition_id: Uuid::from_u128(0xe9),
            position: second_key(),
            config: None,
            display_name: None,
            infer_type: false,
        },
        definition: None,
    };
    let before = Before {
        schema: schema(),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse.ops,
        vec![DatabaseOp::Column {
            table: GUESTS,
            column: seats,
            change: ColumnChange::Delete,
        }]
    );
}

#[test]
fn a_column_delete_is_undone_by_binding_its_definition_back_with_its_name_cells_views_and_place() {
    let op = DatabaseOp::Column {
        table: GUESTS,
        column: PLUS_ONES,
        change: ColumnChange::Delete,
    };
    let [grid, _] = views();
    let grid_without = DatabaseView {
        query: ViewQuery::default(),
        layout: ViewLayout::Table {
            columns: Vec::new(),
        },
        ..grid.clone()
    };
    let write = Write::DeleteColumn {
        table_id: GUESTS,
        column_id: PLUS_ONES,
        definition_id: PLUS_ONES_DEFINITION,
        views: vec![grid_without],
        related: None,
    };
    let before = Before {
        schema: schema(),
        column_cells: BTreeMap::from([(
            PLUS_ONES,
            BTreeMap::from([(MARIA, CellValue::Number(1.0))]),
        )]),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse.ops,
        vec![
            DatabaseOp::Column {
                table: GUESTS,
                column: PLUS_ONES,
                change: ColumnChange::Create {
                    definition: NewColumn::Existing {
                        property: PropertyId::from_uuid(PLUS_ONES_DEFINITION),
                    },
                    after: None,
                },
            },
            DatabaseOp::Column {
                table: GUESTS,
                column: PLUS_ONES,
                change: ColumnChange::Rename {
                    name: "Plus Ones".into(),
                    previous_name: None,
                },
            },
            DatabaseOp::View {
                table: GUESTS,
                view: GRID,
                change: ViewChange::Update {
                    name: Some("Everyone".into()),
                    query: Some(grid.query.clone()),
                    layout: Some(RequestedLayout::Table {
                        columns: vec![ViewColumn {
                            column: PLUS_ONES,
                            width: Some(80)
                        }],
                    }),
                },
            },
            DatabaseOp::Rows {
                table: GUESTS,
                change: RowsChange::Update {
                    changes: RowChanges::PerRow {
                        rows: vec![RowChange {
                            row: MARIA,
                            cells: vec![CellWrite {
                                column: PLUS_ONES,
                                value: CellValue::Number(1.0),
                            }],
                        }],
                    },
                },
            },
            DatabaseOp::Table {
                table: GUESTS,
                change: TableChange::ReorderColumns {
                    order: vec![NAME, RSVP, PLUS_ONES],
                },
            },
        ]
    );
}

#[test]
fn a_column_rename_is_undone_by_renaming_it_back() {
    let op = DatabaseOp::Column {
        table: GUESTS,
        column: RSVP,
        change: ColumnChange::Rename {
            name: "Coming?".into(),
            previous_name: Some("RSVP".into()),
        },
    };
    let write = Write::RenameColumn {
        table_id: GUESTS,
        column_id: RSVP,
        from: None,
        name: "Coming?".into(),
    };
    let before = Before {
        schema: schema(),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse.ops,
        vec![DatabaseOp::Column {
            table: GUESTS,
            column: RSVP,
            change: ColumnChange::Rename {
                name: "RSVP".into(),
                previous_name: Some("Coming?".into()),
            },
        }]
    );
}

#[test]
fn a_column_reorder_is_undone_by_the_old_order() {
    let op = DatabaseOp::Table {
        table: GUESTS,
        change: TableChange::ReorderColumns {
            order: vec![PLUS_ONES, RSVP, NAME],
        },
    };
    let write = Write::OrderColumns {
        table_id: GUESTS,
        positions: Vec::new(),
    };
    let before = Before {
        schema: schema(),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse.ops,
        vec![DatabaseOp::Table {
            table: GUESTS,
            change: TableChange::ReorderColumns {
                order: vec![NAME, RSVP, PLUS_ONES],
            },
        }]
    );
}

#[test]
fn a_type_change_is_undone_by_the_old_type_with_the_old_definition_and_cells() {
    let op = DatabaseOp::Column {
        table: GUESTS,
        column: PLUS_ONES,
        change: ColumnChange::ChangeType {
            to: ColumnKind::Text,
        },
    };
    let write = Write::ReplaceColumn {
        table_id: GUESTS,
        read_version: Some(TableVersion(7)),
        definition: Some(NewDefinition {
            id: Uuid::from_u128(0xe8),
            name: "Extra guests".into(),
            data_type: models_properties::shared::DataType::String,
            is_multi_select: false,
            specific_entity_type: None,
            options: Vec::new(),
        }),
        replacement: ColumnReplacement {
            column: Column {
                protections: vec![],
                nullable: true,
                id: PLUS_ONES,
                table_id: GUESTS,
                property_definition_id: PLUS_ONES_DEFINITION,
                position: second_key(),
                config: None,
                display_name: Some("Plus Ones".into()),
                infer_type: false,
            },
            definition_id: Uuid::from_u128(0xe8),
            config: None,
            values: vec![(MARIA, PropertyValue::Str("1".into()))],
        },
        views: Vec::new(),
    };
    let before = Before {
        schema: schema(),
        column_cells: BTreeMap::from([(
            PLUS_ONES,
            BTreeMap::from([(MARIA, CellValue::Number(1.0))]),
        )]),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse,
        ChangeInverse {
            ops: vec![
                DatabaseOp::Column {
                    table: GUESTS,
                    column: PLUS_ONES,
                    change: ColumnChange::ChangeType {
                        to: ColumnKind::Number,
                    },
                },
                DatabaseOp::Rows {
                    table: GUESTS,
                    change: RowsChange::Update {
                        changes: RowChanges::PerRow {
                            rows: vec![RowChange {
                                row: MARIA,
                                cells: vec![CellWrite {
                                    column: PLUS_ONES,
                                    value: CellValue::Number(1.0),
                                }],
                            }],
                        },
                    },
                },
            ],
            rebinds: BTreeMap::from([(0, PLUS_ONES_DEFINITION)]),
            ..ChangeInverse::default()
        }
    );
}

#[test]
fn added_options_are_undone_by_deleting_the_options_actually_added() {
    let late = OptionId::from_uuid(Uuid::from_u128(0xa4));
    let op = DatabaseOp::Column {
        table: GUESTS,
        column: RSVP,
        change: ColumnChange::AddOptions {
            options: vec![
                NewOption {
                    id: OptionId::from_uuid(Uuid::from_u128(0xa9)),
                    label: "yes".into(),
                },
                NewOption {
                    id: late,
                    label: "Late".into(),
                },
            ],
        },
    };
    let write = Write::AddOptions {
        table_id: GUESTS,
        tables: vec![GUESTS],
        definition_id: RSVP_DEFINITION,
        options: vec![(late, PropertyOptionValue::String("Late".into()))],
    };
    let before = Before {
        schema: schema(),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse.ops,
        vec![DatabaseOp::Column {
            table: GUESTS,
            column: RSVP,
            change: ColumnChange::DeleteOption { option: late },
        }]
    );
}

#[test]
fn an_option_update_is_undone_by_its_old_label_and_colour() {
    let op = DatabaseOp::Column {
        table: GUESTS,
        column: RSVP,
        change: ColumnChange::UpdateOption {
            option: YES,
            label: Some("Coming".into()),
            color: Some(None),
        },
    };
    let write = Write::UpdateOption {
        table_id: GUESTS,
        tables: vec![GUESTS],
        definition_id: RSVP_DEFINITION,
        option_id: YES,
        value: Some(PropertyOptionValue::String("Coming".into())),
        color: Some(None),
    };
    let before = Before {
        schema: schema(),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse.ops,
        vec![DatabaseOp::Column {
            table: GUESTS,
            column: RSVP,
            change: ColumnChange::UpdateOption {
                option: YES,
                label: Some("Yes".into()),
                color: Some(Some("#00AA00".into())),
            },
        }]
    );
}

#[test]
fn an_option_delete_is_undone_by_the_option_its_colour_and_the_cells_that_held_it() {
    let op = DatabaseOp::Column {
        table: GUESTS,
        column: RSVP,
        change: ColumnChange::DeleteOption { option: NO },
    };
    let write = Write::DeleteOption {
        only_if_unused: false,
        table_id: GUESTS,
        tables: vec![GUESTS],
        definition_id: RSVP_DEFINITION,
        option_id: NO,
        views: Vec::new(),
    };
    let before = Before {
        schema: schema(),
        column_cells: BTreeMap::from([(
            RSVP,
            BTreeMap::from([
                (MARIA, CellValue::Options(vec![OptionRef::Id(YES)])),
                (OMAR, CellValue::Options(vec![OptionRef::Id(NO)])),
            ]),
        )]),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse.ops,
        vec![
            DatabaseOp::Column {
                table: GUESTS,
                column: RSVP,
                change: ColumnChange::AddOptions {
                    options: vec![NewOption {
                        id: NO,
                        label: "No".into(),
                    }],
                },
            },
            DatabaseOp::Column {
                table: GUESTS,
                column: RSVP,
                change: ColumnChange::UpdateOption {
                    option: NO,
                    label: None,
                    color: Some(Some("#AA0000".into())),
                },
            },
            DatabaseOp::Rows {
                table: GUESTS,
                change: RowsChange::Update {
                    changes: RowChanges::PerRow {
                        rows: vec![RowChange {
                            row: OMAR,
                            cells: vec![CellWrite {
                                column: RSVP,
                                value: CellValue::Options(vec![OptionRef::Id(NO)]),
                            }],
                        }],
                    },
                },
            },
        ]
    );
}

#[test]
fn a_view_create_is_undone_by_deleting_the_view() {
    let seating = ViewId::from_uuid(Uuid::from_u128(0xf9));
    let op = DatabaseOp::View {
        table: GUESTS,
        view: seating,
        change: ViewChange::Create {
            view: NewView {
                name: "Seating".into(),
                query: ViewQuery::default(),
                layout: RequestedLayout::Table {
                    columns: Vec::new(),
                },
            },
        },
    };
    let write = Write::DeleteView {
        table_id: GUESTS,
        view_id: seating,
    };
    let before = Before {
        schema: schema(),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse.ops,
        vec![DatabaseOp::View {
            table: GUESTS,
            view: seating,
            change: ViewChange::Delete,
        }]
    );
}

#[test]
fn a_view_update_is_undone_by_its_old_name_query_and_layout() {
    let op = DatabaseOp::View {
        table: GUESTS,
        view: GRID,
        change: ViewChange::Update {
            name: Some("All guests".into()),
            query: None,
            layout: None,
        },
    };
    let [grid, _] = views();
    let write = Write::UpdateView {
        view: DatabaseView {
            name: "All guests".into(),
            ..grid.clone()
        },
        regrouped: false,
    };
    let before = Before {
        schema: schema(),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse.ops,
        vec![DatabaseOp::View {
            table: GUESTS,
            view: GRID,
            change: ViewChange::Update {
                name: Some("Everyone".into()),
                query: Some(grid.query.clone()),
                layout: Some(RequestedLayout::Table {
                    columns: vec![ViewColumn {
                        column: PLUS_ONES,
                        width: Some(80),
                    }],
                }),
            },
        }]
    );
}

#[test]
fn a_view_delete_is_undone_by_creating_it_again_under_its_id_in_its_place() {
    let op = DatabaseOp::View {
        table: GUESTS,
        view: BOARD,
        change: ViewChange::Delete,
    };
    let write = Write::DeleteView {
        table_id: GUESTS,
        view_id: BOARD,
    };
    let before = Before {
        schema: schema(),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse.ops,
        vec![
            DatabaseOp::View {
                table: GUESTS,
                view: BOARD,
                change: ViewChange::Create {
                    view: NewView {
                        name: "By RSVP".into(),
                        query: ViewQuery::default(),
                        layout: RequestedLayout::Board {
                            group_by: RSVP,
                            title: Some(NAME),
                            lanes: Vec::new(),
                            card_fields: Vec::new(),
                            hide_empty_lanes: false,
                        },
                    },
                },
            },
            DatabaseOp::Table {
                table: GUESTS,
                change: TableChange::ReorderViews {
                    order: vec![GRID, BOARD],
                },
            },
        ]
    );
}

#[test]
fn a_card_move_is_undone_by_moving_it_back_between_its_old_neighbours() {
    let ana = RowId::from_uuid(Uuid::from_u128(0xb3));
    let op = DatabaseOp::View {
        table: GUESTS,
        view: BOARD,
        change: ViewChange::MoveCard {
            row: MARIA,
            lane: LaneKey::Option(NO),
            before: None,
            after: None,
        },
    };
    let write = Write::MoveCard {
        table_id: GUESTS,
        view_id: BOARD,
        row: MARIA,
        positions: Vec::new(),
        cell: (
            RSVP_DEFINITION,
            Some(PropertyValue::SelectOption(vec![NO.into_uuid()])),
        ),
    };
    let before = Before {
        schema: schema(),
        rows: guests(),
        cards: BTreeMap::from([(
            BOARD,
            vec![
                CardPosition {
                    row: ana,
                    lane: LaneKey::Option(YES),
                    position: first_key(),
                },
                CardPosition {
                    row: MARIA,
                    lane: LaneKey::Option(YES),
                    position: second_key(),
                },
            ],
        )]),
        ..Before::default()
    };

    let inverse = invert(
        &[Planned {
            op: &op,
            write: &write,
            inserted: &[],
        }],
        &before,
    );

    assert_eq!(
        inverse.ops,
        vec![DatabaseOp::View {
            table: GUESTS,
            view: BOARD,
            change: ViewChange::MoveCard {
                row: MARIA,
                lane: LaneKey::Option(YES),
                before: Some(ana),
                after: None,
            },
        }]
    );
}

#[test]
fn table_creates_renames_and_reorders_are_undone_and_a_table_delete_is_not() {
    let gifts = TableId::from_uuid(Uuid::from_u128(0x12));
    let ops = [
        DatabaseOp::Table {
            table: gifts,
            change: TableChange::Create {
                name: "Gifts".into(),
            },
        },
        DatabaseOp::Table {
            table: GUESTS,
            change: TableChange::Rename {
                name: "People".into(),
                previous_name: None,
            },
        },
        DatabaseOp::ReorderTables {
            order: vec![gifts, VENUES, GUESTS],
        },
        DatabaseOp::Table {
            table: VENUES,
            change: TableChange::Delete,
        },
    ];
    let writes = [
        Write::CreateTable {
            table_id: gifts,
            name: "Gifts".into(),
        },
        Write::RenameTable {
            table_id: GUESTS,
            from: "Guests".into(),
            name: "People".into(),
        },
        Write::OrderTables {
            tables: vec![gifts, VENUES, GUESTS],
            positions: Vec::new(),
        },
        Write::DeleteTable {
            table_id: VENUES,
            version: TableVersion(2),
        },
    ];
    let before = Before {
        schema: schema(),
        ..Before::default()
    };
    let planned: Vec<Planned<'_>> = ops
        .iter()
        .zip(&writes)
        .map(|(op, write)| Planned {
            op,
            write,
            inserted: &[],
        })
        .collect();

    let inverse = invert(&planned, &before);

    assert_eq!(
        inverse.ops,
        vec![
            DatabaseOp::Table {
                table: GUESTS,
                change: TableChange::Rename {
                    name: "Guests".into(),
                    previous_name: Some("People".into()),
                },
            },
            DatabaseOp::Table {
                table: gifts,
                change: TableChange::Delete,
            },
            DatabaseOp::ReorderTables {
                order: vec![GUESTS],
            },
        ]
    );
}

#[test]
fn what_a_batch_creates_and_removes_again_needs_no_inverse() {
    let walk_in = RowId::from_uuid(Uuid::from_u128(0xb9));
    let seats = ColumnId::from_uuid(Uuid::from_u128(0xc9));
    let ops = [
        DatabaseOp::Column {
            table: GUESTS,
            column: seats,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Seats".into(),
                    kind: ColumnKind::Number,
                    options: Vec::new(),
                    infer_type: false,
                },
                after: None,
            },
        },
        DatabaseOp::Rows {
            table: GUESTS,
            change: RowsChange::Insert {
                rows: vec![Vec::new()],
            },
        },
        DatabaseOp::Rows {
            table: GUESTS,
            change: RowsChange::Delete {
                rows: vec![walk_in],
            },
        },
        DatabaseOp::Column {
            table: GUESTS,
            column: seats,
            change: ColumnChange::Delete,
        },
    ];
    let writes = [
        Write::CreateColumn {
            column: Column {
                protections: vec![],
                nullable: true,
                id: seats,
                table_id: GUESTS,
                property_definition_id: Uuid::from_u128(0xe9),
                position: second_key(),
                config: None,
                display_name: None,
                infer_type: false,
            },
            definition: None,
        },
        Write::InsertRows {
            table_id: GUESTS,
            rows: vec![Vec::new()],
            restored: Vec::new(),
        },
        Write::DeleteRows {
            only_if_unreferenced: false,
            table_id: GUESTS,
            rows: vec![walk_in],
        },
        Write::DeleteColumn {
            table_id: GUESTS,
            column_id: seats,
            definition_id: Uuid::from_u128(0xe9),
            views: Vec::new(),
            related: None,
        },
    ];
    let before = Before {
        schema: schema(),
        ..Before::default()
    };
    let inserted = [Vec::new(), vec![walk_in], Vec::new(), Vec::new()];
    let planned: Vec<Planned<'_>> = ops
        .iter()
        .zip(&writes)
        .zip(&inserted)
        .map(|((op, write), inserted)| Planned {
            op,
            write,
            inserted,
        })
        .collect();

    let inverse = invert(&planned, &before);

    assert_eq!(inverse, ChangeInverse::default());
}

#[test]
fn a_tables_changes_fold_each_row_once_as_it_stands_now() {
    let walk_in = RowId::from_uuid(Uuid::from_u128(0xb9));
    let versions = [
        VersionTouches {
            version: TableVersion(8),
            rows: vec![
                (MARIA, RowChangeKind::Insert),
                (walk_in, RowChangeKind::Insert),
            ],
            columns: Vec::new(),
        },
        VersionTouches {
            version: TableVersion(9),
            rows: vec![
                (MARIA, RowChangeKind::Update),
                (OMAR, RowChangeKind::Update),
            ],
            columns: Vec::new(),
        },
        VersionTouches {
            version: TableVersion(10),
            rows: vec![
                (walk_in, RowChangeKind::Delete),
                (OMAR, RowChangeKind::Delete),
            ],
            columns: vec![ColumnTouch {
                column: PLUS_ONES,
                kind: ColumnChangeKind::Delete,
            }],
        },
    ];

    let changes = table_changes(TableVersion(7), &versions);

    assert_eq!(
        changes,
        TableChanges {
            version: TableVersion(10),
            complete: true,
            truncated: false,
            rows: vec![
                TouchedRow {
                    row: MARIA,
                    kind: RowChangeKind::Insert,
                },
                TouchedRow {
                    row: OMAR,
                    kind: RowChangeKind::Delete,
                },
            ],
            columns: vec![TouchedColumn {
                column: PLUS_ONES,
                kind: ColumnChangeKind::Delete,
            }],
        }
    );
}

#[test]
fn a_gap_in_a_tables_journal_makes_its_changes_incomplete() {
    let versions = [VersionTouches {
        version: TableVersion(9),
        rows: vec![(MARIA, RowChangeKind::Update)],
        columns: Vec::new(),
    }];

    let changes = table_changes(TableVersion(7), &versions);

    assert_eq!(
        changes,
        TableChanges {
            version: TableVersion(9),
            complete: false,
            truncated: false,
            rows: vec![TouchedRow {
                row: MARIA,
                kind: RowChangeKind::Update,
            }],
            columns: Vec::new(),
        }
    );
}
