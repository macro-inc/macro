use chrono::{DateTime, TimeZone, Utc};
use uuid::Uuid;

use super::*;
use crate::ids::{OptionId, RowId};
use crate::ops::{EntityKind, EntityRef, OptionRef};
use crate::views::{
    Conjunction, DateOperator, FilterCondition, FilterNode, FilterTest, NumberOperator,
    PresenceOperator, SetOperator, TextOperator,
};

const TEAM: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0x7ea));
const START: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0x57a));
const CONTRACTOR: OptionId = OptionId::from_uuid(Uuid::from_u128(0xc0));
const DESIGN: OptionId = OptionId::from_uuid(Uuid::from_u128(0xd0));
const SALES: OptionId = OptionId::from_uuid(Uuid::from_u128(0x5a));

fn september_first() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap()
}

#[test]
fn a_gate_passes_answers_that_meet_every_rule_and_stops_the_rest() {
    // IF Team is not Contractor AND Start date is before Sep 1, 2026.
    let gate = FilterGroup {
        conjunction: Conjunction::And,
        conditions: vec![
            FilterNode::Condition(FilterCondition {
                column: TEAM,
                test: FilterTest::Options {
                    operator: SetOperator::IsNoneOf,
                    options: vec![CONTRACTOR],
                },
            }),
            FilterNode::Condition(FilterCondition {
                column: START,
                test: FilterTest::Date {
                    operator: DateOperator::Before,
                    value: Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap(),
                },
            }),
        ],
    };

    let designer_in_august = HashMap::from([
        (TEAM, CellValue::Options(vec![OptionRef::Id(DESIGN)])),
        (
            START,
            CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 9, 0, 0).unwrap()),
        ),
    ]);
    assert!(matches(&gate, &designer_in_august));

    let contractor_in_august = HashMap::from([
        (TEAM, CellValue::Options(vec![OptionRef::Id(CONTRACTOR)])),
        (
            START,
            CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 9, 0, 0).unwrap()),
        ),
    ]);
    assert!(!matches(&gate, &contractor_in_august));

    // Strict: an unanswered team fails "is none of" too.
    let no_team = HashMap::from([(
        START,
        CellValue::Date(Utc.with_ymd_and_hms(2026, 8, 17, 9, 0, 0).unwrap()),
    )]);
    assert!(!matches(&gate, &no_team));
}

/// One condition on one column, against one cell (`None`: absent).
struct Case {
    name: &'static str,
    test: FilterTest,
    cell: Option<CellValue>,
    expected: bool,
}

