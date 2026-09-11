use super::*;
use cache_core::{
    engine::{BeginOptimisticWrite, NetworkWrite},
    queue::{MutationClaimRequest, MutationClaimToken},
    store::InMemoryStorage,
};
use serde_json::json;
use soup_filter_projection::{
    MailCacheProjectionFacts, SoupCacheProjectionSupplement, encode_cache_projection_supplement,
};

mod optimistic;

const VIEWER: &str = "macro|mail@example.com";
const QUERY: &str = r#"query MailSeed { user { id emailLinks { id } soup(input: {initial:{limit:100,emailView:ALL}}) { items { __typename id cacheProjection ... on GraphqlSoupEmailThread { linkId ownerId inboxVisible isRead isSignal latestInboundMessageTs mailAllPreview { id } mailDraftPreview { id } mailSentPreview { id } updatedAt } } } } }"#;
const PARTIAL: &str = r#"query Partial { user { id soup(input:{initial:{limit:1}}) { items { __typename id ... on GraphqlSoupEmailThread { isRead inboxVisible } } } } }"#;
fn id(n: u128) -> String {
    uuid::Uuid::from_u128(n).to_string()
}
fn filters() -> Value {
    let nil = id(0);
    json!({"documentFilter":{"literal":{"id":nil}},"projectFilter":{"literal":{"projectIdSelf":nil}},"chatFilter":{"literal":{"chatId":nil}},"calendarEventFilter":{"literal":{"id":nil}},"channelFilter":{"literal":{"channelId":nil}},"channelThreadFilter":{"literal":{"threadId":nil}},"callFilter":{"literal":{"callId":nil}},"crmCompanyFilter":{"literal":{"id":nil}},"foreignEntityFilter":{"literal":{"id":nil}}})
}
fn micros(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .unwrap()
        .timestamp_micros()
}
fn capsule(n: u128, has_thread_share: bool) -> String {
    encode_cache_projection_supplement(&SoupCacheProjectionSupplement::mail(
        RecordKey::new(format!("{TYPE}:{}", id(n))).unwrap(),
        MailCacheProjectionFacts::new(
            Some(micros("2025-01-03T00:00:00.000003Z")),
            (n.is_multiple_of(4) && n != 4).then(|| micros("2025-01-01T00:00:00Z")),
            n.is_multiple_of(5),
            has_thread_share,
        ),
    ))
    .unwrap()
}
fn default_capsule(n: u128) -> String {
    capsule(n, n == 1 || n == 60 || (71..=74).contains(&n))
}
fn row(n: u128) -> Value {
    let mut row = json!({"__typename":"GraphqlSoupEmailThread","id":id(n),"linkId":id(if n<=50 {1000}else if n<=70 {1001}else {9999}),"inboxVisible":n.is_multiple_of(2),"isRead":false,"isSignal":n.is_multiple_of(3),"cacheProjection":default_capsule(n),"latestInboundMessageTs":if n != 2 { Some("2025-01-02T00:00:00.000002Z") } else { None },"updatedAt":"2025-01-04T00:00:00.000004Z"});
    row["ownerId"] = json!(if n <= 50 {
        VIEWER
    } else {
        "macro|other@example.com"
    });
    row["mailAllPreview"] = if n != 7 {
        json!({"id":id(n+10000)})
    } else {
        Value::Null
    };
    row["mailDraftPreview"] = if n.is_multiple_of(3) && n != 7 {
        json!({"id":id(n+20000)})
    } else {
        Value::Null
    };
    row["mailSentPreview"] = if n.is_multiple_of(4) && n != 7 {
        json!({"id":id(n+30000)})
    } else {
        Value::Null
    };
    row
}
fn seed() -> Value {
    json!({"user":{"id":VIEWER,"emailLinks":[{"id":id(1000)},{"id":id(1001)}],"soup":{"items":(1..=75).map(row).collect::<Vec<_>>()}}})
}
async fn write<S: Storage>(engine: &mut Engine<S>, query: &str, data: &Value) {
    let vars = Map::new();
    let projections = projection_updates(engine.storage(), query, None, &vars, data)
        .await
        .unwrap();
    engine
        .write_query_with_registration_and_projections(
            None,
            None,
            NetworkWrite {
                query,
                operation_name: None,
                variables: &vars,
                data,
                identity: Some(VIEWER),
            },
            projections,
        )
        .await
        .unwrap();
}
async fn read<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    filters: Value,
    view: &str,
    cursor: Option<String>,
) -> PageResult {
    page(
        engine,
        "generation",
        filters,
        "UPDATED_AT",
        "DESC",
        10,
        PageRequest {
            view: view.into(),
            cursor,
        },
    )
    .await
    .unwrap()
}
async fn all_keys<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    f: Value,
    view: &str,
) -> Vec<String> {
    let mut keys = Vec::new();
    let mut cursor = None;
    loop {
        let PageResult::MailPage {
            keys: page_keys,
            next_cursor,
            sort_timestamps,
            ..
        } = read(engine, f.clone(), view, cursor).await
        else {
            panic!("supported tab")
        };
        if view == "SENT" {
            assert!(
                sort_timestamps
                    .iter()
                    .all(|ts| ts.starts_with("2025-01-01"))
            );
        }
        keys.extend(page_keys);
        cursor = next_cursor;
        if cursor.is_none() {
            return keys;
        }
    }
}

