use super::*;
use cache_core::{
    engine::{BeginOptimisticWrite, NetworkWrite},
    queue::{MutationClaimRequest, MutationClaimToken},
    store::InMemoryStorage,
};
use serde_json::json;

const VIEWER: &str = "macro|mail@example.com";
const QUERY: &str = r#"query MailSeed { user { id emailLinks { id } soup(input: {initial:{limit:100,emailView:ALL}}) { items { __typename id ... on GraphqlSoupEmailThread { linkId inboxVisible isRead isSignal hasNonTrashedMessages latestInboundMessageTs latestNonSpamMessageTs updatedAt } } } } }"#;
const PARTIAL: &str = r#"query Partial { user { id soup(input:{initial:{limit:1}}) { items { __typename id ... on GraphqlSoupEmailThread { isRead inboxVisible } } } } }"#;
fn id(n: u128) -> String {
    uuid::Uuid::from_u128(n).to_string()
}
fn filters() -> Value {
    let nil = id(0);
    json!({"documentFilter":{"literal":{"id":nil}},"projectFilter":{"literal":{"projectIdSelf":nil}},"chatFilter":{"literal":{"chatId":nil}},"calendarEventFilter":{"literal":{"id":nil}},"channelFilter":{"literal":{"channelId":nil}},"channelThreadFilter":{"literal":{"threadId":nil}},"callFilter":{"literal":{"callId":nil}},"crmCompanyFilter":{"literal":{"id":nil}},"foreignEntityFilter":{"literal":{"id":nil}}})
}
fn row(n: u128) -> Value {
    json!({"__typename":"GraphqlSoupEmailThread","id":id(n),"linkId":id(if n<=50 {1000}else if n<=70 {1001}else {9999}),"inboxVisible":n.is_multiple_of(2),"isRead":false,"isSignal":n.is_multiple_of(3),"hasNonTrashedMessages":n!=7,"latestInboundMessageTs":if n==2 {Value::Null}else {json!("2025-01-02T00:00:00.000002Z")},"latestNonSpamMessageTs":"2025-01-03T00:00:00.000003Z","updatedAt":"2025-01-04T00:00:00.000004Z"})
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
    for view in ["DRAFTS", "SENT"] {
        assert!(matches!(
            read(&mut engine, filters(), view, None).await,
            PageResult::Unsupported
        ));
    }
    for literal in [
        json!({"sender":{"partial":"a"}}),
        json!({"shared":"ONLY"}),
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
fn missing_proof_is_not_a_false_fact() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let mut data = seed();
        data["user"]["soup"]["items"][0]
            .as_object_mut()
            .unwrap()
            .remove("hasNonTrashedMessages");
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
