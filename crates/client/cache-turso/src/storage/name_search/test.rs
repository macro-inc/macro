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
    let indexed = engine.search_people_named(request).await.unwrap();
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
            "la per",
            "per la",
            "ate",
            "missing",
            "p004999@",
            "p004999@example.com",
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
        let mut engine = Engine::new(storage);
        for query in ["zzover", "late\0", "%", "_"] {
            parity(
                &mut engine,
                &request(&scope, query, PeopleMode::Recipient),
                EPOCH,
            )
            .await;
        }
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
                .search_people_named(&request(&scope, "late", PeopleMode::Recipient))
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
        assert!(engine.search_people_named(&foreign).await.is_err());
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
            "",
        ] {
            let request = request(&scope, query, PeopleMode::Recipient);
            let start = std::time::Instant::now();
            let result = engine.search_people_named(&request).await.unwrap();
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
                .search_people_named(&request(&scope, "", PeopleMode::Recipient))
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
