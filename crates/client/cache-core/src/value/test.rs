use super::*;
use serde_json::json;

#[test]
fn decoded_field_maps_keep_the_last_of_repeated_or_unordered_keys() {
    let entries = |pairs: &[(&str, &str)]| {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), CacheValue::String(value.to_string())))
            .collect::<Vec<_>>()
    };
    // A postcard map has the same bytes as a sequence of pairs, so these
    // stand in for maps written out of order or with a key repeated.
    for pairs in [
        &[("a", "1"), ("b", "2"), ("c", "3")][..],
        &[("b", "1"), ("a", "2"), ("b", "3")][..],
        &[("a", "1"), ("a", "2"), ("a", "3")][..],
        &[("a", "1"), ("b", "2"), ("b", "3")][..],
    ] {
        let bytes = postcard::to_allocvec(&entries(pairs)).unwrap();
        let decoded: Record = postcard::from_bytes(&bytes).unwrap();
        let expected: BTreeMap<FieldKey, CacheValue> = entries(pairs).into_iter().collect();
        assert_eq!(decoded.fields, expected);
    }
}

#[test]
fn canonical_sorts_keys_recursively() {
    let v = json!({"b": {"z": 1, "a": [ {"y": 2, "x": 3} ]}, "a": null});
    assert_eq!(
        canonical_json(&v),
        r#"{"a":null,"b":{"a":[{"x":3,"y":2}],"z":1}}"#
    );
}

#[test]
fn merge_reports_changes() {
    let mut r = Record::default();
    let mut other = Record::default();
    other
        .fields
        .insert("name".into(), CacheValue::String("A".into()));
    assert!(r.merge(other.clone()));
    assert!(!r.merge(other)); // idempotent
    let mut third = Record::default();
    third
        .fields
        .insert("name".into(), CacheValue::String("B".into()));
    assert!(r.merge(third));
}

#[test]
fn entity_key_format() {
    assert_eq!(
        EntityKey::entity("GraphqlSoupDocument", &["doc-1"]).0,
        "GraphqlSoupDocument:doc-1"
    );
    assert_eq!(
        field_key("soup", Some(r#"{"input":{}}"#)),
        r#"soup({"input":{}})"#
    );
    assert_eq!(field_key("id", None), "id");
}
