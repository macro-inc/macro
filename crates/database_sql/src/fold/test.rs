use models_databases::RowId;
use std::collections::HashMap;

use chrono::{TimeZone, Utc};

use super::*;
use crate::resolve::{Filter, Query, compile};
use crate::split::split;
use crate::test_support::{catalog, *};

const ACME: RowId = RowId::from_uuid(Uuid::from_u128(0xa1));
const GLOBEX: RowId = RowId::from_uuid(Uuid::from_u128(0xa2));
const HOOLI: RowId = RowId::from_uuid(Uuid::from_u128(0xa3));
const INITECH: RowId = RowId::from_uuid(Uuid::from_u128(0xa4));

/// Four deals as the server would return them for a `SELECT *`:
/// Acme (Won, 12000, Sam, vip, done), Globex (Lead, 3000, Sam), Hooli (Won,
/// no amount, Ana, closed), Initech (no stage, 7000, no owner, not done).
fn deals() -> Vec<Row> {
    vec![
        Row {
            id: ACME,
            position: None,
            cells: HashMap::from([
                (NAME, Cell::Text("Acme".into())),
                (AMOUNT, Cell::Number(12000.0)),
                (STAGE, Cell::Options(vec![WON])),
                (OWNER, Cell::Entities(vec!["macro|sam@example.com".into()])),
                (TAGS, Cell::Options(vec![VIP])),
                (DONE, Cell::Bool(true)),
            ]),
        },
        Row {
            id: GLOBEX,
            position: None,
            cells: HashMap::from([
                (NAME, Cell::Text("Globex".into())),
                (AMOUNT, Cell::Number(3000.0)),
                (STAGE, Cell::Options(vec![LEAD])),
                (OWNER, Cell::Entities(vec!["macro|sam@example.com".into()])),
                (TAGS, Cell::Options(vec![])),
            ]),
        },
        Row {
            id: HOOLI,
            position: None,
            cells: HashMap::from([
                (NAME, Cell::Text("hooli".into())),
                (STAGE, Cell::Options(vec![WON])),
                (
                    CLOSED_AT,
                    Cell::Date(Utc.with_ymd_and_hms(2026, 9, 15, 0, 0, 0).unwrap()),
                ),
                (OWNER, Cell::Entities(vec!["macro|ana@example.com".into()])),
            ]),
        },
        Row {
            id: INITECH,
            position: None,
            cells: HashMap::from([
                (NAME, Cell::Text("Initech".into())),
                (AMOUNT, Cell::Number(7000.0)),
                (DONE, Cell::Bool(false)),
            ]),
        },
    ]
}

fn plan(sql: &str) -> Plan {
    match compile(&catalog(), sql).unwrap() {
        Query::Select(select) => split(&catalog(), select),
        Query::Insert(_) | Query::Update(_) | Query::Delete(_) | Query::AlterColumnType(_) => {
            panic!("not a SELECT")
        }
    }
}

#[test]
fn rows_are_filtered_projected_and_sorted() {
    let plan = plan(
        "SELECT name, amount, \"closed at\" FROM crm.deals
         WHERE amount > 5000 OR \"closed at\" IS NOT NULL
         ORDER BY amount DESC",
    );

    assert_eq!(
        fold_rows(&catalog(), &plan, deals()),
        vec![
            vec![
                Some(Cell::Text("Acme".into())),
                Some(Cell::Number(12000.0)),
                None,
            ],
            vec![
                Some(Cell::Text("Initech".into())),
                Some(Cell::Number(7000.0)),
                None,
            ],
            // No amount: sorts last even though the order is descending.
            vec![
                Some(Cell::Text("hooli".into())),
                None,
                Some(Cell::Date(
                    Utc.with_ymd_and_hms(2026, 9, 15, 0, 0, 0).unwrap()
                )),
            ],
        ]
    );
}

#[test]
fn aggregates_per_group_with_a_residual_filter() {
    let plan = plan(
        "SELECT owner, SUM(amount), COUNT(*), COUNT(amount), AVG(amount)
         FROM crm.deals
         WHERE stage IN ('Won', 'Lead')
         GROUP BY owner
         ORDER BY 2 DESC",
    );
    // The server would have applied `stage IN (...)`; hand the fold only
    // what it would have returned.
    let won_or_lead: Vec<Row> = deals().into_iter().take(3).collect();

    assert_eq!(
        fold_rows(&catalog(), &plan, won_or_lead),
        vec![
            vec![
                Some(Cell::Entities(vec!["macro|sam@example.com".into()])),
                Some(Cell::Number(15000.0)),
                Some(Cell::Number(2.0)),
                Some(Cell::Number(2.0)),
                Some(Cell::Number(7500.0)),
            ],
            // Hooli has no amount: SUM and AVG of nothing are NULL, COUNT(*)
            // still counts the row, COUNT(amount) does not.
            vec![
                Some(Cell::Entities(vec!["macro|ana@example.com".into()])),
                None,
                Some(Cell::Number(1.0)),
                Some(Cell::Number(0.0)),
                None,
            ],
        ]
    );
}

