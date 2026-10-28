use filter_ast::Expr;
use item_filters::ast::properties::{EntityRefId, PropertiesLiteral, PropertyMatchValue};

use super::*;
use crate::catalog::{PEOPLE_EMAIL, PEOPLE_ID, PEOPLE_NAME, PEOPLE_TABLE};
use crate::resolve::{
    AggregateFunction, ComparisonOperator, Direction, JoinKind, Order, OrderKey, Query, Relation,
    Value, column_key, compile, row_id_key,
};
use crate::test_support::{catalog, *};

fn select(sql: &str) -> SelectQuery {
    match compile(&catalog(), sql).unwrap() {
        Query::Select(select) => select,
        Query::Insert(_) | Query::Update(_) | Query::Delete(_) | Query::AlterColumnType(_) => {
            panic!("not a SELECT")
        }
    }
}

#[test]
fn pushable_and_residual_conjuncts_are_divided() {
    let plan = split(
        &catalog(),
        select(
            "SELECT name, amount FROM crm.deals WHERE stage = 'Won' AND amount > 5000 ORDER BY amount DESC",
        ),
    );

    assert_eq!(
        plan,
        Plan {
            relations: vec![RelationPlan {
                relation: Relation {
                    table: DEALS,
                    alias: "deals".into(),
                    source: TableSource::Database,
                },
                query: GqlQuery::Soup {
                    table: DEALS,
                    property_filter: Some(Expr::Literal(PropertiesLiteral {
                        property_definition_id: STAGE,
                        entity_type: None,
                        value: PropertyMatchValue::SelectOption(WON.into_uuid())
                    })),
                    key_hint: None,
                },
                needs: vec![NAME, AMOUNT],
            }],
            joins: vec![],
            residual: Some(Filter::Comparison {
                column: AMOUNT,
                operator: ComparisonOperator::Greater,
                value: Value::Number(5000.0),
            }),
            distinct: false,
            shape: Shape::Rows(vec![NAME, AMOUNT]),
            order_by: vec![Order {
                key: OrderKey::Column(AMOUNT),
                direction: Direction::Descending,
            }],
            limit: None,
            offset: None,
            bindings: plan.bindings.clone(),
        }
    );
}

#[test]
fn an_or_with_a_residual_side_pushes_nothing() {
    let plan = split(
        &catalog(),
        select("SELECT name FROM crm.deals WHERE stage = 'Won' OR amount > 5000"),
    );

    assert_eq!(
        plan,
        Plan {
            relations: vec![RelationPlan {
                relation: Relation {
                    table: DEALS,
                    alias: "deals".into(),
                    source: TableSource::Database,
                },
                query: GqlQuery::Soup {
                    table: DEALS,
                    property_filter: None,
                    key_hint: None,
                },
                needs: vec![NAME, STAGE, AMOUNT],
            }],
            joins: vec![],
            residual: Some(Filter::Or(vec![
                Filter::Comparison {
                    column: STAGE,
                    operator: ComparisonOperator::Equal,
                    value: Value::Option(WON),
                },
                Filter::Comparison {
                    column: AMOUNT,
                    operator: ComparisonOperator::Greater,
                    value: Value::Number(5000.0),
                },
            ])),
            distinct: false,
            shape: Shape::Rows(vec![NAME]),
            order_by: vec![],
            limit: None,
            offset: None,
            bindings: plan.bindings.clone(),
        }
    );
}

