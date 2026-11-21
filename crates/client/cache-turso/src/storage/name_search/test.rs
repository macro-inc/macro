use super::*;
use cache_core::{
    engine::{Engine, HydrationScope},
    people::{
        ContextAction, ContextUpdate, PeopleMode, PeopleSearch, PeopleSearchResult,
        PersonFactPatch, PersonFacts,
    },
    value::CacheValue,
};
use pollster::block_on;
use uuid::Uuid;
const VIEWER: &str = "macro|viewer@example.com";
const EPOCH: Uuid = Uuid::from_u128(2);
fn key(user: &str) -> EntityKey<'static> {
    EntityKey::entity(
        "GraphqlContact",
        &[&Uuid::new_v5(
            &Uuid::new_v5(&Uuid::NAMESPACE_OID, VIEWER.as_bytes()),
            user.as_bytes(),
        )
        .to_string()],
    )
}
fn record(user: &str, name: &str) -> Record {
    Record {
        fields: [
            ("userId".into(), CacheValue::String(user.into())),
            (
                "email".into(),
                CacheValue::String(user.strip_prefix("macro|").unwrap().into()),
            ),
            ("name".into(), CacheValue::String(name.into())),
        ]
        .into(),
    }
}
async fn seed(count: usize) -> (Engine<TursoStorage>, HydrationScope) {
    let mut engine = Engine::new(TursoStorage::open_in_memory("indexed-names").unwrap());
    engine
        .write_query(
            None,
            "{ user { id } }",
            None,
            &serde_json::Map::new(),
            &serde_json::json!({"user":{"id":VIEWER}}),
            Some(VIEWER),
        )
        .await
        .unwrap();
    let scope = HydrationScope {
        identity: VIEWER.into(),
        storage_generation: engine.current_storage_generation().await.unwrap(),
        contact_fence: None,
    };
    let mut storage = engine.into_storage();
    storage
        .put_batch(vec![(key(VIEWER), record(VIEWER, "Viewer"))])
        .await
        .unwrap();
    for start in (0..count).step_by(500) {
        storage
            .put_batch(
                (start..(start + 500).min(count))
                    .map(|i| {
                        let id = format!("macro|p{i:06}@example.com");
                        (
                            key(&id),
                            record(
                                &id,
                                if i + 200 >= count {
                                    "Late person"
                                } else {
                                    "Other person"
                                },
                            ),
                        )
                    })
                    .collect(),
            )
            .await
            .unwrap();
    }
    let mut engine = Engine::new(storage);
    engine
        .update_people_context(&ContextUpdate {
            scope: scope.clone(),
            epoch: EPOCH,
            action: ContextAction::Begin {
                previous_epoch: None,
            },
        })
        .await
        .unwrap();
    engine
        .update_people_context(&ContextUpdate {
            scope: scope.clone(),
            epoch: EPOCH,
            action: ContextAction::Commit,
        })
        .await
        .unwrap();
    (engine, scope)
}
fn request(scope: &HydrationScope, query: &str, mode: PeopleMode) -> PeopleSearch {
    PeopleSearch {
        scope: scope.clone(),
        mode,
        query: query.into(),
        excluded: vec![],
        sender_domain: None,
        limit: 50,
        now_ms: 0,
        cursor: None,
        list_priority: vec![],
        only_listed: false,
        teammates: vec![],
    }
}
async fn reference(
    engine: &Engine<TursoStorage>,
    request: &PeopleSearch,
    epoch: Uuid,
) -> PeopleSearchResult {
    let mut read = NameSearchRead::new(request, epoch, engine.people_read_version()).unwrap();
    let storage = engine.storage();
    storage
        .visit_contact_records(&SearchQuery::new(""), |k, r| read.push(k, r, None))
        .await
        .unwrap();
    if !read.prior_dm_targets().is_empty() {
        storage
            .visit_contact_records(&SearchQuery::new(""), |k, r| read.note_prior_alias(k, r))
            .await
            .unwrap();
    }
    read.finish().unwrap()
}
async fn parity(
    engine: &mut Engine<TursoStorage>,
    request: &PeopleSearch,
    epoch: Uuid,
) -> PeopleSearchResult {
    let reference = reference(engine, request, epoch).await;
    let indexed = engine.search_people(request).await.unwrap();
    assert_eq!(
        serde_json::to_value(&indexed).unwrap(),
        serde_json::to_value(reference).unwrap(),
        "{} {:?}",
        request.query,
        request.mode
    );
    indexed
}
#[test]
fn indexed_stages_match_complete_scan_across_sparse_prefixes_overflow_and_continuations() {
    block_on(async {
        let (mut engine, scope) = seed(5000).await;
        for query in [
            "",
            "Late person",
            "late",
            "other",
            "la per",
            "per la",
            "ate",
            "missing",
            "p004999@",
            "p004999@example.com",
            "p004999",
            "example.com",
        ] {
            for mode in [
                PeopleMode::Command,
                PeopleMode::Recipient,
                PeopleMode::Mention,
                PeopleMode::Property,
            ] {
                let mut request = request(&scope, query, mode);
                request.excluded = vec!["macro|p004800@example.com".try_into().unwrap()];
                for _ in 0..3 {
                    let result = parity(&mut engine, &request, EPOCH).await;
                    let PeopleSearchResult::Page { next_cursor, .. } = result else {
                        panic!("page");
                    };
                    if next_cursor.is_none() {
                        break;
                    }
                    request.cursor = next_cursor;
                }
            }
        }
        let mut storage = engine.into_storage();
        let overflow = (0..70)
            .map(|i| format!("word{i}"))
            .collect::<Vec<_>>()
            .join(" ")
            + " zzoverflow";
        storage
            .put_batch(vec![
                (
                    key("macro|overflow@example.com"),
                    record("macro|overflow@example.com", &overflow),
                ),
                (
                    key("macro|nul@example.com"),
                    record("macro|nul@example.com", "Late\0label"),
                ),
            ])
            .await
            .unwrap();
        // A first name shares the exact tier; a comma list, a hyphenated first
        // name, a last name and a control character after the name do not.
        // People the viewer messages lead every word-start match.
        let first_names = [
            ("macro|zed@example.com", "Zed", None),
            ("macro|zed.okafor@example.com", "Zed Okafor", Some(100)),
            ("macro|zed.group@example.com", "Zed, Group", Some(400)),
            ("macro|zed.ann@example.com", "Zed-Ann Person", None),
            ("macro|okafor.zed@example.com", "Okafor Zed", Some(200)),
            ("macro|zed.control@example.com", "Zed\u{1}Person", None),
            ("macro|ozeda@example.com", "Ozeda", Some(900)),
        ];
        storage
            .put_batch(
                first_names
                    .iter()
                    .map(|(user, name, _)| (key(user), record(user, name)))
                    .collect(),
            )
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        engine
            .update_people_context(&ContextUpdate {
                scope: scope.clone(),
                epoch: EPOCH,
                action: ContextAction::Patch {
                    updates: first_names
                        .iter()
                        .filter_map(|(user, _, time)| {
                            Some(PersonFactPatch {
                                user_id: (*user).try_into().unwrap(),
                                facts: PersonFacts {
                                    last_interaction_ms: Some((*time)?),
                                    ..Default::default()
                                },
                            })
                        })
                        .collect(),
                },
            })
            .await
            .unwrap();
        for query in ["zzover", "late\0", "%", "_"] {
            parity(
                &mut engine,
                &request(&scope, query, PeopleMode::Recipient),
                EPOCH,
            )
            .await;
        }
        for mode in [
            PeopleMode::Command,
            PeopleMode::Recipient,
            PeopleMode::Mention,
            PeopleMode::Property,
        ] {
            parity(&mut engine, &request(&scope, "zed okafor", mode), EPOCH).await;
            let mut request = request(&scope, "zed", mode);
            request.limit = 2;
            let mut listed = vec![];
            loop {
                let PeopleSearchResult::Page {
                    people,
                    next_cursor,
                    ..
                } = parity(&mut engine, &request, EPOCH).await
                else {
                    panic!("page");
                };
                listed.extend(
                    people
                        .into_iter()
                        .map(|person| (person.user_id.to_string(), person.match_rank)),
                );
                let Some(cursor) = next_cursor else { break };
                request.cursor = Some(cursor);
            }
            assert_eq!(
                listed
                    .iter()
                    .map(|(user, rank)| (user.as_str(), *rank))
                    .collect::<Vec<_>>(),
                [
                    ("macro|zed.okafor@example.com", 9),
                    ("macro|zed.group@example.com", 8),
                    ("macro|okafor.zed@example.com", 8),
                    ("macro|zed@example.com", 5),
                    ("macro|zed.ann@example.com", 4),
                    ("macro|zed.control@example.com", 4),
                    ("macro|ozeda@example.com", 3),
                ],
                "{mode:?}"
            );
        }
    });
}
#[test]
fn messaged_word_prefixes_page_ahead_of_unmessaged_exact_names_at_scale() {
    block_on(async {
        let (engine, scope) = seed(5000).await;
        let mut storage = engine.into_storage();
        storage
            .put_batch(
                (0..300)
                    .map(|i| {
                        let user = format!("macro|q{i:06}@example.com");
                        (key(&user), record(&user, "Person Other"))
                    })
                    .chain([(
                        key("macro|brother@example.com"),
                        record("macro|brother@example.com", "Brother Person"),
                    )])
                    .collect(),
            )
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        engine
            .update_people_context(&ContextUpdate {
                scope: scope.clone(),
                epoch: EPOCH,
                action: ContextAction::Patch {
                    updates: (0..200)
                        .map(|i| (format!("macro|q{i:06}@example.com"), 1000 + i))
                        .chain([("macro|brother@example.com".to_owned(), 5000)])
                        .map(|(user, time)| PersonFactPatch {
                            user_id: user.try_into().unwrap(),
                            facts: PersonFacts {
                                last_interaction_ms: Some(time),
                                ..Default::default()
                            },
                        })
                        .collect(),
                },
            })
            .await
            .unwrap();
        for mode in [
            PeopleMode::Command,
            PeopleMode::Recipient,
            PeopleMode::Mention,
            PeopleMode::Property,
        ] {
            let mut request = request(&scope, "other", mode);
            request.limit = 120;
            let mut listed = vec![];
            for _ in 0..3 {
                let PeopleSearchResult::Page {
                    people,
                    next_cursor,
                    ..
                } = parity(&mut engine, &request, EPOCH).await
                else {
                    panic!("page");
                };
                listed.extend(people.into_iter().map(|p| (p.user_id, p.match_rank)));
                request.cursor = next_cursor;
            }
            assert_eq!(listed.len(), 360, "{mode:?}");
            assert_eq!(listed[0].0.as_ref(), "macro|q000199@example.com");
            assert!(listed[..200].iter().all(|(_, rank)| *rank == 8), "{mode:?}");
            assert_eq!(listed[200].0.as_ref(), "macro|p000000@example.com");
            assert!(listed[200..].iter().all(|(_, rank)| *rank == 5), "{mode:?}");
        }
    });
}
#[test]
fn address_terms_match_below_names_on_sparse_and_broad_reads() {
    block_on(async {
        let (engine, scope) = seed(5000).await;
        let mut storage = engine.into_storage();
        storage
            .put_batch(vec![
                (
                    key("macro|jdoe1@example.org"),
                    record("macro|jdoe1@example.org", "Jane Doe"),
                ),
                (
                    key("macro|ann@example.net"),
                    record("macro|ann@example.net", "Test name"),
                ),
                (
                    key("macro|asmith@example.net"),
                    record("macro|asmith@example.net", "Ann Smith"),
                ),
                // Mid-word name and address matches: equally recent, and the
                // address match's id sorts first, so only the tier orders them.
                (
                    key("macro|zsmith@example.net"),
                    record("macro|zsmith@example.net", "John Smith"),
                ),
                (
                    key("macro|ajohnson@example.net"),
                    record("macro|ajohnson@example.net", "Pat Lee"),
                ),
            ])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        let users = |result: PeopleSearchResult| {
            let PeopleSearchResult::Page { people, .. } = result else {
                panic!("page");
            };
            people
                .into_iter()
                .map(|p| p.user_id.as_ref().to_owned())
                .collect::<Vec<_>>()
        };

        // A local part that differs from the name, and a domain.
        for (query, expected) in [
            ("jdoe", vec!["macro|jdoe1@example.org"]),
            ("example.org", vec!["macro|jdoe1@example.org"]),
            ("jdoe org", vec!["macro|jdoe1@example.org"]),
            (
                "ann",
                vec!["macro|asmith@example.net", "macro|ann@example.net"],
            ),
            (
                "ohn",
                vec!["macro|zsmith@example.net", "macro|ajohnson@example.net"],
            ),
        ] {
            let result = parity(
                &mut engine,
                &request(&scope, query, PeopleMode::Recipient),
                EPOCH,
            )
            .await;
            assert_eq!(users(result), expected, "{query}");
        }

        // More address matches than one probe holds read in rank order.
        let result = parity(
            &mut engine,
            &request(&scope, "example.com", PeopleMode::Recipient),
            EPOCH,
        )
        .await;
        let people = users(result);
        assert_eq!(people.len(), 50);
        assert!(people.iter().all(|user| user.ends_with("@example.com")));
    });
}
#[test]
fn current_epoch_overrides_inboxes_and_dm_aliases_do_not_weaken_membership() {
    block_on(async {
        let (mut engine, scope) = seed(5000).await;
        let dm = Uuid::from_u128(9);
        let mut updates = vec![];
        for i in 0..10 {
            updates.push(PersonFactPatch {
                user_id: format!("macro|p{i:06}@example.com").try_into().unwrap(),
                facts: PersonFacts {
                    last_interaction_ms: Some(100 - i),
                    secondary_inbox: i == 3,
                    direct_message: (i < 2).then_some(cache_core::people::DirectMessageFacts {
                        id: dm,
                        name: "Shared DM".into(),
                        timestamp_ms: 200,
                    }),
                },
            });
        }
        updates.push(PersonFactPatch {
            user_id: "macro|stub@example.com".try_into().unwrap(),
            facts: PersonFacts {
                last_interaction_ms: Some(1000),
                ..Default::default()
            },
        });
        engine
            .update_people_context(&ContextUpdate {
                scope: scope.clone(),
                epoch: EPOCH,
                action: ContextAction::Patch { updates },
            })
            .await
            .unwrap();
        for mode in [
            PeopleMode::Command,
            PeopleMode::Recipient,
            PeopleMode::Property,
        ] {
            let mut req = request(&scope, "other", mode);
            req.limit = 1;
            for _ in 0..10 {
                let result = parity(&mut engine, &req, EPOCH).await;
                let PeopleSearchResult::Page {
                    people,
                    next_cursor,
                    ..
                } = result
                else {
                    panic!("page");
                };
                assert!(
                    !people
                        .iter()
                        .any(|p| p.user_id.as_ref() == "macro|stub@example.com")
                );
                if next_cursor.is_none() {
                    break;
                }
                req.cursor = next_cursor;
            }
        }
        let next = Uuid::from_u128(3);
        engine
            .update_people_context(&ContextUpdate {
                scope: scope.clone(),
                epoch: next,
                action: ContextAction::Begin {
                    previous_epoch: Some(EPOCH),
                },
            })
            .await
            .unwrap();
        assert!(matches!(
            engine
                .search_people(&request(&scope, "late", PeopleMode::Recipient))
                .await
                .unwrap(),
            PeopleSearchResult::ContextPending
        ));
        engine
            .update_people_context(&ContextUpdate {
                scope: scope.clone(),
                epoch: next,
                action: ContextAction::Commit,
            })
            .await
            .unwrap();
        parity(
            &mut engine,
            &request(&scope, "other", PeopleMode::Recipient),
            next,
        )
        .await;
        let mut foreign = request(&scope, "", PeopleMode::Recipient);
        foreign.scope.identity = "macro|foreign@example.com".into();
        assert!(engine.search_people(&foreign).await.is_err());
    });
}
#[test]
#[ignore = "100k indexed name-policy execution"]
fn indexed_name_search_100k() {
    block_on(async {
        let (mut engine, scope) = seed(100_000).await;
        for query in [
            "Other person",
            "other",
            "person other",
            "ther",
            "Late",
            "missing",
            "example.com",
            "p099999",
            "",
        ] {
            let request = request(&scope, query, PeopleMode::Recipient);
            let start = std::time::Instant::now();
            let result = engine.search_people(&request).await.unwrap();
            let elapsed = start.elapsed();
            let expected = reference(&engine, &request, EPOCH).await;
            assert_eq!(
                serde_json::to_value(&result).unwrap(),
                serde_json::to_value(expected).unwrap()
            );
            eprintln!("indexed names {query:?}: {elapsed:?}");
        }
    });
}

