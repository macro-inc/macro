use super::*;
use cache_core::{
    engine::{BeginOptimisticWrite, Engine, NetworkWrite},
    predicate::{PredicateIndexStorage, ProjectionState},
    queue::{MutationClaimRequest, MutationClaimToken},
    store::InMemoryStorage,
};
use serde_json::{Value, json};

const QUERY: &str = r#"query ChannelSeed { user { id soup(input: {initial: {}}) { items {
    __typename id cacheProjection notifications { id entityId entityType state }
    ... on GraphqlSoupChannel {
        ownerId channelType channelTeamId: teamId organizationId isParticipant createdAt updatedAt
    }
    ... on GraphqlSoupProject { ownerId parentId createdAt updatedAt }
} } } }"#;
const PATCH: &str = r#"query ChannelPatch { user { id soup(input: {initial: {}}) { items {
    __typename id ... on GraphqlSoupChannel { channelTeamId: teamId isParticipant updatedAt }
} } } }"#;
const NOTIFICATION: &str =
    r#"mutation Done { updateNotifications(input: {notificationIds: []}) { id state } }"#;
const IMPORT_PUSH: &str = r#"subscription SoupChannelListCacheWrite {
    soupUpdates { __typename ... on SoupUpdated { item {
        __typename id cacheProjection notifications { id entityId entityType state }
        ... on GraphqlSoupChannel {
            ownerId channelType channelTeamId: teamId organizationId isParticipant createdAt updatedAt
            unreadNotifications: notifications(filter: {states: [UNSEEN], topLevelMessagesOnly: true}, limit: 1) { id state createdAt }
            unreadMentions: notifications(filter: {states: [UNSEEN], eventTypes: ["channel_mention"]}, limit: 10) { id state }
        }
    } } }
}"#;

fn id(n: u128) -> String {
    uuid::Uuid::from_u128(n).to_string()
}
fn key(n: u128) -> RecordKey {
    RecordKey::new(format!("GraphqlSoupChannel:{}", id(n))).unwrap()
}
fn row(n: u128) -> Value {
    json!({"__typename":"GraphqlSoupChannel", "id":id(n), "cacheProjection":null,
        "ownerId":"macro|viewer@example.com", "channelType":"team", "channelTeamId":id(10),
        "organizationId":"20", "isParticipant":n != 3, "createdAt":"2025-01-01T00:00:00Z", "updatedAt":"2025-01-02T00:00:00.000001Z",
        "notifications":[{"id":id(n+100),"entityId":id(n),"entityType":"CHANNEL","state":"UNSEEN"}]
    })
}
fn data(rows: Vec<Value>) -> Value {
    json!({"user":{"id":"macro|viewer@example.com","soup":{"items":rows}}})
}
fn pushed_channels(rows: impl IntoIterator<Item = Value>) -> Value {
    let soup_updates: Vec<_> = rows
        .into_iter()
        .map(|item| json!({"__typename": "SoupUpdated", "item": item}))
        .collect();
    json!({"soupUpdates": soup_updates})
}
fn filters(channel: Value) -> Value {
    let nil = id(0);
    json!({"documentFilter":{"literal":{"id":nil}},"projectFilter":{"literal":{"projectIdSelf":nil}},"chatFilter":{"literal":{"chatId":nil}},"calendarEventFilter":{"literal":{"id":nil}},"emailFilter":{"tree":{"literal":{"threadId":nil}}},"channelThreadFilter":{"literal":{"threadId":nil}},"callFilter":{"literal":{"callId":nil}},"crmCompanyFilter":{"literal":{"id":nil}},"foreignEntityFilter":{"literal":{"id":nil}},"channelFilter":channel})
}
async fn write<S: PredicateIndexStorage>(engine: &mut Engine<S>, query: &str, data: &Value) {
    let projections = authoritative_projection_mutations(
        cache_core::meta::bundled_schema_ref(),
        query,
        None,
        data,
    )
    .unwrap();
    engine
        .write_query_with_registration_and_projections(
            None,
            None,
            NetworkWrite {
                query,
                operation_name: None,
                variables: &Default::default(),
                data,
                identity: Some("macro|viewer@example.com"),
            },
            projections,
        )
        .await
        .unwrap();
}
async fn keys<S: PredicateIndexStorage>(engine: &mut Engine<S>, filter: Value) -> Vec<RecordKey> {
    let SoupFilterCompileOutcome::Supported(query) =
        compile_filter_request(filters(filter), "UPDATED_AT", "DESC", 20).unwrap()
    else {
        panic!("supported")
    };
    engine
        .reconcile_predicate_index(&query, &[])
        .await
        .unwrap()
        .value
        .keys
}

