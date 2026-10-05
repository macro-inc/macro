use models_databases::position::Position;
use models_databases::{DatabaseId, OptionId, RowId};
use std::collections::HashMap;

mod transcripts;

use filter_ast::Expr;
use item_filters::ast::properties::{PropertiesLiteral, PropertyMatchValue};

use super::*;
use crate::catalog::{PEOPLE_EMAIL, PEOPLE_ID, PEOPLE_NAME, PEOPLE_TABLE};
use crate::fold::Cell;
use crate::resolve::column_key;
use crate::run::{OpsSink, OutcomeKind, RowSource, run};
use crate::test_support::{catalog, *};

const FIX_LOGIN: RowId = RowId::from_uuid(Uuid::from_u128(0xe1));
const WRITE_DOCS: RowId = RowId::from_uuid(Uuid::from_u128(0xe2));
const SHIP_IT: RowId = RowId::from_uuid(Uuid::from_u128(0xe3));
const IDLE: RowId = RowId::from_uuid(Uuid::from_u128(0xe4));
const ACME: RowId = RowId::from_uuid(Uuid::from_u128(0xa1));
const GLOBEX: RowId = RowId::from_uuid(Uuid::from_u128(0xa2));
const SAM: &str = "macro|sam@example.com";
const ANA: &str = "macro|ana@example.com";
const KIM: &str = "macro|kim@example.com";

/// Sam and Ana share the high-priority login fix; Kim has a low one; the
/// idle task has no one and no deal.
fn tasks() -> Vec<Row> {
    vec![
        Row {
            id: FIX_LOGIN,
            position: None,
            cells: HashMap::from([
                (TITLE, Cell::Text("Fix login".into())),
                (PRIORITY, Cell::Options(vec![HIGH])),
                (ASSIGNEES, Cell::Entities(vec![SAM.into(), ANA.into()])),
                (DEAL, Cell::Entities(vec![ACME.to_string()])),
            ]),
        },
        Row {
            id: WRITE_DOCS,
            position: None,
            cells: HashMap::from([
                (TITLE, Cell::Text("Write docs".into())),
                (PRIORITY, Cell::Options(vec![LOW])),
                (ASSIGNEES, Cell::Entities(vec![KIM.into()])),
            ]),
        },
        Row {
            id: SHIP_IT,
            position: None,
            cells: HashMap::from([
                (TITLE, Cell::Text("Ship it".into())),
                (PRIORITY, Cell::Options(vec![HIGH])),
                (ASSIGNEES, Cell::Entities(vec![SAM.into()])),
                (DEAL, Cell::Entities(vec![GLOBEX.to_string()])),
            ]),
        },
        Row {
            id: IDLE,
            position: None,
            cells: HashMap::from([
                (TITLE, Cell::Text("Idle".into())),
                (PRIORITY, Cell::Options(vec![HIGH])),
                (ASSIGNEES, Cell::Entities(vec![])),
            ]),
        },
    ]
}

/// People as the driver would key them for the second relation.
fn people() -> Vec<Row> {
    vec![
        Row {
            id: RowId::from_uuid(Uuid::new_v5(&Uuid::NAMESPACE_OID, SAM.as_bytes())),
            position: None,
            cells: HashMap::from([
                (column_key(1, PEOPLE_ID), Cell::Entities(vec![SAM.into()])),
                (column_key(1, PEOPLE_NAME), Cell::Text("Sam".into())),
                (
                    column_key(1, PEOPLE_EMAIL),
                    Cell::Text("sam@example.com".into()),
                ),
            ]),
        },
        Row {
            id: RowId::from_uuid(Uuid::new_v5(&Uuid::NAMESPACE_OID, ANA.as_bytes())),
            position: None,
            cells: HashMap::from([
                (column_key(1, PEOPLE_ID), Cell::Entities(vec![ANA.into()])),
                (column_key(1, PEOPLE_NAME), Cell::Text("Ana".into())),
                (
                    column_key(1, PEOPLE_EMAIL),
                    Cell::Text("ana@example.com".into()),
                ),
            ]),
        },
        Row {
            id: RowId::from_uuid(Uuid::new_v5(&Uuid::NAMESPACE_OID, KIM.as_bytes())),
            position: None,
            cells: HashMap::from([
                (column_key(1, PEOPLE_ID), Cell::Entities(vec![KIM.into()])),
                (column_key(1, PEOPLE_NAME), Cell::Text("Kim".into())),
                (
                    column_key(1, PEOPLE_EMAIL),
                    Cell::Text("kim@example.com".into()),
                ),
            ]),
        },
    ]
}

