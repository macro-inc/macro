use super::*;
use models_databases::{ColumnKind as OpColumnKind, EntityKind};

#[test]
fn grouped_aggregate_with_mixed_where() {
    let sql = "
        SELECT owner, SUM(amount), COUNT(*)
        FROM crm.deals
        WHERE stage IN ('Won', 'Lead') AND amount > 5000 AND closed_at IS NOT NULL
        GROUP BY owner
        ORDER BY 2 DESC, owner ASC
    ";

    let expected = Statement::Select(Select {
        distinct: false,
        aliases: vec![],
        items: SelectList::Items(vec![
            Item::Column(ColumnRef {
                table: None,
                column: Identifier("owner".into()),
            }),
            Item::Aggregate(Aggregate {
                function: AggregateFunction::Sum,
                argument: Some(ColumnRef {
                    table: None,
                    column: Identifier("amount".into()),
                }),
            }),
            Item::Aggregate(Aggregate {
                function: AggregateFunction::Count,
                argument: None,
            }),
        ]),
        from: FromItem {
            table: TableName {
                database: Some(Identifier("crm".into())),
                table: Identifier("deals".into()),
            },
            alias: None,
        },
        joins: vec![],
        where_: Some(Condition::And(vec![
            Condition::In {
                column: ColumnRef {
                    table: None,
                    column: Identifier("stage".into()),
                },
                values: vec![Literal::Text("Won".into()), Literal::Text("Lead".into())],
                negated: false,
            },
            Condition::Comparison {
                column: ColumnRef {
                    table: None,
                    column: Identifier("amount".into()),
                },
                operator: ComparisonOperator::Greater,
                value: Literal::Number(5000.0),
            },
            Condition::IsNull {
                column: ColumnRef {
                    table: None,
                    column: Identifier("closed_at".into()),
                },
                negated: true,
            },
        ])),
        group_by: Some(ColumnRef {
            table: None,
            column: Identifier("owner".into()),
        }),
        order_by: vec![
            OrderBy {
                key: OrderKey::Position(2),
                direction: Direction::Descending,
            },
            OrderBy {
                key: OrderKey::Column(ColumnRef {
                    table: None,
                    column: Identifier("owner".into()),
                }),
                direction: Direction::Ascending,
            },
        ],
        limit: None,
        offset: None,
    });

    assert_eq!(parse(sql).unwrap(), expected);
}

#[test]
fn or_binds_looser_than_and_and_parens_override() {
    let sql = "SELECT * FROM deals WHERE a = 1 OR b = 2 AND (c = 3 OR d = 4)";

    let expected = Statement::Select(Select {
        distinct: false,
        aliases: vec![],
        items: SelectList::Star,
        from: FromItem {
            table: TableName {
                database: None,
                table: Identifier("deals".into()),
            },
            alias: None,
        },
        joins: vec![],
        where_: Some(Condition::Or(vec![
            Condition::Comparison {
                column: ColumnRef {
                    table: None,
                    column: Identifier("a".into()),
                },
                operator: ComparisonOperator::Equal,
                value: Literal::Number(1.0),
            },
            Condition::And(vec![
                Condition::Comparison {
                    column: ColumnRef {
                        table: None,
                        column: Identifier("b".into()),
                    },
                    operator: ComparisonOperator::Equal,
                    value: Literal::Number(2.0),
                },
                Condition::Or(vec![
                    Condition::Comparison {
                        column: ColumnRef {
                            table: None,
                            column: Identifier("c".into()),
                        },
                        operator: ComparisonOperator::Equal,
                        value: Literal::Number(3.0),
                    },
                    Condition::Comparison {
                        column: ColumnRef {
                            table: None,
                            column: Identifier("d".into()),
                        },
                        operator: ComparisonOperator::Equal,
                        value: Literal::Number(4.0),
                    },
                ]),
            ]),
        ])),
        group_by: None,
        order_by: vec![],
        limit: None,
        offset: None,
    });

    assert_eq!(parse(sql).unwrap(), expected);
}