#[test]
fn aggregates_without_group_by_are_one_row_even_over_nothing() {
    let plan = plan("SELECT COUNT(*), SUM(amount), MIN(amount), MAX(\"closed at\") FROM crm.deals");

    assert_eq!(
        fold_rows(&catalog(), &plan, deals()),
        vec![vec![
            Some(Cell::Number(4.0)),
            Some(Cell::Number(22000.0)),
            Some(Cell::Number(3000.0)),
            Some(Cell::Date(
                Utc.with_ymd_and_hms(2026, 9, 15, 0, 0, 0).unwrap()
            )),
        ]]
    );
    assert_eq!(
        fold_rows(&catalog(), &plan, vec![]),
        vec![vec![Some(Cell::Number(0.0)), None, None, None]]
    );
}

#[test]
fn groups_sort_by_option_order_and_the_empty_group_last() {
    // Option order in the catalog is Lead, Won; a plain sort would put Won
    // first by id.
    let plan = plan(
        "SELECT stage, COUNT(*) FROM crm.deals WHERE amount > 0 GROUP BY stage ORDER BY stage",
    );

    assert_eq!(
        fold_rows(&catalog(), &plan, deals()),
        vec![
            vec![Some(Cell::Options(vec![LEAD])), Some(Cell::Number(1.0))],
            vec![Some(Cell::Options(vec![WON])), Some(Cell::Number(1.0))],
            vec![None, Some(Cell::Number(1.0))],
        ]
    );
}

#[test]
fn bins_answer_a_count_only_group() {
    let plan = plan("SELECT stage, COUNT(*) FROM crm.deals GROUP BY stage ORDER BY 2 DESC, stage");
    let bins = vec![
        Bin {
            key: Some(Cell::Options(vec![LEAD])),
            count: 4,
        },
        Bin {
            key: None,
            count: 4,
        },
        Bin {
            key: Some(Cell::Options(vec![WON])),
            count: 9,
        },
    ];

    assert_eq!(
        fold_bins(&catalog(), &plan, bins),
        Ok(vec![
            vec![Some(Cell::Options(vec![WON])), Some(Cell::Number(9.0))],
            vec![Some(Cell::Options(vec![LEAD])), Some(Cell::Number(4.0))],
            vec![None, Some(Cell::Number(4.0))],
        ])
    );
}

#[test]
fn grouped_bins_apply_limit_and_offset_after_sorting() {
    use crate::engine::{Engine, Step};

    for (window, expected) in [
        (
            "LIMIT 1",
            vec![vec![
                Some(Cell::Options(vec![WON])),
                Some(Cell::Number(9.0)),
            ]],
        ),
        (
            "LIMIT 1 OFFSET 1",
            vec![vec![
                Some(Cell::Options(vec![LEAD])),
                Some(Cell::Number(4.0)),
            ]],
        ),
        ("LIMIT 0", vec![]),
        ("LIMIT 1 OFFSET 3", vec![]),
    ] {
        let sql = format!(
            "SELECT stage, COUNT(*) FROM crm.deals \
             GROUP BY stage ORDER BY 2 DESC, stage {window}"
        );
        let (mut engine, step) = Engine::start(&catalog(), &sql).unwrap();
        let Step::Bins(request) = step else {
            panic!("expected grouped bins for {sql}");
        };
        let bins = vec![
            Bin {
                key: Some(Cell::Options(vec![LEAD])),
                count: 4,
            },
            Bin {
                key: None,
                count: 4,
            },
            Bin {
                key: Some(Cell::Options(vec![WON])),
                count: 9,
            },
        ];
        let Step::Done(outcome) = engine.feed_bins(request.id, bins).unwrap() else {
            panic!("expected a completed read for {sql}");
        };
        assert_eq!(outcome.rows, expected, "{sql}");
        assert!(outcome.row_ids.is_empty());
    }
}

