use super::*;

#[test]
fn name_tiers_preserve_words_punctuation_and_contains_without_gaps() {
    for (query, name, expected) in [
        ("  JOHN\tSMITH ", "John  Smith", Some(NameMatch::Exact)),
        ("jo sm", "John Smith", Some(NameMatch::WordPrefix)),
        ("sm jo", "John Smith", Some(NameMatch::WordPrefix)),
        ("jo jo", "John Johnson", Some(NameMatch::WordPrefix)),
        ("ohn", "John Smith", Some(NameMatch::Contains)),
        ("jhn", "John Smith", None),
        ("o'ne", "O’Neill", Some(NameMatch::WordPrefix)),
        ("anne ma", "Anne-Marie", Some(NameMatch::WordPrefix)),
        ("山田", "山田太郎", Some(NameMatch::WordPrefix)),
        ("太郎", "山田太郎", Some(NameMatch::Contains)),
        ("zoë", "Zoë Example", Some(NameMatch::WordPrefix)),
        ("zoe", "Zoë Example", None),
        ("%", "100%", Some(NameMatch::Contains)),
        ("%", "unrelated", None),
        ("\0", "nul\0name", Some(NameMatch::Contains)),
        (" ", "Anything", Some(NameMatch::Browse)),
    ] {
        assert_eq!(
            NameQuery::new(query)
                .unwrap()
                .classify_normalized(&normalize_text(name)),
            expected,
            "{query:?} {name:?}"
        );
    }
}

#[test]
fn name_queries_bound_raw_input_and_prepare_unique_words() {
    assert!(NameQuery::new(&"x".repeat(MAX_QUERY_BYTES)).is_some());
    assert!(NameQuery::new(&"é".repeat(MAX_QUERY_BYTES)).is_none());
    let query = NameQuery::new("SM jo sm").unwrap();
    assert_eq!(query.words().collect::<Vec<_>>(), ["jo", "sm"]);
    // No name/email concatenation: address routing must be explicit at the caller.
    assert_eq!(
        NameQuery::new("example.com")
            .unwrap()
            .classify_normalized("John Smith"),
        None
    );
}