#[test]
fn in_lists_nested_ors_and_has_push_as_one_expression() {
    let plan = split(
        &catalog(),
        select(
            "SELECT name FROM crm.deals
             WHERE (stage IN ('Won', 'Lead') OR owner = 'macro|sam@example.com')
               AND tags HAS 'vip'
               AND name LIKE 'A%'",
        ),
    );

    assert_eq!(
        plan,
        Plan {
            relations: vec![RelationPlan {
                relation: Relation {
                    table: DEALS,
                    alias: "deals".into(),
                    source: TableSource::Database,
                },
                query: GqlQuery::Soup {
                    table: DEALS,
                    property_filter: Some(Expr::and(
                        Expr::or(
                            Expr::or(
                                Expr::Literal(PropertiesLiteral {
                                    property_definition_id: STAGE,
                                    entity_type: None,
                                    value: PropertyMatchValue::SelectOption(WON.into_uuid())
                                }),
                                Expr::Literal(PropertiesLiteral {
                                    property_definition_id: STAGE,
                                    entity_type: None,
                                    value: PropertyMatchValue::SelectOption(LEAD.into_uuid())
                                })
                            ),
                            Expr::Literal(PropertiesLiteral {
                                property_definition_id: OWNER,
                                entity_type: None,
                                value: PropertyMatchValue::EntityRef(
                                    EntityRefId::new("macro|sam@example.com".into()).unwrap()
                                )
                            }),
                        ),
                        Expr::Literal(PropertiesLiteral {
                            property_definition_id: TAGS,
                            entity_type: None,
                            value: PropertyMatchValue::SelectOption(VIP.into_uuid())
                        }),
                    )),
                    key_hint: None,
                },
                needs: vec![NAME],
            }],
            joins: vec![],
            residual: Some(Filter::Like {
                column: NAME,
                pattern: "A%".into(),
                escape: None,
                negated: false,
            }),
            distinct: false,
            shape: Shape::Rows(vec![NAME]),
            order_by: vec![],
            limit: None,
            offset: None,
            bindings: plan.bindings.clone(),
        }
    );
}

#[test]
fn negations_stay_residual_because_soup_not_keeps_empty_cells() {
    let plan = split(
        &catalog(),
        select(
            "SELECT name FROM crm.deals
             WHERE stage != 'Won' AND tags NOT HAS 'vip' AND owner NOT IN ('macro|sam@example.com') AND done = TRUE",
        ),
    );

    assert_eq!(
        plan,
        Plan {
            relations: vec![RelationPlan {
                relation: Relation {
                    table: DEALS,
                    alias: "deals".into(),
                    source: TableSource::Database,
                },
                query: GqlQuery::Soup {
                    table: DEALS,
                    property_filter: None,
                    key_hint: None,
                },
                needs: vec![NAME, STAGE, TAGS, OWNER, DONE],
            }],
            joins: vec![],
            residual: Some(Filter::And(vec![
                Filter::Comparison {
                    column: STAGE,
                    operator: ComparisonOperator::NotEqual,
                    value: Value::Option(WON),
                },
                Filter::Has {
                    column: TAGS,
                    value: Value::Option(VIP),
                    negated: true,
                },
                Filter::In {
                    column: OWNER,
                    values: vec![Value::Entity("macro|sam@example.com".into())],
                    negated: true,
                },
                Filter::Comparison {
                    column: DONE,
                    operator: ComparisonOperator::Equal,
                    value: Value::Bool(true),
                },
            ])),
            distinct: false,
            shape: Shape::Rows(vec![NAME]),
            order_by: vec![],
            limit: None,
            offset: None,
            bindings: plan.bindings.clone(),
        }
    );
}

#[test]
fn count_per_select_group_needs_no_rows() {
    let plan = split(
        &catalog(),
        select(
            "SELECT stage, COUNT(*) FROM crm.deals WHERE owner = 'macro|sam@example.com' GROUP BY stage ORDER BY 2 DESC",
        ),
    );

    assert_eq!(
        plan,
        Plan {
            relations: vec![RelationPlan {
                relation: Relation {
                    table: DEALS,
                    alias: "deals".into(),
                    source: TableSource::Database,
                },
                query: GqlQuery::GroupSoup {
                    table: DEALS,
                    property_filter: Some(Expr::Literal(PropertiesLiteral {
                        property_definition_id: OWNER,
                        entity_type: None,
                        value: PropertyMatchValue::EntityRef(
                            EntityRefId::new("macro|sam@example.com".into()).unwrap()
                        )
                    })),
                    group_by: STAGE,
                },
                needs: vec![],
            }],
            joins: vec![],
            residual: None,
            distinct: false,
            shape: Shape::Aggregate {
                group_by: Some(STAGE),
                items: vec![
                    SelectItem::Column(STAGE),
                    SelectItem::Aggregate {
                        function: AggregateFunction::Count,
                        column: None,
                    },
                ],
            },
            order_by: vec![Order {
                key: OrderKey::Item(1),
                direction: Direction::Descending,
            }],
            limit: None,
            offset: None,
            bindings: plan.bindings.clone(),
        }
    );
}

