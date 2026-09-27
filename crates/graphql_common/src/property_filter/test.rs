use super::*;

#[test]
fn initiative_property_filter_preserves_its_scope() {
    let input = GraphqlPropertiesLiteral {
        property_definition_id: ID::from("00000001-0000-0000-0000-000000000002"),
        entity_type: Some(GraphqlPropertyEntityType::Initiative),
        value: GraphqlPropertyMatchValue::SelectOption(ID::from(
            "00000001-0000-0000-0002-000000000001",
        )),
    };
    assert!(matches!(
        input.into_expr().unwrap(),
        Expr::Literal(PropertiesLiteral {
            entity_type: Some(PropertyEntityType::Initiative),
            ..
        })
    ));
    assert_eq!(
        GraphqlPropertyEntityType::new(models_properties::EntityType::Initiative).into_model(),
        models_properties::EntityType::Initiative,
    );
}