#[test]
fn name_candidates_use_covering_range_and_exact_record_seeks() {
    block_on(async {
        let (engine, scope) = seed(3).await;
        let request = request(&scope, "la per", PeopleMode::Recipient);
        let read = NameSearchRead::new(&request, EPOCH, engine.people_read_version()).unwrap();
        let seed = sql::seeds(&read, NameStage::WordPrefix).remove(0);
        let (sql, params) = sql::candidate(&read, Some(NameStage::WordPrefix), &seed, true);
        let rows = driver::query(
            &engine.storage().connection(),
            &format!("EXPLAIN QUERY PLAN {sql}"),
            params,
        )
        .unwrap();
        let plan = rows
            .iter()
            .map(|row| required_text(row, 3).unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            plan.contains("exact_facts_lookup_idx (attribute=? AND value>=? AND value<?)"),
            "{plan}"
        );
        assert!(
            plan.contains("records_contacts_cover_idx (__typename=? AND id=?)"),
            "{plan}"
        );
        assert!(!plan.contains("TEMP B-TREE"), "{plan}");
        let exact = super::test::request(&scope, "zed", PeopleMode::Mention);
        let read = NameSearchRead::new(&exact, EPOCH, engine.people_read_version()).unwrap();
        let seed = sql::seeds(&read, NameStage::ExactName).remove(0);
        let (sql, params) = sql::candidate(&read, Some(NameStage::ExactName), &seed, false);
        let rows = driver::query(
            &engine.storage().connection(),
            &format!("EXPLAIN QUERY PLAN {sql}"),
            params,
        )
        .unwrap();
        let plan = rows
            .iter()
            .map(|row| required_text(row, 3).unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            plan.contains("exact_facts_lookup_idx (attribute=? AND value>=? AND value<?)"),
            "{plan}"
        );
    });
}

