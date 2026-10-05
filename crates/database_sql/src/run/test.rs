use models_databases::{ColumnId, DatabaseId, RowId};
use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{TimeZone, Utc};
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnResult, OptionRef, RowChanges, RowsChange,
    RowsResult, TableVersion,
};

use super::*;
use crate::fold::Cell;
use crate::test_support::{catalog, *};

const ACME: RowId = RowId::from_uuid(Uuid::from_u128(0xa1));
const GLOBEX: RowId = RowId::from_uuid(Uuid::from_u128(0xa2));
const HOOLI: RowId = RowId::from_uuid(Uuid::from_u128(0xa3));
const INITECH: RowId = RowId::from_uuid(Uuid::from_u128(0xa4));
const NEW_ROW: RowId = RowId::from_uuid(Uuid::from_u128(0xb1));
const SECOND_NEW_ROW: RowId = RowId::from_uuid(Uuid::from_u128(0xb2));
const THIRD_NEW_ROW: RowId = RowId::from_uuid(Uuid::from_u128(0xb3));

/// One `page` or `bins` call as the fake saw it: query, needed columns,
/// cursor, limit.
type Asked = (GqlQuery, Vec<Uuid>, Option<String>, usize);

/// A server that holds these rows and answers any query with them, two
/// per page, remembering what it was asked.
struct FakeSource {
    rows: Vec<Row>,
    bins: Vec<Bin>,
    asked: Mutex<Vec<Asked>>,
}

impl RowSource for FakeSource {
    type Error = std::convert::Infallible;

    async fn page(
        &self,
        query: &GqlQuery,
        needs: &[Uuid],
        cursor: Option<String>,
        limit: usize,
    ) -> Result<Page, Self::Error> {
        self.asked
            .lock()
            .unwrap()
            .push((query.clone(), needs.to_vec(), cursor.clone(), limit));
        let start: usize = cursor.map(|c| c.parse().unwrap()).unwrap_or(0);
        let end = (start + 2.min(limit)).min(self.rows.len());
        Ok(Page {
            rows: self.rows[start..end].to_vec(),
            next: (end < self.rows.len()).then(|| end.to_string()),
        })
    }

    async fn bins(&self, query: &GqlQuery) -> Result<Vec<Bin>, Self::Error> {
        self.asked
            .lock()
            .unwrap()
            .push((query.clone(), vec![], None, 0));
        Ok(self.bins.clone())
    }
}

