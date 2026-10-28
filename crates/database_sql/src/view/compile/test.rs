use chrono::{TimeZone, Utc};
use models_databases::ColumnId;
use models_databases::views::{
    Conjunction, DatabaseView, DateOperator, FilterCondition, FilterGroup, FilterNode, FilterTest,
    NumberOperator, PresenceOperator, SetOperator, SortDirection, SortKey, TextOperator, ValueKind,
    ViewLayout, ViewProblem, ViewQuery,
};

use super::*;
use crate::catalog::TableSource;
use crate::resolve::{
    Binding, ComparisonOperator, Direction, Filter, Order, OrderKey, Relation, SelectItem, Value,
    row_position_key,
};
use crate::test_support::*;

const SAM: &str = "macro|sam@example.com";
const ANA: &str = "macro|ana@example.com";

#[test]
fn a_nested_view_is_the_select_its_sql_resolves_to() {
    let view = DatabaseView {
        id: ISSUES_VIEW,
        database_id: WORK,
        table_id: ISSUES,
        name: "Open work".into(),
        position: "80".parse().unwrap(),
        query: ViewQuery {
            filter: Some(FilterGroup {
                conjunction: Conjunction::And,
                conditions: vec![
                    FilterNode::Condition(FilterCondition {
                        column: SUMMARY_PLACEMENT,
                        test: FilterTest::Text {
                            operator: TextOperator::Contains,
                            value: "50%_off\\".into(),
                        },
                    }),
                    FilterNode::Group(FilterGroup {
                        conjunction: Conjunction::Or,
                        conditions: vec![
                            FilterNode::Condition(FilterCondition {
                                column: STATUS_PLACEMENT,
                                test: FilterTest::Options {
                                    operator: SetOperator::IsNoneOf,
                                    options: vec![WONT_DO],
                                },
                            }),
                            FilterNode::Condition(FilterCondition {
                                column: POINTS_PLACEMENT,
                                test: FilterTest::Number {
                                    operator: NumberOperator::GreaterThan,
                                    value: 3.0,
                                },
                            }),
                        ],
                    }),
                ],
            }),
            sort: vec![
                SortKey {
                    column: DUE_PLACEMENT,
                    direction: SortDirection::Descending,
                },
                SortKey {
                    column: SUMMARY_PLACEMENT,
                    direction: SortDirection::Ascending,
                },
            ],
        },
        layout: ViewLayout::Table { columns: vec![] },
        created_at: Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap(),
        updated_at: Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap(),
    };

    let expected = SelectQuery {
        distinct: false,
        relations: vec![Relation {
            table: ISSUES,
            alias: "issues".into(),
            source: TableSource::Database,
        }],
        joins: vec![],
        items: vec![
            SelectItem::Column(SUMMARY),
            SelectItem::Column(POINTS),
            SelectItem::Column(STATUS),
            SelectItem::Column(DUE),
            SelectItem::Column(BLOCKED),
            SelectItem::Column(LABELS),
            SelectItem::Column(ASSIGNEE),
            SelectItem::Column(REVIEWERS),
            SelectItem::Column(SPEC),
            SelectItem::Column(PARENT),
        ],
        labels: vec![],
        where_: Some(Filter::And(vec![
            Filter::Like {
                column: SUMMARY,
                pattern: "%50\\%\\_off\\\\%".into(),
                escape: Some('\\'),
                negated: false,
            },
            Filter::Or(vec![
                Filter::Or(vec![
                    Filter::In {
                        column: STATUS,
                        values: vec![Value::Option(WONT_DO)],
                        negated: true,
                    },
                    Filter::IsNull {
                        column: STATUS,
                        negated: false,
                    },
                ]),
                Filter::Comparison {
                    column: POINTS,
                    operator: ComparisonOperator::Greater,
                    value: Value::Number(3.0),
                },
            ]),
        ])),
        group_by: None,
        order_by: vec![
            Order {
                key: OrderKey::Column(DUE),
                direction: Direction::Descending,
            },
            Order {
                key: OrderKey::Column(SUMMARY),
                direction: Direction::Ascending,
            },
            Order {
                key: OrderKey::Column(row_position_key(ISSUES)),
                direction: Direction::Ascending,
            },
        ],
        limit: None,
        offset: None,
        bindings: vec![
            Binding {
                key: SUMMARY,
                relation: 0,
                column: Some(SUMMARY),
            },
            Binding {
                key: POINTS,
                relation: 0,
                column: Some(POINTS),
            },
            Binding {
                key: STATUS,
                relation: 0,
                column: Some(STATUS),
            },
            Binding {
                key: DUE,
                relation: 0,
                column: Some(DUE),
            },
            Binding {
                key: BLOCKED,
                relation: 0,
                column: Some(BLOCKED),
            },
            Binding {
                key: LABELS,
                relation: 0,
                column: Some(LABELS),
            },
            Binding {
                key: ASSIGNEE,
                relation: 0,
                column: Some(ASSIGNEE),
            },
            Binding {
                key: REVIEWERS,
                relation: 0,
                column: Some(REVIEWERS),
            },
            Binding {
                key: SPEC,
                relation: 0,
                column: Some(SPEC),
            },
            Binding {
                key: PARENT,
                relation: 0,
                column: Some(PARENT),
            },
            Binding {
                key: row_position_key(ISSUES),
                relation: 0,
                column: None,
            },
        ],
    };

    assert_eq!(compile_view(&view, &issues_catalog()), Ok(expected));
}

