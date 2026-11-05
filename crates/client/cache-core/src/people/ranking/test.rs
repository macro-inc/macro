use super::*;

fn request(query: &str) -> PeopleSearch {
    PeopleSearch {
        scope: crate::engine::HydrationScope {
            contact_fence: None,
            storage_generation: Uuid::from_u128(1),
            identity: "macro|viewer@example.com".into(),
        },
        mode: PeopleMode::Recipient,
        query: query.into(),
        excluded: Vec::new(),
        sender_domain: None,
        limit: 1,
        now_ms: 0,
        cursor: None,
    }
}

fn push(ranker: &mut PeopleRanker<'_>, email: &str, name: &str) {
    let record = Record {
        fields: [
            (
                "userId".into(),
                CacheValue::String(format!("macro|{email}")),
            ),
            ("email".into(), CacheValue::String(email.into())),
            ("name".into(), CacheValue::String(name.into())),
        ]
        .into(),
    };
    let user = MacroUserIdStr::try_from_email(email).unwrap();
    ranker.push(
        &contact_key(&ranker.request.scope.identity, user.as_ref()),
        &record,
    );
}

#[test]
fn foreign_viewer_keys_never_rank_as_personal_membership() {
    let request = request("");
    let mut ranker = PeopleRanker::new(&request, Uuid::from_u128(2)).unwrap();
    let user = "macro|person@example.com";
    let record = Record {
        fields: [
            ("userId".into(), CacheValue::String(user.into())),
            (
                "email".into(),
                CacheValue::String("person@example.com".into()),
            ),
            (
                "name".into(),
                CacheValue::String("Other private name".into()),
            ),
        ]
        .into(),
    };
    ranker.push(&contact_key("macro|other@example.com", user), &record);
    assert!(ranker.best.is_empty());
}

#[test]
fn stack_key_comparison_preserves_canonical_identity_and_exact_key_bytes() {
    let request = request("");
    let user = "macro|person@example.com";
    let valid = contact_key(&request.scope.identity, user);
    let record = Record {
        fields: [
            (
                "userId".into(),
                CacheValue::String("macro|PERSON@example.com".into()),
            ),
            (
                "email".into(),
                CacheValue::String("PERSON@example.com".into()),
            ),
            ("name".into(), CacheValue::String("Person".into())),
        ]
        .into(),
    };
    for key in [
        valid.clone(),
        contact_key("macro|other@example.com", user),
        EntityKey(format!("GraphqlContact:{}", valid.id().unwrap().to_uppercase()).into()),
        EntityKey(format!("graphqlcontact:{}", valid.id().unwrap()).into()),
        EntityKey(format!("{valid}:extra").into()),
        EntityKey(valid.id().unwrap().to_owned().into()),
    ] {
        let mut ranker = PeopleRanker::new(&request, Uuid::from_u128(2)).unwrap();
        ranker.push(&key, &record);
        assert_eq!(!ranker.best.is_empty(), key == valid, "{key}");
    }
}

#[test]
fn automated_mailboxes_do_not_consume_the_result_limit() {
    let request = request("");
    let mut ranker = PeopleRanker::new(&request, Uuid::from_u128(2)).unwrap();
    for index in 0..100_000 {
        push(
            &mut ranker,
            &format!("notifications+{index}@example.com"),
            "A",
        );
        assert!(ranker.best.len() <= request.limit + 1);
    }
    push(
        &mut ranker,
        "person@example.com",
        "A person with a longer name",
    );
    let PeopleSearchResult::Page {
        people,
        truncated,
        next_cursor,
        ..
    } = ranker.finish().unwrap()
    else {
        panic!("expected a ranked page")
    };
    assert_eq!(people.len(), 1);
    assert_eq!(people[0].email, "person@example.com");
    assert!(!truncated);
    assert!(next_cursor.is_none());
}

#[test]
fn complete_typed_addresses_and_other_person_surfaces_keep_automated_people() {
    for (query, mode) in [
        ("NO-REPLY@example.com", PeopleMode::Recipient),
        ("", PeopleMode::Command),
        ("", PeopleMode::Mention),
        ("", PeopleMode::Property),
    ] {
        let mut request = request(query);
        request.mode = mode;
        let mut ranker = PeopleRanker::new(&request, Uuid::from_u128(2)).unwrap();
        push(&mut ranker, "NO-REPLY@example.com", "Notifications");
        let PeopleSearchResult::Page { people, .. } = ranker.finish().unwrap() else {
            panic!("expected a ranked page")
        };
        assert_eq!(people.len(), 1, "{mode:?}");
        assert_eq!(people[0].email, "NO-REPLY@example.com");
    }
}