/// A sink's refusal, in the words a server would use.
#[derive(Debug, PartialEq, thiserror::Error)]
#[error("{0}")]
struct Refused(&'static str);

/// A sink that records every batch and answers each op as written, with
/// the rows an insert created taken from `inserted`; it refuses any op the
/// `refuse` test picks.
struct FakeSink {
    applied: Mutex<Vec<(DatabaseId, Vec<DatabaseOp>)>>,
    inserted: Vec<RowId>,
    refuse: fn(&DatabaseOp) -> Option<&'static str>,
}

impl FakeSink {
    fn new() -> Self {
        FakeSink {
            applied: Mutex::new(vec![]),
            inserted: vec![],
            refuse: |_| None,
        }
    }
}

impl OpsSink for FakeSink {
    type Error = Refused;

    async fn apply(
        &self,
        database: DatabaseId,
        ops: Vec<DatabaseOp>,
    ) -> Result<Vec<OpResult>, Self::Error> {
        self.applied.lock().unwrap().push((database, ops.clone()));
        if let Some(reason) = ops.iter().find_map(self.refuse) {
            return Err(Refused(reason));
        }
        Ok(ops
            .iter()
            .map(|op| match op {
                DatabaseOp::Rows { table, change } => OpResult::Rows {
                    table: *table,
                    table_version: TableVersion(8),
                    change: match change {
                        RowsChange::Insert { rows } => RowsResult::Inserted {
                            rows: self.inserted[..rows.len()].to_vec(),
                        },
                        RowsChange::Update {
                            changes: RowChanges::Uniform { rows, .. },
                        } => RowsResult::Updated {
                            affected: rows.len() as u32,
                        },
                        RowsChange::Update {
                            changes: RowChanges::PerRow { rows },
                        } => RowsResult::Updated {
                            affected: rows.len() as u32,
                        },
                        RowsChange::Delete { rows } => RowsResult::Deleted {
                            affected: rows.len() as u32,
                        },
                    },
                },
                DatabaseOp::Column {
                    table,
                    column,
                    change: ColumnChange::ChangeType { .. },
                } => OpResult::Column {
                    table: *table,
                    column: *column,
                    table_version: TableVersion(8),
                    change: ColumnResult::TypeChanged,
                },
                other => panic!("a statement sends no {other:?}"),
            })
            .collect())
    }
}

fn deals() -> Vec<Row> {
    vec![
        Row {
            id: ACME,
            position: None,
            cells: HashMap::from([
                (NAME, Cell::Text("Acme".into())),
                (AMOUNT, Cell::Number(12000.0)),
                (STAGE, Cell::Options(vec![WON])),
            ]),
        },
        Row {
            id: GLOBEX,
            position: None,
            cells: HashMap::from([
                (NAME, Cell::Text("Globex".into())),
                (AMOUNT, Cell::Number(3000.0)),
                (STAGE, Cell::Options(vec![LEAD])),
            ]),
        },
        Row {
            id: HOOLI,
            position: None,
            cells: HashMap::from([
                (NAME, Cell::Text("Hooli".into())),
                (STAGE, Cell::Options(vec![WON])),
                (
                    CLOSED_AT,
                    Cell::Date(Utc.with_ymd_and_hms(2026, 9, 15, 0, 0, 0).unwrap()),
                ),
            ]),
        },
        Row {
            id: INITECH,
            position: None,
            cells: HashMap::from([
                (NAME, Cell::Text("Initech".into())),
                (AMOUNT, Cell::Number(7000.0)),
            ]),
        },
    ]
}

fn source(rows: Vec<Row>) -> FakeSource {
    FakeSource {
        rows,
        bins: vec![],
        asked: Mutex::new(vec![]),
    }
}

#[test]
fn select_pages_to_completion_then_folds() {
    let source = source(deals());
    let sink = FakeSink::new();

    let outcome = pollster::block_on(run(
        &catalog(),
        "SELECT name, amount FROM crm.deals WHERE stage = 'Won' AND amount > 5000 ORDER BY amount DESC",
        &source,
        &sink,
    ))
    .unwrap();

    assert_eq!(
        outcome,
        Outcome {
            columns: vec![
                OutcomeColumn {
                    name: "name".into(),
                    column: Some(NAME),
                    kind: OutcomeKind::Text,
                    table: None,
                },
                OutcomeColumn {
                    name: "amount".into(),
                    column: Some(AMOUNT),
                    kind: OutcomeKind::Number,
                    table: None,
                },
            ],
            // The fake ignores property_filter, so Initech (no stage) comes back too;
            // the residual `amount > 5000` keeps it and drops Globex.
            rows: vec![
                vec![Some(Cell::Text("Acme".into())), Some(Cell::Number(12000.0))],
                vec![
                    Some(Cell::Text("Initech".into())),
                    Some(Cell::Number(7000.0))
                ],
            ],
            row_ids: vec![ACME, INITECH],
            read_tables: vec![DEALS],
            truncated: false,
            inserted_row_ids: vec![],
            changes_applied: 0,
            altered_column: None,
        }
    );

    // Two rows a page: three requests, the last one empty-handed.
    let asked = source.asked.lock().unwrap();
    assert_eq!(asked.len(), 2);
    assert_eq!(asked[0].2, None);
    assert_eq!(asked[1].2, Some("2".into()));
    assert!(
        asked
            .iter()
            .all(|(_, needs, _, _)| *needs == vec![NAME, AMOUNT])
    );
    assert!(sink.applied.lock().unwrap().is_empty());
}

#[test]
fn aggregate_columns_are_named_after_the_statement() {
    let source = source(deals());
    let outcome = pollster::block_on(run(
        &catalog(),
        "SELECT stage, SUM(amount), COUNT(*), MAX(\"closed at\") FROM crm.deals GROUP BY stage ORDER BY stage",
        &source,
        &FakeSink::new(),
    ))
    .unwrap();

    assert_eq!(
        outcome.columns,
        vec![
            OutcomeColumn {
                name: "stage".into(),
                column: Some(STAGE),
                kind: OutcomeKind::Select,
                table: None,
            },
            OutcomeColumn {
                name: "SUM(amount)".into(),
                column: None,
                kind: OutcomeKind::Number,
                table: None,
            },
            OutcomeColumn {
                name: "COUNT(*)".into(),
                column: None,
                kind: OutcomeKind::Number,
                table: None,
            },
            OutcomeColumn {
                name: "MAX(closed at)".into(),
                column: None,
                kind: OutcomeKind::Date,
                table: None,
            },
        ]
    );
    assert_eq!(
        outcome.rows,
        vec![
            vec![
                Some(Cell::Options(vec![LEAD])),
                Some(Cell::Number(3000.0)),
                Some(Cell::Number(1.0)),
                None,
            ],
            vec![
                Some(Cell::Options(vec![WON])),
                Some(Cell::Number(12000.0)),
                Some(Cell::Number(2.0)),
                Some(Cell::Date(
                    Utc.with_ymd_and_hms(2026, 9, 15, 0, 0, 0).unwrap()
                )),
            ],
            vec![
                None,
                Some(Cell::Number(7000.0)),
                Some(Cell::Number(1.0)),
                None
            ],
        ]
    );
    assert_eq!(outcome.row_ids, Vec::<RowId>::new());
}

#[test]
fn aliases_name_the_result_columns_and_order_it() {
    let source = source(deals());
    let outcome = pollster::block_on(run(
        &catalog(),
        "SELECT stage AS \"Stage\", SUM(amount) AS total FROM crm.deals GROUP BY stage ORDER BY total DESC",
        &source,
        &FakeSink::new(),
    ))
    .unwrap();

    assert_eq!(
        outcome.columns,
        vec![
            OutcomeColumn {
                name: "Stage".into(),
                column: Some(STAGE),
                kind: OutcomeKind::Select,
                table: None,
            },
            OutcomeColumn {
                name: "total".into(),
                column: None,
                kind: OutcomeKind::Number,
                table: None,
            },
        ]
    );
    assert_eq!(
        outcome
            .rows
            .iter()
            .map(|row| row[1].clone())
            .collect::<Vec<_>>(),
        vec![
            Some(Cell::Number(12000.0)),
            Some(Cell::Number(7000.0)),
            Some(Cell::Number(3000.0)),
        ]
    );
}

#[test]
fn count_only_groups_ask_for_bins_not_rows() {
    let source = FakeSource {
        rows: deals(),
        bins: vec![
            Bin {
                key: Some(Cell::Options(vec![WON])),
                count: 2,
            },
            Bin {
                key: None,
                count: 1,
            },
        ],
        asked: Mutex::new(vec![]),
    };
    let outcome = pollster::block_on(run(
        &catalog(),
        "SELECT stage, COUNT(*) FROM crm.deals GROUP BY stage",
        &source,
        &FakeSink::new(),
    ))
    .unwrap();

    assert_eq!(
        outcome.rows,
        vec![
            vec![Some(Cell::Options(vec![WON])), Some(Cell::Number(2.0))],
            vec![None, Some(Cell::Number(1.0))],
        ]
    );
    let asked = source.asked.lock().unwrap();
    assert_eq!(asked.len(), 1);
    assert!(matches!(asked[0].0, GqlQuery::GroupSoup { .. }));
}

#[test]
fn the_row_cap_marks_the_answer_truncated() {
    let many: Vec<Row> = (0..ROW_CAP + 5)
        .map(|i| Row {
            id: RowId::from_uuid(Uuid::from_u128(0x1000 + i as u128)),
            position: None,
            cells: HashMap::from([(AMOUNT, Cell::Number(1.0))]),
        })
        .collect();
    let source = FakeSource {
        rows: many,
        bins: vec![],
        asked: Mutex::new(vec![]),
    };
    let outcome = pollster::block_on(run(
        &catalog(),
        "SELECT SUM(amount) FROM crm.deals",
        &source,
        &FakeSink::new(),
    ))
    .unwrap();

    assert!(outcome.truncated);
    assert_eq!(outcome.rows, vec![vec![Some(Cell::Number(ROW_CAP as f64))]]);
    // The engine never asks for more than the cap allows.
    assert!(
        source
            .asked
            .lock()
            .unwrap()
            .iter()
            .all(|(_, _, _, limit)| *limit <= ROW_CAP)
    );
}

#[test]
fn a_source_failure_is_the_outcome_error() {
    #[derive(Debug, PartialEq, thiserror::Error)]
    #[error("gateway timed out")]
    struct GatewayTimedOut;
    struct Broken;
    impl RowSource for Broken {
        type Error = GatewayTimedOut;

        async fn page(
            &self,
            _: &GqlQuery,
            _: &[Uuid],
            _: Option<String>,
            _: usize,
        ) -> Result<Page, Self::Error> {
            Err(GatewayTimedOut)
        }
        async fn bins(&self, _: &GqlQuery) -> Result<Vec<Bin>, Self::Error> {
            Err(GatewayTimedOut)
        }
    }
    let error = pollster::block_on(run(
        &catalog(),
        "SELECT name FROM crm.deals",
        &Broken,
        &FakeSink::new(),
    ))
    .unwrap_err();
    assert_eq!(error, RunFailure::Source(GatewayTimedOut));
    assert_eq!(error.to_string(), "could not read rows");

    let error = pollster::block_on(run(
        &catalog(),
        "SELECT nam FROM crm.deals",
        &Broken,
        &FakeSink::new(),
    ))
    .unwrap_err();
    assert_eq!(
        error.to_string(),
        "unknown column \"nam\" in crm.deals — did you mean \"name\"?"
    );
}

/// What the browser catches: the typed error, tagged by stage (and, for
/// resolution, kind), with the words an agent reads beside it.
#[test]
fn an_error_crosses_as_a_typed_value_with_its_words() {
    let RunFailure::Engine(unknown_column) = pollster::block_on(run(
        &catalog(),
        "SELECT nam FROM crm.deals",
        &source(deals()),
        &FakeSink::new(),
    ))
    .unwrap_err() else {
        panic!("the engine refuses an unknown column");
    };
    assert_eq!(
        serde_json::to_value(EngineError::from(unknown_column)).unwrap(),
        serde_json::json!({
            "error": {
                "stage": "resolve",
                "kind": "unknownColumn",
                "name": "nam",
                "table": "crm.deals",
                "suggestion": "name",
            },
            "message": "unknown column \"nam\" in crm.deals — did you mean \"name\"?",
        })
    );

    let RunFailure::Engine(unparsed) = pollster::block_on(run(
        &catalog(),
        "SELEC name FROM crm.deals",
        &source(deals()),
        &FakeSink::new(),
    ))
    .unwrap_err() else {
        panic!("the engine refuses a statement it cannot parse");
    };
    let wire = serde_json::to_value(EngineError::from(unparsed)).unwrap();
    assert_eq!(wire["error"]["stage"], "parse");
    assert_eq!(
        wire["error"]["span"],
        serde_json::json!({"start": 0, "end": 5})
    );

    assert_eq!(
        serde_json::to_value(RunError::TooManyRows { limit: ROW_CAP }).unwrap(),
        serde_json::json!({"stage": "tooManyRows", "limit": ROW_CAP})
    );
}

#[test]
fn a_view_problem_crosses_tagged_by_its_stage() {
    let problem =
        RunError::from(models_databases::views::ViewProblem::UnknownTable { table: DEALS });

    assert_eq!(
        serde_json::to_value(EngineError::from(problem)).unwrap(),
        serde_json::json!({
            "error": {
                "stage": "view",
                "kind": "unknownTable",
                "table": DEALS,
            },
            "message": format!("no table {DEALS} among the tables you can see"),
        })
    );
}

#[test]
fn an_insert_is_one_op_holding_every_row() {
    let sink = FakeSink {
        inserted: vec![NEW_ROW, SECOND_NEW_ROW, THIRD_NEW_ROW],
        ..FakeSink::new()
    };
    let source = source(deals());
    let outcome = pollster::block_on(run(
        &catalog(),
        "INSERT INTO crm.deals (name, stage) VALUES ('Acme', 'won'), ('Globex', 'Lead'), ('Hooli', NULL)",
        &source,
        &sink,
    ))
    .unwrap();

    assert_eq!(
        outcome,
        Outcome {
            inserted_row_ids: vec![NEW_ROW, SECOND_NEW_ROW, THIRD_NEW_ROW],
            changes_applied: 3,
            ..Outcome::default()
        }
    );
    assert_eq!(
        *sink.applied.lock().unwrap(),
        vec![(
            CRM,
            vec![DatabaseOp::Rows {
                table: DEALS,
                change: RowsChange::Insert {
                    rows: vec![
                        vec![
                            CellWrite {
                                column: ColumnId::from_uuid(NAME),
                                value: CellValue::Text("Acme".into()),
                            },
                            CellWrite {
                                column: ColumnId::from_uuid(STAGE),
                                value: CellValue::Options(vec![OptionRef::Label("Won".into())]),
                            },
                        ],
                        vec![
                            CellWrite {
                                column: ColumnId::from_uuid(NAME),
                                value: CellValue::Text("Globex".into()),
                            },
                            CellWrite {
                                column: ColumnId::from_uuid(STAGE),
                                value: CellValue::Options(vec![OptionRef::Label("Lead".into())]),
                            },
                        ],
                        vec![CellWrite {
                            column: ColumnId::from_uuid(NAME),
                            value: CellValue::Text("Hooli".into()),
                        }],
                    ]
                },
            }],
        )]
    );
    assert!(source.asked.lock().unwrap().is_empty());
}

#[test]
fn update_and_delete_by_row_id_read_the_row_then_write_it() {
    let sink = FakeSink::new();
    let outcome = pollster::block_on(run(
        &catalog(),
        "UPDATE crm.deals SET stage = 'Won', amount = NULL WHERE row_id = '00000000-0000-0000-0000-0000000000a1'",
        &source(deals()),
        &sink,
    ))
    .unwrap();
    assert_eq!(outcome.changes_applied, 1);

    let outcome = pollster::block_on(run(
        &catalog(),
        "DELETE FROM crm.deals WHERE row_id = '00000000-0000-0000-0000-0000000000a2'",
        &source(deals()),
        &sink,
    ))
    .unwrap();
    assert_eq!(outcome.changes_applied, 1);

    assert_eq!(
        *sink.applied.lock().unwrap(),
        vec![
            (
                CRM,
                vec![DatabaseOp::Rows {
                    table: DEALS,
                    change: RowsChange::Update {
                        changes: RowChanges::Uniform {
                            rows: vec![ACME],
                            cells: vec![
                                CellWrite {
                                    column: ColumnId::from_uuid(STAGE),
                                    value: CellValue::Options(vec![OptionRef::Label("Won".into())]),
                                },
                                CellWrite {
                                    column: ColumnId::from_uuid(AMOUNT),
                                    value: CellValue::Clear,
                                },
                            ],
                        }
                    },
                }],
            ),
            (
                CRM,
                vec![DatabaseOp::Rows {
                    table: DEALS,
                    change: RowsChange::Delete { rows: vec![GLOBEX] },
                }],
            ),
        ]
    );
}

#[test]
fn a_where_that_matches_nothing_writes_nothing() {
    let sink = FakeSink::new();
    let outcome = pollster::block_on(run(
        &catalog(),
        "DELETE FROM crm.deals WHERE name = 'Vandelay'",
        &source(deals()),
        &sink,
    ))
    .unwrap();
    assert_eq!(outcome, Outcome::default());
    assert!(sink.applied.lock().unwrap().is_empty());
}

#[test]
fn a_row_named_by_id_that_the_table_lacks_is_refused() {
    let sink = FakeSink::new();
    let error = pollster::block_on(run(
        &catalog(),
        "UPDATE crm.deals SET done = TRUE WHERE row_id IN ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000ff')",
        &source(deals()),
        &sink,
    ))
    .unwrap_err();
    assert_eq!(
        error,
        RunFailure::Engine(RunError::NoSuchRow {
            position: 2,
            row: RowId::from_uuid(Uuid::from_u128(0xff)),
        })
    );
    assert_eq!(
        error.to_string(),
        "row 2: no row 00000000-0000-0000-0000-0000000000ff in this table"
    );
    assert!(sink.applied.lock().unwrap().is_empty());
}

#[test]
fn a_refused_op_is_the_statement_error() {
    let sink = FakeSink {
        refuse: |_| Some("row 2: \"stage\" holds one value; 2 were given"),
        ..FakeSink::new()
    };
    let error = pollster::block_on(run(
        &catalog(),
        "UPDATE crm.deals SET done = TRUE WHERE stage = 'Won'",
        &source(deals()),
        &sink,
    ))
    .unwrap_err();
    assert_eq!(
        error,
        RunFailure::Write(Refused("row 2: \"stage\" holds one value; 2 were given"))
    );
}

#[test]
fn outcome_serializes_camel_case_for_the_wire() {
    let outcome = Outcome {
        columns: vec![OutcomeColumn {
            name: "stage".into(),
            column: Some(STAGE),
            kind: OutcomeKind::Select,
            table: None,
        }],
        rows: vec![vec![Some(Cell::Options(vec![WON])), None]],
        row_ids: vec![ACME],
        read_tables: vec![DEALS],
        truncated: false,
        inserted_row_ids: vec![],
        changes_applied: 0,
        altered_column: None,
    };
    assert_eq!(
        serde_json::to_value(&outcome).unwrap(),
        serde_json::json!({
            "columns": [{ "name": "stage", "column": "00000000-0000-0000-0000-000000000003", "kind": "select" }],
            "rows": [[{ "type": "options", "value": ["00000000-0000-0000-0000-000000000030"] }, null]],
            "rowIds": ["00000000-0000-0000-0000-0000000000a1"],
            "readTables": ["00000000-0000-0000-0000-0000000000d0"],
            "truncated": false,
            "insertedRowIds": [],
            "changesApplied": 0
        })
    );
}

#[test]
fn a_type_change_is_one_op_without_reading_rows() {
    let source = source(deals());
    let sink = FakeSink::new();

    let outcome = pollster::block_on(run(
        &catalog(),
        "ALTER TABLE crm.deals ALTER COLUMN name TYPE number",
        &source,
        &sink,
    ))
    .unwrap();

    assert_eq!(
        outcome,
        Outcome {
            altered_column: Some(AlteredColumn {
                table: DEALS,
                column: NAME,
                to: "number".into(),
            }),
            ..Outcome::default()
        }
    );
    assert_eq!(
        *sink.applied.lock().unwrap(),
        vec![(
            CRM,
            vec![DatabaseOp::Column {
                table: DEALS,
                column: ColumnId::from_uuid(NAME),
                change: ColumnChange::ChangeType {
                    to: models_databases::ColumnKind::Number,
                },
            }],
        )]
    );
    assert!(source.asked.lock().unwrap().is_empty());
}

#[test]
fn a_type_change_the_sink_refuses_is_the_statement_error() {
    let sink = FakeSink {
        refuse: |_| Some("2 values in \"name\" aren't numbers: 'Acme', 'Globex'."),
        ..FakeSink::new()
    };
    let error = pollster::block_on(run(
        &catalog(),
        "ALTER TABLE crm.deals ALTER COLUMN name TYPE number",
        &source(vec![]),
        &sink,
    ))
    .unwrap_err();

    assert_eq!(
        error,
        RunFailure::Write(Refused(
            "2 values in \"name\" aren't numbers: 'Acme', 'Globex'."
        ))
    );
}

/// A sink that answers every op as though it had updated one row.
struct AnswersRowsUpdated;

impl OpsSink for AnswersRowsUpdated {
    type Error = Refused;

    async fn apply(
        &self,
        _: DatabaseId,
        ops: Vec<DatabaseOp>,
    ) -> Result<Vec<OpResult>, Self::Error> {
        Ok(ops
            .iter()
            .map(|_| OpResult::Rows {
                table: DEALS,
                table_version: TableVersion(8),
                change: RowsResult::Updated { affected: 1 },
            })
            .collect())
    }
}

#[test]
fn a_result_of_another_kind_than_the_op_is_refused() {
    let error = pollster::block_on(run(
        &catalog(),
        "ALTER TABLE crm.deals ALTER COLUMN name TYPE number",
        &source(vec![]),
        &AnswersRowsUpdated,
    ))
    .unwrap_err();

    assert_eq!(
        error,
        RunFailure::Engine(RunError::UnexpectedOpResult {
            sent: SentOp::ColumnTypeChange,
            received: OpResultKind::RowsUpdated,
        })
    );
    assert_eq!(
        error.to_string(),
        "a column type change was sent, but rows updated came back"
    );
}