#[test]
fn every_test_compiles_to_its_filter() {
    let due = Utc.with_ymd_and_hms(2026, 10, 1, 9, 30, 0).unwrap();
    let cases: Vec<(ColumnId, FilterTest, Filter)> = vec![
        (
            DUE_PLACEMENT,
            FilterTest::Presence {
                operator: PresenceOperator::IsEmpty,
            },
            Filter::IsNull {
                column: DUE,
                negated: false,
            },
        ),
        (
            LABELS_PLACEMENT,
            FilterTest::Presence {
                operator: PresenceOperator::IsNotEmpty,
            },
            Filter::IsNull {
                column: LABELS,
                negated: true,
            },
        ),
        (
            SUMMARY_PLACEMENT,
            FilterTest::Text {
                operator: TextOperator::Is,
                value: "Ship it".into(),
            },
            Filter::Comparison {
                column: SUMMARY,
                operator: ComparisonOperator::Equal,
                value: Value::Text("Ship it".into()),
            },
        ),
        (
            SUMMARY_PLACEMENT,
            FilterTest::Text {
                operator: TextOperator::IsNot,
                value: "Ship it".into(),
            },
            Filter::Or(vec![
                Filter::Comparison {
                    column: SUMMARY,
                    operator: ComparisonOperator::NotEqual,
                    value: Value::Text("Ship it".into()),
                },
                Filter::IsNull {
                    column: SUMMARY,
                    negated: false,
                },
            ]),
        ),
        (
            SUMMARY_PLACEMENT,
            FilterTest::Text {
                operator: TextOperator::Contains,
                value: "login".into(),
            },
            Filter::Like {
                column: SUMMARY,
                pattern: "%login%".into(),
                escape: Some('\\'),
                negated: false,
            },
        ),
        (
            SUMMARY_PLACEMENT,
            FilterTest::Text {
                operator: TextOperator::DoesNotContain,
                value: "login".into(),
            },
            Filter::Or(vec![
                Filter::Like {
                    column: SUMMARY,
                    pattern: "%login%".into(),
                    escape: Some('\\'),
                    negated: true,
                },
                Filter::IsNull {
                    column: SUMMARY,
                    negated: false,
                },
            ]),
        ),
        (
            SPEC_PLACEMENT,
            FilterTest::Text {
                operator: TextOperator::StartsWith,
                value: "https://".into(),
            },
            Filter::Like {
                column: SPEC,
                pattern: "https://%".into(),
                escape: Some('\\'),
                negated: false,
            },
        ),
        (
            SUMMARY_PLACEMENT,
            FilterTest::Text {
                operator: TextOperator::EndsWith,
                value: "100%".into(),
            },
            Filter::Like {
                column: SUMMARY,
                pattern: "%100\\%".into(),
                escape: Some('\\'),
                negated: false,
            },
        ),
        (
            POINTS_PLACEMENT,
            FilterTest::Number {
                operator: NumberOperator::Is,
                value: 5.0,
            },
            Filter::Comparison {
                column: POINTS,
                operator: ComparisonOperator::Equal,
                value: Value::Number(5.0),
            },
        ),
        (
            POINTS_PLACEMENT,
            FilterTest::Number {
                operator: NumberOperator::IsNot,
                value: 5.0,
            },
            Filter::Or(vec![
                Filter::Comparison {
                    column: POINTS,
                    operator: ComparisonOperator::NotEqual,
                    value: Value::Number(5.0),
                },
                Filter::IsNull {
                    column: POINTS,
                    negated: false,
                },
            ]),
        ),
        (
            POINTS_PLACEMENT,
            FilterTest::Number {
                operator: NumberOperator::GreaterThan,
                value: -1.5,
            },
            Filter::Comparison {
                column: POINTS,
                operator: ComparisonOperator::Greater,
                value: Value::Number(-1.5),
            },
        ),
        (
            POINTS_PLACEMENT,
            FilterTest::Number {
                operator: NumberOperator::GreaterThanOrEqual,
                value: 2.0,
            },
            Filter::Comparison {
                column: POINTS,
                operator: ComparisonOperator::GreaterOrEqual,
                value: Value::Number(2.0),
            },
        ),
        (
            POINTS_PLACEMENT,
            FilterTest::Number {
                operator: NumberOperator::LessThan,
                value: 8.0,
            },
            Filter::Comparison {
                column: POINTS,
                operator: ComparisonOperator::Less,
                value: Value::Number(8.0),
            },
        ),
        (
            POINTS_PLACEMENT,
            FilterTest::Number {
                operator: NumberOperator::LessThanOrEqual,
                value: 8.0,
            },
            Filter::Comparison {
                column: POINTS,
                operator: ComparisonOperator::LessOrEqual,
                value: Value::Number(8.0),
            },
        ),
        (
            DUE_PLACEMENT,
            FilterTest::Date {
                operator: DateOperator::Before,
                value: due,
            },
            Filter::Comparison {
                column: DUE,
                operator: ComparisonOperator::Less,
                value: Value::Date(due),
            },
        ),
        (
            DUE_PLACEMENT,
            FilterTest::Date {
                operator: DateOperator::After,
                value: due,
            },
            Filter::Comparison {
                column: DUE,
                operator: ComparisonOperator::Greater,
                value: Value::Date(due),
            },
        ),
        (
            DUE_PLACEMENT,
            FilterTest::Date {
                operator: DateOperator::OnOrBefore,
                value: due,
            },
            Filter::Comparison {
                column: DUE,
                operator: ComparisonOperator::LessOrEqual,
                value: Value::Date(due),
            },
        ),
        (
            DUE_PLACEMENT,
            FilterTest::Date {
                operator: DateOperator::OnOrAfter,
                value: due,
            },
            Filter::Comparison {
                column: DUE,
                operator: ComparisonOperator::GreaterOrEqual,
                value: Value::Date(due),
            },
        ),
        (
            BLOCKED_PLACEMENT,
            FilterTest::Checkbox { checked: true },
            Filter::Comparison {
                column: BLOCKED,
                operator: ComparisonOperator::Equal,
                value: Value::Bool(true),
            },
        ),
        (
            BLOCKED_PLACEMENT,
            FilterTest::Checkbox { checked: false },
            Filter::Or(vec![
                Filter::Comparison {
                    column: BLOCKED,
                    operator: ComparisonOperator::Equal,
                    value: Value::Bool(false),
                },
                Filter::IsNull {
                    column: BLOCKED,
                    negated: false,
                },
            ]),
        ),
        (
            STATUS_PLACEMENT,
            FilterTest::Options {
                operator: SetOperator::IsAnyOf,
                options: vec![TODO, DOING],
            },
            Filter::In {
                column: STATUS,
                values: vec![Value::Option(TODO), Value::Option(DOING)],
                negated: false,
            },
        ),
        (
            STATUS_PLACEMENT,
            FilterTest::Options {
                operator: SetOperator::IsNoneOf,
                options: vec![TODO, DOING],
            },
            Filter::Or(vec![
                Filter::In {
                    column: STATUS,
                    values: vec![Value::Option(TODO), Value::Option(DOING)],
                    negated: true,
                },
                Filter::IsNull {
                    column: STATUS,
                    negated: false,
                },
            ]),
        ),
        (
            LABELS_PLACEMENT,
            FilterTest::Options {
                operator: SetOperator::HasAny,
                options: vec![BUG],
            },
            Filter::Has {
                column: LABELS,
                value: Value::Option(BUG),
                negated: false,
            },
        ),
        (
            LABELS_PLACEMENT,
            FilterTest::Options {
                operator: SetOperator::HasAny,
                options: vec![BUG, FEATURE],
            },
            Filter::Or(vec![
                Filter::Has {
                    column: LABELS,
                    value: Value::Option(BUG),
                    negated: false,
                },
                Filter::Has {
                    column: LABELS,
                    value: Value::Option(FEATURE),
                    negated: false,
                },
            ]),
        ),
        (
            LABELS_PLACEMENT,
            FilterTest::Options {
                operator: SetOperator::HasAll,
                options: vec![BUG, FEATURE],
            },
            Filter::And(vec![
                Filter::Has {
                    column: LABELS,
                    value: Value::Option(BUG),
                    negated: false,
                },
                Filter::Has {
                    column: LABELS,
                    value: Value::Option(FEATURE),
                    negated: false,
                },
            ]),
        ),
        (
            LABELS_PLACEMENT,
            FilterTest::Options {
                operator: SetOperator::HasNone,
                options: vec![BUG, FEATURE],
            },
            Filter::And(vec![
                Filter::Has {
                    column: LABELS,
                    value: Value::Option(BUG),
                    negated: true,
                },
                Filter::Has {
                    column: LABELS,
                    value: Value::Option(FEATURE),
                    negated: true,
                },
            ]),
        ),
        (
            ASSIGNEE_PLACEMENT,
            FilterTest::Entities {
                operator: SetOperator::IsAnyOf,
                entities: vec![SAM.into()],
            },
            Filter::In {
                column: ASSIGNEE,
                values: vec![Value::Entity(SAM.into())],
                negated: false,
            },
        ),
        (
            PARENT_PLACEMENT,
            FilterTest::Entities {
                operator: SetOperator::IsNoneOf,
                entities: vec!["00000000-0000-0000-0000-000000000101".into()],
            },
            Filter::Or(vec![
                Filter::In {
                    column: PARENT,
                    values: vec![Value::Entity("00000000-0000-0000-0000-000000000101".into())],
                    negated: true,
                },
                Filter::IsNull {
                    column: PARENT,
                    negated: false,
                },
            ]),
        ),
        (
            REVIEWERS_PLACEMENT,
            FilterTest::Entities {
                operator: SetOperator::HasAny,
                entities: vec![SAM.into(), ANA.into()],
            },
            Filter::Or(vec![
                Filter::Has {
                    column: REVIEWERS,
                    value: Value::Entity(SAM.into()),
                    negated: false,
                },
                Filter::Has {
                    column: REVIEWERS,
                    value: Value::Entity(ANA.into()),
                    negated: false,
                },
            ]),
        ),
        (
            REVIEWERS_PLACEMENT,
            FilterTest::Entities {
                operator: SetOperator::HasAll,
                entities: vec![SAM.into()],
            },
            Filter::Has {
                column: REVIEWERS,
                value: Value::Entity(SAM.into()),
                negated: false,
            },
        ),
        (
            REVIEWERS_PLACEMENT,
            FilterTest::Entities {
                operator: SetOperator::HasNone,
                entities: vec![SAM.into()],
            },
            Filter::Has {
                column: REVIEWERS,
                value: Value::Entity(SAM.into()),
                negated: true,
            },
        ),
    ];

    for (column, test, expected) in cases {
        let compiled = compile_view(
            &issues_view(
                ViewQuery {
                    filter: Some(FilterGroup {
                        conjunction: Conjunction::And,
                        conditions: vec![FilterNode::Condition(FilterCondition {
                            column,
                            test: test.clone(),
                        })],
                    }),
                    sort: vec![],
                },
                ViewLayout::Table { columns: vec![] },
            ),
            &issues_catalog(),
        )
        .unwrap();
        assert_eq!(compiled.where_, Some(expected), "{test:?}");
    }
}