#[test]
fn every_atom_form_and_literal_kind() {
    let sql = "
        select name from crm.deals
        where stage not in ('Lost')
          and tags has 'vip'
          and assignees not has 'macro|a@b.com'
          and closed_at is null
          and name like 'A%'
          and notes not like '%draft%'
          and done = true
          and score >= -1.5e3
          and \"Plus ones\" <> .5
          and note != 'it''s';
    ";

    let expected = Statement::Select(Select {
        distinct: false,
        aliases: vec![],
        items: SelectList::Items(vec![Item::Column(ColumnRef {
            table: None,
            column: Identifier("name".into()),
        })]),
        from: FromItem {
            table: TableName {
                database: Some(Identifier("crm".into())),
                table: Identifier("deals".into()),
            },
            alias: None,
        },
        joins: vec![],
        where_: Some(Condition::And(vec![
            Condition::In {
                column: ColumnRef {
                    table: None,
                    column: Identifier("stage".into()),
                },
                values: vec![Literal::Text("Lost".into())],
                negated: true,
            },
            Condition::Has {
                column: ColumnRef {
                    table: None,
                    column: Identifier("tags".into()),
                },
                value: Literal::Text("vip".into()),
                negated: false,
            },
            Condition::Has {
                column: ColumnRef {
                    table: None,
                    column: Identifier("assignees".into()),
                },
                value: Literal::Text("macro|a@b.com".into()),
                negated: true,
            },
            Condition::IsNull {
                column: ColumnRef {
                    table: None,
                    column: Identifier("closed_at".into()),
                },
                negated: false,
            },
            Condition::Like {
                column: ColumnRef {
                    table: None,
                    column: Identifier("name".into()),
                },
                pattern: "A%".into(),
                escape: None,
                negated: false,
            },
            Condition::Like {
                column: ColumnRef {
                    table: None,
                    column: Identifier("notes".into()),
                },
                pattern: "%draft%".into(),
                escape: None,
                negated: true,
            },
            Condition::Comparison {
                column: ColumnRef {
                    table: None,
                    column: Identifier("done".into()),
                },
                operator: ComparisonOperator::Equal,
                value: Literal::Boolean(true),
            },
            Condition::Comparison {
                column: ColumnRef {
                    table: None,
                    column: Identifier("score".into()),
                },
                operator: ComparisonOperator::GreaterOrEqual,
                value: Literal::Number(-1500.0),
            },
            Condition::Comparison {
                column: ColumnRef {
                    table: None,
                    column: Identifier("Plus ones".into()),
                },
                operator: ComparisonOperator::NotEqual,
                value: Literal::Number(0.5),
            },
            Condition::Comparison {
                column: ColumnRef {
                    table: None,
                    column: Identifier("note".into()),
                },
                operator: ComparisonOperator::NotEqual,
                value: Literal::Text("it's".into()),
            },
        ])),
        group_by: None,
        order_by: vec![],
        limit: None,
        offset: None,
    });

    assert_eq!(parse(sql).unwrap(), expected);
}

#[test]
fn order_by_column_aggregate_and_position() {
    let sql = "SELECT stage, MAX(amount) FROM \"My CRM\".\"Big Deals\" GROUP BY stage ORDER BY stage, MAX(amount) DESC, 1 ASC";

    let expected = Statement::Select(Select {
        distinct: false,
        aliases: vec![],
        items: SelectList::Items(vec![
            Item::Column(ColumnRef {
                table: None,
                column: Identifier("stage".into()),
            }),
            Item::Aggregate(Aggregate {
                function: AggregateFunction::Max,
                argument: Some(ColumnRef {
                    table: None,
                    column: Identifier("amount".into()),
                }),
            }),
        ]),
        from: FromItem {
            table: TableName {
                database: Some(Identifier("My CRM".into())),
                table: Identifier("Big Deals".into()),
            },
            alias: None,
        },
        joins: vec![],
        where_: None,
        group_by: Some(ColumnRef {
            table: None,
            column: Identifier("stage".into()),
        }),
        order_by: vec![
            OrderBy {
                key: OrderKey::Column(ColumnRef {
                    table: None,
                    column: Identifier("stage".into()),
                }),
                direction: Direction::Ascending,
            },
            OrderBy {
                key: OrderKey::Aggregate(Aggregate {
                    function: AggregateFunction::Max,
                    argument: Some(ColumnRef {
                        table: None,
                        column: Identifier("amount".into()),
                    }),
                }),
                direction: Direction::Descending,
            },
            OrderBy {
                key: OrderKey::Position(1),
                direction: Direction::Ascending,
            },
        ],
        limit: None,
        offset: None,
    });

    assert_eq!(parse(sql).unwrap(), expected);
}

