use filter_ast::Expr;
use item_filters::ast::{chat::ChatLiteral, document::DocumentLiteral};
use serde_json::{Value, json};

use super::*;

fn generated_filter_fixture() -> Value {
    serde_json::from_str(include_str!("../fixtures/generated-soup-filter.json")).unwrap()
}

#[test]
fn generated_typescript_variables_materialize_authoritative_ast() {
    let ast = materialize_graphql_filter(generated_filter_fixture()).unwrap();

    assert!(matches!(
        ast.document_filter.as_deref(),
        Some(Expr::And(left, right))
            if matches!(left.as_ref(), Expr::Literal(DocumentLiteral::NotificationDone(false)))
                && matches!(right.as_ref(), Expr::Literal(DocumentLiteral::UpdatedAt(_)))
    ));
    assert!(matches!(
        ast.chat_filter.as_deref(),
        Some(Expr::Not(expr))
            if matches!(expr.as_ref(), Expr::Literal(ChatLiteral::Owner(_)))
    ));
    assert!(ast.email_filter.tree.is_some());
}

#[test]
fn serde_and_graphql_entrypoints_materialize_identically() {
    let value = generated_filter_fixture();
    let from_json = materialize_graphql_filter(value.clone()).unwrap();
    let input: GraphqlEntityFilterAst = serde_json::from_value(value).unwrap();
    let from_graphql_type = input.into_ast().unwrap();

    assert_eq!(
        serde_json::to_value(from_json).unwrap(),
        serde_json::to_value(from_graphql_type).unwrap()
    );
}

#[test]
fn rejects_rest_ast_shape() {
    let error = materialize_graphql_filter(json!({
        "df": { "l": { "id": "00000000-0000-0000-0000-000000000001" } }
    }))
    .unwrap_err();

    assert!(matches!(error, MaterializeError::Shape(_)));
}

#[test]
fn rejects_pathological_depth_before_materialization() {
    let mut expression = json!({
        "literal": { "id": "00000000-0000-0000-0000-000000000001" }
    });
    for _ in 0..MAX_FILTER_DEPTH {
        expression = json!({ "not": expression });
    }

    let error = materialize_graphql_filter(json!({ "documentFilter": expression })).unwrap_err();
    assert!(matches!(error, MaterializeError::Bounds(_)));
}

#[test]
fn rejects_oversized_strings_before_domain_parsing() {
    let error = materialize_graphql_filter(json!({
        "documentFilter": {
            "literal": { "owner": "x".repeat(MAX_FILTER_STRING_BYTES + 1) }
        }
    }))
    .unwrap_err();

    assert!(matches!(error, MaterializeError::Bounds(_)));
}

#[test]
fn property_entity_type_conversion_rejects_unsupported_variants() {
    let property_filter = |entity_type| {
        json!({
            "propertiesFilter": {
                "literal": {
                    "propertyDefinitionId": "00000000-0000-0000-0000-000000000001",
                    "entityType": entity_type,
                    "value": {
                        "entityRef": "00000000-0000-0000-0000-000000000002"
                    }
                }
            }
        })
    };

    let error = materialize_graphql_filter(property_filter(json!("CALL_RECORD"))).unwrap_err();
    assert!(matches!(error, MaterializeError::Conversion(_)));

    let ast = materialize_graphql_filter(property_filter(Value::Null)).unwrap();
    let Some(Expr::Literal(literal)) = ast.properties_filter.as_deref() else {
        panic!("expected property literal")
    };
    assert!(literal.entity_type.is_none());
}
