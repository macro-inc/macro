//! Transcripts of the engine answering statements, checked in as JSON under
//! `fixtures/transcripts/`: every step the engine takes and the page, bins
//! or op results fed back. The browser driver's tests replay the reads
//! against its source, so both sides agree on what crosses the wasm
//! boundary; writes are driven on the server.

use models_databases::position::Position;
use models_databases::{ColumnId, DatabaseId, OptionId, RowId, TableId};
use std::collections::HashMap;

use serde_json::{Value, json};

use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnKind as ColumnType, ColumnResult, DatabaseOp,
    OpResult, OptionRef, RowChange, RowChanges, RowsChange, RowsResult, TableVersion,
};

use super::*;
use crate::catalog::{Column, ColumnKind, EntityKind, SelectOption, Table, TableSource};

const CRM: DatabaseId =
    DatabaseId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000db01));
const DEALS: TableId = TableId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000d001));
const PEOPLE: TableId = TableId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000d002));
const NAME: Uuid = Uuid::from_u128(0x01990000_0000_7000_8000_00000000c001);
const AMOUNT: Uuid = Uuid::from_u128(0x01990000_0000_7000_8000_00000000c002);
const STAGE: Uuid = Uuid::from_u128(0x01990000_0000_7000_8000_00000000c003);
const OWNER: Uuid = Uuid::from_u128(0x01990000_0000_7000_8000_00000000c004);
const PITCH: Uuid = Uuid::from_u128(0x01990000_0000_7000_8000_00000000c005);
// Writes name column placements, which differ from the definitions reads key
// cells by.
const NAME_COLUMN: ColumnId =
    ColumnId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000b001));
const AMOUNT_COLUMN: ColumnId =
    ColumnId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000b002));
const STAGE_COLUMN: ColumnId =
    ColumnId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000b003));
const OWNER_COLUMN: ColumnId =
    ColumnId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000b004));
const PEOPLE_NAME_COLUMN: ColumnId =
    ColumnId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000b005));
const PITCH_COLUMN: ColumnId =
    ColumnId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000b006));
const LEAD: OptionId = OptionId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000a001));
const WON: OptionId = OptionId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000a002));
const ACME: RowId = RowId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000e001));
const GLOBEX: RowId = RowId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000e002));
const INITECH: RowId = RowId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000e003));
const HOOLI: RowId = RowId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000e004));
const VANDELAY: RowId = RowId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000e005));
const SAM: RowId = RowId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000f001));
const ANA: RowId = RowId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000f002));

/// `crm.deals` (texts, a number, a single select, a relation to people)
/// and `crm.people`, sharing the `name` definition, as the browser builds
/// the catalog from a database's detail.
fn crm() -> Catalog {
    Catalog {
        tables: vec![
            Table {
                id: DEALS,
                database_id: CRM,
                database: "crm".into(),
                name: "deals".into(),
                columns: vec![
                    Column {
                        id: NAME,
                        placement: NAME_COLUMN,
                        name: "name".into(),
                        kind: ColumnKind::Text,
                    },
                    Column {
                        id: AMOUNT,
                        placement: AMOUNT_COLUMN,
                        name: "amount".into(),
                        kind: ColumnKind::Number,
                    },
                    Column {
                        id: STAGE,
                        placement: STAGE_COLUMN,
                        name: "stage".into(),
                        kind: ColumnKind::Select {
                            multi: false,
                            options: vec![
                                SelectOption {
                                    id: LEAD,
                                    label: "Lead".into(),
                                },
                                SelectOption {
                                    id: WON,
                                    label: "Won".into(),
                                },
                            ],
                        },
                    },
                    Column {
                        id: OWNER,
                        placement: OWNER_COLUMN,
                        name: "owner".into(),
                        kind: ColumnKind::Entity {
                            multi: true,
                            target: EntityKind::Row,
                        },
                    },
                    Column {
                        id: PITCH,
                        placement: PITCH_COLUMN,
                        name: "pitch".into(),
                        kind: ColumnKind::Text,
                    },
                ],
                source: TableSource::Database,
            },
            Table {
                id: PEOPLE,
                database_id: CRM,
                database: "crm".into(),
                name: "people".into(),
                columns: vec![Column {
                    id: NAME,
                    placement: PEOPLE_NAME_COLUMN,
                    name: "name".into(),
                    kind: ColumnKind::Text,
                }],
                source: TableSource::Database,
            },
        ],
    }
}

