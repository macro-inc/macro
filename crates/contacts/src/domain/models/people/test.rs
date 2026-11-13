use super::*;

#[test]
fn query_trims_lowercases_and_rejects_oversized_text() {
    let query = PeopleSearchQuery::new("  AlIce ").unwrap();
    assert_eq!(query.searchable(), Some("alice"));
    assert_eq!(query.byte_len(), 5);
    assert!(PeopleSearchQuery::new(&"a".repeat(MAX_QUERY_BYTES)).is_some());
    assert!(PeopleSearchQuery::new(&"a".repeat(MAX_QUERY_BYTES + 1)).is_none());
}

#[test]
fn blank_and_one_character_queries_are_not_searchable() {
    for text in ["", "   ", "a", " é "] {
        assert_eq!(PeopleSearchQuery::new(text).unwrap().searchable(), None);
    }
    assert_eq!(
        PeopleSearchQuery::new("éé").unwrap().searchable(),
        Some("éé")
    );
}

#[test]
fn limit_defaults_caps_and_rejects_zero() {
    assert_eq!(PeopleSearchLimit::DEFAULT.get(), 20);
    assert_eq!(PeopleSearchLimit::new(1).unwrap().get(), 1);
    assert_eq!(PeopleSearchLimit::new(50).unwrap().get(), 50);
    assert_eq!(PeopleSearchLimit::new(51).unwrap().get(), 50);
    assert_eq!(PeopleSearchLimit::new(u32::MAX).unwrap().get(), 50);
    assert!(PeopleSearchLimit::new(0).is_none());
}

#[test]
fn a_query_ranks_teammates_first_unless_asked_for_exact_matches() {
    let query = PeopleSearchQuery::new(" Sam ").unwrap();
    assert_eq!(query.ranking(), PeopleSearchRanking::TeammatesFirst);
    let exact = query.exact_first();
    assert_eq!(exact.ranking(), PeopleSearchRanking::ExactFirst);
    assert_eq!(exact.searchable(), Some("sam"));
}