/// Deals keyed by definition, as a source reads them: Acme is won,
/// Globex a lead.
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
                (AMOUNT, Cell::Number(50.0)),
                (STAGE, Cell::Options(vec![LEAD])),
            ]),
        },
    ]
}

/// Serve every request from `serve`, one page each, noting each request.
fn drive(
    catalog: &Catalog,
    sql: &str,
    serve: impl Fn(&GqlQuery) -> Vec<Row>,
) -> (Outcome, Vec<Request>) {
    let (mut engine, mut step) = Engine::start(catalog, sql).unwrap();
    let mut requests = Vec::new();
    loop {
        step = match step {
            Step::Done(outcome) => return (outcome, requests),
            Step::Fetch(request) => {
                let rows = serve(&request.query);
                let id = request.id;
                requests.push(request);
                engine.feed_page(id, Page { rows, next: None }).unwrap()
            }
            Step::Bins(_) => panic!("no bins here"),
            Step::Ops { .. } => panic!("no writes here"),
        };
    }
}

/// Serve each table's rows, applying the pushed-down `propf` as Soup would.
fn by_table(query: &GqlQuery) -> Vec<Row> {
    let (rows, property_filter) = match query {
        GqlQuery::Soup {
            table,
            property_filter,
            ..
        } if *table == TASKS => (tasks(), property_filter),
        GqlQuery::Soup {
            table,
            property_filter,
            ..
        } if *table == DEALS => (deals(), property_filter),
        GqlQuery::People { .. } => return people(),
        other => panic!("unexpected {other:?}"),
    };
    rows.into_iter()
        .filter(|row| {
            property_filter
                .as_ref()
                .is_none_or(|expr| soup_matches(expr, row))
        })
        .collect()
}

fn soup_matches(expr: &Expr<PropertiesLiteral>, row: &Row) -> bool {
    match expr {
        Expr::And(a, b) => soup_matches(a, row) && soup_matches(b, row),
        Expr::Or(a, b) => soup_matches(a, row) || soup_matches(b, row),
        Expr::Not(a) => !soup_matches(a, row),
        Expr::Literal(literal) => match (
            row.cells.get(&literal.property_definition_id),
            &literal.value,
        ) {
            (Some(Cell::Options(ids)), PropertyMatchValue::SelectOption(id)) => {
                ids.contains(&OptionId::from_uuid(*id))
            }
            (Some(Cell::Entities(ids)), PropertyMatchValue::EntityRef(id)) => {
                ids.iter().any(|candidate| candidate == &id.to_string())
            }
            _ => false,
        },
    }
}

#[test]
fn emails_of_people_with_high_priority_tasks() {
    let (outcome, requests) = drive(
        &catalog(),
        "SELECT DISTINCT p.email FROM macro.tasks t JOIN macro.people p ON t.assignees = p.id
         WHERE t.priority = 'High' ORDER BY p.email",
        by_table,
    );

    assert_eq!(
        outcome.columns,
        vec![OutcomeColumn {
            name: "email".into(),
            column: Some(PEOPLE_EMAIL),
            kind: OutcomeKind::Text,
            table: None,
        }]
    );
    // Sam is on two high tasks; DISTINCT keeps one. Kim's task is low.
    assert_eq!(
        outcome.rows,
        vec![
            vec![Some(Cell::Text("ana@example.com".into()))],
            vec![Some(Cell::Text("sam@example.com".into()))]
        ]
    );
    assert_eq!(outcome.row_ids, vec![FIX_LOGIN, FIX_LOGIN]);
    assert_eq!(outcome.read_tables, vec![TASKS, PEOPLE_TABLE]);
    assert!(!outcome.truncated);

    // Tasks first (Soup applied the priority), then people narrowed to the
    // assignees of the high-priority tasks.
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].id, 0);
    assert!(matches!(
        &requests[0].query,
        GqlQuery::Soup { table, property_filter: Some(_), key_hint: None } if *table == TASKS
    ));
    assert_eq!(requests[0].needs, vec![ASSIGNEES]);
    assert_eq!(requests[1].id, 1);
    assert_eq!(
        requests[1].query,
        GqlQuery::People {
            ids: Some(vec![SAM.into(), ANA.into()]),
        }
    );
    assert_eq!(
        requests[1].needs,
        vec![column_key(1, PEOPLE_EMAIL), column_key(1, PEOPLE_ID)]
    );
}