#[test]
fn any_other_aggregate_or_a_residual_filter_fetches_rows_and_folds() {
    let plan = split(
        &catalog(),
        select(
            "SELECT owner, SUM(amount), COUNT(*)
             FROM crm.deals
             WHERE stage IN ('Won', 'Lead') AND amount > 5000 AND \"closed at\" IS NOT NULL
             GROUP BY owner
             ORDER BY 2 DESC, owner ASC",
        ),
    );

    assert_eq!(
        plan,
        Plan {
            relations: vec![RelationPlan {
                relation: Relation {
                    table: DEALS,
                    alias: "deals".into(),
                    source: TableSource::Database,
                },
                query: GqlQuery::Soup {
                    table: DEALS,
                    property_filter: Some(Expr::or(
                        Expr::Literal(PropertiesLiteral {
                            property_definition_id: STAGE,
                            entity_type: None,
                            value: PropertyMatchValue::SelectOption(WON.into_uuid())
                        }),
                        Expr::Literal(PropertiesLiteral {
                            property_definition_id: STAGE,
                            entity_type: None,
                            value: PropertyMatchValue::SelectOption(LEAD.into_uuid())
                        })
                    )),
                    key_hint: None,
                },
                needs: vec![OWNER, AMOUNT, CLOSED_AT],
            }],
            joins: vec![],
            residual: Some(Filter::And(vec![
                Filter::Comparison {
                    column: AMOUNT,
                    operator: ComparisonOperator::Greater,
                    value: Value::Number(5000.0),
                },
                Filter::IsNull {
                    column: CLOSED_AT,
                    negated: true,
                },
            ])),
            distinct: false,
            shape: Shape::Aggregate {
                group_by: Some(OWNER),
                items: vec![
                    SelectItem::Column(OWNER),
                    SelectItem::Aggregate {
                        function: AggregateFunction::Sum,
                        column: Some(AMOUNT),
                    },
                    SelectItem::Aggregate {
                        function: AggregateFunction::Count,
                        column: None,
                    },
                ],
            },
            order_by: vec![
                Order {
                    key: OrderKey::Item(1),
                    direction: Direction::Descending,
                },
                Order {
                    key: OrderKey::Column(OWNER),
                    direction: Direction::Ascending,
                },
            ],
            limit: None,
            offset: None,
            bindings: plan.bindings.clone(),
        }
    );

    // The same COUNT-only shape over a residual filter must fetch rows too:
    // bins are counted before we could apply `amount > 5000`.
    let plan = split(
        &catalog(),
        select("SELECT stage, COUNT(*) FROM crm.deals WHERE amount > 5000 GROUP BY stage"),
    );
    assert_eq!(
        plan.relations[0].query,
        GqlQuery::Soup {
            table: DEALS,
            property_filter: None,
            key_hint: None,
        }
    );
    assert_eq!(plan.relations[0].needs, vec![STAGE, AMOUNT]);
}

#[test]
fn a_whole_table_read_pushes_nothing_and_needs_every_column() {
    let plan = split(&catalog(), select("SELECT * FROM crm.people"));

    assert_eq!(
        plan,
        Plan {
            relations: vec![RelationPlan {
                relation: Relation {
                    table: PEOPLE,
                    alias: "people".into(),
                    source: TableSource::Database,
                },
                query: GqlQuery::Soup {
                    table: PEOPLE,
                    property_filter: None,
                    key_hint: None,
                },
                needs: vec![NAME],
            }],
            joins: vec![],
            residual: None,
            distinct: false,
            shape: Shape::Rows(vec![NAME]),
            order_by: vec![],
            limit: None,
            offset: None,
            bindings: plan.bindings.clone(),
        }
    );
}