async fn lifecycle<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    assert!(matches!(
        read(&mut engine, filters(), "ALL", None).await,
        PageResult::Incomplete { .. }
    ));
    write(&mut engine, QUERY, &seed()).await;
    let mut cursor = None;
    let mut all = Vec::new();
    loop {
        let PageResult::MailPage {
            keys, next_cursor, ..
        } = read(&mut engine, filters(), "ALL", cursor).await
        else {
            panic!("cached page")
        };
        all.extend(keys);
        cursor = next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(
        all.len(),
        69,
        "two readable inboxes, no trash or unrelated shared inbox"
    );
    assert_eq!(
        all.iter().collect::<std::collections::HashSet<_>>().len(),
        69
    );
    assert!(
        all.windows(2).all(|w| w[0] > w[1]),
        "microsecond ties use stable normalized keys"
    );
    assert_eq!(
        all_keys(&mut engine, filters(), "DRAFTS").await.len(),
        23,
        "older drafts are independent of ALL preview"
    );
    assert_eq!(
        all_keys(&mut engine, filters(), "SENT").await.len(),
        16,
        "sent messages also require an outbound timestamp"
    );
    let mut calendar = filters();
    calendar["emailFilter"] = json!({"tree":{"literal":{"calendarOnly":true}}});
    assert_eq!(all_keys(&mut engine, calendar, "ALL").await.len(), 14);
    let mut shared = filters();
    shared["emailFilter"] = json!({"tree":{"literal":{"shared":"ONLY"}}});
    let shared_keys = all_keys(&mut engine, shared.clone(), "ALL").await;
    assert_eq!(shared_keys.len(), 5);
    assert!(
        !shared_keys.contains(&format!("{TYPE}:{}", id(1))),
        "own grant is excluded by Mail's owner policy"
    );
    assert!(
        !shared_keys.contains(&format!("{TYPE}:{}", id(61))),
        "delegation alone is not a share"
    );
    assert!(
        !shared_keys.contains(&format!("{TYPE}:{}", id(75))),
        "different owner alone is not a share"
    );
    let mut revoked = seed();
    revoked["user"]["soup"]["items"] = json!([row(72)]);
    revoked["user"]["soup"]["items"][0]["cacheProjection"] = json!(capsule(72, false));
    write(&mut engine, QUERY, &revoked).await;
    assert_eq!(
        all_keys(&mut engine, shared, "ALL").await.len(),
        4,
        "refreshed grant removal removes shared membership"
    );
    let mut draft_removed = seed();
    draft_removed["user"]["soup"]["items"] = json!([row(3)]);
    draft_removed["user"]["soup"]["items"][0]["mailDraftPreview"] = Value::Null;
    write(&mut engine, QUERY, &draft_removed).await;
    assert_eq!(all_keys(&mut engine, filters(), "DRAFTS").await.len(), 22);
    assert_eq!(
        all_keys(&mut engine, filters(), "ALL").await.len(),
        69,
        "removing a draft must not drop its thread from ALL"
    );
    let mut archived = filters();
    archived["emailFilter"] = json!({"tree":{"literal":{"inboxVisible":false}}});
    let PageResult::MailPage { keys, .. } = read(&mut engine, archived, "ALL", None).await else {
        panic!()
    };
    assert!(keys.iter().all(|key| {
        let n = uuid::Uuid::parse_str(key.split_once(':').unwrap().1)
            .unwrap()
            .as_u128();
        n % 2 == 1
    }));
    let PageResult::MailPage {
        keys,
        next_cursor: Some(cursor),
        ..
    } = read(&mut engine, filters(), "INBOX", None).await
    else {
        panic!()
    };
    assert!(keys.iter().all(|key| {
        let n = uuid::Uuid::parse_str(key.split_once(':').unwrap().1)
            .unwrap()
            .as_u128();
        n.is_multiple_of(2) && n != 2
    }));
    assert!(matches!(
        read(&mut engine, filters(), "ALL", Some(cursor.clone())).await,
        PageResult::StaleCursor { .. }
    ));
    assert!(matches!(
        page(
            &mut engine,
            "other-generation",
            filters(),
            "UPDATED_AT",
            "DESC",
            10,
            PageRequest {
                view: "INBOX".into(),
                cursor: Some(cursor.clone())
            }
        )
        .await
        .unwrap(),
        PageResult::StaleCursor { .. }
    ));
    for view in ["STARRED", "IMPORTANT"] {
        assert!(matches!(
            read(&mut engine, filters(), view, None).await,
            PageResult::Unsupported
        ));
    }
    for literal in [
        json!({"sender":{"partial":"a"}}),
        json!({"recipient":{"partial":"a"}}),
        json!({"notificationState":"DONE"}),
    ] {
        let mut f = filters();
        f["emailFilter"] = json!({"tree":{"literal":literal}});
        assert!(matches!(
            read(&mut engine, f, "ALL", None).await,
            PageResult::Unsupported
        ));
    }
    let data = json!({"user":{"id":VIEWER,"soup":{"items":[{"__typename":"GraphqlSoupEmailThread","id":id(1),"isRead":true}]}}});
    let vars = Map::new();
    let mutations = optimistic_updates(
        projection_updates(engine.storage(), PARTIAL, None, &vars, &data)
            .await
            .unwrap(),
    );
    let [OptimisticProjectionMutation::Patch { exact, .. }] = mutations.as_slice() else {
        panic!()
    };
    assert_eq!(
        exact.len(),
        1,
        "partial edits must not overwrite other fields' optimism"
    );
    let transaction = engine
        .begin_optimistic_write_with_projections(
            None,
            BeginOptimisticWrite {
                uuid: "00000000-0000-0000-0000-000000002000",
                query: PARTIAL,
                operation_name: None,
                variables: &vars,
                data: &data,
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 1,
            },
            mutations,
        )
        .await
        .unwrap()
        .0;
    assert!(matches!(
        read(&mut engine, filters(), "INBOX", Some(cursor)).await,
        PageResult::StaleCursor { .. }
    ));
    let mut f = filters();
    f["emailFilter"] = json!({"tree":{"literal":{"read":true}}});
    let PageResult::MailPage { keys, .. } = read(&mut engine, f.clone(), "ALL", None).await else {
        panic!()
    };
    assert_eq!(keys, vec![format!("{TYPE}:{}", id(1))]);
    let claim = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "test".into(),
            now_ms: 1,
            lease_expires_at_ms: 100,
        })
        .await
        .unwrap()
        .unwrap();
    engine
        .rollback_optimistic_write(
            transaction,
            MutationClaimToken {
                owner: "test".into(),
                generation: claim.lease_generation,
            },
        )
        .await
        .unwrap();
    let PageResult::MailPage { keys, .. } = read(&mut engine, f, "ALL", None).await else {
        panic!()
    };
    assert!(keys.is_empty());
    let mut engine = Engine::new(engine.into_storage());
    let PageResult::MailPage { keys, .. } = read(&mut engine, filters(), "ALL", None).await else {
        panic!()
    };
    assert_eq!(
        keys.len(),
        10,
        "offline restart needs neither query baseline nor message bodies"
    );
}
#[test]
fn memory_offline_mail() {
    pollster::block_on(lifecycle(InMemoryStorage::new()))
}
#[test]
fn turso_offline_mail() {
    pollster::block_on(lifecycle(
        cache_turso::TursoStorage::open_in_memory("mail-page-test").unwrap(),
    ))
}

