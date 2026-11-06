use models_databases::{CellValue, ColumnId};
use uuid::Uuid;

use super::*;

const TITLE: ColumnId = ColumnId::from_uuid(Uuid::from_u128(1));
const KICKOFF_ROW: RowId = RowId::from_uuid(Uuid::from_u128(100));
const REVIEW_ROW: RowId = RowId::from_uuid(Uuid::from_u128(101));

#[test]
fn a_new_source_row_is_inserted_and_an_unchanged_one_left_alone() {
    let kickoff = vec![CellWrite {
        column: TITLE,
        value: CellValue::Text("Kickoff".to_string()),
    }];
    let review = vec![CellWrite {
        column: TITLE,
        value: CellValue::Text("Review".to_string()),
    }];
    let mappings = vec![RowMapping {
        external_id: "kickoff".to_string(),
        row_id: KICKOFF_ROW,
        fingerprint: Some(fingerprint(&kickoff)),
    }];

    let planned = plan(
        &mappings,
        &HashSet::from([KICKOFF_ROW]),
        vec![
            SourceRow {
                external_id: "kickoff".to_string(),
                cells: kickoff,
            },
            SourceRow {
                external_id: "review".to_string(),
                cells: review.clone(),
            },
        ],
        true,
    );

    assert_eq!(
        planned,
        SyncPlan {
            inserts: vec![RowInsert {
                external_id: "review".to_string(),
                row_id: None,
                fingerprint: fingerprint(&review),
                cells: review,
            }],
            updates: vec![],
            deletes: vec![],
        }
    );
}

#[test]
fn a_changed_source_row_rewrites_its_row() {
    let before = vec![CellWrite {
        column: TITLE,
        value: CellValue::Text("Kickoff".to_string()),
    }];
    let after = vec![CellWrite {
        column: TITLE,
        value: CellValue::Clear,
    }];
    let mappings = vec![RowMapping {
        external_id: "kickoff".to_string(),
        row_id: KICKOFF_ROW,
        fingerprint: Some(fingerprint(&before)),
    }];

    let planned = plan(
        &mappings,
        &HashSet::from([KICKOFF_ROW]),
        vec![SourceRow {
            external_id: "kickoff".to_string(),
            cells: after.clone(),
        }],
        true,
    );

    assert_eq!(
        planned,
        SyncPlan {
            inserts: vec![],
            updates: vec![RowUpdate {
                external_id: "kickoff".to_string(),
                row_id: KICKOFF_ROW,
                fingerprint: fingerprint(&after),
                cells: after,
            }],
            deletes: vec![],
        }
    );
}

#[test]
fn a_complete_read_deletes_the_rows_the_source_lost() {
    let mappings = vec![
        RowMapping {
            external_id: "kickoff".to_string(),
            row_id: KICKOFF_ROW,
            fingerprint: Some([1; 32]),
        },
        RowMapping {
            external_id: "review".to_string(),
            row_id: REVIEW_ROW,
            fingerprint: Some([2; 32]),
        },
    ];

    let planned = plan(&mappings, &HashSet::from([KICKOFF_ROW]), vec![], true);

    assert_eq!(
        planned,
        SyncPlan {
            inserts: vec![],
            updates: vec![],
            deletes: vec![
                RowDelete {
                    external_id: "kickoff".to_string(),
                    row_id: Some(KICKOFF_ROW),
                },
                RowDelete {
                    external_id: "review".to_string(),
                    row_id: None,
                },
            ],
        }
    );
}

#[test]
fn an_incomplete_read_deletes_nothing() {
    let mappings = vec![RowMapping {
        external_id: "kickoff".to_string(),
        row_id: KICKOFF_ROW,
        fingerprint: Some([1; 32]),
    }];

    let planned = plan(&mappings, &HashSet::from([KICKOFF_ROW]), vec![], false);

    assert_eq!(planned, SyncPlan::default());
}

#[test]
fn an_unfinished_insert_is_rewritten_when_its_row_exists_and_retried_under_its_id_when_not() {
    let kickoff = vec![CellWrite {
        column: TITLE,
        value: CellValue::Text("Kickoff".to_string()),
    }];
    let review = vec![CellWrite {
        column: TITLE,
        value: CellValue::Text("Review".to_string()),
    }];
    let mappings = vec![
        RowMapping {
            external_id: "kickoff".to_string(),
            row_id: KICKOFF_ROW,
            fingerprint: None,
        },
        RowMapping {
            external_id: "review".to_string(),
            row_id: REVIEW_ROW,
            fingerprint: None,
        },
    ];

    let planned = plan(
        &mappings,
        &HashSet::from([KICKOFF_ROW]),
        vec![
            SourceRow {
                external_id: "kickoff".to_string(),
                cells: kickoff.clone(),
            },
            SourceRow {
                external_id: "review".to_string(),
                cells: review.clone(),
            },
        ],
        true,
    );

    assert_eq!(
        planned,
        SyncPlan {
            inserts: vec![RowInsert {
                external_id: "review".to_string(),
                row_id: Some(REVIEW_ROW),
                fingerprint: fingerprint(&review),
                cells: review,
            }],
            updates: vec![RowUpdate {
                external_id: "kickoff".to_string(),
                row_id: KICKOFF_ROW,
                fingerprint: fingerprint(&kickoff),
                cells: kickoff,
            }],
            deletes: vec![],
        }
    );
}

#[test]
fn a_row_deleted_in_macro_comes_back_as_a_new_row() {
    let kickoff = vec![CellWrite {
        column: TITLE,
        value: CellValue::Text("Kickoff".to_string()),
    }];
    let mappings = vec![RowMapping {
        external_id: "kickoff".to_string(),
        row_id: KICKOFF_ROW,
        fingerprint: Some(fingerprint(&kickoff)),
    }];

    let planned = plan(
        &mappings,
        &HashSet::new(),
        vec![SourceRow {
            external_id: "kickoff".to_string(),
            cells: kickoff.clone(),
        }],
        true,
    );

    assert_eq!(
        planned,
        SyncPlan {
            inserts: vec![RowInsert {
                external_id: "kickoff".to_string(),
                row_id: None,
                fingerprint: fingerprint(&kickoff),
                cells: kickoff,
            }],
            updates: vec![],
            deletes: vec![],
        }
    );
}

#[test]
fn a_source_row_listed_twice_is_written_once() {
    let first = vec![CellWrite {
        column: TITLE,
        value: CellValue::Text("Kickoff".to_string()),
    }];
    let second = vec![CellWrite {
        column: TITLE,
        value: CellValue::Text("Kickoff again".to_string()),
    }];

    let planned = plan(
        &[],
        &HashSet::new(),
        vec![
            SourceRow {
                external_id: "kickoff".to_string(),
                cells: first.clone(),
            },
            SourceRow {
                external_id: "kickoff".to_string(),
                cells: second,
            },
        ],
        true,
    );

    assert_eq!(
        planned,
        SyncPlan {
            inserts: vec![RowInsert {
                external_id: "kickoff".to_string(),
                row_id: None,
                fingerprint: fingerprint(&first),
                cells: first,
            }],
            updates: vec![],
            deletes: vec![],
        }
    );
}