#[test]
fn limit_and_offset_apply_after_ordering() {
    let windowed = plan("SELECT name FROM crm.deals ORDER BY name LIMIT 2 OFFSET 1");
    assert_eq!(
        fold_rows(&catalog(), &windowed, deals()),
        vec![
            vec![Some(Cell::Text("Globex".into()))],
            vec![Some(Cell::Text("hooli".into()))],
        ]
    );

    let top_group =
        plan("SELECT stage, COUNT(*) FROM crm.deals GROUP BY stage ORDER BY 2 DESC LIMIT 1");
    assert_eq!(
        fold_rows(&catalog(), &top_group, deals()),
        vec![vec![
            Some(Cell::Options(vec![WON])),
            Some(Cell::Number(2.0))
        ]]
    );
}

#[test]
fn residual_predicates_follow_sql_null_rules_and_macro_matching() {
    let cases: &[(&str, &[RowId])] = &[
        // number comparisons; an empty cell never compares true
        ("amount > 5000", &[ACME, INITECH]),
        ("amount <= 7000", &[GLOBEX, INITECH]),
        ("amount != 7000", &[ACME, GLOBEX]),
        // != and NOT IN drop empty cells, as in SQL
        ("stage != 'Won'", &[GLOBEX]),
        ("stage NOT IN ('Won', 'Lead')", &[]),
        ("owner NOT IN ('macro|sam@example.com')", &[HOOLI]),
        // IS NULL is how you ask for empty cells
        ("stage IS NULL", &[INITECH]),
        ("stage IS NOT NULL", &[ACME, GLOBEX, HOOLI]),
        // multi-valued: an absent cell is the empty set
        ("tags HAS 'vip'", &[ACME]),
        ("tags NOT HAS 'vip'", &[GLOBEX, HOOLI, INITECH]),
        // text: LIKE ignores case, = does not
        ("name LIKE 'h%'", &[HOOLI]),
        ("name LIKE '%o%'", &[GLOBEX, HOOLI]),
        ("name LIKE '_cme'", &[ACME]),
        ("name NOT LIKE '%e%'", &[HOOLI]),
        ("name = 'Hooli'", &[]),
        // ESCAPE makes the next pattern character literal
        ("name LIKE 'acm_'", &[ACME]),
        (r"name LIKE 'acm\_' ESCAPE '\'", &[]),
        (r"name LIKE 'acm\e' ESCAPE '\'", &[ACME]),
        (r"name LIKE '%\%%' ESCAPE '\'", &[]),
        (
            r"name NOT LIKE '%\%%' ESCAPE '\'",
            &[ACME, GLOBEX, HOOLI, INITECH],
        ),
        ("name LIKE 'H%' ESCAPE '!'", &[HOOLI]),
        ("name LIKE 'H!%' ESCAPE '!'", &[]),
        ("name < 'H'", &[ACME, GLOBEX]),
        // checkbox: an unset checkbox is not FALSE
        ("done = FALSE", &[INITECH]),
        ("done != TRUE", &[INITECH]),
        // dates
        ("\"closed at\" >= '2026-09-15'", &[HOOLI]),
        ("\"closed at\" < '2026-09-15T00:00:01Z'", &[HOOLI]),
        // combinations
        ("amount > 5000 AND done = TRUE", &[ACME]),
        ("amount > 5000 OR stage = 'Lead'", &[ACME, GLOBEX, INITECH]),
        (
            "(amount > 5000 OR stage = 'Lead') AND owner = 'macro|sam@example.com'",
            &[ACME, GLOBEX],
        ),
    ];

    // Split would push some of these to the server; test the evaluator on the
    // whole resolved WHERE so every form is covered as the fold would apply
    // it when it is residual.
    for (where_, kept) in cases {
        let Query::Select(select) = compile(
            &catalog(),
            &format!("SELECT name FROM crm.deals WHERE {where_}"),
        )
        .unwrap() else {
            panic!("not a SELECT");
        };
        let filter = select.where_.unwrap();
        let held: Vec<RowId> = deals()
            .iter()
            .filter(|row| super::predicate::holds(&filter, row))
            .map(|row| row.id)
            .collect();
        assert_eq!(held, *kept, "\nWHERE {where_}");
    }
}

#[test]
fn distinct_keeps_the_first_of_equal_rows_after_sorting() {
    let plan = plan("SELECT DISTINCT owner FROM crm.deals ORDER BY owner");
    let (rows, ids) = fold_relations(&catalog(), &plan, vec![deals()]);
    assert_eq!(
        rows,
        vec![
            vec![Some(Cell::Entities(vec!["macro|ana@example.com".into()]))],
            vec![Some(Cell::Entities(vec!["macro|sam@example.com".into()]))],
            vec![None],
        ]
    );
    // Hooli is Ana's; Acme is the first of Sam's two; Initech has no owner.
    assert_eq!(ids, vec![HOOLI, ACME, INITECH]);
}