#[test]
fn groups_collapse_and_empty_groups_keep_every_row() {
    let blocked = FilterNode::Condition(FilterCondition {
        column: BLOCKED_PLACEMENT,
        test: FilterTest::Checkbox { checked: true },
    });
    let blocked_filter = Filter::Comparison {
        column: BLOCKED,
        operator: ComparisonOperator::Equal,
        value: Value::Bool(true),
    };
    let empty = |conjunction| FilterGroup {
        conjunction,
        conditions: vec![],
    };
    let cases: Vec<(&str, Option<FilterGroup>, Option<Filter>)> = vec![
        ("no filter", None, None),
        ("an empty group", Some(empty(Conjunction::And)), None),
        (
            "one condition, either conjunction",
            Some(FilterGroup {
                conjunction: Conjunction::Or,
                conditions: vec![blocked.clone()],
            }),
            Some(blocked_filter.clone()),
        ),
        (
            "a group holding one group holding one condition",
            Some(FilterGroup {
                conjunction: Conjunction::And,
                conditions: vec![FilterNode::Group(FilterGroup {
                    conjunction: Conjunction::Or,
                    conditions: vec![blocked.clone()],
                })],
            }),
            Some(blocked_filter.clone()),
        ),
        (
            "an empty group under AND asks nothing more",
            Some(FilterGroup {
                conjunction: Conjunction::And,
                conditions: vec![blocked.clone(), FilterNode::Group(empty(Conjunction::Or))],
            }),
            Some(blocked_filter.clone()),
        ),
        (
            "an empty group under OR lets every row through",
            Some(FilterGroup {
                conjunction: Conjunction::Or,
                conditions: vec![blocked.clone(), FilterNode::Group(empty(Conjunction::And))],
            }),
            None,
        ),
    ];

    for (case, filter, expected) in cases {
        let compiled = compile_view(
            &issues_view(
                ViewQuery {
                    filter,
                    sort: vec![],
                },
                ViewLayout::Table { columns: vec![] },
            ),
            &issues_catalog(),
        )
        .unwrap();
        assert_eq!(compiled.where_, expected, "{case}");
    }
}