/// What the driver feeds back for one step.
enum Feed {
    Page(Page),
    Bins(Vec<Bin>),
    Results(Vec<OpResult>),
}

/// Run `sql`, answering the engine's steps in order with `feeds`.
fn transcript(sql: &str, feeds: Vec<Feed>) -> Value {
    let catalog = crm();
    let (mut engine, mut step) = Engine::start(&catalog, sql).unwrap();
    let mut exchanges = Vec::new();
    for feed in feeds {
        let next = match (&step, &feed) {
            (Step::Fetch(request), Feed::Page(page)) => {
                engine.feed_page(request.id, page.clone()).unwrap()
            }
            (Step::Bins(request), Feed::Bins(bins)) => {
                engine.feed_bins(request.id, bins.clone()).unwrap()
            }
            (Step::Ops { id, .. }, Feed::Results(results)) => {
                engine.feed_ops(*id, results.clone()).unwrap()
            }
            (step, _) => panic!("the engine asked for {step:?}"),
        };
        exchanges.push(match feed {
            Feed::Page(page) => json!({ "step": step, "page": page }),
            Feed::Bins(bins) => json!({ "step": step, "bins": bins }),
            Feed::Results(results) => json!({ "step": step, "results": results }),
        });
        step = next;
    }
    let Step::Done(outcome) = step else {
        panic!("the engine still wants {step:?}")
    };
    json!({ "catalog": catalog, "sql": sql, "exchanges": exchanges, "outcome": outcome })
}

