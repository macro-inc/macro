use super::*;
use crate::models::contact::ContactId;

#[test]
fn search_has_cache_matching_semantics_and_a_byte_bound() {
    let viewer = MacroUserIdStr::try_from_email("viewer@example.com").unwrap();
    let user_id = MacroUserIdStr::try_from_email("person@example.com").unwrap();
    let contact = Contact {
        id: ContactId::for_viewer(&viewer, &user_id),
        user_id,
        name: Some("CAFÉ Plan 100%_".into()),
    };
    for query in [" café PLN ", "person EXAMPLE", "%_", ""] {
        assert!(
            ContactSearch::new(query).unwrap().matches(&contact),
            "{query}"
        );
    }
    assert!(!ContactSearch::new("missing").unwrap().matches(&contact));
    assert!(ContactSearch::new(&"x".repeat(512)).is_some());
    assert!(ContactSearch::new(&"x".repeat(513)).is_none());
    assert!(ContactSearch::new(&"é".repeat(257)).is_none());
}

#[test]
fn reference_predicates_match_before_limiting_without_inventing_local_part_names() {
    let viewer = MacroUserIdStr::try_from_email("viewer@example.com").unwrap();
    let user_id = MacroUserIdStr::try_from_email("person@example.com").unwrap();
    let mut contact = Contact {
        id: ContactId::for_viewer(&viewer, &user_id),
        user_id,
        name: Some("Sam Example".into()),
    };
    assert!(!ContactSearch::exact("Sam").unwrap().matches(&contact));
    assert!(
        ContactSearch::first_name(" SAM ")
            .unwrap()
            .matches(&contact)
    );
    assert!(ContactSearch::any_name("Sam").unwrap().matches(&contact));
    assert!(
        ContactSearch::exact("sam example")
            .unwrap()
            .matches(&contact)
    );
    assert!(
        !ContactSearch::first_name("sam example")
            .unwrap()
            .matches(&contact)
    );
    assert!(!ContactSearch::any_name("Sm").unwrap().matches(&contact));
    assert!(ContactSearch::new("Sm").unwrap().matches(&contact));
    assert!(
        ContactSearch::exact("macro|person@example.com")
            .unwrap()
            .matches(&contact)
    );
    contact.name = None;
    assert!(
        !ContactSearch::first_name("person")
            .unwrap()
            .matches(&contact)
    );
    assert!(
        ContactSearch::exact("PERSON@example.com")
            .unwrap()
            .matches(&contact)
    );
    assert!(ContactSearch::exact("").is_none());
    assert!(ContactSearch::first_name("  ").is_none());
    assert!(ContactSearch::any_name(&"é".repeat(257)).is_none());
}

#[test]
fn lookups_bound_raw_input_and_deduplicate_canonical_ids_in_order() {
    let first = MacroUserIdStr::try_from_email("FIRST@example.com").unwrap();
    let same = MacroUserIdStr::try_from_email("first@example.com").unwrap();
    let second = MacroUserIdStr::try_from_email("second@example.com").unwrap();
    let lookup = ContactLookup::new(vec![first.clone(), second.clone(), same]).unwrap();
    assert_eq!(lookup.ids(), &[first.clone(), second]);
    assert!(ContactLookup::new(vec![]).unwrap().ids().is_empty());
    assert!(ContactLookup::new(vec![first; 501]).is_none());
}