#[test]
fn without_distinct_each_assignment_is_a_row() {
    let (outcome, _) = drive(
        &catalog(),
        "SELECT t.title, p.name FROM macro.tasks t JOIN macro.people p ON t.assignees = p.id
         ORDER BY t.title, p.name",
        by_table,
    );
    assert_eq!(
        outcome.rows,
        vec![
            vec![
                Some(Cell::Text("Fix login".into())),
                Some(Cell::Text("Ana".into()))
            ],
            vec![
                Some(Cell::Text("Fix login".into())),
                Some(Cell::Text("Sam".into()))
            ],
            vec![
                Some(Cell::Text("Ship it".into())),
                Some(Cell::Text("Sam".into()))
            ],
            vec![
                Some(Cell::Text("Write docs".into())),
                Some(Cell::Text("Kim".into()))
            ],
        ]
    );
    assert_eq!(
        outcome.row_ids,
        vec![FIX_LOGIN, FIX_LOGIN, SHIP_IT, WRITE_DOCS]
    );
}

#[test]
fn row_ids_come_back_as_row_cells_not_entities() {
    let (outcome, _) = drive(
        &catalog(),
        "SELECT row_id, name FROM crm.deals WHERE row_id = '00000000-0000-0000-0000-0000000000a1'",
        |_| {
            vec![
                Row {
                    id: ACME,
                    position: None,
                    cells: HashMap::from([(NAME, Cell::Text("Acme".into()))]),
                },
                Row {
                    id: GLOBEX,
                    position: None,
                    cells: HashMap::from([(NAME, Cell::Text("Globex".into()))]),
                },
            ]
        },
    );
    assert_eq!(
        outcome.columns,
        vec![
            OutcomeColumn {
                name: "row_id".into(),
                column: None,
                kind: OutcomeKind::Row,
                table: Some(DEALS),
            },
            OutcomeColumn {
                name: "name".into(),
                column: Some(NAME),
                kind: OutcomeKind::Text,
                table: None,
            },
        ]
    );
    assert_eq!(
        outcome.rows,
        vec![vec![Some(Cell::Row(ACME)), Some(Cell::Text("Acme".into()))]]
    );
    assert_eq!(
        serde_json::to_value(&outcome.rows[0][0]).unwrap(),
        serde_json::json!({"type": "row", "value": "00000000-0000-0000-0000-0000000000a1"})
    );
}

#[test]
fn left_join_on_row_id_keeps_tasks_without_a_deal() {
    let (outcome, requests) = drive(
        &catalog(),
        "SELECT t.title, d.name, d.amount FROM macro.tasks t LEFT JOIN crm.deals d ON t.deal = d.row_id
         WHERE d.amount > 100 OR d.amount IS NULL ORDER BY t.title",
        by_table,
    );
    assert_eq!(
        outcome.rows,
        vec![
            vec![
                Some(Cell::Text("Fix login".into())),
                Some(Cell::Text("Acme".into())),
                Some(Cell::Number(12000.0))
            ],
            vec![Some(Cell::Text("Idle".into())), None, None],
            vec![Some(Cell::Text("Write docs".into())), None, None],
        ]
    );
    // The hint names the row id (no property) with the deals the tasks link.
    assert_eq!(
        requests[1].query,
        GqlQuery::Soup {
            table: DEALS,
            property_filter: None,
            key_hint: Some(KeyHint {
                column: None,
                values: vec![
                    Cell::Entities(vec![ACME.to_string()]),
                    Cell::Entities(vec![GLOBEX.to_string()]),
                ],
            }),
        }
    );
}

#[test]
fn where_on_a_left_joined_table_drops_the_tasks_it_rejects() {
    let (outcome, requests) = drive(
        &catalog(),
        "SELECT t.title, d.name FROM macro.tasks t LEFT JOIN crm.deals d ON t.deal = d.row_id
         WHERE d.stage = 'Won' ORDER BY t.title",
        by_table,
    );
    // Only the login fix links a won deal. Ship it links a lead, and the
    // other two link nothing, so their `d.stage` is NULL and WHERE drops
    // them after the join.
    assert_eq!(
        outcome.rows,
        vec![vec![
            Some(Cell::Text("Fix login".into())),
            Some(Cell::Text("Acme".into()))
        ]]
    );
    // The deals read carries no filter: pushed into it, the stage would act
    // as part of the ON condition and keep every task.
    assert_eq!(
        requests[1].query,
        GqlQuery::Soup {
            table: DEALS,
            property_filter: None,
            key_hint: Some(KeyHint {
                column: None,
                values: vec![
                    Cell::Entities(vec![ACME.to_string()]),
                    Cell::Entities(vec![GLOBEX.to_string()]),
                ],
            }),
        }
    );
}

