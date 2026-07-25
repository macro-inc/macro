use super::*;

#[test]
fn accepts_fragment_only_object_document() {
    let selection = RecordSelection::parse(
        r#"
        fragment SoupItemFields on GraphqlSoupItem {
          itemId: id
          entityType
          entity {
            __typename
            ... on GraphqlSoupDocument { id name }
            ... on GraphqlSoupChat { id name }
          }
        }
        "#,
        "SoupItemFields",
    )
    .unwrap();

    assert_eq!(selection.type_names(), &["GraphqlSoupItem"]);
}

#[test]
fn accepts_normalized_union_selection() {
    let selection = RecordSelection::parse(
        r#"
        fragment SoupEntities on GraphqlSoupEntity {
          __typename
          ... on GraphqlSoupDocument { id name }
          ... on GraphqlSoupChat { id name }
        }
        "#,
        "SoupEntities",
    )
    .unwrap();

    assert!(
        selection
            .type_names()
            .contains(&"GraphqlSoupDocument".to_string())
    );
    assert!(
        selection
            .type_names()
            .contains(&"GraphqlSoupChat".to_string())
    );
}

#[test]
fn rejects_embedded_root_and_unbound_variables() {
    let embedded =
        RecordSelection::parse("fragment Page on SoupPage { nextCursor }", "Page").unwrap_err();
    assert!(matches!(
        embedded,
        RecordSelectionError::NotNormalized(ref name) if name == "SoupPage"
    ));

    let variable = RecordSelection::parse(
        r#"fragment UserSoup on GraphqlUser {
          soup(input: $input) { nextCursor }
        }"#,
        "UserSoup",
    )
    .unwrap_err();
    assert!(matches!(
        variable,
        RecordSelectionError::UnboundVariable(ref name) if name == "input"
    ));
}

#[test]
fn rejects_unknown_fragment_and_type() {
    assert!(matches!(
        RecordSelection::parse("fragment Item on GraphqlSoupItem { id }", "Missing"),
        Err(RecordSelectionError::Document(
            DocumentError::UnknownFragment(_)
        ))
    ));
    assert!(matches!(
        RecordSelection::parse("fragment Item on MissingType { id }", "Item"),
        Err(RecordSelectionError::UnknownType(_))
    ));
    assert!(matches!(
        RecordSelection::parse(
            "fragment Item on GraphqlSoupItem { id } fragment Unused on MissingType { id }",
            "Item",
        ),
        Err(RecordSelectionError::UnknownType(_))
    ));
}

#[test]
fn validates_page_limits() {
    assert!(matches!(
        validate_limit(0),
        Err(RecordSelectionError::InvalidLimit { .. })
    ));
    validate_limit(MAX_RECORD_SELECTION_PAGE_SIZE).unwrap();
    assert!(matches!(
        validate_limit(MAX_RECORD_SELECTION_PAGE_SIZE + 1),
        Err(RecordSelectionError::InvalidLimit { .. })
    ));
}

#[test]
fn cursor_has_opaque_roundtrip() {
    let cursor = RecordCursor::new(EntityKey("GraphqlSoupItem:item-1".to_string()));
    let encoded = serde_json::to_value(&cursor).unwrap();
    assert_eq!(
        serde_json::from_value::<RecordCursor>(encoded).unwrap(),
        cursor
    );
}
