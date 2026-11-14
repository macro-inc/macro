use super::predicate;
use filter_ast::Expr;
use item_filters::ast::properties::{PropertiesLiteral, PropertyEntityType, PropertyMatchValue};
use uuid::{Uuid, uuid};

const STATUS: Uuid = uuid!("00000001-0000-0000-0000-000000000002");
const PRIORITY: Uuid = uuid!("00000001-0000-0000-0000-000000000003");
const NOT_STARTED: Uuid = uuid!("00000001-0000-0000-0002-000000000001");
const IN_PROGRESS: Uuid = uuid!("00000001-0000-0000-0002-000000000002");
const BLOCKED: Uuid = uuid!("00000001-0000-0000-0002-000000000003");
const LOW: Uuid = uuid!("00000001-0000-0000-0003-000000000001");

fn option(
    definition: Uuid,
    entity_type: Option<PropertyEntityType>,
    id: Uuid,
) -> Expr<PropertiesLiteral> {
    Expr::val(PropertiesLiteral {
        property_definition_id: definition,
        entity_type,
        value: PropertyMatchValue::SelectOption(id),
    })
}

fn status(id: Uuid) -> Expr<PropertiesLiteral> {
    option(STATUS, None, id)
}

/// The SQL with whitespace runs collapsed, to compare shapes.
fn squash(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn exists(entity_type: &str, definition: Uuid, value: &str) -> String {
    squash(&format!(
        "EXISTS ( SELECT 1 FROM entity_properties ep_prop WHERE ep_prop.entity_id = d.id {entity_type} AND ep_prop.property_definition_id = '{definition}' AND ep_prop.values->'value' {value} )"
    ))
}

#[test]
fn options_of_one_definition_share_one_exists() {
    let expr = Expr::or(
        status(BLOCKED),
        Expr::or(status(NOT_STARTED), status(IN_PROGRESS)),
    );
    assert_eq!(
        squash(&predicate(&expr, "d.id")),
        exists(
            "",
            STATUS,
            &format!("?| ARRAY['{NOT_STARTED}', '{IN_PROGRESS}', '{BLOCKED}']::text[]")
        )
    );
}

#[test]
fn a_lone_option_keeps_its_key_test() {
    assert_eq!(
        squash(&predicate(&status(BLOCKED), "d.id")),
        exists("", STATUS, &format!("? '{BLOCKED}'"))
    );
}

#[test]
fn a_repeated_option_keeps_its_key_test() {
    let expr = Expr::or(status(BLOCKED), status(BLOCKED));
    assert_eq!(
        squash(&predicate(&expr, "d.id")),
        exists("", STATUS, &format!("? '{BLOCKED}'"))
    );
}

#[test]
fn options_group_by_definition_and_entity_type() {
    let task = Some(PropertyEntityType::Task);
    let expr = Expr::or(
        Expr::or(status(BLOCKED), option(PRIORITY, None, LOW)),
        Expr::or(
            option(STATUS, task, NOT_STARTED),
            Expr::or(status(IN_PROGRESS), option(STATUS, task, IN_PROGRESS)),
        ),
    );
    assert_eq!(
        squash(&predicate(&expr, "d.id")),
        format!(
            "({} OR {} OR {})",
            exists(
                "",
                STATUS,
                &format!("?| ARRAY['{IN_PROGRESS}', '{BLOCKED}']::text[]")
            ),
            exists(
                "AND ep_prop.entity_type = 'TASK'",
                STATUS,
                &format!("?| ARRAY['{NOT_STARTED}', '{IN_PROGRESS}']::text[]")
            ),
            exists("", PRIORITY, &format!("? '{LOW}'")),
        )
    );
}

#[test]
fn negation_and_conjunction_close_the_or_region() {
    let not_both = Expr::is_not(Expr::or(status(BLOCKED), status(NOT_STARTED)));
    assert_eq!(
        squash(&predicate(&not_both, "d.id")),
        format!(
            "(NOT {})",
            exists(
                "",
                STATUS,
                &format!("?| ARRAY['{NOT_STARTED}', '{BLOCKED}']::text[]")
            )
        )
    );
    let split = Expr::or(
        Expr::and(status(BLOCKED), option(PRIORITY, None, LOW)),
        status(NOT_STARTED),
    );
    assert_eq!(
        squash(&predicate(&split, "d.id")),
        format!(
            "(({} AND {}) OR {})",
            exists("", STATUS, &format!("? '{BLOCKED}'")),
            exists("", PRIORITY, &format!("? '{LOW}'")),
            exists("", STATUS, &format!("? '{NOT_STARTED}'")),
        )
    );
}