#[test]
fn identity_switch_does_not_read_old_mail_bases_but_keeps_incoming_snapshots() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write(&mut engine, QUERY, &seed()).await;
        let vars = Map::new();
        let mut partial = json!({"user":{"id":"new-viewer","soup":{"items":[{"__typename":"GraphqlSoupEmailThread","id":id(1),"isRead":true}]}}});
        let reads = engine.storage().record_get_count();
        let projections =
            projection_updates_for_write(engine.storage(), PARTIAL, None, &vars, &partial, false)
                .await
                .unwrap();
        assert_eq!(
            engine.storage().record_get_count(),
            reads,
            "identity-changing preparation must not read old records"
        );
        assert!(
            matches!(
                projections.as_slice(),
                [ProjectionMutation::MarkIncomplete { .. }]
            ),
            "partial rows must not borrow the previous viewer's complete metadata"
        );

        // Same-identity incremental writes still resolve against the existing base.
        partial["user"]["id"] = json!(VIEWER);
        let projections =
            projection_updates_for_write(engine.storage(), PARTIAL, None, &vars, &partial, true)
                .await
                .unwrap();
        assert!(matches!(
            projections.as_slice(),
            [ProjectionMutation::Patch { .. }]
        ));

        let mut incoming = seed();
        incoming["user"]["id"] = json!("new-viewer");
        incoming["user"]["soup"]["items"]
            .as_array_mut()
            .unwrap()
            .truncate(1);
        incoming["user"]["soup"]["items"][0]["isRead"] = json!(true);
        let reads = engine.storage().record_get_count();
        let projections =
            projection_updates_for_write(engine.storage(), QUERY, None, &vars, &incoming, false)
                .await
                .unwrap();
        assert_eq!(engine.storage().record_get_count(), reads);
        assert!(
            matches!(projections.as_slice(), [ProjectionMutation::Replace(_)]),
            "the first new-viewer snapshot must establish Mail coverage immediately"
        );
        let result = engine
            .write_query_with_registration_and_projections(
                None,
                None,
                NetworkWrite {
                    query: QUERY,
                    operation_name: None,
                    variables: &vars,
                    data: &incoming,
                    identity: Some("new-viewer"),
                },
                projections,
            )
            .await
            .unwrap();
        assert!(result.reset, "the engine still owns the identity reset");
        let PageResult::MailPage { keys, .. } = read(&mut engine, filters(), "ALL", None).await
        else {
            panic!("new-viewer snapshot is queryable")
        };
        assert_eq!(keys, vec![format!("{TYPE}:{}", id(1))]);
    });
}

