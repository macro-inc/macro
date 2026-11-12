use super::*;
use crate::engine::HydrationScope;
const VERSION: PeopleReadVersion = PeopleReadVersion {
    contacts: Uuid::from_u128(10),
    context: Uuid::from_u128(11),
};

fn request(query: &str, mode: PeopleMode, limit: usize) -> PeopleSearch {
    PeopleSearch {
        scope: HydrationScope {
            identity: "macro|viewer@example.com".into(),
            storage_generation: Uuid::from_u128(1),
            contact_fence: None,
        },
        mode,
        query: query.into(),
        excluded: vec![],
        sender_domain: None,
        limit,
        now_ms: 0,
        cursor: None,
    }
}
fn person(
    request: &PeopleSearch,
    id: &str,
    name: &str,
    time: i64,
    dm: Option<Uuid>,
) -> (EntityKey<'static>, Record) {
    let facts = PersonFacts {
        last_interaction_ms: Some(time),
        direct_message: dm.map(|id| crate::people::DirectMessageFacts {
            id,
            name: "Conversation".into(),
            timestamp_ms: time,
        }),
        secondary_inbox: false,
    };
    (
        crate::people::contact_key(&request.scope.identity, id),
        Record {
            fields: [
                ("userId".into(), CacheValue::String(id.into())),
                (
                    "email".into(),
                    CacheValue::String(id.strip_prefix("macro|").unwrap().into()),
                ),
                ("name".into(), CacheValue::String(name.into())),
                (
                    CONTEXT_FIELD.into(),
                    CacheValue::opaque(
                        &serde_json::to_value(StoredFacts {
                            epoch: Uuid::from_u128(2),
                            facts,
                        })
                        .unwrap(),
                    ),
                ),
            ]
            .into(),
        },
    )
}
#[test]
fn tiers_then_recency_then_identity_and_bounded_duplicate_handling() {
    let request = request("jo", PeopleMode::Recipient, 3);
    let rows = [
        person(&request, "macro|a@example.com", "Jo", 1, None),
        person(&request, "macro|c@example.com", "John", 20, None),
        person(&request, "macro|b@example.com", "John", 20, None),
        person(&request, "macro|d@example.com", "Banjo", 100, None),
    ];
    let mut read = NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).unwrap();
    for _ in 0..3 {
        for (key, record) in rows.iter().rev() {
            read.push(key, record, None);
            assert!(read.best.len() <= 4);
        }
    }
    let PeopleSearchResult::Page {
        people,
        next_cursor,
        ..
    } = read.finish().unwrap()
    else {
        panic!("page");
    };
    assert_eq!(
        people
            .iter()
            .map(|p| p.user_id.as_ref())
            .collect::<Vec<_>>(),
        [
            "macro|a@example.com",
            "macro|b@example.com",
            "macro|c@example.com"
        ]
    );
    let mut next = request.clone();
    next.cursor = next_cursor;
    let mut read = NameSearchRead::new(&next, Uuid::from_u128(2), VERSION).unwrap();
    for (k, r) in &rows {
        read.push(k, r, None);
    }
    let PeopleSearchResult::Page {
        people,
        next_cursor,
        ..
    } = read.finish().unwrap()
    else {
        panic!("page");
    };
    assert_eq!(people[0].name, "Banjo");
    assert!(next_cursor.is_none());
    assert!(NameSearchRead::new(&next, Uuid::from_u128(3), VERSION).is_err());
    next.query = "john".into();
    assert!(NameSearchRead::new(&next, Uuid::from_u128(2), VERSION).is_err());
}
#[test]
fn earlier_eligible_dm_alias_does_not_reappear_on_a_later_tier() {
    let request = request("jo", PeopleMode::Command, 1);
    let dm = Uuid::from_u128(9);
    let rows = [
        person(&request, "macro|a@example.com", "Jo", 1, Some(dm)),
        person(&request, "macro|b@example.com", "John", 2, Some(dm)),
        person(&request, "macro|c@example.com", "John", 3, None),
    ];
    let mut read = NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).unwrap();
    for (k, r) in &rows {
        read.push(k, r, None);
    }
    let PeopleSearchResult::Page {
        people,
        next_cursor,
        ..
    } = read.finish().unwrap()
    else {
        panic!("page");
    };
    assert_eq!(people[0].user_id.as_ref(), "macro|a@example.com");
    let mut request = request;
    request.cursor = next_cursor;
    request.limit = 2;
    let mut read = NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).unwrap();
    for (k, r) in &rows {
        read.push(k, r, None);
    }
    for (k, r) in &rows {
        read.note_prior_alias(k, r);
    }
    let PeopleSearchResult::Page { people, .. } = read.finish().unwrap() else {
        panic!("page");
    };
    assert_eq!(people.len(), 1);
    assert_eq!(people[0].user_id.as_ref(), "macro|c@example.com");
}
#[test]
fn eligibility_preserves_self_pin_automated_addresses_and_foreign_keys() {
    let request = request("", PeopleMode::Property, 2);
    let own = person(&request, &request.scope.identity, "Viewer", 0, None);
    let other = person(&request, "macro|other@example.com", "Other", 100, None);
    let mut read = NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).unwrap();
    read.push(&other.0, &other.1, None);
    read.push(&own.0, &own.1, None);
    read.push(
        &crate::people::contact_key("macro|foreign@example.com", "macro|other@example.com"),
        &other.1,
        None,
    );
    let PeopleSearchResult::Page { people, .. } = read.finish().unwrap() else {
        panic!("page");
    };
    assert_eq!(people.len(), 2);
    assert_eq!(people[0].user_id.as_ref(), request.scope.identity);
    for (query, expected) in [("notice", 0), ("notifications@example.com", 1)] {
        let request = super::test::request(query, PeopleMode::Recipient, 2);
        let row = person(
            &request,
            "macro|notifications@example.com",
            "Notice",
            0,
            None,
        );
        let mut read = NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).unwrap();
        read.push(&row.0, &row.1, None);
        let PeopleSearchResult::Page { people, .. } = read.finish().unwrap() else {
            panic!("page");
        };
        assert_eq!(people.len(), expected);
    }
}