#[test]
fn an_unsorted_view_keeps_the_table_order() {
    let compiled = compile_view(
        &issues_view(ViewQuery::default(), ViewLayout::Table { columns: vec![] }),
        &issues_catalog(),
    )
    .unwrap();

    assert_eq!(
        compiled.order_by,
        vec![Order {
            key: OrderKey::Column(row_position_key(ISSUES)),
            direction: Direction::Ascending,
        }]
    );
}

#[test]
fn a_view_that_does_not_fit_its_table_is_refused() {
    let in_another_table = DatabaseView {
        table_id: DEALS,
        ..issues_view(ViewQuery::default(), ViewLayout::Table { columns: vec![] })
    };
    assert_eq!(
        compile_view(&in_another_table, &issues_catalog()),
        Err(ViewProblem::UnknownTable { table: DEALS })
    );

    let by_definition = issues_view(
        ViewQuery {
            filter: None,
            sort: vec![SortKey {
                column: ColumnId::from_uuid(SUMMARY),
                direction: SortDirection::Ascending,
            }],
        },
        ViewLayout::Table { columns: vec![] },
    );
    assert_eq!(
        compile_view(&by_definition, &issues_catalog()),
        Err(ViewProblem::UnknownColumn {
            column: ColumnId::from_uuid(SUMMARY)
        })
    );

    let misfit = issues_view(
        ViewQuery {
            filter: Some(FilterGroup {
                conjunction: Conjunction::And,
                conditions: vec![FilterNode::Condition(FilterCondition {
                    column: POINTS_PLACEMENT,
                    test: FilterTest::Text {
                        operator: TextOperator::Is,
                        value: "5".into(),
                    },
                })],
            }),
            sort: vec![],
        },
        ViewLayout::Table { columns: vec![] },
    );
    assert_eq!(
        compile_view(&misfit, &issues_catalog()),
        Err(ViewProblem::TestDoesNotFit {
            column: "points".into(),
            holds: ValueKind::Number,
            test: ValueKind::Text,
        })
    );
}