#[test]
fn distinct_over_aggregates_changes_nothing() {
    let plan =
        plan("SELECT DISTINCT stage, COUNT(*) FROM crm.deals GROUP BY stage ORDER BY 2 DESC");
    let (rows, ids) = fold_relations(&catalog(), &plan, vec![deals()]);
    assert_eq!(rows.len(), 3);
    assert_eq!(ids, Vec::<RowId>::new());
}

#[test]
fn join_matches_by_membership_and_leaves_empty_cells_unmatched() {
    use crate::catalog::PEOPLE_ID;
    use crate::resolve::column_key;

    let plan = plan(
        "SELECT d.name, p.name FROM crm.deals d LEFT JOIN macro.people p ON d.owner = p.id ORDER BY d.name",
    );
    let people = vec![
        Row {
            id: RowId::from_uuid(Uuid::from_u128(0x71)),
            position: None,
            cells: HashMap::from([
                (
                    column_key(1, PEOPLE_ID),
                    Cell::Entities(vec!["macro|sam@example.com".into()]),
                ),
                (
                    column_key(1, crate::catalog::PEOPLE_NAME),
                    Cell::Text("Sam".into()),
                ),
            ]),
        },
        Row {
            id: RowId::from_uuid(Uuid::from_u128(0x72)),
            position: None,
            cells: HashMap::from([
                (
                    column_key(1, PEOPLE_ID),
                    Cell::Entities(vec!["macro|ana@example.com".into()]),
                ),
                (
                    column_key(1, crate::catalog::PEOPLE_NAME),
                    Cell::Text("Ana".into()),
                ),
            ]),
        },
    ];
    let joined = join::join(&plan, vec![deals(), people.clone()]);
    assert_eq!(joined.len(), 4);
    let (rows, ids) = fold_relations(&catalog(), &plan, vec![deals(), people]);
    assert_eq!(
        rows,
        vec![
            vec![
                Some(Cell::Text("Acme".into())),
                Some(Cell::Text("Sam".into()))
            ],
            vec![
                Some(Cell::Text("Globex".into())),
                Some(Cell::Text("Sam".into()))
            ],
            vec![
                Some(Cell::Text("hooli".into())),
                Some(Cell::Text("Ana".into()))
            ],
            vec![Some(Cell::Text("Initech".into())), None],
        ]
    );
    assert_eq!(ids, vec![ACME, GLOBEX, HOOLI, INITECH]);
}

/// Many `%`s over a long text that almost matches: backtracking would try
/// every way to split the text between them.
#[test]
fn like_with_many_wildcards_matches_in_linear_passes() {
    let row = Row {
        id: ACME,
        position: None,
        cells: HashMap::from([(NAME, Cell::Text(format!("{}b", "a".repeat(5_000))))]),
    };
    let like = |pattern: &str| Filter::Like {
        column: NAME,
        pattern: pattern.into(),
        escape: None,
        negated: false,
    };

    assert!(!predicate::holds(&like("%a%a%a%a%a%a%a%a%a%a%a%a%c"), &row));
    assert!(predicate::holds(&like("%a%a%a%a%a%a%a%a%a%a%a%a%b"), &row));
    assert!(predicate::holds(&like("a%_b"), &row));
    assert!(!predicate::holds(&like("%ab_"), &row));
}

/// `0` and `-0` are equal in SQL, so they are one group and one distinct row.
#[test]
fn zero_and_negative_zero_are_one_value() {
    let rows = vec![
        Row {
            id: ACME,
            position: None,
            cells: HashMap::from([(AMOUNT, Cell::Number(0.0))]),
        },
        Row {
            id: GLOBEX,
            position: None,
            cells: HashMap::from([(AMOUNT, Cell::Number(-0.0))]),
        },
    ];

    assert_eq!(
        fold_rows(
            &catalog(),
            &plan("SELECT DISTINCT amount FROM crm.deals"),
            rows.clone()
        ),
        vec![vec![Some(Cell::Number(0.0))]]
    );
    assert_eq!(
        fold_rows(
            &catalog(),
            &plan("SELECT amount, COUNT(*) FROM crm.deals GROUP BY amount"),
            rows
        ),
        vec![vec![Some(Cell::Number(0.0)), Some(Cell::Number(2.0))]]
    );
}

#[test]
fn bins_do_not_answer_a_row_shaped_plan() {
    assert_eq!(
        fold_bins(&catalog(), &plan("SELECT name FROM crm.deals"), vec![]),
        Err(RunError::NotAnsweredByBins)
    );
}
