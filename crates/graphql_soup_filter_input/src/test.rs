use filter_ast::Expr;
use item_filters::ast::{
    channel::ChannelThreadLiteral, chat::ChatLiteral, document::DocumentLiteral,
};
use serde_json::{Value, json};

use super::*;

fn generated_filter_fixture() -> Value {
    serde_json::from_str(include_str!("../fixtures/generated-soup-filter.json")).unwrap()
}

#[test]
fn favorites_filter_materializes_without_changing_entity_scope() {
    let mut input = generated_filter_fixture();
    input["favoritesOnly"] = json!(true);
    let ast = materialize_graphql_filter(input).unwrap();
    assert_eq!(ast.favorites_only, Some(true));
    assert!(ast.email_filter.tree.is_some());
}

#[test]
fn generated_typescript_variables_materialize_authoritative_ast() {
    let ast = materialize_graphql_filter(generated_filter_fixture()).unwrap();

    assert!(matches!(
        ast.document_filter.as_deref(),
        Some(Expr::And(left, right))
            if matches!(left.as_ref(), Expr::Or(_, _))
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

fn balanced_file_types(leaves: usize) -> Value {
    if leaves == 1 {
        return json!({"literal":{"fileType":"md"}});
    }
    json!({"or":{"left":balanced_file_types(leaves / 2), "right":balanced_file_types(leaves - leaves / 2)}})
}

#[test]
fn finite_file_picker_unions_fit_but_unbounded_json_forests_do_not() {
    // 512 leaves are 1,023 expression nodes, but 2,559 JSON values after wrappers.
    let input = json!({"documentFilter":balanced_file_types(512)});
    assert!(materialize_graphql_filter(input.clone()).is_ok());
    let graphql: GraphqlEntityFilterAst = serde_json::from_value(input).unwrap();
    assert!(graphql.into_ast().is_ok());
    let oversized = json!({"documentFilter":balanced_file_types(1024)});
    assert!(matches!(
        materialize_graphql_filter(oversized),
        Err(MaterializeError::Bounds(_))
    ));
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

#[test]
fn initiative_filters_materialize_for_browser_and_server() {
    let id = Uuid::from_u128(42);
    for literal in [
        json!({"include": true}),
        json!({"id": id.to_string()}),
        json!({"owner": "macro|user@example.com"}),
        json!({"nameContains": "Launch"}),
        json!({"dueBefore": "2026-10-01T00:00:00Z"}),
        json!({"dueAfter": "2026-09-01T00:00:00Z"}),
    ] {
        let value = json!({"initiativeFilter": {"literal": literal}});
        let ast = materialize_graphql_filter(value.clone()).unwrap();
        let input: GraphqlEntityFilterAst = serde_json::from_value(value).unwrap();
        assert!(ast.initiative_filter.is_some());
        assert_eq!(
            serde_json::to_value(ast).unwrap(),
            serde_json::to_value(input.into_ast().unwrap()).unwrap()
        );
    }
    for literal in [
        json!({"include": false}),
        json!({"id": "invalid"}),
        json!({"dueBefore": "invalid"}),
    ] {
        assert!(
            materialize_graphql_filter(json!({"initiativeFilter": {"literal": literal}})).is_err()
        );
    }
    assert!(
        materialize_graphql_filter(json!({}))
            .unwrap()
            .initiative_filter
            .is_none()
    );
}

#[test]
fn initiative_property_filters_preserve_entity_scope() {
    let ast = materialize_graphql_filter(json!({
        "initiativeFilter": {"literal": {"include": true}},
        "propertiesFilter": {"literal": {
            "propertyDefinitionId": "00000001-0000-0000-0000-000000000002",
            "entityType": "INITIATIVE",
            "value": {"selectOption": "00000001-0000-0000-0002-000000000001"}
        }}
    }))
    .unwrap();
    assert!(matches!(
        ast.properties_filter.as_deref(),
        Some(Expr::Literal(PropertiesLiteral {
            entity_type: Some(PropertyEntityType::Initiative),
            ..
        }))
    ));
}

#[test]
fn a_database_row_filter_names_a_table_or_a_row() {
    use item_filters::ast::database_row::DatabaseRowLiteral;

    let ast = materialize_graphql_filter(json!({
        "databaseRowFilter": { "or": {
            "left": { "literal": { "tableId": "7ab00000-0000-0000-0000-000000000001" } },
            "right": { "literal": { "id": "70000000-0000-0000-0000-000000000001" } }
        } }
    }))
    .unwrap();

    assert_eq!(
        ast.database_row_filter.as_deref(),
        Some(&Expr::or(
            Expr::val(DatabaseRowLiteral::TableId(Uuid::from_u128(
                0x7ab00000_0000_0000_0000_000000000001
            ))),
            Expr::val(DatabaseRowLiteral::Id(Uuid::from_u128(
                0x70000000_0000_0000_0000_000000000001
            ))),
        ))
    );
    assert!(
        materialize_graphql_filter(json!({
            "databaseRowFilter": { "literal": { "tableId": "not-a-uuid" } }
        }))
        .is_err()
    );
    assert!(
        materialize_graphql_filter(json!({}))
            .unwrap()
            .database_row_filter
            .is_none()
    );
}

#[test]
fn channel_thread_has_replies_materializes_for_browser_and_server() {
    for has_replies in [true, false] {
        let value = json!({
            "channelThreadFilter": {"literal": {"hasReplies": has_replies}}
        });
        let ast = materialize_graphql_filter(value.clone()).unwrap();
        assert!(matches!(
            ast.channel_thread_filter.as_deref(),
            Some(Expr::Literal(ChannelThreadLiteral::HasReplies(v))) if *v == has_replies
        ));
        let input: GraphqlEntityFilterAst = serde_json::from_value(value).unwrap();
        assert_eq!(
            serde_json::to_value(ast).unwrap(),
            serde_json::to_value(input.into_ast().unwrap()).unwrap()
        );
    }
}

#[test]
fn crm_document_literals_materialize_for_browser_and_server() {
    let company_id = "0198a1b2-c3d4-7e5f-8061-728394a5b700";
    let value = json!({
        "documentFilter": {"or": {
            "left": {"literal": {"property": {
                "propertyDefinitionId": "00000001-0000-0000-0000-00000000000c",
                "value": {"entityRef": company_id}
            }}},
            "right": {"literal": {"emailAttachmentParticipant": {"domain": "acme.com"}}}
        }}
    });
    let ast = materialize_graphql_filter(value.clone()).unwrap();
    let input: GraphqlEntityFilterAst = serde_json::from_value(value).unwrap();
    assert_eq!(
        serde_json::to_value(&ast).unwrap(),
        serde_json::to_value(input.into_ast().unwrap()).unwrap()
    );

    let Some(Expr::Or(left, right)) = ast.document_filter.as_deref() else {
        panic!("expected an OR of the two CRM literals")
    };
    assert!(matches!(
        left.as_ref(),
        Expr::Literal(DocumentLiteral::Property(PropertiesLiteral {
            entity_type: None,
            value: PropertyMatchValue::EntityRef(id),
            ..
        })) if id.to_string() == company_id
    ));
    assert!(matches!(
        right.as_ref(),
        Expr::Literal(DocumentLiteral::EmailAttachmentParticipant(
            item_filters::ast::email::Email::Domain(domain)
        )) if domain == "acme.com"
    ));
}

#[test]
fn contacts_are_opt_in_and_normalize_full_email_filters() {
    assert!(
        materialize_graphql_filter(json!({}))
            .unwrap()
            .crm_contact_filter
            .is_none()
    );
    let ast = materialize_graphql_filter(json!({
        "crmContactFilter": { "and": {
            "left": { "literal": { "teamId": "00000000-0000-0000-0000-000000000011" } },
            "right": { "literal": { "email": "  Pat+Alias@Example.com " } }
        } }
    }))
    .unwrap();
    let tree = serde_json::to_value(ast.crm_contact_filter).unwrap();
    assert_eq!(tree["&"][1]["l"]["email"], "pat+alias@example.com");
    assert!(
        materialize_graphql_filter(
            json!({ "crmContactFilter": { "literal": { "include": false } } })
        )
        .is_err()
    );
}
