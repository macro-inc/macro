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

#[test]
fn date_ranges_keep_open_bounds_and_normalize_offsets() {
    let value = GraphqlPropertyMatchValue::DateRange(GraphqlPropertyDateRange {
        start: None,
        end: Some("2026-10-21T00:00:00+05:30".to_owned()),
    })
    .into_ast()
    .unwrap();
    assert!(matches!(value, PropertyMatchValue::DateRange(range)
        if range.start.is_none() && range.end.unwrap().to_rfc3339() == "2026-10-20T18:30:00+00:00"));
    assert!(
        GraphqlPropertyMatchValue::DateRange(GraphqlPropertyDateRange {
            start: Some("not a timestamp".to_owned()),
            end: None,
        })
        .into_ast()
        .is_err()
    );
}