#[test]
fn canonical_channel_fields_and_aliased_team_id_form_v4_snapshots() {
    let projections = authoritative_projection_mutations(
        cache_core::meta::bundled_schema_ref(),
        QUERY,
        None,
        &data(vec![row(1)]),
    )
    .unwrap();
    let [ProjectionMutation::Replace(document)] = projections.as_slice() else {
        panic!("complete channel")
    };
    soup_filter_projection::validate_soup_flat_v4(document).unwrap();
    assert_eq!(document.partition, vocabulary::channel_partition());
    assert!(
        document
            .exact_facts
            .iter()
            .any(|fact| fact.attribute == vocabulary::channel_team()
                && fact.value.as_bytes() == uuid::Uuid::from_u128(10).as_bytes())
    );
    assert!(
        document
            .exact_facts
            .iter()
            .any(|fact| fact.attribute == vocabulary::notification_unseen())
    );
    let mut malformed = document.clone();
    malformed
        .exact_facts
        .retain(|fact| fact.attribute != vocabulary::channel_participant());
    assert!(soup_filter_projection::validate_soup_flat_v4(&malformed).is_err());
    assert!(soup_filter_projection::validate_soup_flat_v3(document).is_err());
}

#[test]
fn channel_push_preserves_full_state_with_bounded_display_edges() {
    let query = QUERY.replace(
        "ownerId channelType",
        "unreadNotifications: notifications(filter: {states: [UNSEEN], topLevelMessagesOnly: true}, limit: 1) { id state }
         unreadMentions: notifications(filter: {states: [UNSEEN], eventTypes: [\"channel_mention\"]}, limit: 10) { id state }
         ownerId channelType",
    );
    let mut channel = row(1);
    channel["unreadNotifications"] = json!([]);
    channel["unreadMentions"] = json!([]);
    let projections = authoritative_projection_mutations(
        cache_core::meta::bundled_schema_ref(),
        &query,
        None,
        &data(vec![channel.clone()]),
    )
    .unwrap();
    let [ProjectionMutation::Replace(document)] = projections.as_slice() else {
        panic!("push must keep a complete active snapshot");
    };
    assert!(document.exact_facts.iter().any(|fact| {
        fact.attribute == vocabulary::notification_unseen()
            && fact.value.as_bytes() == uuid::Uuid::from_u128(101).as_bytes()
    }));

    let preview = query.replace(
        "cacheProjection notifications { id entityId entityType state }",
        "",
    );
    channel.as_object_mut().unwrap().remove("notifications");
    let projections = authoritative_projection_mutations(
        cache_core::meta::bundled_schema_ref(),
        &preview,
        None,
        &data(vec![channel]),
    )
    .unwrap();
    assert!(matches!(
        projections.as_slice(),
        [ProjectionMutation::Patch { exact, .. }]
            if !exact.iter().any(|patch| patch.attribute == vocabulary::notification_unseen())
    ));
}

#[test]
fn imported_channel_push_populates_a_bounded_live_list() {
    use cache_core::engine::live_query::LiveQuerySpec;
    use cache_core::record_selection::RecordSelection;
    use cache_core::value::EntityKey;
    use cache_turso::TursoFileDatabase;
    use std::sync::Arc;
    use std::time::Instant;

    let query = QUERY.replace(
        "ownerId channelType",
        "unreadNotifications: notifications(filter: {states: [UNSEEN], topLevelMessagesOnly: true}, limit: 1) { id state }
         unreadMentions: notifications(filter: {states: [UNSEEN], eventTypes: [\"channel_mention\"]}, limit: 10) { id state }
         ownerId channelType",
    );
    let selection = RecordSelection::parse(
        cache_core::meta::bundled_schema_ref(),
        r#"fragment ChannelList on GraphqlSoupChannel {
            id isParticipant updatedAt
            unreadNotifications: notifications(filter: {states: [UNSEEN], topLevelMessagesOnly: true}, limit: 1) { id state }
            unreadMentions: notifications(filter: {states: [UNSEEN], eventTypes: ["channel_mention"]}, limit: 10) { id state }
        }"#,
        "ChannelList",
    )
    .unwrap();
    let SoupFilterCompileOutcome::Supported(filter) = compile_filter_request(
        filters(json!({"literal": {"isParticipant": true}})),
        "UPDATED_AT",
        "DESC",
        20,
    )
    .unwrap() else {
        panic!("supported channel list");
    };
    let spec = LiveQuerySpec {
        query: filter,
        baseline: vec![],
        selection: Arc::new(selection.clone()),
    };
    pollster::block_on(async {
        for channel_count in [3500, 7000] {
            let directory = tempfile::tempdir().unwrap();
            let db = TursoFileDatabase::new(directory.path().join("channels.turso")).unwrap();
            let mut engine = Engine::new(db.open("archive").unwrap());
            for first in (100..100 + channel_count).step_by(500) {
                let rows = (first..(first + 500).min(100 + channel_count))
                    .map(|number| {
                        let mut channel = row(number);
                        channel["unreadNotifications"] = json!([]);
                        channel["unreadMentions"] = json!([]);
                        channel
                    })
                    .collect();
                write(&mut engine, &query, &data(rows)).await;
            }
            engine.into_storage().try_close().unwrap();
            let open_started = Instant::now();
            let storage = db.open("archive").unwrap();
            let open = open_started.elapsed();
            assert_eq!(storage.upgraded_from_storage_version(), None);
            let mut engine = Engine::new(storage);
            let initial = engine
                .read_live_query("archive", spec.clone(), None)
                .await
                .unwrap();
            assert_eq!(initial.upserts.len(), 20);
            let first_import = 10_000;
            let end = first_import + channel_count;
            let push_started = Instant::now();
            let imported = |number| {
                let mut channel = row(number);
                channel["updatedAt"] = if number == first_import {
                    json!("2025-01-04T00:00:00Z")
                } else {
                    json!("2025-01-03T00:00:00Z")
                };
                channel["notifications"] = json!([]);
                channel["unreadNotifications"] = json!([]);
                channel["unreadMentions"] = json!([]);
                channel
            };
            write(
                &mut engine,
                IMPORT_PUSH,
                &pushed_channels([imported(first_import)]),
            )
            .await;
            let updated = engine
                .resume_live_query(
                    "archive",
                    initial.registration_id,
                    Some(initial.revision.parse().unwrap()),
                )
                .await
                .unwrap()
                .unwrap();
            assert_eq!(updated.keys.unwrap()[0], key(first_import));
            assert_eq!(updated.upserts.len(), 1);
            assert_eq!(updated.removed.len(), 1);
            assert_eq!(updated.upserts[0].record["id"], id(first_import));
            assert_eq!(updated.upserts[0].record["unreadMentions"], json!([]));

            for first in (first_import + 1..end).step_by(10) {
                let rows = (first..(first + 10).min(end)).map(imported);
                write(&mut engine, IMPORT_PUSH, &pushed_channels(rows)).await;
            }
            let push_elapsed = push_started.elapsed();
            let final_list = engine
                .read_live_query("archive", spec.clone(), None)
                .await
                .unwrap();
            let keys = final_list.keys.unwrap();
            assert_eq!(keys.len(), 20);
            assert_eq!(keys[0], key(first_import));
            assert!(keys.iter().all(|key| {
                let (_, channel_id) = key.as_str().split_once(':').unwrap();
                let number = uuid::Uuid::parse_str(channel_id).unwrap().as_u128();
                (first_import..end).contains(&number)
            }));
            for first in (first_import..end).step_by(100) {
                let keys = (first..(first + 100).min(end))
                    .map(|number| EntityKey::entity("GraphqlSoupChannel", &[&id(number)]))
                    .collect::<Vec<_>>();
                let read = engine
                    .read_records_by_keys(&selection, &keys)
                    .await
                    .unwrap();
                assert_eq!(read.value.len(), keys.len());
            }
            println!(
                "{channel_count} imported channels, 20 displayed, first push one upsert and one removal, reopened {channel_count} existing channels in {open:?}, applied pushes in {push_elapsed:?}"
            );
        }
    });
}

#[test]
fn channel_aliases_preserve_identity_and_reject_conflicting_nullable_facts() {
    let query = QUERY.replace(
        "__typename id cacheProjection",
        "__typename identity: id capsule: cacheProjection",
    );
    let mut aliased = row(1);
    aliased["identity"] = aliased["id"].take();
    aliased.as_object_mut().unwrap().remove("id");
    aliased["capsule"] = aliased["cacheProjection"].take();
    aliased.as_object_mut().unwrap().remove("cacheProjection");
    assert!(
        matches!(authoritative_projection_mutations(cache_core::meta::bundled_schema_ref(), &query, None, &data(vec![aliased])).unwrap().as_slice(), [ProjectionMutation::Replace(document)] if document.record_key == key(1))
    );

    let duplicate = QUERY.replace(
        "channelTeamId: teamId",
        "channelTeamId: teamId otherTeam: teamId",
    );
    let mut conflict = row(1);
    conflict["otherTeam"] = json!(id(11));
    assert!(matches!(
        authoritative_projection_mutations(
            cache_core::meta::bundled_schema_ref(),
            &duplicate,
            None,
            &data(vec![conflict])
        )
        .unwrap()
        .as_slice(),
        [ProjectionMutation::MarkIncomplete { .. }]
    ));
}

#[test]
fn organization_ids_preserve_the_signed_64_bit_projection_domain() {
    for organization_id in [
        i64::MIN,
        -1,
        0,
        i64::from(u32::MAX),
        i64::from(u32::MAX) + 1,
        i64::MAX,
    ] {
        let value = json!(organization_id.to_string());
        assert_eq!(organization(&value), Ok(Some(organization_id)));
        let mut channel = row(1);
        channel["organizationId"] = value.clone();
        let updates = authoritative_projection_mutations(
            cache_core::meta::bundled_schema_ref(),
            QUERY,
            None,
            &data(vec![channel]),
        )
        .unwrap();
        let [ProjectionMutation::Replace(document)] = updates.as_slice() else {
            panic!("complete i64 organization snapshot: {organization_id}")
        };
        let SoupFilterCompileOutcome::Supported(query) = compile_filter_request(
            filters(json!({"literal":{"organizationId":organization_id}})),
            "UPDATED_AT",
            "DESC",
            20,
        )
        .unwrap() else {
            panic!("organization filter")
        };
        let predicate = &query
            .as_query()
            .partitions
            .iter()
            .find(|part| part.partition == vocabulary::channel_partition())
            .unwrap()
            .predicate;
        assert!(document.matches(predicate));
        let update = patch(
            key(1),
            json!({"organizationId":value}).as_object().unwrap(),
            None,
        )
        .unwrap();
        let OptimisticProjectionMutation::Patch { exact, .. } = update else {
            panic!("organization patch")
        };
        assert_eq!(exact.len(), 1);
        assert_eq!(exact[0].attribute, vocabulary::channel_organization());
        assert_eq!(exact[0].values[0].as_bytes(), organization_id.to_be_bytes());
    }
    assert_eq!(organization(&Value::Null), Ok(None));
    for invalid in [
        json!("9223372036854775808"),
        json!("-9223372036854775809"),
        json!("invalid"),
        json!(1),
        json!("1.5"),
    ] {
        assert!(organization(&invalid).is_err());
    }
}

#[test]
fn partial_and_invalid_channel_snapshots_do_not_invent_completeness() {
    for field in [
        "notifications",
        "channelType",
        "isParticipant",
        "channelTeamId",
        "organizationId",
        "ownerId",
        "updatedAt",
    ] {
        let mut incomplete = row(1);
        incomplete.as_object_mut().unwrap().remove(field);
        assert!(
            matches!(
                authoritative_projection_mutations(
                    cache_core::meta::bundled_schema_ref(),
                    QUERY,
                    None,
                    &data(vec![incomplete])
                )
                .unwrap()
                .as_slice(),
                [ProjectionMutation::MarkIncomplete { .. }]
            ),
            "{field}"
        );
    }
    for (field, invalid) in [
        ("channelType", json!("unknown")),
        ("isParticipant", Value::Null),
        ("organizationId", json!("invalid")),
        ("cacheProjection", json!("unexpected")),
    ] {
        let mut malformed = row(1);
        malformed[field] = invalid;
        assert!(matches!(
            authoritative_projection_mutations(
                cache_core::meta::bundled_schema_ref(),
                QUERY,
                None,
                &data(vec![malformed])
            )
            .unwrap()
            .as_slice(),
            [ProjectionMutation::MarkIncomplete { .. }]
        ));
    }
    let mut nullable = row(1);
    nullable["channelTeamId"] = Value::Null;
    nullable["organizationId"] = Value::Null;
    assert!(matches!(
        authoritative_projection_mutations(
            cache_core::meta::bundled_schema_ref(),
            QUERY,
            None,
            &data(vec![nullable])
        )
        .unwrap()
        .as_slice(),
        [ProjectionMutation::Replace(_)]
    ));
}

#[test]
fn full_channel_optimism_does_not_create_authoritative_access() {
    use cache_core::predicate::{ProjectionMutationLayer, compose_effective_optimistic_projection};
    let mutations = optimistic_projection_mutations(&data(vec![row(1)]), 1);
    assert!(matches!(
        mutations.as_slice(),
        [OptimisticProjectionMutation::Patch { .. }]
    ));
    let shadow = compose_effective_optimistic_projection(
        &key(1),
        None,
        &[ProjectionMutationLayer {
            owner: 1,
            mutations: &mutations,
        }],
    )
    .unwrap()
    .unwrap();
    assert!(matches!(
        shadow.state,
        predicate_index::OptimisticProjectionState::Incomplete { .. }
    ));
}

async fn lifecycle<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    let project = json!({"__typename":"GraphqlSoupProject","id":id(7),"cacheProjection":null,
        "ownerId":"macro|viewer@example.com","parentId":null,"createdAt":"2025-01-01T00:00:00Z","updatedAt":"2025-01-02T00:00:00.000001Z",
        "notifications":[{"id":id(107),"entityId":id(7),"entityType":"PROJECT","state":"UNSEEN"}]
    });
    write(
        &mut engine,
        QUERY,
        &data(vec![row(1), row(2), row(3), project]),
    )
    .await;
    let mut mixed = filters(json!({"literal":{"notificationState":"UNSEEN"}}));
    mixed["projectFilter"] = json!({"literal":{"notificationState":"UNSEEN"}});
    let SoupFilterCompileOutcome::Supported(query) =
        compile_filter_request(mixed, "UPDATED_AT", "DESC", 20).unwrap()
    else {
        panic!("mixed Soup filter")
    };
    let found = engine
        .reconcile_predicate_index(&query, &[])
        .await
        .unwrap()
        .value
        .keys;
    assert_eq!(
        found,
        [
            RecordKey::new(format!("GraphqlSoupProject:{}", id(7))).unwrap(),
            key(2),
            key(1)
        ]
    );
    let unseen = json!({"literal":{"notificationState":"UNSEEN"}});
    assert_eq!(keys(&mut engine, unseen.clone()).await, [key(2), key(1)]);
    let patch = data(vec![
        json!({"__typename":"GraphqlSoupChannel","id":id(1),"isParticipant":false,"channelTeamId":null}),
    ]);
    let (transaction, _) = engine
        .begin_optimistic_write_with_projections(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                uuid: "00000000-0000-0000-0000-000000002000",
                query: PATCH,
                operation_name: None,
                variables: &Default::default(),
                data: &patch,
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 1,
                identity_bindings: &[],
            },
            optimistic_projection_mutations(&patch, 1),
        )
        .await
        .unwrap();
    engine = Engine::new(engine.into_storage());
    assert_eq!(keys(&mut engine, unseen.clone()).await, [key(2)]);
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
    assert_eq!(keys(&mut engine, unseen.clone()).await, [key(2), key(1)]);

    // A child notification update edits only its primary channel's membership.
    let notification = json!({"updateNotifications":[{"id":id(101),"state":"DONE"}]});
    let updates = notification_projection_updates(
        cache_core::meta::bundled_schema_ref(),
        engine.storage(),
        NOTIFICATION,
        None,
        &Default::default(),
        &notification,
    )
    .await
    .unwrap();
    assert!(
        matches!(updates.as_slice(), [ProjectionMutation::PatchExact { record_key, .. }] if record_key == &key(1))
    );
    engine
        .write_query_with_registration_and_projections(
            None,
            None,
            NetworkWrite {
                query: NOTIFICATION,
                operation_name: None,
                variables: &Default::default(),
                data: &notification,
                identity: Some("macro|viewer@example.com"),
            },
            updates,
        )
        .await
        .unwrap();
    assert_eq!(keys(&mut engine, unseen).await, [key(2)]);

    // Partial metadata refresh clears optional facts, preserving notification
    // state and completeness only when a canonical base exists.
    write(&mut engine, PATCH, &patch).await;
    assert_eq!(
        keys(&mut engine, json!({"literal":{"teamId":id(10)}})).await,
        [key(2)]
    );
    let partial = data(vec![
        json!({"__typename":"GraphqlSoupChannel","id":id(4),"isParticipant":true}),
    ]);
    write(&mut engine, PATCH, &partial).await;
    assert!(matches!(
        engine
            .storage()
            .load_projection_states(&[key(4)])
            .await
            .unwrap()[0],
        Some(ProjectionState::Incomplete { .. })
    ));
    let dirty = dirty_projection_mutations(&[key(2).as_str().to_owned()]);
    assert!(
        matches!(dirty.as_slice(), [ProjectionMutation::MarkIncomplete { partition, .. }] if partition == &vocabulary::channel_partition())
    );
}

#[test]
fn channel_lifecycle_in_memory() {
    pollster::block_on(lifecycle(InMemoryStorage::new()));
}
#[test]
fn channel_lifecycle_in_turso() {
    pollster::block_on(lifecycle(
        cache_turso::TursoStorage::open_in_memory("soup-channels").unwrap(),
    ));
}