#[test]
fn inner_join_drops_tasks_without_a_match_and_counts_joined_rows() {
    let (outcome, _) = drive(
        &catalog(),
        "SELECT t.priority, COUNT(*) FROM macro.tasks t JOIN macro.people p ON t.assignees = p.id
         GROUP BY t.priority ORDER BY 2 DESC",
        by_table,
    );
    // High: Sam and Ana on one task, Sam on another, three joined rows;
    // Low: Kim, one. The idle task has no assignee and is gone.
    assert_eq!(
        outcome.rows,
        vec![
            vec![Some(Cell::Options(vec![HIGH])), Some(Cell::Number(3.0))],
            vec![Some(Cell::Options(vec![LOW])), Some(Cell::Number(1.0))],
        ]
    );
    assert_eq!(outcome.row_ids, Vec::<RowId>::new());
}

#[test]
fn a_joined_tables_rows_arrive_keyed_by_definition_and_the_engine_keys_them() {
    // A source serves every table the same way, cells by property
    // definition; the engine gives the joined relation its own keys, so the
    // people row's `name` cannot overwrite the deal's.
    let (outcome, requests) = drive(
        &catalog(),
        "SELECT d.name, p.name FROM crm.deals d JOIN crm.people p ON d.owner = p.row_id",
        |query| match query {
            GqlQuery::Soup { table, .. } if *table == DEALS => vec![Row {
                id: ACME,
                position: None,
                cells: HashMap::from([
                    (NAME, Cell::Text("Acme".into())),
                    (
                        OWNER,
                        Cell::Entities(vec![Uuid::from_u128(0x99).to_string()]),
                    ),
                ]),
            }],
            GqlQuery::Soup { table, .. } if *table == PEOPLE => vec![Row {
                id: RowId::from_uuid(Uuid::from_u128(0x99)),
                position: None,
                cells: HashMap::from([(NAME, Cell::Text("Sam".into()))]),
            }],
            other => panic!("unexpected {other:?}"),
        },
    );
    assert_eq!(
        outcome.rows,
        vec![vec![
            Some(Cell::Text("Acme".into())),
            Some(Cell::Text("Sam".into()))
        ]]
    );
    assert_eq!(
        requests[1].needs,
        vec![column_key(1, NAME), crate::resolve::row_id_key(PEOPLE)]
    );
}

#[test]
fn a_definition_shared_by_both_tables_keeps_its_two_columns_apart() {
    // crm.deals.name and crm.people.name are one definition; joined, each
    // side's value must survive under its own key.
    let (outcome, _) = drive(
        &catalog(),
        "SELECT d.name, p.name FROM crm.deals d JOIN crm.people p ON d.owner = p.row_id",
        |query| match query {
            GqlQuery::Soup { table, .. } if *table == DEALS => vec![Row {
                id: ACME,
                position: None,
                cells: HashMap::from([
                    (NAME, Cell::Text("Acme".into())),
                    (
                        OWNER,
                        Cell::Entities(vec![Uuid::from_u128(0x99).to_string()]),
                    ),
                ]),
            }],
            GqlQuery::Soup { table, .. } if *table == PEOPLE => vec![Row {
                id: RowId::from_uuid(Uuid::from_u128(0x99)),
                position: None,
                cells: HashMap::from([(column_key(1, NAME), Cell::Text("Sam".into()))]),
            }],
            other => panic!("unexpected {other:?}"),
        },
    );
    assert_eq!(
        outcome.rows,
        vec![vec![
            Some(Cell::Text("Acme".into())),
            Some(Cell::Text("Sam".into()))
        ]]
    );
    assert_eq!(
        outcome
            .columns
            .iter()
            .map(|column| column.column)
            .collect::<Vec<_>>(),
        vec![Some(NAME), Some(NAME)]
    );
}

#[test]
fn pages_continue_by_cursor_and_ids_must_match() {
    let (mut engine, step) = Engine::start(
        &catalog(),
        "SELECT t.title, p.name FROM macro.tasks t JOIN macro.people p ON t.assignees = p.id",
    )
    .unwrap();
    let Step::Fetch(first) = step else {
        panic!("expected a fetch");
    };
    assert_eq!(
        (first.id, first.cursor.clone(), first.limit),
        (0, None, PAGE_LIMIT)
    );

    // Page one of the tasks continues at its cursor.
    let step = engine
        .feed_page(
            0,
            Page {
                rows: tasks().into_iter().take(2).collect(),
                next: Some("2".into()),
            },
        )
        .unwrap();
    let Step::Fetch(second) = step else {
        panic!("expected a fetch");
    };
    assert_eq!(second.id, 1);
    assert_eq!(second.cursor, Some("2".into()));
    assert_eq!(second.query, first.query);

    // A wrong id is refused; the outstanding request is spent either way.
    assert_eq!(
        engine
            .feed_page(7, Page::default())
            .unwrap_err()
            .to_string(),
        "fed request 7, but request 1 is outstanding"
    );
    assert_eq!(
        engine
            .feed_page(1, Page::default())
            .unwrap_err()
            .to_string(),
        "fed request 1, but nothing is outstanding"
    );
}