#[test]
fn distinct_aliases_and_joins() {
    let sql = "
        SELECT DISTINCT p.email, t.row_id
        FROM macro.tasks AS t
        INNER JOIN macro.people p ON t.assignees = p.id
        LEFT OUTER JOIN crm.deals ON deals.owner = p.id AND deals.name = t.name
        WHERE t.priority = 'High'
        GROUP BY p.email
        ORDER BY p.email
    ";
    let qualified = |table: &str, column: &str| ColumnRef {
        table: Some(Identifier(table.into())),
        column: Identifier(column.into()),
    };

    let expected = Statement::Select(Select {
        distinct: true,
        aliases: vec![],
        items: SelectList::Items(vec![
            Item::Column(qualified("p", "email")),
            Item::Column(qualified("t", "row_id")),
        ]),
        from: FromItem {
            table: TableName {
                database: Some(Identifier("macro".into())),
                table: Identifier("tasks".into()),
            },
            alias: Some(Identifier("t".into())),
        },
        joins: vec![
            Join {
                kind: JoinKind::Inner,
                table: FromItem {
                    table: TableName {
                        database: Some(Identifier("macro".into())),
                        table: Identifier("people".into()),
                    },
                    alias: Some(Identifier("p".into())),
                },
                on: vec![(qualified("t", "assignees"), qualified("p", "id"))],
            },
            Join {
                kind: JoinKind::Left,
                table: FromItem {
                    table: TableName {
                        database: Some(Identifier("crm".into())),
                        table: Identifier("deals".into()),
                    },
                    alias: None,
                },
                on: vec![
                    (qualified("deals", "owner"), qualified("p", "id")),
                    (qualified("deals", "name"), qualified("t", "name")),
                ],
            },
        ],
        where_: Some(Condition::Comparison {
            column: qualified("t", "priority"),
            operator: ComparisonOperator::Equal,
            value: Literal::Text("High".into()),
        }),
        group_by: Some(qualified("p", "email")),
        order_by: vec![OrderBy {
            key: OrderKey::Column(qualified("p", "email")),
            direction: Direction::Ascending,
        }],
        limit: None,
        offset: None,
    });

    assert_eq!(parse(sql).unwrap(), expected);
}

#[test]
fn item_aliases_and_membership_joins() {
    let sql = "
        SELECT p.email AS person, COUNT(*) deals
        FROM crm.deals d
        JOIN crm.people p ON d.owner HAS p.id
        GROUP BY p.email
        ORDER BY deals DESC
    ";
    let qualified = |table: &str, column: &str| ColumnRef {
        table: Some(Identifier(table.into())),
        column: Identifier(column.into()),
    };

    let expected = Statement::Select(Select {
        distinct: false,
        items: SelectList::Items(vec![
            Item::Column(qualified("p", "email")),
            Item::Aggregate(Aggregate {
                function: AggregateFunction::Count,
                argument: None,
            }),
        ]),
        aliases: vec![
            (0, Identifier("person".into())),
            (1, Identifier("deals".into())),
        ],
        from: FromItem {
            table: TableName {
                database: Some(Identifier("crm".into())),
                table: Identifier("deals".into()),
            },
            alias: Some(Identifier("d".into())),
        },
        joins: vec![Join {
            kind: JoinKind::Inner,
            table: FromItem {
                table: TableName {
                    database: Some(Identifier("crm".into())),
                    table: Identifier("people".into()),
                },
                alias: Some(Identifier("p".into())),
            },
            on: vec![(qualified("d", "owner"), qualified("p", "id"))],
        }],
        where_: None,
        group_by: Some(qualified("p", "email")),
        order_by: vec![OrderBy {
            key: OrderKey::Column(ColumnRef {
                table: None,
                column: Identifier("deals".into()),
            }),
            direction: Direction::Descending,
        }],
        limit: None,
        offset: None,
    });

    assert_eq!(parse(sql).unwrap(), expected);
}