fn run(cases: Vec<Case>) {
    let mut failures = Vec::new();
    for case in cases {
        let group = FilterGroup {
            conjunction: Conjunction::And,
            conditions: vec![FilterNode::Condition(FilterCondition {
                column: TEAM,
                test: case.test.clone(),
            })],
        };
        let cells: HashMap<ColumnId, CellValue> = case
            .cell
            .clone()
            .map(|cell| HashMap::from([(TEAM, cell)]))
            .unwrap_or_default();
        if matches(&group, &cells) != case.expected {
            failures.push(format!(
                "{}: {:?} on {:?} should be {}",
                case.name, case.test, case.cell, case.expected
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn text(operator: TextOperator, value: &str) -> FilterTest {
    FilterTest::Text {
        operator,
        value: value.into(),
    }
}

#[test]
fn presence_tests_see_absent_clear_blank_and_memberless_cells_as_empty() {
    let empty = |operator| FilterTest::Presence { operator };
    run(vec![
        Case {
            name: "absent is empty",
            test: empty(PresenceOperator::IsEmpty),
            cell: None,
            expected: true,
        },
        Case {
            name: "clear is empty",
            test: empty(PresenceOperator::IsEmpty),
            cell: Some(CellValue::Clear),
            expected: true,
        },
        Case {
            name: "blank text is empty",
            test: empty(PresenceOperator::IsEmpty),
            cell: Some(CellValue::Text("  ".into())),
            expected: true,
        },
        Case {
            name: "no options is empty",
            test: empty(PresenceOperator::IsEmpty),
            cell: Some(CellValue::Options(vec![])),
            expected: true,
        },
        Case {
            name: "no links is empty",
            test: empty(PresenceOperator::IsEmpty),
            cell: Some(CellValue::Link(vec![])),
            expected: true,
        },
        Case {
            name: "no entities is empty",
            test: empty(PresenceOperator::IsEmpty),
            cell: Some(CellValue::Entities(vec![])),
            expected: true,
        },
        Case {
            name: "no rows is empty",
            test: empty(PresenceOperator::IsEmpty),
            cell: Some(CellValue::Rows(vec![])),
            expected: true,
        },
        Case {
            name: "text is not empty",
            test: empty(PresenceOperator::IsEmpty),
            cell: Some(CellValue::Text("Sam".into())),
            expected: false,
        },
        Case {
            name: "an unchecked box is a value",
            test: empty(PresenceOperator::IsEmpty),
            cell: Some(CellValue::Boolean(false)),
            expected: false,
        },
        Case {
            name: "zero is a value",
            test: empty(PresenceOperator::IsNotEmpty),
            cell: Some(CellValue::Number(0.0)),
            expected: true,
        },
        Case {
            name: "absent is not not-empty",
            test: empty(PresenceOperator::IsNotEmpty),
            cell: None,
            expected: false,
        },
        Case {
            name: "clear is not not-empty",
            test: empty(PresenceOperator::IsNotEmpty),
            cell: Some(CellValue::Clear),
            expected: false,
        },
    ]);
}

#[test]
fn text_tests_ignore_case_and_fail_on_empty_cells() {
    let sam = || Some(CellValue::Text("Sam Rivera".into()));
    run(vec![
        Case {
            name: "is, other case",
            test: text(TextOperator::Is, "sam rivera"),
            cell: sam(),
            expected: true,
        },
        Case {
            name: "is, other text",
            test: text(TextOperator::Is, "Sam"),
            cell: sam(),
            expected: false,
        },
        Case {
            name: "is, absent",
            test: text(TextOperator::Is, "Sam"),
            cell: None,
            expected: false,
        },
        Case {
            name: "is not, other text",
            test: text(TextOperator::IsNot, "Alex"),
            cell: sam(),
            expected: true,
        },
        Case {
            name: "is not, same text in other case",
            test: text(TextOperator::IsNot, "SAM RIVERA"),
            cell: sam(),
            expected: false,
        },
        Case {
            name: "is not, absent",
            test: text(TextOperator::IsNot, "Alex"),
            cell: None,
            expected: false,
        },
        Case {
            name: "is not, clear",
            test: text(TextOperator::IsNot, "Alex"),
            cell: Some(CellValue::Clear),
            expected: false,
        },
        Case {
            name: "contains",
            test: text(TextOperator::Contains, "RIV"),
            cell: sam(),
            expected: true,
        },
        Case {
            name: "contains, missing",
            test: text(TextOperator::Contains, "lee"),
            cell: sam(),
            expected: false,
        },
        Case {
            name: "contains, clear",
            test: text(TextOperator::Contains, "riv"),
            cell: Some(CellValue::Clear),
            expected: false,
        },
        Case {
            name: "does not contain",
            test: text(TextOperator::DoesNotContain, "lee"),
            cell: sam(),
            expected: true,
        },
        Case {
            name: "does not contain, present in other case",
            test: text(TextOperator::DoesNotContain, "RIVERA"),
            cell: sam(),
            expected: false,
        },
        Case {
            name: "does not contain, absent",
            test: text(TextOperator::DoesNotContain, "lee"),
            cell: None,
            expected: false,
        },
        Case {
            name: "starts with",
            test: text(TextOperator::StartsWith, "sAm"),
            cell: sam(),
            expected: true,
        },
        Case {
            name: "starts with, ends instead",
            test: text(TextOperator::StartsWith, "rivera"),
            cell: sam(),
            expected: false,
        },
        Case {
            name: "starts with, absent",
            test: text(TextOperator::StartsWith, "sam"),
            cell: None,
            expected: false,
        },
        Case {
            name: "ends with",
            test: text(TextOperator::EndsWith, "RIVERA"),
            cell: sam(),
            expected: true,
        },
        Case {
            name: "ends with, starts instead",
            test: text(TextOperator::EndsWith, "sam"),
            cell: sam(),
            expected: false,
        },
        Case {
            name: "ends with, clear",
            test: text(TextOperator::EndsWith, "rivera"),
            cell: Some(CellValue::Clear),
            expected: false,
        },
        Case {
            name: "a link matches a text test",
            test: text(TextOperator::Contains, "EXAMPLE.com"),
            cell: Some(CellValue::Link(vec!["https://example.com/a".into()])),
            expected: true,
        },
        Case {
            name: "a link that is not it",
            test: text(TextOperator::IsNot, "https://example.com/b"),
            cell: Some(CellValue::Link(vec!["https://example.com/a".into()])),
            expected: true,
        },
        Case {
            name: "a link that is it",
            test: text(TextOperator::IsNot, "https://EXAMPLE.com/a"),
            cell: Some(CellValue::Link(vec!["https://example.com/a".into()])),
            expected: false,
        },
        Case {
            name: "a text test on a number fails",
            test: text(TextOperator::Is, "3"),
            cell: Some(CellValue::Number(3.0)),
            expected: false,
        },
    ]);
}

#[test]
fn number_tests_compare_and_fail_on_empty_cells() {
    let number = |operator, value| FilterTest::Number { operator, value };
    let three = || Some(CellValue::Number(3.0));
    run(vec![
        Case {
            name: "is",
            test: number(NumberOperator::Is, 3.0),
            cell: three(),
            expected: true,
        },
        Case {
            name: "is, other",
            test: number(NumberOperator::Is, 4.0),
            cell: three(),
            expected: false,
        },
        Case {
            name: "is, absent",
            test: number(NumberOperator::Is, 3.0),
            cell: None,
            expected: false,
        },
        Case {
            name: "is not",
            test: number(NumberOperator::IsNot, 4.0),
            cell: three(),
            expected: true,
        },
        Case {
            name: "is not, same",
            test: number(NumberOperator::IsNot, 3.0),
            cell: three(),
            expected: false,
        },
        Case {
            name: "is not, absent",
            test: number(NumberOperator::IsNot, 4.0),
            cell: None,
            expected: false,
        },
        Case {
            name: "is not, clear",
            test: number(NumberOperator::IsNot, 4.0),
            cell: Some(CellValue::Clear),
            expected: false,
        },
        Case {
            name: "greater than",
            test: number(NumberOperator::GreaterThan, 2.0),
            cell: three(),
            expected: true,
        },
        Case {
            name: "greater than, equal",
            test: number(NumberOperator::GreaterThan, 3.0),
            cell: three(),
            expected: false,
        },
        Case {
            name: "greater than or equal, equal",
            test: number(NumberOperator::GreaterThanOrEqual, 3.0),
            cell: three(),
            expected: true,
        },
        Case {
            name: "greater than or equal, less",
            test: number(NumberOperator::GreaterThanOrEqual, 3.5),
            cell: three(),
            expected: false,
        },
        Case {
            name: "less than",
            test: number(NumberOperator::LessThan, 4.0),
            cell: three(),
            expected: true,
        },
        Case {
            name: "less than, equal",
            test: number(NumberOperator::LessThan, 3.0),
            cell: three(),
            expected: false,
        },
        Case {
            name: "less than or equal, equal",
            test: number(NumberOperator::LessThanOrEqual, 3.0),
            cell: three(),
            expected: true,
        },
        Case {
            name: "less than or equal, absent",
            test: number(NumberOperator::LessThanOrEqual, 3.0),
            cell: None,
            expected: false,
        },
        Case {
            name: "a number test on text fails",
            test: number(NumberOperator::Is, 3.0),
            cell: Some(CellValue::Text("3".into())),
            expected: false,
        },
    ]);
}

#[test]
fn date_tests_compare_and_fail_on_empty_cells() {
    let date = |operator| FilterTest::Date {
        operator,
        value: september_first(),
    };
    let august = || {
        Some(CellValue::Date(
            Utc.with_ymd_and_hms(2026, 8, 31, 23, 59, 0).unwrap(),
        ))
    };
    let on_the_day = || Some(CellValue::Date(september_first()));
    run(vec![
        Case {
            name: "before",
            test: date(DateOperator::Before),
            cell: august(),
            expected: true,
        },
        Case {
            name: "before, same instant",
            test: date(DateOperator::Before),
            cell: on_the_day(),
            expected: false,
        },
        Case {
            name: "before, absent",
            test: date(DateOperator::Before),
            cell: None,
            expected: false,
        },
        Case {
            name: "after",
            test: date(DateOperator::After),
            cell: august(),
            expected: false,
        },
        Case {
            name: "after, clear",
            test: date(DateOperator::After),
            cell: Some(CellValue::Clear),
            expected: false,
        },
        Case {
            name: "on or before, same instant",
            test: date(DateOperator::OnOrBefore),
            cell: on_the_day(),
            expected: true,
        },
        Case {
            name: "on or after, same instant",
            test: date(DateOperator::OnOrAfter),
            cell: on_the_day(),
            expected: true,
        },
        Case {
            name: "on or after, earlier",
            test: date(DateOperator::OnOrAfter),
            cell: august(),
            expected: false,
        },
        Case {
            name: "on or after, absent",
            test: date(DateOperator::OnOrAfter),
            cell: None,
            expected: false,
        },
    ]);
}

#[test]
fn checkbox_tests_need_a_checkbox_value() {
    let checkbox = |checked| FilterTest::Checkbox { checked };
    run(vec![
        Case {
            name: "checked, checked",
            test: checkbox(true),
            cell: Some(CellValue::Boolean(true)),
            expected: true,
        },
        Case {
            name: "checked, unchecked",
            test: checkbox(true),
            cell: Some(CellValue::Boolean(false)),
            expected: false,
        },
        Case {
            name: "checked, absent",
            test: checkbox(true),
            cell: None,
            expected: false,
        },
        Case {
            name: "unchecked, unchecked",
            test: checkbox(false),
            cell: Some(CellValue::Boolean(false)),
            expected: true,
        },
        Case {
            name: "unchecked, checked",
            test: checkbox(false),
            cell: Some(CellValue::Boolean(true)),
            expected: false,
        },
        Case {
            name: "unchecked, absent (strict)",
            test: checkbox(false),
            cell: None,
            expected: false,
        },
        Case {
            name: "unchecked, clear (strict)",
            test: checkbox(false),
            cell: Some(CellValue::Clear),
            expected: false,
        },
    ]);
}

#[test]
fn option_tests_compare_option_ids_and_fail_on_empty_cells() {
    let options = |operator, options: Vec<OptionId>| FilterTest::Options { operator, options };
    let design = || Some(CellValue::Options(vec![OptionRef::Id(DESIGN)]));
    let design_and_sales = || {
        Some(CellValue::Options(vec![
            OptionRef::Id(DESIGN),
            OptionRef::Id(SALES),
        ]))
    };
    run(vec![
        Case {
            name: "is any of",
            test: options(SetOperator::IsAnyOf, vec![DESIGN, SALES]),
            cell: design(),
            expected: true,
        },
        Case {
            name: "is any of, other",
            test: options(SetOperator::IsAnyOf, vec![CONTRACTOR]),
            cell: design(),
            expected: false,
        },
        Case {
            name: "is any of, absent",
            test: options(SetOperator::IsAnyOf, vec![DESIGN]),
            cell: None,
            expected: false,
        },
        Case {
            name: "is none of",
            test: options(SetOperator::IsNoneOf, vec![CONTRACTOR]),
            cell: design(),
            expected: true,
        },
        Case {
            name: "is none of, named",
            test: options(SetOperator::IsNoneOf, vec![DESIGN]),
            cell: design(),
            expected: false,
        },
        Case {
            name: "is none of, absent (strict)",
            test: options(SetOperator::IsNoneOf, vec![CONTRACTOR]),
            cell: None,
            expected: false,
        },
        Case {
            name: "is none of, clear (strict)",
            test: options(SetOperator::IsNoneOf, vec![CONTRACTOR]),
            cell: Some(CellValue::Clear),
            expected: false,
        },
        Case {
            name: "is none of, no options (strict)",
            test: options(SetOperator::IsNoneOf, vec![CONTRACTOR]),
            cell: Some(CellValue::Options(vec![])),
            expected: false,
        },
        Case {
            name: "has any",
            test: options(SetOperator::HasAny, vec![SALES, CONTRACTOR]),
            cell: design_and_sales(),
            expected: true,
        },
        Case {
            name: "has any, none held",
            test: options(SetOperator::HasAny, vec![CONTRACTOR]),
            cell: design_and_sales(),
            expected: false,
        },
        Case {
            name: "has all",
            test: options(SetOperator::HasAll, vec![DESIGN, SALES]),
            cell: design_and_sales(),
            expected: true,
        },
        Case {
            name: "has all, one missing",
            test: options(SetOperator::HasAll, vec![DESIGN, CONTRACTOR]),
            cell: design_and_sales(),
            expected: false,
        },
        Case {
            name: "has all, absent",
            test: options(SetOperator::HasAll, vec![DESIGN]),
            cell: None,
            expected: false,
        },
        Case {
            name: "has none",
            test: options(SetOperator::HasNone, vec![CONTRACTOR]),
            cell: design_and_sales(),
            expected: true,
        },
        Case {
            name: "has none, one held",
            test: options(SetOperator::HasNone, vec![SALES]),
            cell: design_and_sales(),
            expected: false,
        },
        Case {
            name: "has none, absent (strict)",
            test: options(SetOperator::HasNone, vec![CONTRACTOR]),
            cell: None,
            expected: false,
        },
        Case {
            name: "an option named by label never matches an id",
            test: options(SetOperator::IsAnyOf, vec![DESIGN]),
            cell: Some(CellValue::Options(vec![OptionRef::Label("Design".into())])),
            expected: false,
        },
    ]);
}

#[test]
fn entity_tests_compare_entity_and_row_ids_and_fail_on_empty_cells() {
    let entities = |operator, entities: Vec<&str>| FilterTest::Entities {
        operator,
        entities: entities.into_iter().map(String::from).collect(),
    };
    let sam = || {
        Some(CellValue::Entities(vec![EntityRef {
            entity_type: EntityKind::User,
            entity_id: "macro|sam@macro.com".into(),
        }]))
    };
    let row = RowId::from_uuid(Uuid::from_u128(0x40a));
    let related = || Some(CellValue::Rows(vec![row]));
    run(vec![
        Case {
            name: "is any of",
            test: entities(SetOperator::IsAnyOf, vec!["macro|sam@macro.com"]),
            cell: sam(),
            expected: true,
        },
        Case {
            name: "is any of, other",
            test: entities(SetOperator::IsAnyOf, vec!["macro|alex@macro.com"]),
            cell: sam(),
            expected: false,
        },
        Case {
            name: "is none of",
            test: entities(SetOperator::IsNoneOf, vec!["macro|alex@macro.com"]),
            cell: sam(),
            expected: true,
        },
        Case {
            name: "is none of, absent (strict)",
            test: entities(SetOperator::IsNoneOf, vec!["macro|alex@macro.com"]),
            cell: None,
            expected: false,
        },
        Case {
            name: "has any, a related row",
            test: entities(
                SetOperator::HasAny,
                vec!["00000000-0000-0000-0000-00000000040a"],
            ),
            cell: related(),
            expected: true,
        },
        Case {
            name: "has all, a related row",
            test: entities(
                SetOperator::HasAll,
                vec!["00000000-0000-0000-0000-00000000040a", "other"],
            ),
            cell: related(),
            expected: false,
        },
        Case {
            name: "has none, a related row",
            test: entities(SetOperator::HasNone, vec!["other"]),
            cell: related(),
            expected: true,
        },
        Case {
            name: "has none, clear (strict)",
            test: entities(SetOperator::HasNone, vec!["other"]),
            cell: Some(CellValue::Clear),
            expected: false,
        },
    ]);
}

#[test]
fn groups_combine_like_a_view_and_an_empty_group_passes() {
    let is_design = FilterNode::Condition(FilterCondition {
        column: TEAM,
        test: FilterTest::Options {
            operator: SetOperator::IsAnyOf,
            options: vec![DESIGN],
        },
    });
    let started = FilterNode::Condition(FilterCondition {
        column: START,
        test: FilterTest::Presence {
            operator: PresenceOperator::IsNotEmpty,
        },
    });
    let design_only = HashMap::from([(TEAM, CellValue::Options(vec![OptionRef::Id(DESIGN)]))]);
    let both = |conjunction| FilterGroup {
        conjunction,
        conditions: vec![is_design.clone(), started.clone()],
    };

    assert!(!matches(&both(Conjunction::And), &design_only));
    assert!(matches(&both(Conjunction::Or), &design_only));
    assert!(matches(
        &FilterGroup {
            conjunction: Conjunction::And,
            conditions: vec![],
        },
        &HashMap::new()
    ));
    // A nested group without conditions keeps every row, as a view's does:
    // it drops out of an AND and satisfies an OR.
    let empty_group = FilterNode::Group(FilterGroup {
        conjunction: Conjunction::And,
        conditions: vec![],
    });
    assert!(!matches(
        &FilterGroup {
            conjunction: Conjunction::And,
            conditions: vec![empty_group.clone(), started.clone()],
        },
        &design_only
    ));
    assert!(matches(
        &FilterGroup {
            conjunction: Conjunction::Or,
            conditions: vec![empty_group, started.clone()],
        },
        &design_only
    ));
    assert!(matches(
        &FilterGroup {
            conjunction: Conjunction::Or,
            conditions: vec![
                started,
                FilterNode::Group(FilterGroup {
                    conjunction: Conjunction::And,
                    conditions: vec![is_design],
                }),
            ],
        },
        &design_only
    ));
}
