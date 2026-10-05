use filter_ast::Expr;
use item_filters::ast::properties::{EntityRefId, PropertiesLiteral, PropertyMatchValue};
use serde_json::{Value, json};
use uuid::Uuid;

use super::Propf;

#[test]
fn every_pushed_down_form_reads_as_the_exported_schema() {
    let option = Uuid::from_u128(1);
    let property = Uuid::from_u128(2);
    let expression = Expr::and(
        Expr::Literal(PropertiesLiteral {
            property_definition_id: property,
            entity_type: None,
            value: PropertyMatchValue::SelectOption(option),
        }),
        Expr::or(
            Expr::is_not(Expr::Literal(PropertiesLiteral {
                property_definition_id: property,
                entity_type: None,
                value: PropertyMatchValue::EntityRef(
                    EntityRefId::new("user|a@b.c".into()).unwrap(),
                ),
            })),
            Expr::Literal(PropertiesLiteral {
                property_definition_id: property,
                entity_type: None,
                value: PropertyMatchValue::SelectOption(option),
            }),
        ),
    );

    let wire = serde_json::to_value(&expression).unwrap();
    let schema: Propf = serde_json::from_value(wire.clone()).unwrap();

    assert_eq!(serde_json::to_value(&schema).unwrap(), wire);
    assert_eq!(
        wire,
        json!({ "&": [
            { "l": { "pd": property, "v": { "so": option } } },
            { "|": [
                { "!": { "l": { "pd": property, "v": { "er": "user|a@b.c" } } } },
                { "l": { "pd": property, "v": { "so": option } } },
            ] },
        ] }) as Value
    );
}