#[test]
fn a_relation_past_the_cap_is_truncated_and_the_next_still_fetched() {
    let many: Vec<Row> = (0..ROW_CAP + 5)
        .map(|index| Row {
            id: RowId::from_uuid(Uuid::from_u128(0x1000 + index as u128)),
            position: None,
            cells: HashMap::from([
                (TITLE, Cell::Text("t".into())),
                (PRIORITY, Cell::Options(vec![HIGH])),
                (ASSIGNEES, Cell::Entities(vec![SAM.into()])),
            ]),
        })
        .collect();
    let (mut engine, step) = Engine::start(
        &catalog(),
        "SELECT DISTINCT p.email FROM macro.tasks t JOIN macro.people p ON t.assignees = p.id",
    )
    .unwrap();
    let Step::Fetch(request) = step else {
        panic!("expected a fetch");
    };
    let step = engine
        .feed_page(
            request.id,
            Page {
                rows: many,
                next: Some("more".into()),
            },
        )
        .unwrap();
    let Step::Fetch(request) = step else {
        panic!("expected the people fetch");
    };
    assert_eq!(
        request.query,
        GqlQuery::People {
            ids: Some(vec![SAM.into()]),
        }
    );
    let Step::Done(outcome) = engine
        .feed_page(
            request.id,
            Page {
                rows: people(),
                next: None,
            },
        )
        .unwrap()
    else {
        panic!("expected the answer");
    };
    assert!(outcome.truncated);
    assert_eq!(
        outcome.rows,
        vec![vec![Some(Cell::Text("sam@example.com".into()))]]
    );
}

#[test]
fn steps_and_pages_cross_the_wire_as_json() {
    let (_, step) =
        Engine::start(&catalog(), "SELECT name FROM crm.deals WHERE stage = 'Won'").unwrap();
    let json = serde_json::to_value(&step).unwrap();
    assert_eq!(json["step"], "fetch");
    assert_eq!(json["query"]["type"], "soup");
    assert_eq!(json["query"]["table"], DEALS.to_string());
    assert!(json["query"]["keyHint"].is_null());
    assert!(json["query"].get("key_hint").is_none());
    assert_eq!(json["needs"], serde_json::json!([NAME.to_string()]));
    assert_eq!(json["limit"], PAGE_LIMIT);
    let back: Step = serde_json::from_value(json).unwrap();
    assert_eq!(back, step);

    let page = Page {
        rows: vec![Row {
            id: ACME,
            position: None,
            cells: HashMap::from([(NAME, Cell::Text("Acme".into()))]),
        }],
        next: Some("2".into()),
    };
    let json = serde_json::to_value(&page).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "rows": [{ "id": ACME.to_string(), "cells": { NAME.to_string(): { "type": "text", "value": "Acme" } } }],
            "next": "2"
        })
    );
    assert_eq!(serde_json::from_value::<Page>(json).unwrap(), page);
}

struct ByTable;

impl RowSource for ByTable {
    type Error = std::convert::Infallible;

    async fn page(
        &self,
        query: &GqlQuery,
        _needs: &[Uuid],
        _cursor: Option<String>,
        _limit: usize,
    ) -> Result<Page, Self::Error> {
        Ok(Page {
            rows: by_table(query),
            next: None,
        })
    }

    async fn bins(&self, _: &GqlQuery) -> Result<Vec<Bin>, Self::Error> {
        unreachable!("these statements read no bins")
    }
}

struct NoWrites;

impl OpsSink for NoWrites {
    type Error = std::convert::Infallible;

    async fn apply(&self, _: DatabaseId, _: Vec<DatabaseOp>) -> Result<Vec<OpResult>, Self::Error> {
        unreachable!("these statements write nothing")
    }
}

#[test]
fn run_answers_a_join_through_a_row_source() {
    let outcome = pollster::block_on(run(
        &catalog(),
        "SELECT DISTINCT p.email FROM macro.tasks t JOIN macro.people p ON t.assignees = p.id
         WHERE t.priority = 'High' ORDER BY p.email DESC",
        &ByTable,
        &NoWrites,
    ))
    .unwrap();
    assert_eq!(
        outcome.rows,
        vec![
            vec![Some(Cell::Text("sam@example.com".into()))],
            vec![Some(Cell::Text("ana@example.com".into()))]
        ]
    );
}