#[test]
fn oversized_normalized_keys_are_skipped_without_losing_valid_rows() {
    pollster::block_on(async {
        let mut invalid = row(1);
        invalid["id"] = json!("x".repeat(predicate_index::MAX_EXACT_VALUE_BYTES + 1));
        let data = json!({"user":{"id":VIEWER,"soup":{"items":[invalid, row(4)]}}});
        let updates = projection_updates(&InMemoryStorage::new(), QUERY, None, &Map::new(), &data)
            .await
            .unwrap();
        let [ProjectionMutation::Replace(document)] = updates.as_slice() else {
            panic!("only the valid row should be projected")
        };
        assert_eq!(document.record_key.as_str(), format!("{TYPE}:{}", id(4)));
    });
}

#[test]
fn page_limit_bounds_match_the_index_limit() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write(&mut engine, QUERY, &seed()).await;
        for limit in [
            0,
            1,
            predicate_index::MAX_QUERY_LIMIT - 1,
            predicate_index::MAX_QUERY_LIMIT,
        ] {
            let result = page(
                &mut engine,
                "generation",
                filters(),
                "UPDATED_AT",
                "DESC",
                limit,
                PageRequest {
                    view: "ALL".into(),
                    cursor: None,
                },
            )
            .await;
            if limit == 0 || limit == predicate_index::MAX_QUERY_LIMIT {
                let Err(PageError::Adapter(error)) = result else {
                    panic!("invalid limits should be request errors")
                };
                assert_eq!(
                    error.to_string(),
                    format!(
                        "Mail page limit must be 1..{}",
                        predicate_index::MAX_QUERY_LIMIT - 1
                    )
                );
            } else {
                assert!(matches!(result, Ok(PageResult::MailPage { .. })));
            }
        }
    });
}

