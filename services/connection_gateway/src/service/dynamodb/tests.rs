use super::*;

#[test]
fn rows_missing_entry_attributes_are_left_out_beside_whole_entries() {
    let whole = HashMap::from([
        (
            "PK".to_owned(),
            AttributeValue::S("#user#macro|user@example.com".to_owned()),
        ),
        ("SK".to_owned(), AttributeValue::S("live".to_owned())),
        (
            "entity_type".to_owned(),
            AttributeValue::S("user".to_owned()),
        ),
        (
            "entity_id".to_owned(),
            AttributeValue::S("macro|user@example.com".to_owned()),
        ),
        (
            "connection_id".to_owned(),
            AttributeValue::S("live".to_owned()),
        ),
        (
            "created_at".to_owned(),
            AttributeValue::N("1000".to_owned()),
        ),
        (
            "user_id".to_owned(),
            AttributeValue::S("macro|user@example.com".to_owned()),
        ),
        ("last_ping".to_owned(), AttributeValue::N("2000".to_owned())),
    ]);
    // What a ping for an entry already gone used to leave behind.
    let pinged_after_close = HashMap::from([
        (
            "PK".to_owned(),
            AttributeValue::S("#user#macro|user@example.com".to_owned()),
        ),
        ("SK".to_owned(), AttributeValue::S("closed".to_owned())),
        ("last_ping".to_owned(), AttributeValue::N("3000".to_owned())),
    ]);

    let rows = read_rows(vec![pinged_after_close, whole]).unwrap();

    assert_eq!(
        rows.entries
            .iter()
            .map(|entry| entry.connection_id.as_str())
            .collect::<Vec<_>>(),
        vec!["live"]
    );
    assert_eq!(
        rows.malformed,
        vec![MalformedRow {
            pk: "#user#macro|user@example.com".to_owned(),
            sk: "closed".to_owned(),
            missing: vec![
                "entity_type",
                "entity_id",
                "connection_id",
                "created_at",
                "user_id"
            ],
        }]
    );
}

#[test]
fn a_whole_row_of_an_unknown_entity_type_is_malformed_but_missing_nothing() {
    let newer = HashMap::from([
        ("PK".to_owned(), AttributeValue::S("#hologram#h".to_owned())),
        ("SK".to_owned(), AttributeValue::S("connection".to_owned())),
        (
            "entity_type".to_owned(),
            AttributeValue::S("hologram".to_owned()),
        ),
        ("entity_id".to_owned(), AttributeValue::S("h".to_owned())),
        (
            "connection_id".to_owned(),
            AttributeValue::S("connection".to_owned()),
        ),
        (
            "created_at".to_owned(),
            AttributeValue::N("1000".to_owned()),
        ),
        (
            "user_id".to_owned(),
            AttributeValue::S("macro|user@example.com".to_owned()),
        ),
    ]);

    let rows = read_rows(vec![newer]).unwrap();

    assert!(rows.entries.is_empty());
    assert_eq!(
        rows.malformed,
        vec![MalformedRow {
            pk: "#hologram#h".to_owned(),
            sk: "connection".to_owned(),
            missing: vec![],
        }]
    );
}