#[test]
fn order_by_row_position_lists_rows_in_table_order_whatever_the_fetch_order() {
    // Soup lists rows newest first; the table's order is their positions.
    let (outcome, _) = drive(
        &catalog(),
        "SELECT name FROM crm.deals ORDER BY row_position",
        |_| {
            vec![
                Row {
                    id: GLOBEX,
                    position: Some("8180".parse::<Position>().unwrap()),
                    cells: HashMap::from([(NAME, Cell::Text("Globex".into()))]),
                },
                Row {
                    id: ACME,
                    position: Some("80".parse::<Position>().unwrap()),
                    cells: HashMap::from([(NAME, Cell::Text("Acme".into()))]),
                },
                Row {
                    id: SHIP_IT,
                    position: Some("8280".parse::<Position>().unwrap()),
                    cells: HashMap::from([(NAME, Cell::Text("Initech".into()))]),
                },
            ]
        },
    );
    assert_eq!(
        outcome.rows,
        vec![
            vec![Some(Cell::Text("Acme".into()))],
            vec![Some(Cell::Text("Globex".into()))],
            vec![Some(Cell::Text("Initech".into()))]
        ]
    );
    assert_eq!(outcome.row_ids, vec![ACME, GLOBEX, SHIP_IT]);
}

#[test]
fn row_position_breaks_ties_after_the_sorts() {
    let (outcome, _) = drive(
        &catalog(),
        "SELECT name FROM crm.deals ORDER BY stage, row_position",
        |_| {
            vec![
                Row {
                    id: IDLE,
                    position: Some("8380".parse::<Position>().unwrap()),
                    cells: HashMap::from([
                        (NAME, Cell::Text("Hooli".into())),
                        (STAGE, Cell::Options(vec![LEAD])),
                    ]),
                },
                Row {
                    id: SHIP_IT,
                    position: Some("8280".parse::<Position>().unwrap()),
                    cells: HashMap::from([
                        (NAME, Cell::Text("Initech".into())),
                        (STAGE, Cell::Options(vec![WON])),
                    ]),
                },
                Row {
                    id: GLOBEX,
                    position: Some("8180".parse::<Position>().unwrap()),
                    cells: HashMap::from([
                        (NAME, Cell::Text("Globex".into())),
                        (STAGE, Cell::Options(vec![LEAD])),
                    ]),
                },
                Row {
                    id: ACME,
                    position: Some("80".parse::<Position>().unwrap()),
                    cells: HashMap::from([
                        (NAME, Cell::Text("Acme".into())),
                        (STAGE, Cell::Options(vec![WON])),
                    ]),
                },
            ]
        },
    );
    // Lead comes before Won in the column's option order.
    assert_eq!(
        outcome.rows,
        vec![
            vec![Some(Cell::Text("Globex".into()))],
            vec![Some(Cell::Text("Hooli".into()))],
            vec![Some(Cell::Text("Acme".into()))],
            vec![Some(Cell::Text("Initech".into()))],
        ]
    );
    assert_eq!(outcome.row_ids, vec![GLOBEX, IDLE, ACME, SHIP_IT]);
}

/// Rows as Soup hands them over: newest first, the reverse of their positions.
fn deals_newest_first() -> Vec<Row> {
    vec![
        Row {
            id: SHIP_IT,
            position: Some("8280".parse::<Position>().unwrap()),
            cells: HashMap::from([
                (NAME, Cell::Text("Initech".into())),
                (STAGE, Cell::Options(vec![WON])),
            ]),
        },
        Row {
            id: GLOBEX,
            position: Some("8180".parse::<Position>().unwrap()),
            cells: HashMap::from([
                (NAME, Cell::Text("Globex".into())),
                (STAGE, Cell::Options(vec![LEAD])),
            ]),
        },
        Row {
            id: ACME,
            position: Some("80".parse::<Position>().unwrap()),
            cells: HashMap::from([
                (NAME, Cell::Text("Acme".into())),
                (STAGE, Cell::Options(vec![WON])),
            ]),
        },
    ]
}

#[test]
fn without_order_by_rows_come_back_in_table_order_whatever_the_fetch_order() {
    let (outcome, _) = drive(&catalog(), "SELECT name FROM crm.deals", |_| {
        deals_newest_first()
    });
    assert_eq!(
        outcome.rows,
        vec![
            vec![Some(Cell::Text("Acme".into()))],
            vec![Some(Cell::Text("Globex".into()))],
            vec![Some(Cell::Text("Initech".into()))]
        ]
    );
    assert_eq!(outcome.row_ids, vec![ACME, GLOBEX, SHIP_IT]);
}

