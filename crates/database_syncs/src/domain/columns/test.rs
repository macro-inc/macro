use uuid::Uuid;

use super::*;
use crate::domain::models::GranolaField;

const TABLE: TableId = TableId::from_uuid(Uuid::from_u128(1));
const TITLE: ColumnId = ColumnId::from_uuid(Uuid::from_u128(10));
const DATE: ColumnId = ColumnId::from_uuid(Uuid::from_u128(11));
const SUMMARY: ColumnId = ColumnId::from_uuid(Uuid::from_u128(12));
const STATUS: ColumnId = ColumnId::from_uuid(Uuid::from_u128(13));
const PLANNED_DONE: OptionId = OptionId::from_uuid(Uuid::from_u128(20));
const PLANNED_DOING: OptionId = OptionId::from_uuid(Uuid::from_u128(21));
const PLANNED_TODO: OptionId = OptionId::from_uuid(Uuid::from_u128(22));
const MACRO_DOING: OptionId = OptionId::from_uuid(Uuid::from_u128(30));

#[test]
fn a_deleted_or_retyped_column_stops_syncing_and_is_not_added_back() {
    let title = SyncField::Granola {
        field: GranolaField::Title,
    };
    let date = SyncField::Granola {
        field: GranolaField::Date,
    };
    let summary = SyncField::Granola {
        field: GranolaField::Summary,
    };

    let changes = reconcile(
        TABLE,
        &[
            SyncedColumn {
                field: title.clone(),
                column: TITLE,
            },
            SyncedColumn {
                field: date.clone(),
                column: DATE,
            },
        ],
        &[DetachedColumn {
            field: summary.clone(),
            column: SUMMARY,
            reason: DetachReason::Deleted,
        }],
        &[TableColumn {
            id: DATE,
            name: "Date".to_string(),
            kind: Some(ColumnKind::Text),
            options: vec![],
        }],
        &[
            WantedColumn {
                field: title.clone(),
                id: TITLE,
                name: "Title".to_string(),
                kind: ColumnKind::Text,
                options: vec![],
            },
            WantedColumn {
                field: date.clone(),
                id: DATE,
                name: "Date".to_string(),
                kind: ColumnKind::Date,
                options: vec![],
            },
            WantedColumn {
                field: summary.clone(),
                id: SUMMARY,
                name: "Summary".to_string(),
                kind: ColumnKind::Text,
                options: vec![],
            },
        ],
    );

    assert_eq!(
        changes,
        ColumnChanges {
            columns: vec![],
            detached: vec![
                DetachedColumn {
                    field: summary,
                    column: SUMMARY,
                    reason: DetachReason::Deleted,
                },
                DetachedColumn {
                    field: title,
                    column: TITLE,
                    reason: DetachReason::Deleted,
                },
                DetachedColumn {
                    field: date,
                    column: DATE,
                    reason: DetachReason::TypeChanged,
                },
            ],
            ops: vec![],
            option_ids: HashMap::new(),
        }
    );
}

#[test]
fn a_new_field_gets_a_column_named_apart_from_the_others() {
    let title = SyncField::Notion {
        property_id: "title".to_string(),
    };
    let notes = SyncField::Notion {
        property_id: "abc".to_string(),
    };

    let changes = reconcile(
        TABLE,
        &[SyncedColumn {
            field: title.clone(),
            column: TITLE,
        }],
        &[],
        &[
            TableColumn {
                id: TITLE,
                name: "Name".to_string(),
                kind: Some(ColumnKind::Text),
                options: vec![],
            },
            TableColumn {
                id: DATE,
                name: "notes".to_string(),
                kind: Some(ColumnKind::Date),
                options: vec![],
            },
        ],
        &[
            WantedColumn {
                field: title.clone(),
                id: TITLE,
                name: "Name".to_string(),
                kind: ColumnKind::Text,
                options: vec![],
            },
            WantedColumn {
                field: notes.clone(),
                id: SUMMARY,
                name: "Notes".to_string(),
                kind: ColumnKind::Text,
                options: vec![],
            },
        ],
    );

    assert_eq!(
        changes,
        ColumnChanges {
            columns: vec![
                SyncedColumn {
                    field: title,
                    column: TITLE,
                },
                SyncedColumn {
                    field: notes,
                    column: SUMMARY,
                },
            ],
            detached: vec![],
            ops: vec![DatabaseOp::Column {
                table: TABLE,
                column: SUMMARY,
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Notes 2".to_string(),
                        kind: ColumnKind::Text,
                        options: vec![],
                        infer_type: false,
                    },
                    after: None,
                },
            }],
            option_ids: HashMap::new(),
        }
    );
}