fn fixture(name: &str) -> Value {
    let path = format!(
        "{}/fixtures/transcripts/{name}.json",
        env!("CARGO_MANIFEST_DIR")
    );

    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

fn deal(
    id: RowId,
    position: &str,
    name: &str,
    amount: f64,
    stage: OptionId,
    owner: Option<RowId>,
) -> Row {
    let mut cells = HashMap::from([
        (NAME, Cell::Text(name.into())),
        (AMOUNT, Cell::Number(amount)),
        (STAGE, Cell::Options(vec![stage])),
    ]);
    if let Some(owner) = owner {
        cells.insert(OWNER, Cell::Entities(vec![owner.to_string()]));
    }
    Row {
        id,
        position: Some(position.parse().unwrap()),
        cells,
    }
}

#[test]
fn a_select_column_filter_is_one_soup_query() {
    assert_eq!(
        transcript(
            "SELECT name, amount FROM crm.deals WHERE stage = 'Won' ORDER BY amount DESC",
            vec![Feed::Page(Page {
                rows: vec![
                    deal(ACME, "80", "Acme", 12000.0, WON, Some(SAM)),
                    deal(GLOBEX, "8180", "Globex", 50000.0, WON, None),
                ],
                next: None,
            })],
        ),
        fixture("select-column-filter")
    );
}

#[test]
fn a_count_per_select_option_is_answered_by_bins() {
    assert_eq!(
        transcript(
            "SELECT stage, COUNT(*) FROM crm.deals GROUP BY stage",
            vec![Feed::Bins(vec![
                Bin {
                    key: Some(Cell::Options(vec![WON])),
                    count: 2,
                },
                Bin {
                    key: Some(Cell::Options(vec![LEAD])),
                    count: 1,
                },
                Bin {
                    key: None,
                    count: 4,
                },
            ])],
        ),
        fixture("count-per-option")
    );
}

#[test]
fn a_join_asks_for_the_joined_rows_it_needs() {
    assert_eq!(
        transcript(
            "SELECT d.name, p.name FROM crm.deals d JOIN crm.people p ON d.owner = p.row_id",
            vec![
                Feed::Page(Page {
                    rows: vec![
                        deal(ACME, "80", "Acme", 12000.0, WON, Some(SAM)),
                        deal(INITECH, "8280", "Initech", 300.0, LEAD, None),
                    ],
                    next: None,
                }),
                Feed::Page(Page {
                    rows: vec![Row {
                        id: SAM,
                        position: Some("80".parse::<Position>().unwrap()),
                        cells: HashMap::from([(NAME, Cell::Text("Sam".into()))]),
                    }],
                    next: None,
                }),
            ],
        ),
        fixture("join")
    );
}

#[test]
fn where_on_a_left_joined_table_applies_after_the_join() {
    let person = |id: RowId, name: &str, position: &str| Row {
        id,
        position: Some(position.parse().unwrap()),
        cells: HashMap::from([(NAME, Cell::Text(name.into()))]),
    };
    assert_eq!(
        transcript(
            "SELECT p.name, d.name FROM crm.people p LEFT JOIN crm.deals d ON p.row_id = d.owner
             WHERE d.stage = 'Won'",
            vec![
                Feed::Page(Page {
                    rows: vec![person(SAM, "Sam", "80"), person(ANA, "Ana", "8180")],
                    next: None,
                }),
                Feed::Page(Page {
                    rows: vec![
                        deal(ACME, "80", "Acme", 12000.0, WON, Some(SAM)),
                        deal(INITECH, "8280", "Initech", 300.0, LEAD, Some(ANA)),
                    ],
                    next: None,
                }),
            ],
        ),
        fixture("left-join-where")
    );
}

#[test]
fn pages_follow_the_cursor_to_the_end() {
    assert_eq!(
        transcript(
            "SELECT name FROM crm.deals",
            vec![
                Feed::Page(Page {
                    rows: vec![deal(ACME, "80", "Acme", 12000.0, WON, Some(SAM))],
                    next: Some("second-page".into()),
                }),
                Feed::Page(Page {
                    rows: vec![deal(GLOBEX, "8180", "Globex", 50000.0, WON, None)],
                    next: None,
                }),
            ],
        ),
        fixture("paging")
    );
}

#[test]
fn row_position_orders_rows_fed_newest_first() {
    assert_eq!(
        transcript(
            "SELECT name FROM crm.deals ORDER BY stage, row_position",
            vec![Feed::Page(Page {
                rows: vec![
                    deal(INITECH, "8280", "Initech", 300.0, LEAD, None),
                    deal(GLOBEX, "8180", "Globex", 50000.0, WON, None),
                    deal(ACME, "80", "Acme", 12000.0, WON, Some(SAM)),
                ],
                next: None,
            })],
        ),
        fixture("row-position")
    );
}

/// The deals `crm.deals` holds for the writes below.
fn deals() -> Page {
    Page {
        rows: vec![
            deal(ACME, "80", "Acme", 12000.0, WON, Some(SAM)),
            deal(GLOBEX, "8180", "Globex", 50000.0, WON, None),
            deal(INITECH, "8280", "Initech", 300.0, LEAD, None),
        ],
        next: None,
    }
}

#[test]
fn an_insert_of_two_rows_is_one_op() {
    let transcript = transcript(
        "INSERT INTO crm.deals (name, amount, stage) VALUES ('Hooli', 900, 'Lead'), ('Vandelay', NULL, 'won')",
        vec![Feed::Results(vec![OpResult::Rows {
            table: DEALS,
            table_version: TableVersion(7),
            change: RowsResult::Inserted {
                rows: vec![HOOLI, VANDELAY],
            },
        }])],
    );

    assert_eq!(
        transcript["exchanges"][0]["step"],
        json!(Step::Ops {
            id: 0,
            database: CRM,
            ops: vec![DatabaseOp::Rows {
                table: DEALS,
                change: RowsChange::Insert {
                    rows: vec![
                        vec![
                            CellWrite {
                                column: NAME_COLUMN,
                                value: CellValue::Text("Hooli".into()),
                            },
                            CellWrite {
                                column: AMOUNT_COLUMN,
                                value: CellValue::Number(900.0),
                            },
                            CellWrite {
                                column: STAGE_COLUMN,
                                value: CellValue::Options(vec![OptionRef::Label("Lead".into())]),
                            },
                        ],
                        vec![
                            CellWrite {
                                column: NAME_COLUMN,
                                value: CellValue::Text("Vandelay".into()),
                            },
                            CellWrite {
                                column: STAGE_COLUMN,
                                value: CellValue::Options(vec![OptionRef::Label("Won".into())]),
                            },
                        ],
                    ]
                },
            }],
        })
    );
    assert_eq!(transcript, fixture("insert-two-rows"));
}

#[test]
fn an_update_with_literal_values_sets_the_same_cells_on_every_matching_row() {
    let transcript = transcript(
        "UPDATE crm.deals SET stage = 'Lead', pitch = NULL WHERE amount > 10000",
        vec![
            Feed::Page(deals()),
            Feed::Results(vec![OpResult::Rows {
                table: DEALS,
                table_version: TableVersion(8),
                change: RowsResult::Updated { affected: 2 },
            }]),
        ],
    );

    assert_eq!(
        transcript["exchanges"][1]["step"],
        json!(Step::Ops {
            id: 1,
            database: CRM,
            ops: vec![DatabaseOp::Rows {
                table: DEALS,
                change: RowsChange::Update {
                    changes: RowChanges::Uniform {
                        rows: vec![ACME, GLOBEX],
                        cells: vec![
                            CellWrite {
                                column: STAGE_COLUMN,
                                value: CellValue::Options(vec![OptionRef::Label("Lead".into())]),
                            },
                            CellWrite {
                                column: PITCH_COLUMN,
                                value: CellValue::Clear,
                            },
                        ],
                    }
                },
            }],
        })
    );
    assert_eq!(transcript, fixture("update-uniform"));
}

#[test]
fn an_update_that_copies_a_column_gives_each_row_its_own_cells() {
    let transcript = transcript(
        "UPDATE crm.deals SET pitch = name, stage = 'Lead' WHERE stage = 'Won'",
        vec![
            Feed::Page(Page {
                rows: vec![
                    deal(ACME, "80", "Acme", 12000.0, WON, Some(SAM)),
                    deal(GLOBEX, "8180", "Globex", 50000.0, WON, None),
                ],
                next: None,
            }),
            Feed::Results(vec![OpResult::Rows {
                table: DEALS,
                table_version: TableVersion(9),
                change: RowsResult::Updated { affected: 2 },
            }]),
        ],
    );

    assert_eq!(
        transcript["exchanges"][1]["step"],
        json!(Step::Ops {
            id: 1,
            database: CRM,
            ops: vec![DatabaseOp::Rows {
                table: DEALS,
                change: RowsChange::Update {
                    changes: RowChanges::PerRow {
                        rows: vec![
                            RowChange {
                                row: ACME,
                                cells: vec![
                                    CellWrite {
                                        column: PITCH_COLUMN,
                                        value: CellValue::Text("Acme".into()),
                                    },
                                    CellWrite {
                                        column: STAGE_COLUMN,
                                        value: CellValue::Options(vec![OptionRef::Label(
                                            "Lead".into()
                                        )]),
                                    },
                                ],
                            },
                            RowChange {
                                row: GLOBEX,
                                cells: vec![
                                    CellWrite {
                                        column: PITCH_COLUMN,
                                        value: CellValue::Text("Globex".into()),
                                    },
                                    CellWrite {
                                        column: STAGE_COLUMN,
                                        value: CellValue::Options(vec![OptionRef::Label(
                                            "Lead".into()
                                        )]),
                                    },
                                ],
                            },
                        ],
                    }
                },
            }],
        })
    );
    assert_eq!(transcript, fixture("update-per-row"));
}

#[test]
fn a_delete_with_a_where_removes_every_matching_row_in_one_op() {
    let transcript = transcript(
        "DELETE FROM crm.deals WHERE amount < 1000",
        vec![
            Feed::Page(deals()),
            Feed::Results(vec![OpResult::Rows {
                table: DEALS,
                table_version: TableVersion(10),
                change: RowsResult::Deleted { affected: 1 },
            }]),
        ],
    );

    assert_eq!(
        transcript["exchanges"][1]["step"],
        json!(Step::Ops {
            id: 1,
            database: CRM,
            ops: vec![DatabaseOp::Rows {
                table: DEALS,
                change: RowsChange::Delete {
                    rows: vec![INITECH],
                },
            }],
        })
    );
    assert_eq!(transcript, fixture("delete-where"));
}

#[test]
fn an_alter_column_is_one_type_change_op() {
    let transcript = transcript(
        "ALTER TABLE crm.deals ALTER COLUMN amount TYPE text",
        vec![Feed::Results(vec![OpResult::Column {
            table: DEALS,
            column: AMOUNT_COLUMN,
            table_version: TableVersion(11),
            change: ColumnResult::TypeChanged,
        }])],
    );

    assert_eq!(
        transcript["exchanges"][0]["step"],
        json!(Step::Ops {
            id: 0,
            database: CRM,
            ops: vec![DatabaseOp::Column {
                table: DEALS,
                column: AMOUNT_COLUMN,
                change: ColumnChange::ChangeType {
                    to: ColumnType::Text,
                },
            }],
        })
    );
    assert_eq!(transcript, fixture("alter-column"));
}
