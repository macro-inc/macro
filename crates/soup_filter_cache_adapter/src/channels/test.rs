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
} } } }"#;
const PATCH: &str = r#"query ChannelPatch { user { id soup(input: {initial: {}}) { items {
    __typename id ... on GraphqlSoupChannel { channelTeamId: teamId isParticipant updatedAt }
} } } }"#;
const NOTIFICATION: &str =
    r#"mutation Done { updateNotifications(input: {notificationIds: []}) { id state } }"#;

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
fn filters(channel: Value) -> Value {
    let nil = id(0);
    json!({"documentFilter":{"literal":{"id":nil}},"projectFilter":{"literal":{"projectIdSelf":nil}},"chatFilter":{"literal":{"chatId":nil}},"calendarEventFilter":{"literal":{"id":nil}},"emailFilter":{"tree":{"literal":{"threadId":nil}}},"channelThreadFilter":{"literal":{"threadId":nil}},"callFilter":{"literal":{"callId":nil}},"crmCompanyFilter":{"literal":{"id":nil}},"foreignEntityFilter":{"literal":{"id":nil}},"channelFilter":channel})
}
async fn write<S: PredicateIndexStorage>(engine: &mut Engine<S>, query: &str, data: &Value) {
    let projections = authoritative_projection_mutations(query, None, data).unwrap();
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
    let projections = authoritative_projection_mutations(QUERY, None, &data(vec![row(1)])).unwrap();
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
                authoritative_projection_mutations(QUERY, None, &data(vec![incomplete]))
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
            authoritative_projection_mutations(QUERY, None, &data(vec![malformed]))
                .unwrap()
                .as_slice(),
            [ProjectionMutation::MarkIncomplete { .. }]
        ));
    }
    let mut nullable = row(1);
    nullable["channelTeamId"] = Value::Null;
    nullable["organizationId"] = Value::Null;
    assert!(matches!(
        authoritative_projection_mutations(QUERY, None, &data(vec![nullable]))
            .unwrap()
            .as_slice(),
        [ProjectionMutation::Replace(_)]
    ));
}

async fn lifecycle<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    write(&mut engine, QUERY, &data(vec![row(1), row(2), row(3)])).await;
    let unseen = json!({"literal":{"notificationState":"UNSEEN"}});
    assert_eq!(keys(&mut engine, unseen.clone()).await, [key(2), key(1)]);
    let patch = data(vec![
        json!({"__typename":"GraphqlSoupChannel","id":id(1),"isParticipant":false,"channelTeamId":null}),
    ]);
    let (transaction, _) = engine
        .begin_optimistic_write_with_projections(
            None,
            BeginOptimisticWrite {
                uuid: "00000000-0000-0000-0000-000000002000",
                query: PATCH,
                operation_name: None,
                variables: &Default::default(),
                data: &patch,
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 1,
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