#[test]
fn a_column_an_unfinished_run_created_is_taken_up_without_creating_it_again() {
    let summary = SyncField::Granola {
        field: GranolaField::Summary,
    };

    let changes = reconcile(
        TABLE,
        &[],
        &[],
        &[TableColumn {
            id: SUMMARY,
            name: "Summary".to_string(),
            kind: Some(ColumnKind::Text),
            options: vec![],
        }],
        &[WantedColumn {
            field: summary.clone(),
            id: SUMMARY,
            name: "Summary".to_string(),
            kind: ColumnKind::Text,
            options: vec![],
        }],
    );

    assert_eq!(
        changes,
        ColumnChanges {
            columns: vec![SyncedColumn {
                field: summary,
                column: SUMMARY,
            }],
            detached: vec![],
            ops: vec![],
            option_ids: HashMap::new(),
        }
    );
}

#[test]
fn a_select_gains_the_options_it_lacks_and_reuses_one_with_the_same_label() {
    let status = SyncField::Notion {
        property_id: "st".to_string(),
    };

    let changes = reconcile(
        TABLE,
        &[SyncedColumn {
            field: status.clone(),
            column: STATUS,
        }],
        &[],
        &[TableColumn {
            id: STATUS,
            name: "Status".to_string(),
            kind: Some(ColumnKind::Select { multi: false }),
            options: vec![
                (PLANNED_DONE, "Finished".to_string()),
                (MACRO_DOING, "doing".to_string()),
            ],
        }],
        &[WantedColumn {
            field: status.clone(),
            id: STATUS,
            name: "Status".to_string(),
            kind: ColumnKind::Select { multi: false },
            options: vec![
                NewOption {
                    id: PLANNED_DONE,
                    label: "Done".to_string(),
                },
                NewOption {
                    id: PLANNED_DOING,
                    label: "Doing".to_string(),
                },
                NewOption {
                    id: PLANNED_TODO,
                    label: "To do".to_string(),
                },
            ],
        }],
    );

    assert_eq!(
        changes,
        ColumnChanges {
            columns: vec![SyncedColumn {
                field: status,
                column: STATUS,
            }],
            detached: vec![],
            ops: vec![DatabaseOp::Column {
                table: TABLE,
                column: STATUS,
                change: ColumnChange::AddOptions {
                    options: vec![NewOption {
                        id: PLANNED_TODO,
                        label: "To do".to_string(),
                    }],
                },
            }],
            option_ids: HashMap::from([(PLANNED_DOING, MACRO_DOING)]),
        }
    );
}

#[test]
fn a_new_table_creates_every_wanted_column_with_its_options() {
    let status = SyncField::Notion {
        property_id: "st".to_string(),
    };

    let changes = reconcile(
        TABLE,
        &[],
        &[],
        &[],
        &[WantedColumn {
            field: status.clone(),
            id: STATUS,
            name: "Status".to_string(),
            kind: ColumnKind::Select { multi: true },
            options: vec![NewOption {
                id: PLANNED_DONE,
                label: "Done".to_string(),
            }],
        }],
    );

    assert_eq!(
        changes,
        ColumnChanges {
            columns: vec![SyncedColumn {
                field: status,
                column: STATUS,
            }],
            detached: vec![],
            ops: vec![DatabaseOp::Column {
                table: TABLE,
                column: STATUS,
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Status".to_string(),
                        kind: ColumnKind::Select { multi: true },
                        options: vec![NewOption {
                            id: PLANNED_DONE,
                            label: "Done".to_string(),
                        }],
                        infer_type: false,
                    },
                    after: None,
                },
            }],
            option_ids: HashMap::new(),
        }
    );
}