#[test]
fn like_takes_an_escape_character() {
    let sql = r"SELECT name FROM crm.deals WHERE name LIKE '50\%%' ESCAPE '\' OR notes NOT LIKE '%a!_b%' escape '!'";

    let expected = Statement::Select(Select {
        distinct: false,
        aliases: vec![],
        items: SelectList::Items(vec![Item::Column(ColumnRef {
            table: None,
            column: Identifier("name".into()),
        })]),
        from: FromItem {
            table: TableName {
                database: Some(Identifier("crm".into())),
                table: Identifier("deals".into()),
            },
            alias: None,
        },
        joins: vec![],
        where_: Some(Condition::Or(vec![
            Condition::Like {
                column: ColumnRef {
                    table: None,
                    column: Identifier("name".into()),
                },
                pattern: r"50\%%".into(),
                escape: Some('\\'),
                negated: false,
            },
            Condition::Like {
                column: ColumnRef {
                    table: None,
                    column: Identifier("notes".into()),
                },
                pattern: "%a!_b%".into(),
                escape: Some('!'),
                negated: true,
            },
        ])),
        group_by: None,
        order_by: vec![],
        limit: None,
        offset: None,
    });

    assert_eq!(parse(sql).unwrap(), expected);
}

#[test]
fn a_keyword_after_as_is_the_alias() {
    let sql = "SELECT stage AS count, SUM(amount) AS sum FROM crm.deals GROUP BY stage";

    let Statement::Select(select) = parse(sql).unwrap() else {
        panic!("a select");
    };
    assert_eq!(
        select.aliases,
        vec![
            (0, Identifier("count".into())),
            (1, Identifier("sum".into()))
        ]
    );
}

#[test]
fn keywords_are_usable_as_column_names_when_quoted() {
    // `count` unquoted is the aggregate keyword; quoted it is a column.
    let sql = "SELECT \"count\", COUNT(\"order\") FROM stats WHERE \"from\" = 'x'";

    let expected = Statement::Select(Select {
        distinct: false,
        aliases: vec![],
        items: SelectList::Items(vec![
            Item::Column(ColumnRef {
                table: None,
                column: Identifier("count".into()),
            }),
            Item::Aggregate(Aggregate {
                function: AggregateFunction::Count,
                argument: Some(ColumnRef {
                    table: None,
                    column: Identifier("order".into()),
                }),
            }),
        ]),
        from: FromItem {
            table: TableName {
                database: None,
                table: Identifier("stats".into()),
            },
            alias: None,
        },
        joins: vec![],
        where_: Some(Condition::Comparison {
            column: ColumnRef {
                table: None,
                column: Identifier("from".into()),
            },
            operator: ComparisonOperator::Equal,
            value: Literal::Text("x".into()),
        }),
        group_by: None,
        order_by: vec![],
        limit: None,
        offset: None,
    });

    assert_eq!(parse(sql).unwrap(), expected);
}