#[test]
fn stale_projection_refuses_instead_of_reporting_empty_membership() {
    block_on(async {
        let (mut engine, scope) = seed(3).await;
        let connection = engine.storage().connection();
        driver::execute(
            &connection,
            "UPDATE meta SET value='obsolete' WHERE key=?",
            vec![text(people_sql::VERSION_KEY)],
        )
        .unwrap();
        assert!(
            engine
                .search_people(&request(&scope, "", PeopleMode::Recipient))
                .await
                .is_err()
        );
    });
}

#[test]
fn ordered_early_stop_releases_statement_and_still_checks_cleanup() {
    let storage = TursoStorage::open_in_memory("early-stop").unwrap();
    let c = storage.connection();
    let sql = "SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3";
    let mut count = 0;
    driver::query_until(&c, sql, vec![], |_| {
        count += 1;
        Ok(false)
    })
    .unwrap();
    assert_eq!(count, 1);
    assert_eq!(driver::query(&c, sql, vec![]).unwrap().len(), 3);
    driver::arm_reset_failure(sql);
    assert!(driver::query_until(&c, sql, vec![], |_| Ok(false)).is_err());
}
fn listed_record(user: &str, name: &str, lists: &[&str]) -> Record {
    let mut record = record(user, name);
    record.fields.insert(
        "lists".into(),
        CacheValue::List(
            lists
                .iter()
                .map(|list| CacheValue::String((*list).into()))
                .collect(),
        ),
    );
    record
}
#[test]
fn list_groups_match_complete_scan_with_small_groups_and_continuations() {
    block_on(async {
        let (engine, scope) = seed(5000).await;
        let mut storage = engine.into_storage();
        // Five teammates and a few hundred people in each other list among
        // 5000 contacts, so a group is far smaller than one rank budget.
        let lists = |i: usize| -> &'static [&'static str] {
            match i {
                0..5 => &["teammates"],
                5..300 => &["interacted"],
                300..900 => &["gmail"],
                900 => &["gmail", "teammates"],
                901 => &["custom:1"],
                902..910 => &["invited", "outlook"],
                4900.. => &["gmail"],
                _ => &[],
            }
        };
        storage
            .put_batch(
                (0..5000)
                    .filter(|i| !lists(*i).is_empty())
                    .map(|i| {
                        let user = format!("macro|p{i:06}@example.com");
                        let name = if i + 200 >= 5000 {
                            "Late person"
                        } else {
                            "Other person"
                        };
                        (key(&user), listed_record(&user, name, lists(i)))
                    })
                    .collect(),
            )
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        engine
            .update_people_context(&ContextUpdate {
                scope: scope.clone(),
                epoch: EPOCH,
                action: ContextAction::Patch {
                    updates: [2, 100, 101, 400, 905, 1000, 4950]
                        .into_iter()
                        .map(|i| PersonFactPatch {
                            user_id: format!("macro|p{i:06}@example.com").try_into().unwrap(),
                            facts: PersonFacts {
                                last_interaction_ms: Some(1000 + i64::from(i)),
                                ..Default::default()
                            },
                        })
                        .collect(),
                },
            })
            .await
            .unwrap();
        let mention = vec![
            vec!["teammates".to_owned()],
            vec!["interacted".to_owned(), "invited".to_owned()],
            vec!["gmail".to_owned(), "outlook".to_owned()],
        ];
        for (priority, only_listed) in [
            (mention.clone(), false),
            (mention.clone(), true),
            (vec![vec!["gmail".to_owned()]], false),
            (
                vec![vec!["teammates".to_owned(), "teammates".to_owned()]],
                true,
            ),
        ] {
            for query in ["", "other", "late", "person", "p000003", "missing"] {
                for mode in [
                    PeopleMode::Command,
                    PeopleMode::Recipient,
                    PeopleMode::Mention,
                    PeopleMode::Property,
                ] {
                    let mut request = request(&scope, query, mode);
                    request.list_priority = priority.clone();
                    request.only_listed = only_listed;
                    for _ in 0..3 {
                        let PeopleSearchResult::Page { next_cursor, .. } =
                            parity(&mut engine, &request, EPOCH).await
                        else {
                            panic!("page");
                        };
                        if next_cursor.is_none() {
                            break;
                        }
                        request.cursor = next_cursor;
                    }
                }
            }
        }

        // Empty browsing lists every teammate, most recent first, then the
        // next group; pages never repeat or skip anyone.
        let mut request = request(&scope, "", PeopleMode::Mention);
        request.list_priority = mention;
        request.limit = 500;
        let mut listed = vec![];
        loop {
            let PeopleSearchResult::Page {
                people,
                next_cursor,
                ..
            } = parity(&mut engine, &request, EPOCH).await
            else {
                panic!("page");
            };
            listed.extend(people.into_iter().map(|p| p.user_id.to_string()));
            let Some(cursor) = next_cursor else { break };
            request.cursor = Some(cursor);
        }
        assert_eq!(
            listed[..7],
            [
                "macro|p000002@example.com",
                "macro|p000000@example.com",
                "macro|p000001@example.com",
                "macro|p000003@example.com",
                "macro|p000004@example.com",
                "macro|p000900@example.com",
                "macro|p000905@example.com",
            ]
        );
        assert_eq!(listed.len(), 5001);
        assert_eq!(
            listed
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            5001
        );
    });
}
#[test]
fn teammates_match_complete_scan_across_early_stops_and_continuations() {
    block_on(async {
        let (mut engine, scope) = seed(5000).await;
        // Ten teammates spread through key order, most of them late: an ordered
        // scan that stopped early without reading them first would miss them.
        let roster = [3, 2500, 4700, 4750, 4805, 4890, 4950, 4990, 4995, 4999]
            .map(|i| format!("macro|p{i:06}@example.com"));
        engine
            .update_people_context(&ContextUpdate {
                scope: scope.clone(),
                epoch: EPOCH,
                action: ContextAction::Patch {
                    updates: [(10, 2000), (4995, 500), (4850, 300)]
                        .into_iter()
                        .map(|(i, time)| PersonFactPatch {
                            user_id: format!("macro|p{i:06}@example.com").try_into().unwrap(),
                            facts: PersonFacts {
                                last_interaction_ms: Some(time),
                                ..Default::default()
                            },
                        })
                        .collect(),
                },
            })
            .await
            .unwrap();
        let mention = vec![
            vec!["teammates".to_owned()],
            vec!["interacted".to_owned(), "invited".to_owned()],
        ];
        for list_priority in [vec![], mention] {
            for query in ["", "person", "other", "late", "ers", "p004999", "missing"] {
                for mode in [
                    PeopleMode::Command,
                    PeopleMode::Recipient,
                    PeopleMode::Mention,
                    PeopleMode::Property,
                ] {
                    let mut request = request(&scope, query, mode);
                    request.limit = 4;
                    request.list_priority = list_priority.clone();
                    request.teammates = roster
                        .iter()
                        .map(|id| id.clone().try_into().unwrap())
                        .collect();
                    for _ in 0..5 {
                        let PeopleSearchResult::Page { next_cursor, .. } =
                            parity(&mut engine, &request, EPOCH).await
                        else {
                            panic!("page");
                        };
                        if next_cursor.is_none() {
                            break;
                        }
                        request.cursor = next_cursor;
                    }
                }
            }
        }

        // The people the viewer messages, then the teammates, then everyone else.
        let mut request = request(&scope, "person", PeopleMode::Mention);
        request.limit = 4;
        request.teammates = roster
            .iter()
            .map(|id| id.clone().try_into().unwrap())
            .collect();
        let mut listed = vec![];
        while listed.len() < 14 {
            let PeopleSearchResult::Page {
                people,
                next_cursor,
                ..
            } = parity(&mut engine, &request, EPOCH).await
            else {
                panic!("page");
            };
            listed.extend(people.into_iter().map(|p| p.user_id.to_string()));
            request.cursor = next_cursor;
        }
        assert_eq!(
            listed[..14],
            [
                "macro|p000010@example.com",
                "macro|p004995@example.com",
                "macro|p004850@example.com",
                "macro|p000003@example.com",
                "macro|p002500@example.com",
                "macro|p004700@example.com",
                "macro|p004750@example.com",
                "macro|p004805@example.com",
                "macro|p004890@example.com",
                "macro|p004950@example.com",
                "macro|p004990@example.com",
                "macro|p004999@example.com",
                "macro|p000000@example.com",
                "macro|p000001@example.com",
            ]
        );
    });
}