#[test]
fn groups_without_order_by_come_in_the_table_order_of_their_first_rows() {
    let (outcome, _) = drive(
        &catalog(),
        "SELECT name, COUNT(*) FROM crm.deals GROUP BY name",
        |_| deals_newest_first(),
    );
    assert_eq!(
        outcome.rows,
        vec![
            vec![Some(Cell::Text("Acme".into())), Some(Cell::Number(1.0))],
            vec![Some(Cell::Text("Globex".into())), Some(Cell::Number(1.0))],
            vec![Some(Cell::Text("Initech".into())), Some(Cell::Number(1.0))],
        ]
    );
}

#[test]
fn a_selected_row_position_is_a_text_column_named_row_position() {
    let (outcome, _) = drive(
        &catalog(),
        "SELECT name, row_position FROM crm.deals ORDER BY name",
        |_| {
            vec![
                Row {
                    id: ACME,
                    position: Some("80".parse::<Position>().unwrap()),
                    cells: HashMap::from([(NAME, Cell::Text("Acme".into()))]),
                },
                Row {
                    id: GLOBEX,
                    position: None,
                    cells: HashMap::from([(NAME, Cell::Text("Globex".into()))]),
                },
            ]
        },
    );
    assert_eq!(
        outcome.columns,
        vec![
            OutcomeColumn {
                name: "name".into(),
                column: Some(NAME),
                kind: OutcomeKind::Text,
                table: None,
            },
            OutcomeColumn {
                name: "row_position".into(),
                column: None,
                kind: OutcomeKind::Text,
                table: None,
            },
        ]
    );
    assert_eq!(
        outcome.rows,
        vec![
            vec![
                Some(Cell::Text("Acme".into())),
                Some(Cell::Text("80".into()))
            ],
            vec![Some(Cell::Text("Globex".into())), None],
        ]
    );
}

#[test]
fn an_aggregate_of_row_position_is_named_after_it() {
    let (outcome, _) = drive(
        &catalog(),
        "SELECT COUNT(row_position) FROM crm.deals",
        |_| {
            vec![Row {
                id: ACME,
                position: Some("80".parse::<Position>().unwrap()),
                cells: HashMap::new(),
            }]
        },
    );
    assert_eq!(
        outcome.columns,
        vec![OutcomeColumn {
            name: "COUNT(row_position)".into(),
            column: None,
            kind: OutcomeKind::Number,
            table: None,
        }]
    );
    assert_eq!(outcome.rows, vec![vec![Some(Cell::Number(1.0))]]);
}

/// `people` takes no filter, so a filter on it stays with the fold rather
/// than being pushed into a query that would drop it.
#[test]
fn a_filter_on_people_is_applied_by_the_fold() {
    let (mut engine, step) = Engine::start(
        &catalog(),
        "SELECT email FROM macro.people WHERE id = 'macro|ana@example.com'",
    )
    .unwrap();
    let Step::Fetch(request) = step else {
        panic!("expected a fetch");
    };
    assert_eq!(request.query, GqlQuery::People { ids: None });
    assert_eq!(request.needs, vec![PEOPLE_EMAIL, PEOPLE_ID]);

    let ana = RowId::from_uuid(Uuid::new_v5(&Uuid::NAMESPACE_OID, ANA.as_bytes()));
    let step = engine
        .feed_page(
            request.id,
            Page {
                rows: vec![
                    Row {
                        id: RowId::from_uuid(Uuid::new_v5(&Uuid::NAMESPACE_OID, SAM.as_bytes())),
                        position: None,
                        cells: HashMap::from([
                            (PEOPLE_ID, Cell::Entities(vec![SAM.into()])),
                            (PEOPLE_EMAIL, Cell::Text("sam@example.com".into())),
                        ]),
                    },
                    Row {
                        id: ana,
                        position: None,
                        cells: HashMap::from([
                            (PEOPLE_ID, Cell::Entities(vec![ANA.into()])),
                            (PEOPLE_EMAIL, Cell::Text("ana@example.com".into())),
                        ]),
                    },
                ],
                next: None,
            },
        )
        .unwrap();

    assert_eq!(
        step,
        Step::Done(Outcome {
            columns: vec![OutcomeColumn {
                name: "email".into(),
                column: Some(PEOPLE_EMAIL),
                kind: OutcomeKind::Text,
                table: None,
            }],
            rows: vec![vec![Some(Cell::Text("ana@example.com".into()))]],
            row_ids: vec![ana],
            read_tables: vec![PEOPLE_TABLE],
            ..Outcome::default()
        })
    );
}

