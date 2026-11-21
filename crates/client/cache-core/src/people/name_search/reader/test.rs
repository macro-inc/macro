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
        list_priority: vec![],
        only_listed: false,
        teammates: vec![],
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
#[test]
fn messaged_word_start_matches_lead_strangers_with_exact_names_in_every_mode() {
    // Two strangers named exactly "Rhea" and a "Rhea Okafor" the viewer
    // messages: the person the viewer messages leads.
    let strangers = [
        ("macro|rhea+1@example.com", Some("Rhea"), None),
        ("macro|rhea@example.org", Some("rhea"), None),
        (
            "macro|rhea.okafor@example.com",
            Some("Rhea Okafor"),
            Some(500),
        ),
    ];
    // Messaged people first, by name tier and then recency; then the never
    // messaged by name tier; a contains-only match last, however recent.
    let groups = [
        ("macro|rhea@example.com", Some("Rhea"), None),
        ("macro|rhea+old@example.com", None, None),
        (
            "macro|rhea.okafor@example.com",
            Some("Rhea Okafor"),
            Some(100),
        ),
        ("macro|rhea+agent@example.com", None, Some(300)),
        ("macro|rhea.lee@example.com", Some("Rhea Lee"), Some(50)),
        ("macro|andrhea@example.com", Some("Andrhea"), Some(900)),
    ];
    for mode in [
        PeopleMode::Mention,
        PeopleMode::Command,
        PeopleMode::Property,
        PeopleMode::Recipient,
    ] {
        for (rows, expected) in [
            (
                &strangers[..],
                &[
                    ("macro|rhea.okafor@example.com", 9, 500),
                    ("macro|rhea+1@example.com", 5, 0),
                    ("macro|rhea@example.org", 5, 0),
                ][..],
            ),
            (
                &groups[..],
                &[
                    ("macro|rhea.okafor@example.com", 9, 100),
                    ("macro|rhea.lee@example.com", 9, 50),
                    ("macro|rhea+agent@example.com", 8, 300),
                    ("macro|rhea@example.com", 5, 0),
                    ("macro|rhea+old@example.com", 4, 0),
                    ("macro|andrhea@example.com", 3, 900),
                ][..],
            ),
        ] {
            let request = request("rhea", mode, 10);
            let records = rows
                .iter()
                .map(|(id, name, time)| {
                    let (key, mut record) = person(&request, id, "", time.unwrap_or(0), None);
                    record.fields.insert(
                        "name".into(),
                        name.map_or(CacheValue::Null, |name| CacheValue::String(name.into())),
                    );
                    if time.is_none() {
                        record.fields.remove(CONTEXT_FIELD);
                    }
                    (key, record)
                })
                .collect::<Vec<_>>();
            let mut read = NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).unwrap();
            for (key, record) in &records {
                read.push(key, record, None);
            }
            let PeopleSearchResult::Page { people, .. } = read.finish().unwrap() else {
                panic!("page");
            };
            assert_eq!(
                people
                    .iter()
                    .map(|p| (p.user_id.as_ref(), p.match_rank, p.timestamp_ms))
                    .collect::<Vec<_>>(),
                expected,
                "{mode:?}"
            );
        }
    }
}
fn listed(
    request: &PeopleSearch,
    id: &str,
    name: &str,
    time: i64,
    lists: &[&str],
) -> (EntityKey<'static>, Record) {
    let (key, mut record) = person(request, id, name, time, None);
    record.fields.insert(
        "lists".into(),
        CacheValue::List(
            lists
                .iter()
                .map(|list| CacheValue::String((*list).into()))
                .collect(),
        ),
    );
    (key, record)
}
fn mention_priority() -> Vec<Vec<String>> {
    vec![
        vec!["interacted".into(), "invited".into()],
        vec!["teammates".into()],
        vec!["gmail".into(), "outlook".into()],
    ]
}
fn listed_ids(request: &PeopleSearch, rows: &[(EntityKey<'static>, Record)]) -> Vec<(String, u8)> {
    let mut request = request.clone();
    let mut listed = vec![];
    loop {
        let mut read = NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).unwrap();
        for (key, record) in rows.iter().rev() {
            read.push(key, record, None);
        }
        let PeopleSearchResult::Page {
            people,
            next_cursor,
            ..
        } = read.finish().unwrap()
        else {
            panic!("page");
        };
        listed.extend(
            people
                .into_iter()
                .map(|p| (p.user_id.to_string(), p.match_rank)),
        );
        let Some(cursor) = next_cursor else {
            return listed;
        };
        request.cursor = Some(cursor);
    }
}
#[test]
fn list_groups_order_people_within_each_tier_before_recency() {
    let mut request = request("", PeopleMode::Mention, 1);
    request.list_priority = mention_priority();
    let rows = [
        listed(
            &request,
            "macro|stranger@example.com",
            "Rheanna Stranger",
            5000,
            &[],
        ),
        listed(
            &request,
            "macro|custom@example.com",
            "Rheanna Custom",
            4000,
            &["custom:1"],
        ),
        listed(&request, "macro|gmail@example.com", "Rhea", 0, &["gmail"]),
        listed(
            &request,
            "macro|recent.gmail@example.com",
            "Rheanna Recent",
            3000,
            &["outlook"],
        ),
        listed(
            &request,
            "macro|invited@example.com",
            "Rheanna Invited",
            0,
            &["invited"],
        ),
        listed(
            &request,
            "macro|chat@example.com",
            "Rheanna Chat",
            2000,
            &["interacted"],
        ),
        listed(
            &request,
            "macro|teammate@example.com",
            "Rheanna Mate",
            0,
            &["teammates"],
        ),
        listed(
            &request,
            "macro|both@example.com",
            "Rheanna Both",
            0,
            &["gmail", "teammates"],
        ),
    ];
    // An empty query is one tier: the first group a person's lists reach,
    // then recency. Unknown keys and no lists both come last.
    assert_eq!(
        listed_ids(&request, &rows),
        [
            ("macro|chat@example.com".to_owned(), 0),
            ("macro|invited@example.com".to_owned(), 0),
            ("macro|both@example.com".to_owned(), 0),
            ("macro|teammate@example.com".to_owned(), 0),
            ("macro|recent.gmail@example.com".to_owned(), 0),
            ("macro|gmail@example.com".to_owned(), 0),
            ("macro|stranger@example.com".to_owned(), 0),
            ("macro|custom@example.com".to_owned(), 0),
        ]
    );
    request.only_listed = true;
    assert_eq!(
        listed_ids(&request, &rows)
            .into_iter()
            .map(|(id, _)| id)
            .collect::<Vec<_>>(),
        [
            "macro|chat@example.com",
            "macro|invited@example.com",
            "macro|both@example.com",
            "macro|teammate@example.com",
            "macro|recent.gmail@example.com",
            "macro|gmail@example.com",
        ]
    );

    // Among the people the text names, the group decides before the name
    // tier: someone the viewer interacted with leads a teammate, and a
    // teammate whose name only starts with the query leads an exact name from
    // a connected inbox. Exact still precedes word-start within a group. A
    // list order supersedes the messaged split, so recency comes after both.
    request.only_listed = false;
    request.query = "rhea".into();
    assert_eq!(
        listed_ids(&request, &rows),
        [
            ("macro|chat@example.com".to_owned(), 4),
            ("macro|invited@example.com".to_owned(), 4),
            ("macro|both@example.com".to_owned(), 4),
            ("macro|teammate@example.com".to_owned(), 4),
            ("macro|gmail@example.com".to_owned(), 5),
            ("macro|recent.gmail@example.com".to_owned(), 4),
            ("macro|stranger@example.com".to_owned(), 4),
            ("macro|custom@example.com".to_owned(), 4),
        ]
    );

    // Without a priority, lists change nothing and the messaged split stays.
    request.list_priority = vec![];
    assert_eq!(
        listed_ids(&request, &rows)[..2],
        [
            ("macro|stranger@example.com".to_owned(), 8),
            ("macro|custom@example.com".to_owned(), 8),
        ]
    );
    request.query = String::new();
    assert_eq!(
        listed_ids(&request, &rows)
            .into_iter()
            .map(|(id, _)| id)
            .collect::<Vec<_>>(),
        [
            "macro|stranger@example.com",
            "macro|custom@example.com",
            "macro|recent.gmail@example.com",
            "macro|chat@example.com",
            "macro|both@example.com",
            "macro|gmail@example.com",
            "macro|invited@example.com",
            "macro|teammate@example.com",
        ]
    );
}
#[test]
fn list_priority_is_bounded_and_part_of_the_cursor() {
    let mut request = request("", PeopleMode::Mention, 1);
    request.list_priority = vec![vec!["teammates".into()]; MAX_LIST_GROUPS + 1];
    assert!(NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).is_err());
    request.list_priority = vec![vec![String::new()]];
    assert!(NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).is_err());
    request.list_priority = vec![vec!["x".repeat(MAX_LIST_KEY_BYTES + 1)]];
    assert!(NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).is_err());

    // However many lists a contact is in, the one a caller ranks by counts.
    request.list_priority = vec![vec!["teammates".into()]];
    let customs = (0..70)
        .map(|i| format!("custom:{i:02}"))
        .collect::<Vec<_>>();
    let mut lists = customs.iter().map(String::as_str).collect::<Vec<_>>();
    lists.push("teammates");
    let many = [listed(
        &request,
        "macro|many@example.com",
        "Many",
        0,
        &lists,
    )];
    request.only_listed = true;
    assert_eq!(listed_ids(&request, &many).len(), 1);
    request.only_listed = false;

    request.list_priority = mention_priority();
    let rows = [
        listed(&request, "macro|a@example.com", "A", 0, &["teammates"]),
        listed(&request, "macro|b@example.com", "B", 0, &["gmail"]),
    ];
    let mut read = NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).unwrap();
    for (key, record) in &rows {
        read.push(key, record, None);
    }
    let PeopleSearchResult::Page { next_cursor, .. } = read.finish().unwrap() else {
        panic!("page");
    };
    request.cursor = next_cursor;
    request.only_listed = true;
    assert!(NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).is_err());
    request.only_listed = false;
    request.list_priority.reverse();
    assert!(NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).is_err());
}
fn teammate_rows(request: &PeopleSearch) -> Vec<(EntityKey<'static>, Record)> {
    [
        ("macro|bjacob@example.com", "Bjacob Stranger", 0),
        ("macro|majacob@example.com", "Majacob Mate", 0),
        ("macro|jacobi@example.com", "Jacobi Stranger", 0),
        ("macro|jacob@example.org", "Jacob", 0),
        ("macro|jacob@example.com", "Jacob", 0),
        ("macro|jacobson@example.com", "Jacobson Mate", 0),
        ("macro|rivers@example.com", "Jacob Rivers", 0),
        ("macro|park@example.com", "Jacoby Park", 200),
        ("macro|chat@example.com", "Jacob Chat", 50),
    ]
    .into_iter()
    .map(|(id, name, time)| person(request, id, name, time, None))
    .collect()
}
fn teammates() -> Vec<MacroUserIdStr<'static>> {
    // A roster id in another case parses to the form the contact is keyed by.
    [
        "macro|Rivers@Example.com",
        "macro|jacobson@example.com",
        "macro|majacob@example.com",
        "macro|chat@example.com",
        "macro|absent@example.com",
    ]
    .into_iter()
    .map(|id| MacroUserIdStr::try_from(id).unwrap().into_owned())
    .collect()
}
#[test]
fn teammates_rank_between_messaged_people_and_strangers_in_each_name_tier() {
    for mode in [
        PeopleMode::Mention,
        PeopleMode::Command,
        PeopleMode::Property,
        PeopleMode::Recipient,
    ] {
        let mut request = request("jacob", mode, 2);
        request.teammates = teammates();
        let rows = teammate_rows(&request);
        // People the viewer messages lead, teammates included; then teammates
        // never messaged, exact before word-start; then strangers, however
        // exactly their names match. Contains-only matches follow in the same
        // groups. Pages of two cross every boundary.
        assert_eq!(
            listed_ids(&request, &rows),
            [
                ("macro|chat@example.com".to_owned(), 9),
                ("macro|park@example.com".to_owned(), 8),
                ("macro|rivers@example.com".to_owned(), 7),
                ("macro|jacobson@example.com".to_owned(), 6),
                ("macro|jacob@example.com".to_owned(), 5),
                ("macro|jacob@example.org".to_owned(), 5),
                ("macro|jacobi@example.com".to_owned(), 4),
                ("macro|majacob@example.com".to_owned(), 2),
                ("macro|bjacob@example.com".to_owned(), 1),
            ],
            "{mode:?}"
        );

        // Without a roster, teammates rank as the strangers they share a tier with.
        request.teammates = vec![];
        assert_eq!(
            listed_ids(&request, &rows)
                .into_iter()
                .map(|(id, _)| id)
                .collect::<Vec<_>>(),
            [
                "macro|chat@example.com",
                "macro|park@example.com",
                "macro|jacob@example.com",
                "macro|jacob@example.org",
                "macro|rivers@example.com",
                "macro|jacobi@example.com",
                "macro|jacobson@example.com",
                "macro|bjacob@example.com",
                "macro|majacob@example.com",
            ],
            "{mode:?}"
        );
    }
}
#[test]
fn a_list_order_supersedes_the_teammate_split() {
    let mut request = request("jacob", PeopleMode::Mention, 2);
    request.list_priority = mention_priority();
    let rows = teammate_rows(&request);
    let unchanged = listed_ids(&request, &rows);
    // Nobody is listed, so everyone is in the last group: exact before
    // word-start, then recency, then identity. A roster changes none of it.
    assert_eq!(
        unchanged,
        [
            ("macro|chat@example.com".to_owned(), 5),
            ("macro|jacob@example.com".to_owned(), 5),
            ("macro|jacob@example.org".to_owned(), 5),
            ("macro|rivers@example.com".to_owned(), 5),
            ("macro|park@example.com".to_owned(), 4),
            ("macro|jacobi@example.com".to_owned(), 4),
            ("macro|jacobson@example.com".to_owned(), 4),
            ("macro|bjacob@example.com".to_owned(), 1),
            ("macro|majacob@example.com".to_owned(), 1),
        ]
    );
    request.teammates = teammates();
    assert_eq!(listed_ids(&request, &rows), unchanged);
}
#[test]
fn teammates_are_bounded_and_part_of_the_cursor() {
    let mut request = request("jacob", PeopleMode::Mention, 1);
    request.teammates = (0..=MAX_PEOPLE_BATCH)
        .map(|i| {
            MacroUserIdStr::try_from(format!("macro|mate{i}@example.com"))
                .unwrap()
                .into_owned()
        })
        .collect();
    assert!(NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).is_err());

    request.teammates = teammates();
    let rows = teammate_rows(&request);
    let mut read = NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).unwrap();
    for (key, record) in &rows {
        read.push(key, record, None);
    }
    let PeopleSearchResult::Page { next_cursor, .. } = read.finish().unwrap() else {
        panic!("page");
    };
    request.cursor = next_cursor;
    assert!(NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).is_ok());
    request.teammates.pop();
    assert!(NameSearchRead::new(&request, Uuid::from_u128(2), VERSION).is_err());
}
