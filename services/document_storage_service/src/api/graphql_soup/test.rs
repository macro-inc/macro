use super::is_introspection_query;

#[test]
fn accepts_pure_introspection() {
    assert!(is_introspection_query(
        "{ __schema { queryType { name } } }",
        None
    ));
    assert!(is_introspection_query(
        "query Introspection { __type(name: \"Query\") { name } }",
        Some("Introspection")
    ));
}

#[test]
fn rejects_mixed_and_substring_queries() {
    assert!(!is_introspection_query("{ __typename user { id } }", None));
    assert!(!is_introspection_query("{ user { id } } # __schema", None));
    assert!(!is_introspection_query(
        "query Named { user { id } }",
        Some("Named")
    ));
}
