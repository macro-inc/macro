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

fn contact(email: &str, name: Option<&str>) -> Contact {
    let viewer =
        macro_user_id::user_id::MacroUserIdStr::try_from_email("viewer@example.com").unwrap();
    let user_id = macro_user_id::user_id::MacroUserIdStr::try_from_email(email).unwrap();
    Contact {
        id: super::super::contact::ContactId::for_viewer(&viewer, &user_id),
        user_id,
        name: name.map(str::to_owned),
        lists: Vec::new(),
    }
}

#[test]
fn text_names_people_by_whole_name_first_name_or_word_starts() {
    let tero_n = NamedPeopleQuery::new("  Tero   N ").unwrap();
    assert_eq!(tero_n.normalized(), "tero n");
    assert_eq!(tero_n.words(), ["n", "tero"]);
    let tero_nyland = contact("tero@example.com", Some("Tero Nyland"));
    assert_eq!(tero_n.named_by(&tero_nyland), Some(NamedBy::WordStart));
    assert_eq!(
        NamedPeopleQuery::new("nyland tero")
            .unwrap()
            .named_by(&tero_nyland),
        Some(NamedBy::WordStart),
        "word order does not matter"
    );
    assert_eq!(
        NamedPeopleQuery::new("tero nyland")
            .unwrap()
            .named_by(&tero_nyland),
        Some(NamedBy::Exact)
    );
    assert_eq!(
        NamedPeopleQuery::new("TERO")
            .unwrap()
            .named_by(&tero_nyland),
        Some(NamedBy::Exact),
        "one word equal to the first name is exact"
    );

    let te = NamedPeopleQuery::new("te").unwrap();
    assert_eq!(
        te.named_by(&contact("q@example.com", Some("Quinn Teague"))),
        Some(NamedBy::WordStart),
        "the last name starts with the text"
    );
    assert_eq!(
        te.named_by(&contact("p@example.com", Some("Peter Stone"))),
        None,
        "a word that only contains the text is not named"
    );
    assert_eq!(
        te.named_by(&contact("o@example.com", Some("Anne O'Teller"))),
        Some(NamedBy::WordStart),
        "punctuation separates words"
    );
}

#[test]
fn a_person_without_a_name_is_named_by_the_local_part_of_their_address() {
    let query = NamedPeopleQuery::new("tero n").unwrap();
    assert_eq!(
        query.named_by(&contact("tero.nyland@example.com", None)),
        Some(NamedBy::WordStart)
    );
    assert_eq!(
        query.named_by(&contact("nyland@tero-n.example.com", None)),
        None,
        "the domain is not a name"
    );
}

#[test]
fn addresses_ids_and_punctuation_name_nobody() {
    for text in [
        "tero@example.com",
        "tero@",
        " MACRO|tero@example.com",
        " - ",
        "",
    ] {
        let query = NamedPeopleQuery::new(text).unwrap();
        assert!(!query.names_anyone(), "{text:?}");
        assert_eq!(
            query.named_by(&contact("tero@example.com", Some("tero"))),
            None
        );
    }
}

#[test]
fn oversized_or_many_word_text_is_rejected() {
    assert!(NamedPeopleQuery::new(&"a".repeat(MAX_QUERY_BYTES + 1)).is_none());
    let words = |count: usize| {
        (0..count)
            .map(|n| format!("w{n}"))
            .collect::<Vec<_>>()
            .join(" ")
    };
    assert!(NamedPeopleQuery::new(&words(MAX_NAMED_WORDS)).is_some());
    assert!(NamedPeopleQuery::new(&words(MAX_NAMED_WORDS + 1)).is_none());
}