#[test]
fn insert_several_rows() {
    let sql = "
        INSERT INTO crm.deals (name, stage, amount, \"closed at\")
        VALUES ('Acme', 'Won', 12000, '2026-09-01'),
               ('Globex', 'Lead', NULL, NULL),
               ('Initech ''24', 'Lead', -0, FALSE)
    ";

    let expected = Statement::Insert(Insert {
        table: TableName {
            database: Some(Identifier("crm".into())),
            table: Identifier("deals".into()),
        },
        columns: vec![
            Identifier("name".into()),
            Identifier("stage".into()),
            Identifier("amount".into()),
            Identifier("closed at".into()),
        ],
        rows: vec![
            vec![
                Literal::Text("Acme".into()),
                Literal::Text("Won".into()),
                Literal::Number(12000.0),
                Literal::Text("2026-09-01".into()),
            ],
            vec![
                Literal::Text("Globex".into()),
                Literal::Text("Lead".into()),
                Literal::Null,
                Literal::Null,
            ],
            vec![
                Literal::Text("Initech '24".into()),
                Literal::Text("Lead".into()),
                Literal::Number(-0.0),
                Literal::Boolean(false),
            ],
        ],
    });

    assert_eq!(parse(sql).unwrap(), expected);
}

#[test]
fn update_and_delete_take_any_where() {
    let sql = "UPDATE crm.deals SET stage = 'Won', amount = 12000, \"closed at\" = NULL WHERE ROW_ID = '00000000-0000-0000-0000-0000000000a1'";

    let expected = Statement::Update(Update {
        table: TableName {
            database: Some(Identifier("crm".into())),
            table: Identifier("deals".into()),
        },
        assignments: vec![
            (
                Identifier("stage".into()),
                SetValue::Literal(Literal::Text("Won".into())),
            ),
            (
                Identifier("amount".into()),
                SetValue::Literal(Literal::Number(12000.0)),
            ),
            (
                Identifier("closed at".into()),
                SetValue::Literal(Literal::Null),
            ),
        ],
        where_: Condition::Comparison {
            column: ColumnRef {
                table: None,
                column: Identifier("ROW_ID".into()),
            },
            operator: ComparisonOperator::Equal,
            value: Literal::Text("00000000-0000-0000-0000-0000000000a1".into()),
        },
    });
    assert_eq!(parse(sql).unwrap(), expected);

    let sql = "delete from deals where stage = 'Lead' and amount < 100;";
    let expected = Statement::Delete(Delete {
        table: TableName {
            database: None,
            table: Identifier("deals".into()),
        },
        where_: Condition::And(vec![
            Condition::Comparison {
                column: ColumnRef {
                    table: None,
                    column: Identifier("stage".into()),
                },
                operator: ComparisonOperator::Equal,
                value: Literal::Text("Lead".into()),
            },
            Condition::Comparison {
                column: ColumnRef {
                    table: None,
                    column: Identifier("amount".into()),
                },
                operator: ComparisonOperator::Less,
                value: Literal::Number(100.0),
            },
        ]),
    });
    assert_eq!(parse(sql).unwrap(), expected);
}

#[test]
fn an_update_can_copy_another_column_of_the_row() {
    let sql = "UPDATE crm.deals SET \"closed at\" = due, done = TRUE WHERE done = FALSE";
    let expected = Statement::Update(Update {
        table: TableName {
            database: Some(Identifier("crm".into())),
            table: Identifier("deals".into()),
        },
        assignments: vec![
            (
                Identifier("closed at".into()),
                SetValue::Column(Identifier("due".into())),
            ),
            (
                Identifier("done".into()),
                SetValue::Literal(Literal::Boolean(true)),
            ),
        ],
        where_: Condition::Comparison {
            column: ColumnRef {
                table: None,
                column: Identifier("done".into()),
            },
            operator: ComparisonOperator::Equal,
            value: Literal::Boolean(false),
        },
    });
    assert_eq!(parse(sql).unwrap(), expected);
}

#[test]
fn list_values_default_values_and_limit_offset() {
    let sql = "UPDATE crm.deals SET tags = ['vip', 'renewal'], owner = ['macro|sam@example.com'] WHERE row_id = '00000000-0000-0000-0000-0000000000a1'";
    let expected = Statement::Update(Update {
        table: TableName {
            database: Some(Identifier("crm".into())),
            table: Identifier("deals".into()),
        },
        assignments: vec![
            (
                Identifier("tags".into()),
                SetValue::Literal(Literal::List(vec![
                    Literal::Text("vip".into()),
                    Literal::Text("renewal".into()),
                ])),
            ),
            (
                Identifier("owner".into()),
                SetValue::Literal(Literal::List(vec![Literal::Text(
                    "macro|sam@example.com".into(),
                )])),
            ),
        ],
        where_: Condition::Comparison {
            column: ColumnRef {
                table: None,
                column: Identifier("row_id".into()),
            },
            operator: ComparisonOperator::Equal,
            value: Literal::Text("00000000-0000-0000-0000-0000000000a1".into()),
        },
    });
    assert_eq!(parse(sql).unwrap(), expected);

    let sql = "INSERT INTO crm.deals DEFAULT VALUES";
    let expected = Statement::Insert(Insert {
        table: TableName {
            database: Some(Identifier("crm".into())),
            table: Identifier("deals".into()),
        },
        columns: vec![],
        rows: vec![vec![]],
    });
    assert_eq!(parse(sql).unwrap(), expected);

    let sql = "SELECT name FROM crm.deals ORDER BY name LIMIT 10 OFFSET 20";
    let expected = Statement::Select(Select {
        distinct: false,
        aliases: vec![],
        items: SelectList::Items(vec![Item::Column(ColumnRef {
            table: None,
            column: Identifier("name".into()),
        })]),
        from: FromItem {
            table: TableName {
                database: Some(Identifier("crm".into())),
                table: Identifier("deals".into()),
            },
            alias: None,
        },
        joins: vec![],
        where_: None,
        group_by: None,
        order_by: vec![OrderBy {
            key: OrderKey::Column(ColumnRef {
                table: None,
                column: Identifier("name".into()),
            }),
            direction: Direction::Ascending,
        }],
        limit: Some(10),
        offset: Some(20),
    });
    assert_eq!(parse(sql).unwrap(), expected);
}

#[test]
fn rejections_point_at_the_offending_token() {
    let cases: &[(&str, std::ops::Range<usize>, &str)] = &[
        (
            "SELECT name FROM crm.deals WHERE amount * 1.2 > 5000",
            40..41,
            "expected a comparison operator, IN, HAS, IS or LIKE after \"amount\", found *",
        ),
        (
            "SELECT d.name FROM crm.deals d JOIN crm.people p WHERE p.id = d.owner",
            49..54,
            "expected ON after the joined table, found WHERE",
        ),
        (
            "SELECT d.name FROM crm.deals d JOIN crm.people p ON p.id LIKE d.owner",
            57..61,
            "expected = between the two join columns, found LIKE",
        ),
        (
            "SELECT d.name FROM crm.deals d LEFT crm.people p ON p.id = d.owner",
            36..39,
            "expected JOIN after LEFT, found \"crm\"",
        ),
        (
            "SELECT name AS FROM crm.deals",
            15..19,
            "expected a name for the column after AS, found FROM",
        ),
        (
            "SELECT d.name FROM crm.deals d, crm.people p",
            30..31,
            "tables are combined with JOIN … ON a.column = b.row_id, not a comma",
        ),
        (
            "SELECT stage, SUM(amount) FROM crm.deals GROUP BY stage HAVING SUM(amount) > 1",
            56..62,
            "expected end of statement, found \"HAVING\"",
        ),
        (
            "SELECT name FROM crm.deals WHERE owner IN (SELECT id FROM crm.people)",
            43..49,
            "subqueries are not supported: run the inner SELECT on its own first and use the values it returns",
        ),
        (
            "SELECT LOWER(name) FROM crm.deals",
            12..13,
            "expected FROM, found (",
        ),
        (
            "SELECT name FROM crm.deals WHERE stage IN ()",
            43..44,
            "expected a value: 'text', a number, TRUE, FALSE or NULL, found )",
        ),
        (
            "SELECT name FROM crm.deals WHERE NOT stage = 'Won'",
            33..36,
            "expected a column name to compare, found NOT",
        ),
        (
            "SELECT name FROM crm.deals WHERE stage NOT = 'Won'",
            43..44,
            "expected IN, HAS or LIKE after \"stage\" NOT, found =",
        ),
        (
            "SELECT name FROM crm.deals WHERE name LIKE 'a%' ESCAPE '!!'",
            55..59,
            "the ESCAPE character must be exactly one character",
        ),
        (
            "SELECT name FROM crm.deals WHERE name LIKE 'a!' ESCAPE '!'",
            43..47,
            "a LIKE pattern cannot end with its ESCAPE character",
        ),
        (
            "SELECT name FROM crm.deals WHERE name LIKE 'a%' ESCAPE",
            54..54,
            "expected a quoted escape character after ESCAPE, found end of statement",
        ),
        (
            "SELECT name FROM crm.deals ORDER BY 0",
            36..37,
            "expected a column name or a 1-based select-list position after ORDER BY, found 0",
        ),
        (
            "SELECT name FROM crm.deals ORDER BY name, 0",
            42..43,
            "expected a column name or a 1-based select-list position after ORDER BY, found 0",
        ),
        (
            "SELECT name FROM crm.deals LIMIT 10000000000",
            33..44,
            "expected a row count after LIMIT, found 10000000000",
        ),
        (
            "SELECT name FROM crm.deals WHERE (stage = 'Won'",
            47..47,
            "expected ) to close the condition, found end of statement",
        ),
        (
            "SELECT name FROM crm.deals; SELECT name FROM crm.deals",
            28..34,
            "expected end of statement, found SELECT",
        ),
        (
            "SELECT FROM crm.deals",
            7..11,
            "expected a column name, an aggregate like COUNT(*) or SUM(column), or *, found FROM",
        ),
        (
            "SELECT name FROM crm.deals WHERE name = 'unterminated",
            40..53,
            "unterminated quote starting at '",
        ),
        (
            "SELECT name FROM crm.deals WHERE name = #1",
            40..41,
            "unexpected character \"#\"",
        ),
        (
            "INSERT INTO crm.deals VALUES ('Acme')",
            22..28,
            "expected ( and the column list, or DEFAULT VALUES, after the table name, found VALUES",
        ),
        (
            "INSERT INTO crm.deals (name, stage) VALUES ('Acme', 'Won'), ('Globex')",
            60..70,
            "row 2 has 1 values but 2 columns were listed",
        ),
        (
            "UPDATE crm.deals SET stage = 'Won'",
            34..34,
            "expected WHERE and the rows to change (UPDATE needs one; WHERE row_id = '<id>' names a single row), found end of statement",
        ),
        (
            "UPDATE crm.deals SET stage = WHERE row_id = 'a'",
            29..34,
            "expected a value ('text', a number, TRUE, FALSE, NULL or a [list]) or a column name, found WHERE",
        ),
        (
            "DELETE FROM crm.deals",
            21..21,
            "expected WHERE and the rows to change (DELETE needs one; WHERE row_id = '<id>' names a single row), found end of statement",
        ),
        (
            "MERGE INTO crm.deals USING x",
            0..5,
            "expected SELECT, INSERT, UPDATE, DELETE or ALTER TABLE, found \"MERGE\"",
        ),
    ];

    for (sql, span, message) in cases {
        let error = parse(sql).unwrap_err();
        assert_eq!(
            (error.span.clone(), error.message.as_str()),
            (span.clone(), *message),
            "\n{sql}\n{}^",
            " ".repeat(error.span.start)
        );
    }
}

#[test]
fn alter_column_type_names_the_table_column_and_type() {
    assert_eq!(
        parse("ALTER TABLE crm.deals ALTER COLUMN amount TYPE text").unwrap(),
        Statement::AlterColumnType(AlterColumnType {
            table: TableName {
                database: Some(Identifier("crm".into())),
                table: Identifier("deals".into()),
            },
            column: Identifier("amount".into()),
            to: OpColumnKind::Text,
        })
    );
}

#[test]
fn the_column_keyword_is_optional() {
    assert_eq!(
        parse("alter table deals alter \"closed at\" type select[];").unwrap(),
        Statement::AlterColumnType(AlterColumnType {
            table: TableName {
                database: None,
                table: Identifier("deals".into()),
            },
            column: Identifier("closed at".into()),
            to: OpColumnKind::Select { multi: true },
        })
    );
}

#[test]
fn using_null_is_not_part_of_alter_column() {
    let error = parse("ALTER TABLE deals ALTER COLUMN amount TYPE number USING NULL").unwrap_err();
    assert_eq!(
        error.to_string(),
        "expected end of statement, found \"USING\" at byte 50"
    );
}

#[test]
fn crm_contacts_remain_typed_entity_references() {
    assert_eq!(
        parse("ALTER TABLE deals ALTER COLUMN contact TYPE entity(CONTACT)").unwrap(),
        Statement::AlterColumnType(AlterColumnType {
            table: TableName {
                database: None,
                table: Identifier("deals".into()),
            },
            column: Identifier("contact".into()),
            to: OpColumnKind::Entity {
                target: EntityKind::Contact,
                multi: false,
            },
        })
    );
}

#[test]
fn an_entity_type_names_its_kind_and_takes_brackets_for_several() {
    assert_eq!(
        parse("ALTER TABLE deals ALTER COLUMN owner TYPE entity(user)[]").unwrap(),
        Statement::AlterColumnType(AlterColumnType {
            table: TableName {
                database: None,
                table: Identifier("deals".into()),
            },
            column: Identifier("owner".into()),
            to: OpColumnKind::Entity {
                target: EntityKind::User,
                multi: true,
            },
        })
    );
    assert_eq!(
        parse("ALTER TABLE deals ALTER COLUMN column TYPE select_number").unwrap(),
        Statement::AlterColumnType(AlterColumnType {
            table: TableName {
                database: None,
                table: Identifier("deals".into()),
            },
            column: Identifier("column".into()),
            to: OpColumnKind::SelectNumber { multi: false },
        })
    );
}

#[test]
fn a_bad_alter_says_what_would_have_been_accepted() {
    let types = "text, number, boolean, date, link, select, select_number, tag or \
                 entity(<KIND>) such as entity(USER); add [] after select, select_number \
                 or entity(…) for several values";
    let cases: Vec<(&str, std::ops::Range<usize>, String)> = vec![
        (
            "ALTER TABLE deals ALTER COLUMN amount TYPE strin",
            43..48,
            format!("unknown column type \"strin\"; the types are {types}"),
        ),
        (
            "ALTER TABLE deals ALTER COLUMN amount TYPE text[]",
            47..48,
            "text holds one value; [] is for select, select_number and entity(…)".into(),
        ),
        (
            "ALTER TABLE deals ALTER COLUMN tags TYPE tag[]",
            44..45,
            "tag always holds several values; write tag".into(),
        ),
        (
            "ALTER TABLE deals ALTER COLUMN owner TYPE entity",
            48..48,
            "expected ( and an entity kind after entity, like entity(USER), found end of statement"
                .into(),
        ),
        (
            "ALTER TABLE deals ALTER COLUMN owner TYPE entity(ROBOT)",
            49..54,
            "unknown entity kind \"ROBOT\"; the kinds are USER, DOCUMENT, TASK, COMPANY, CONTACT, \
             CALL_RECORD, CHANNEL, CHAT, PROJECT, THREAD, CALENDAR_EVENT, INITIATIVE"
                .into(),
        ),
        (
            "ALTER TABLE deals ALTER COLUMN owner TYPE entity(DATABASE_ROW)",
            49..61,
            "a relation to another table's rows is made with the ChangeColumnType tool's \
             linkToTableId, not ALTER COLUMN"
                .into(),
        ),
        (
            "ALTER TABLE deals ADD COLUMN notes text",
            18..21,
            "expected ALTER COLUMN after the table name (ALTER TABLE only changes a column's \
             type), found \"ADD\""
                .into(),
        ),
    ];
    for (sql, span, message) in cases {
        let error = parse(sql).unwrap_err();
        assert_eq!(
            (error.span.clone(), error.message.as_str()),
            (span.clone(), message.as_str()),
            "\n{sql}"
        );
    }
}

#[test]
fn a_parse_error_reads_with_the_byte_it_points_at() {
    // `FORM` reads as the column's alias, so the miss is at `crm`.
    let error = parse("SELECT name FORM crm.deals").unwrap_err();

    assert_eq!(
        error,
        ParseError {
            span: 17..20,
            message: "expected FROM, found \"crm\"".into(),
        }
    );
    assert_eq!(error.to_string(), "expected FROM, found \"crm\" at byte 17");
}