#[test]
fn a_feed_of_the_wrong_kind_is_refused() {
    let (mut engine, step) = Engine::start(&catalog(), "SELECT name FROM crm.deals").unwrap();
    let Step::Fetch(request) = step else {
        panic!("expected a fetch");
    };
    assert_eq!(
        engine.feed_bins(request.id, vec![]),
        Err(RunError::WrongAnswer {
            request: 0,
            expected: Answer::Page,
            fed: Answer::Bins,
        })
    );

    let (mut engine, step) = Engine::start(
        &catalog(),
        "SELECT stage, COUNT(*) FROM crm.deals GROUP BY stage",
    )
    .unwrap();
    let Step::Bins(request) = step else {
        panic!("expected bins");
    };
    assert_eq!(
        engine.feed_page(request.id, Page::default()),
        Err(RunError::WrongAnswer {
            request: 0,
            expected: Answer::Bins,
            fed: Answer::Page,
        })
    );

    let (mut engine, step) = Engine::start(
        &catalog(),
        "INSERT INTO crm.deals (name) VALUES ('Initech')",
    )
    .unwrap();
    let Step::Ops { id, .. } = step else {
        panic!("expected ops");
    };
    assert_eq!(
        engine.feed_page(id, Page::default()),
        Err(RunError::WrongAnswer {
            request: 0,
            expected: Answer::OpResults,
            fed: Answer::Page,
        })
    );
    assert_eq!(
        engine.feed_ops(id, vec![]),
        Err(RunError::NothingOutstanding { fed: 0 })
    );
}

#[test]
fn a_join_past_the_hint_limit_fetches_the_joined_relation_whole() {
    let assigned = |count: usize| -> Vec<Row> {
        (0..count)
            .map(|index| Row {
                id: RowId::from_uuid(Uuid::from_u128(0x1000 + index as u128)),
                position: None,
                cells: HashMap::from([(
                    ASSIGNEES,
                    Cell::Entities(vec![format!("macro|person{index}@example.com")]),
                )]),
            })
            .collect()
    };
    let sql = "SELECT p.email FROM macro.tasks t JOIN macro.people p ON t.assignees = p.id";

    let (mut engine, step) = Engine::start(&catalog(), sql).unwrap();
    let Step::Fetch(request) = step else {
        panic!("expected a fetch");
    };
    let Step::Fetch(people) = engine
        .feed_page(
            request.id,
            Page {
                rows: assigned(MAX_KEY_HINT_VALUES),
                next: None,
            },
        )
        .unwrap()
    else {
        panic!("expected the people fetch");
    };
    assert_eq!(
        people.query,
        GqlQuery::People {
            ids: Some(
                (0..MAX_KEY_HINT_VALUES)
                    .map(|index| format!("macro|person{index}@example.com"))
                    .collect()
            ),
        }
    );

    let (mut engine, step) = Engine::start(&catalog(), sql).unwrap();
    let Step::Fetch(request) = step else {
        panic!("expected a fetch");
    };
    let Step::Fetch(people) = engine
        .feed_page(
            request.id,
            Page {
                rows: assigned(MAX_KEY_HINT_VALUES + 1),
                next: None,
            },
        )
        .unwrap()
    else {
        panic!("expected the people fetch");
    };
    assert_eq!(people.query, GqlQuery::People { ids: None });
}

/// `people` has no `groupSoup`, so a count per person reads the people.
#[test]
fn a_count_per_person_fetches_people_rather_than_bins() {
    let (_, step) = Engine::start(
        &catalog(),
        "SELECT id, COUNT(*) FROM macro.people GROUP BY id",
    )
    .unwrap();

    assert_eq!(
        step,
        Step::Fetch(Request {
            id: 0,
            query: GqlQuery::People { ids: None },
            needs: vec![PEOPLE_ID],
            cursor: None,
            limit: PAGE_LIMIT,
        })
    );
}

#[test]
fn a_read_that_names_its_rows_asks_for_only_those_rows() {
    let (outcome, requests) = drive(
        &catalog(),
        "SELECT row_id FROM crm.deals WHERE row_id IN ('00000000-0000-0000-0000-0000000000a2')",
        by_table,
    );
    assert_eq!(outcome.row_ids, vec![GLOBEX]);
    // The source may narrow the fetch to the named row; the fold filters
    // regardless, as this source serves the whole table.
    assert_eq!(
        requests[0].query,
        GqlQuery::Soup {
            table: DEALS,
            property_filter: None,
            key_hint: Some(KeyHint {
                column: None,
                values: vec![Cell::Entities(vec![GLOBEX.to_string()])],
            }),
        }
    );
}