async fn cleared_inbox_timestamp<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    let mut data = seed();
    data["user"]["soup"]["items"] = json!([row(4)]);
    write(&mut engine, QUERY, &data).await;
    let key = RecordKey::new(format!("{TYPE}:{}", id(4))).unwrap();
    let PageResult::MailPage { keys, .. } = read(&mut engine, filters(), "INBOX", None).await
    else {
        panic!("initial inbox page")
    };
    assert_eq!(keys, [key.as_str()]);

    let partial = json!({"user":{"id":VIEWER,"soup":{"items":[{
        "__typename":TYPE,"id":id(4),"cacheProjection":capsule(4, false),
        "latestInboundMessageTs":null
    }]}}});
    let updates = projection_updates(engine.storage(), QUERY, None, &Map::new(), &partial)
        .await
        .unwrap();
    assert!(matches!(
        updates.as_slice(),
        [ProjectionMutation::MarkIncomplete { .. }]
    ));
    assert!(matches!(
        optimistic_updates(updates).as_slice(),
        [OptimisticProjectionMutation::Unknown { .. }]
    ));
    write(&mut engine, QUERY, &partial).await;
    assert!(
        matches!(
            engine
                .storage()
                .load_projection_states(std::slice::from_ref(&key))
                .await
                .unwrap()
                .as_slice(),
            [Some(ProjectionState::Incomplete { .. })]
        ),
        "cleared sort facts must not remain available to cursors or reference hits"
    );
    for view in ["ALL", "INBOX"] {
        let PageResult::MailPage {
            keys, next_cursor, ..
        } = read(&mut engine, filters(), view, None).await
        else {
            panic!("cached page")
        };
        assert!(keys.is_empty());
        assert!(next_cursor.is_none());
    }

    // A canonical full snapshot restores ALL coverage without resurrecting the
    // old inbox sort timestamp, even across a cache restart.
    data["user"]["soup"]["items"][0]["latestInboundMessageTs"] = Value::Null;
    write(&mut engine, QUERY, &data).await;
    let mut engine = Engine::new(engine.into_storage());
    let states = engine
        .storage()
        .load_projection_states(std::slice::from_ref(&key))
        .await
        .unwrap();
    let [Some(ProjectionState::Complete(document))] = states.as_slice() else {
        panic!("full snapshot restores coverage")
    };
    assert!(
        !document
            .sort_facts
            .iter()
            .any(|fact| fact.attribute == vocabulary::token("mail-inbox-ts"))
    );
    for view in ["ALL", "INBOX"] {
        let PageResult::MailPage { keys, .. } = read(&mut engine, filters(), view, None).await
        else {
            panic!("cached page")
        };
        assert_eq!(keys.len(), usize::from(view == "ALL"));
    }
}

#[test]
fn memory_cleared_inbox_timestamp_suppresses_stale_sort_facts() {
    pollster::block_on(cleared_inbox_timestamp(InMemoryStorage::new()));
}

#[test]
fn turso_cleared_inbox_timestamp_suppresses_stale_sort_facts() {
    pollster::block_on(cleared_inbox_timestamp(
        cache_turso::TursoStorage::open_in_memory("mail-cleared-timestamp-test").unwrap(),
    ));
}

#[test]
fn invalid_capsules_invalidate_existing_mail_projections() {
    pollster::block_on(async {
        for invalid in [
            Value::Null,
            json!("not a capsule"),
            json!(default_capsule(2)),
            json!(
                encode_cache_projection_supplement(&SoupCacheProjectionSupplement::document(
                    RecordKey::new(format!("GraphqlSoupDocument:{}", id(1))).unwrap(),
                    false,
                    false,
                    vec![],
                ),)
                .unwrap()
            ),
        ] {
            let mut engine = Engine::new(InMemoryStorage::new());
            let mut data = seed();
            data["user"]["soup"]["items"] = json!([row(1)]);
            write(&mut engine, QUERY, &data).await;
            data["user"]["soup"]["items"][0]["cacheProjection"] = invalid;
            write(&mut engine, QUERY, &data).await;
            let key = RecordKey::new(format!("{TYPE}:{}", id(1))).unwrap();
            assert!(matches!(
                engine
                    .storage()
                    .load_projection_states(&[key])
                    .await
                    .unwrap()[0],
                Some(ProjectionState::Incomplete { .. })
            ));
        }
    });
}

#[test]
fn missing_proof_is_not_a_false_fact() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let mut data = seed();
        data["user"]["soup"]["items"][0]
            .as_object_mut()
            .unwrap()
            .remove("cacheProjection");
        write(&mut engine, QUERY, &data).await;
        let key = RecordKey::new(format!("{TYPE}:{}", id(1))).unwrap();
        assert!(matches!(
            engine
                .storage()
                .load_projection_states(&[key])
                .await
                .unwrap()[0],
            Some(ProjectionState::Incomplete { .. })
        ));
    })
}
