use super::*;

#[test]
fn unsupported_initiative_filter_is_rejected_instead_of_losing_its_scope() {
    let input = GraphqlPropertiesLiteral {
        property_definition_id: ID::from("00000001-0000-0000-0000-000000000002"),
        entity_type: Some(GraphqlPropertyEntityType::Initiative),
        value: GraphqlPropertyMatchValue::SelectOption(ID::from(
            "00000001-0000-0000-0002-000000000001",
        )),
    };
    assert!(input.into_expr().is_err());
    assert_eq!(
        GraphqlPropertyEntityType::new(models_properties::EntityType::Initiative).into_model(),
        models_properties::EntityType::Initiative,
    );
}
