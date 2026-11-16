use super::*;

#[test]
fn checked_entity_key_round_trips() {
    for value in [
        // ROOT_QUERY is the only key accepted without a typename/id separator;
        // ROOT_QUERY: remains invalid, while ordinary typenames may have empty IDs.
        "ROOT_QUERY",
        "GraphqlSoupDocument:doc-1",
        "GraphqlSoupDocument:tenant:doc-1",
        "__meta:identity",
        "Thing:",
    ] {
        let entity = EntityKey(Cow::Borrowed(value));
        let pair = RecordKey::from_entity(&entity).unwrap();
        assert_eq!(pair.into_entity().unwrap().as_ref(), value);
    }
}

#[test]
fn borrowed_keys_validate_components_and_reuse_the_buffer() {
    let mut buffer = String::with_capacity(128);
    for (typename, id, expected) in [
        ("ROOT_QUERY", "", "ROOT_QUERY"),
        ("ROOT_QUERY", "child", "ROOT_QUERY:child"),
        ("Thing", "tenant:record", "Thing:tenant:record"),
        ("Thing", "", "Thing:"),
        ("Thing", "unicode-🐢", "Thing:unicode-🐢"),
    ] {
        let borrowed = RecordKey::borrow_entity(typename, id, &mut buffer).unwrap();
        assert_eq!(borrowed.as_ref(), expected);
        assert!(matches!(borrowed.0, Cow::Borrowed(_)));
        assert_eq!(buffer.capacity(), 128);
    }
    for typename in ["", ":", "Thing:other"] {
        assert!(
            RecordKey::borrow_entity(typename, "id", &mut buffer)
                .unwrap_err()
                .requires_physical_reset()
        );
    }
}

#[test]
fn invalid_entity_keys_and_sql_pairs_are_rejected() {
    for value in ["", "Thing", ":id", "ROOT_QUERY:"] {
        assert!(RecordKey::from_entity(&EntityKey(Cow::Borrowed(value))).is_err());
    }
    let empty_typename = RecordKey {
        typename: String::new(),
        id: "id".into(),
    };
    assert!(
        empty_typename
            .into_entity()
            .unwrap_err()
            .requires_physical_reset()
    );

    let root_query = RecordKey {
        typename: "ROOT_QUERY".into(),
        id: String::new(),
    };
    assert_eq!(root_query.into_entity().unwrap().as_ref(), "ROOT_QUERY");
}