#[test]
fn each_relation_gets_its_own_pushdown_and_needs() {
    let plan = split(
        &catalog(),
        select(
            "SELECT DISTINCT p.email
             FROM macro.tasks t
             JOIN macro.people p ON t.assignees = p.id
             LEFT JOIN crm.deals d ON t.deal = d.row_id
             WHERE t.priority = 'High' AND d.stage = 'Won' AND d.amount > 100 AND p.name LIKE 'A%'",
        ),
    );
    let people_id = column_key(1, PEOPLE_ID);
    let people_email = column_key(1, PEOPLE_EMAIL);
    let people_name = column_key(1, PEOPLE_NAME);
    let deals_stage = column_key(2, STAGE);
    let deals_amount = column_key(2, AMOUNT);

    assert_eq!(
        plan.relations,
        vec![
            RelationPlan {
                relation: Relation {
                    table: TASKS,
                    alias: "t".into(),
                    source: TableSource::Database,
                },
                query: GqlQuery::Soup {
                    table: TASKS,
                    property_filter: Some(Expr::Literal(PropertiesLiteral {
                        property_definition_id: PRIORITY,
                        entity_type: None,
                        value: PropertyMatchValue::SelectOption(HIGH.into_uuid())
                    })),
                    key_hint: None,
                },
                needs: vec![ASSIGNEES, DEAL],
            },
            RelationPlan {
                relation: Relation {
                    table: PEOPLE_TABLE,
                    alias: "p".into(),
                    source: TableSource::People,
                },
                query: GqlQuery::People { ids: None },
                needs: vec![people_email, people_name, people_id],
            },
            RelationPlan {
                relation: Relation {
                    table: DEALS,
                    alias: "d".into(),
                    source: TableSource::Database,
                },
                // Left joined: its conditions apply after the join.
                query: GqlQuery::Soup {
                    table: DEALS,
                    property_filter: None,
                    key_hint: None,
                },
                needs: vec![deals_stage, deals_amount, row_id_key(DEALS)],
            },
        ]
    );
    assert_eq!(
        plan.joins,
        vec![
            JoinPlan {
                relation: 1,
                kind: JoinKind::Inner,
                on: vec![(ASSIGNEES, people_id)],
            },
            JoinPlan {
                relation: 2,
                kind: JoinKind::Left,
                on: vec![(DEAL, row_id_key(DEALS))],
            },
        ]
    );
    assert_eq!(
        plan.residual,
        Some(Filter::And(vec![
            Filter::Comparison {
                column: deals_stage,
                operator: ComparisonOperator::Equal,
                value: Value::Option(WON),
            },
            Filter::Comparison {
                column: deals_amount,
                operator: ComparisonOperator::Greater,
                value: Value::Number(100.0),
            },
            Filter::Like {
                column: people_name,
                pattern: "A%".into(),
                escape: None,
                negated: false,
            },
        ]))
    );
    assert!(plan.distinct);
    assert_eq!(plan.shape, Shape::Rows(vec![people_email]));
    assert_eq!(
        plan.column(&catalog(), deals_amount).map(|c| c.id),
        Some(AMOUNT)
    );
    assert_eq!(plan.column(&catalog(), row_id_key(DEALS)), None);
    assert_eq!(plan.table(), TASKS);
}

#[test]
fn a_left_joined_relation_takes_no_pushdown_and_an_inner_joined_one_does() {
    let plan = split(
        &catalog(),
        select(
            "SELECT p.name FROM crm.people p
             JOIN crm.deals d ON p.row_id = d.owner
             LEFT JOIN macro.tasks t ON d.row_id = t.deal
             WHERE d.stage = 'Won' AND t.priority = 'High'",
        ),
    );
    let tasks_priority = column_key(2, PRIORITY);

    assert_eq!(
        plan.relations[1].query,
        GqlQuery::Soup {
            table: DEALS,
            property_filter: Some(Expr::Literal(PropertiesLiteral {
                property_definition_id: STAGE,
                entity_type: None,
                value: PropertyMatchValue::SelectOption(WON.into_uuid())
            })),
            key_hint: None,
        }
    );
    assert_eq!(
        plan.relations[2].query,
        GqlQuery::Soup {
            table: TASKS,
            property_filter: None,
            key_hint: None,
        }
    );
    assert_eq!(
        plan.residual,
        Some(Filter::Comparison {
            column: tasks_priority,
            operator: ComparisonOperator::Equal,
            value: Value::Option(HIGH),
        })
    );
    assert_eq!(
        plan.relations[2].needs,
        vec![tasks_priority, column_key(2, DEAL)]
    );
}

#[test]
fn a_condition_spanning_relations_stays_residual_and_bins_need_one_relation() {
    let plan = split(
        &catalog(),
        select(
            "SELECT t.priority, COUNT(*) FROM macro.tasks t JOIN macro.people p ON t.assignees = p.id
             WHERE t.priority = 'High' OR p.name = 'Sam' GROUP BY t.priority",
        ),
    );
    // COUNT per select group would be bins over one table; over a join the
    // rows are needed.
    assert!(matches!(
        plan.relations[0].query,
        GqlQuery::Soup {
            property_filter: None,
            ..
        }
    ));
    assert!(plan.residual.is_some());
    assert_eq!(plan.relations[0].needs, vec![PRIORITY, ASSIGNEES]);

    let plan = split(
        &catalog(),
        select("SELECT DISTINCT stage, COUNT(*) FROM crm.deals GROUP BY stage"),
    );
    assert!(matches!(plan.relations[0].query, GqlQuery::Soup { .. }));
}

#[test]
fn counting_per_member_of_a_multi_valued_column_folds_rows() {
    // Soup bins a multi-select row once per option it holds; SQL groups by
    // the whole cell, so the bins cannot answer it.
    let plan = split(
        &catalog(),
        select("SELECT tags, COUNT(*) FROM crm.deals GROUP BY tags"),
    );
    assert_eq!(
        plan.relations[0].query,
        GqlQuery::Soup {
            table: DEALS,
            property_filter: None,
            key_hint: None,
        }
    );
    assert_eq!(plan.relations[0].needs, vec![TAGS]);
}

#[test]
fn a_row_id_condition_never_pushes_down() {
    let plan = split(
        &catalog(),
        select("SELECT name FROM crm.deals WHERE row_id = '00000000-0000-0000-0000-0000000000a1'"),
    );
    assert!(matches!(
        plan.relations[0].query,
        GqlQuery::Soup {
            property_filter: None,
            ..
        }
    ));
    assert_eq!(plan.relations[0].needs, vec![NAME, row_id_key(DEALS)]);
}

#[test]
fn propf_serializes_to_the_soup_wire_form() {
    let plan = split(
        &catalog(),
        select(
            "SELECT name FROM crm.deals WHERE stage = 'Won' AND owner = 'macro|sam@example.com'",
        ),
    );
    let GqlQuery::Soup {
        property_filter, ..
    } = plan.relations.into_iter().next().unwrap().query
    else {
        panic!("expected a soup query");
    };

    assert_eq!(
        serde_json::to_value(property_filter.unwrap()).unwrap(),
        serde_json::json!({
            "&": [
                { "l": { "pd": "00000000-0000-0000-0000-000000000003", "v": { "so": "00000000-0000-0000-0000-000000000030" } } },
                { "l": { "pd": "00000000-0000-0000-0000-000000000005", "v": { "er": "macro|sam@example.com" } } }
            ]
        })
    );
}

#[test]
fn a_row_position_condition_never_pushes_down() {
    let plan = split(
        &catalog(),
        select("SELECT name FROM crm.deals WHERE row_position = '000000000001'"),
    );
    assert!(matches!(
        plan.relations[0].query,
        GqlQuery::Soup {
            property_filter: None,
            ..
        }
    ));
    assert_eq!(
        plan.relations[0].needs,
        vec![NAME, crate::resolve::row_position_key(DEALS)]
    );
}
