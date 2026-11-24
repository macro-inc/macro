use super::*;
use cache_core::{
    engine::{BeginOptimisticWrite, Engine, InitialClaimOutcome, NetworkWrite},
    predicate::PredicateIndexStorage,
    queue::{MutationClaimRequest, MutationClaimToken},
    store::{InMemoryStorage, Storage},
};
use serde_json::json;
use uuid::Uuid;

const QUERY: &str = include_str!("test/project.graphql");
const SET: &str = include_str!("test/set.graphql");
const FAVORITE: &str = include_str!("test/favorite.graphql");
const VIEWER: &str = "macro|properties@example.com";
fn id(n: u128) -> String {
    Uuid::from_u128(n).to_string()
}
fn key() -> RecordKey {
    RecordKey::new(format!("GraphqlSoupProject:{}", id(100))).unwrap()
}
fn property(n: u128, option: u128) -> Value {
    json!({"id": id(n + 1000), "propertyDefinitionId": id(n), "value": {"__typename":"GraphqlSelectOptionPropertyValue", "optionIds": [id(option)]}})
}
fn data() -> Value {
    json!({"user": {"id": VIEWER, "soup": {"items": [{
        "__typename": "GraphqlSoupProject", "id": id(100), "isFavorited": true, "cacheProjection": null,
        "ownerId": VIEWER, "parentId": null, "createdAt": "2025-01-01T00:00:00Z", "updatedAt": "2025-01-02T00:00:00Z", "notifications": [],
        "properties": [property(1, 11), property(2, 22)],
    }]}}})
}
fn filters(property: Option<Value>) -> Value {
    let nil = id(0);
    let mut filters = json!({
        "documentFilter":{"literal":{"id":nil}}, "projectFilter":{"literal":{"projectIdSelf": id(100)}},
        "chatFilter":{"literal":{"chatId":nil}}, "emailFilter":{"tree":{"literal":{"threadId":nil}}},
        "channelFilter":{"literal":{"channelId":nil}}, "channelThreadFilter":{"literal":{"threadId":nil}},
        "calendarEventFilter":{"literal":{"id":nil}}, "callFilter":{"literal":{"callId":nil}},
        "crmCompanyFilter":{"literal":{"id":nil}}, "foreignEntityFilter":{"literal":{"id":nil}},
    });
    if let Some(property) = property {
        filters["propertiesFilter"] = property;
    }
    filters
}

#[test]
fn favorites_membership_changes_optimistically_and_rolls_back_without_a_new_query() {
    pollster::block_on(async {
        let mut engine =
            Engine::new(cache_turso::TursoStorage::open_in_memory("favorites").unwrap());
        write(&mut engine, QUERY, &Map::new(), &data(), VIEWER).await;
        let mut filter = filters(None);
        filter["favoritesOnly"] = json!(true);
        let crate::SoupFilterCompileOutcome::Supported(query) =
            crate::compile_current_filter_request(filter, "UPDATED_AT", "DESC", 100).unwrap()
        else {
            panic!("favorite filter must be supported");
        };
        assert_eq!(
            engine
                .reconcile_predicate_index(&query, &[])
                .await
                .unwrap()
                .value
                .keys,
            vec![key()]
        );
        let vars = json!({"entity":{"type":"PROJECT","id":id(100)},"favorite":false})
            .as_object()
            .unwrap()
            .clone();
        let removal = json!({"setFavorite":{"result":{"__typename":"GraphqlMutationSuccess","effects":[{
            "__typename":"SoupUpdated","item":{"__typename":"GraphqlSoupProject","id":id(100),"isFavorited":false}
        }]}}});
        let core = crate::optimistic_projection_mutations(&removal, 0);
        let projections = augment_optimistic(
            cache_core::meta::bundled_schema_ref(),
            engine.storage(),
            FAVORITE,
            None,
            &vars,
            &removal,
            core,
        )
        .await
        .unwrap();
        let queued = engine
            .enqueue_optimistic_mutation_with_projections(
                None,
                BeginOptimisticWrite {
                    client_metadata: None,
                    identity_bindings: &[],
                    uuid: "00000000-0000-7000-8000-000000000007",
                    query: FAVORITE,
                    operation_name: None,
                    variables: &vars,
                    data: &removal,
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 0,
                },
                MutationClaimRequest {
                    owner: "runner".into(),
                    now_ms: 0,
                    lease_expires_at_ms: 1000,
                },
                projections,
            )
            .await
            .unwrap();
        assert!(
            engine
                .reconcile_predicate_index(&query, &[])
                .await
                .unwrap()
                .value
                .keys
                .is_empty()
        );
        // Unrelated properties remain live while the favorite write is pending.
        assert!(matches(&mut engine, literal(1, 11)).await);
        let InitialClaimOutcome::Claimed(claim) = queued.initial_claim else {
            panic!("initial claim")
        };
        engine
            .rollback_optimistic_write(
                queued.transaction_id,
                MutationClaimToken {
                    owner: "runner".into(),
                    generation: claim.lease_generation,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            engine
                .reconcile_predicate_index(&query, &[])
                .await
                .unwrap()
                .value
                .keys,
            vec![key()]
        );
        write(&mut engine, FAVORITE, &vars, &removal, VIEWER).await;
        assert!(
            engine
                .reconcile_predicate_index(&query, &[])
                .await
                .unwrap()
                .value
                .keys
                .is_empty()
        );
        assert!(matches(&mut engine, literal(1, 11)).await);
    });
}
fn literal(definition: u128, option: u128) -> Value {
    json!({"literal":{"propertyDefinitionId": id(definition), "value":{"selectOption":id(option)}}})
}
async fn write<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    query: &str,
    vars: &Map<String, Value>,
    data: &Value,
    identity: &str,
) {
    let core = crate::authoritative_projection_mutations(
        cache_core::meta::bundled_schema_ref(),
        query,
        None,
        data,
    )
    .unwrap();
    let reuse = engine
        .current_identity()
        .await
        .unwrap()
        .as_deref()
        .is_none_or(|bound| bound == identity);
    let projections = augment_authoritative(
        cache_core::meta::bundled_schema_ref(),
        engine.storage(),
        query,
        None,
        vars,
        data,
        reuse,
        core,
    )
    .await
    .unwrap();
    engine
        .write_query_with_registration_and_projections(
            None,
            None,
            NetworkWrite {
                query,
                operation_name: None,
                variables: vars,
                data,
                identity: Some(identity),
                channel: None,
            },
            projections,
        )
        .await
        .unwrap();
}
async fn matches<S: PredicateIndexStorage>(engine: &mut Engine<S>, property: Value) -> bool {
    let crate::SoupFilterCompileOutcome::Supported(query) =
        crate::compile_current_filter_request(filters(Some(property)), "UPDATED_AT", "DESC", 100)
            .unwrap()
    else {
        panic!("filter must be supported")
    };
    engine
        .reconcile_predicate_index(&query, &[])
        .await
        .unwrap()
        .value
        .keys
        == vec![key()]
}

#[test]
fn property_snapshots_and_single_property_writes_update_native_postings() {
    pollster::block_on(async {
        let mut engine =
            Engine::new(cache_turso::TursoStorage::open_in_memory("properties").unwrap());
        write(&mut engine, QUERY, &Map::new(), &data(), VIEWER).await;
        assert!(matches(&mut engine, literal(1, 11)).await);
        assert!(!matches(&mut engine, literal(1, 12)).await);
        let vars = json!({"input": {"entityType":"PROJECT", "entityId":id(100), "propertyDefinitionId":id(1)}}).as_object().unwrap().clone();
        write(
            &mut engine,
            SET,
            &vars,
            &json!({"setEntityProperty":property(1,12)}),
            VIEWER,
        )
        .await;
        assert!(!matches(&mut engine, literal(1, 11)).await);
        assert!(
            matches(
                &mut engine,
                json!({"and":{"left":literal(1,12),"right":literal(2,22)}})
            )
            .await
        );
    });
}

#[test]
fn missing_or_malformed_property_proof_is_unknown_not_a_negative_match() {
    pollster::block_on(async {
        for properties in [None, Some(Value::Null), Some(json!([{"id":id(1)}]))] {
            let mut payload = data();
            let row = payload["user"]["soup"]["items"][0].as_object_mut().unwrap();
            row.remove("properties");
            if let Some(properties) = properties {
                row.insert("properties".into(), properties);
            }
            let mut engine = Engine::new(InMemoryStorage::new());
            write(&mut engine, QUERY, &Map::new(), &payload, VIEWER).await;
            let state = engine
                .storage()
                .load_projection_states(&[key()])
                .await
                .unwrap()
                .pop()
                .flatten()
                .unwrap();
            assert!(matches!(state, ProjectionState::Incomplete { .. }));
            assert!(!matches(&mut engine, json!({"not":literal(1,11)})).await);
        }
    });
}

#[test]
fn empty_snapshots_clear_facts_but_deleted_child_records_make_them_unknown() {
    pollster::block_on(async {
        let mut engine =
            Engine::new(cache_turso::TursoStorage::open_in_memory("property-deletion").unwrap());
        write(&mut engine, QUERY, &Map::new(), &data(), VIEWER).await;
        let changes =
            deletion_updates(engine.storage(), &[format!("GraphqlProperty:{}", id(1001))])
                .await
                .unwrap();
        assert_eq!(changes.len(), 1);
        assert!(matches!(
            changes[0],
            ProjectionMutation::MarkIncomplete { .. }
        ));
        let mut payload = data();
        payload["user"]["soup"]["items"][0]["properties"] = json!([]);
        write(&mut engine, QUERY, &Map::new(), &payload, VIEWER).await;
        assert!(!matches(&mut engine, literal(1, 11)).await);
        assert!(matches(&mut engine, json!({"not":literal(1,11)})).await);
    });
}

#[test]
fn identity_changes_never_borrow_older_property_snapshots() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write(&mut engine, QUERY, &Map::new(), &data(), VIEWER).await;
        let mut payload = data();
        payload["user"]["id"] = json!("macro|other@example.com");
        payload["user"]["soup"]["items"][0]
            .as_object_mut()
            .unwrap()
            .remove("properties");
        write(
            &mut engine,
            QUERY,
            &Map::new(),
            &payload,
            "macro|other@example.com",
        )
        .await;
        assert!(!matches(&mut engine, literal(1, 11)).await);
        assert!(!matches(&mut engine, json!({"not":literal(1,11)})).await);
    });
}

#[test]
fn independent_property_optimism_survives_rollback_and_commits() {
    pollster::block_on(async {
        let mut engine =
            Engine::new(cache_turso::TursoStorage::open_in_memory("property-queue").unwrap());
        write(&mut engine, QUERY, &Map::new(), &data(), VIEWER).await;
        let mut first = None;
        let mut second_data = Value::Null;
        let mut second_vars = Map::new();
        for (definition, option) in [(1, 12), (2, 23)] {
            let vars = json!({"input":{"entityType":"PROJECT","entityId":id(100),"propertyDefinitionId":id(definition)}}).as_object().unwrap().clone();
            let data = json!({"setEntityProperty":property(definition, option)});
            let projections = augment_optimistic(
                cache_core::meta::bundled_schema_ref(),
                engine.storage(),
                SET,
                None,
                &vars,
                &data,
                vec![],
            )
            .await
            .unwrap();
            let uuid = format!("00000000-0000-7000-8000-{definition:012}");
            let queued = engine
                .enqueue_optimistic_mutation_with_projections(
                    None,
                    BeginOptimisticWrite {
                        client_metadata: None,
                        uuid: &uuid,
                        query: SET,
                        operation_name: None,
                        variables: &vars,
                        data: &data,
                        link_patches: &[],
                        revalidations: &[],
                        created_at_ms: 0,
                        identity_bindings: &[],
                    },
                    MutationClaimRequest {
                        owner: "runner".into(),
                        now_ms: 0,
                        lease_expires_at_ms: 1000,
                    },
                    projections,
                )
                .await
                .unwrap();
            if definition == 1 {
                first = Some(queued);
            } else {
                second_data = data;
                second_vars = vars;
            }
        }
        assert!(
            matches(
                &mut engine,
                json!({"and":{"left":literal(1,12),"right":literal(2,23)}})
            )
            .await
        );
        let first = first.unwrap();
        let InitialClaimOutcome::Claimed(claim) = first.initial_claim else {
            panic!("first claim")
        };
        engine
            .rollback_optimistic_write(
                first.transaction_id,
                MutationClaimToken {
                    owner: "runner".into(),
                    generation: claim.lease_generation,
                },
            )
            .await
            .unwrap();
        assert!(
            matches(
                &mut engine,
                json!({"and":{"left":literal(1,11),"right":literal(2,23)}})
            )
            .await
        );
        assert!(!matches(&mut engine, literal(1, 12)).await);
        let claim = engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 1,
                lease_expires_at_ms: 1000,
            })
            .await
            .unwrap()
            .unwrap();
        let projections = augment_authoritative(
            cache_core::meta::bundled_schema_ref(),
            engine.storage(),
            SET,
            None,
            &second_vars,
            &second_data,
            true,
            vec![],
        )
        .await
        .unwrap();
        engine
            .commit_optimistic_write_with_projections_outcome(
                claim.queued.id,
                MutationClaimToken {
                    owner: "runner".into(),
                    generation: claim.lease_generation,
                },
                SET,
                None,
                &second_vars,
                &second_data,
                projections,
            )
            .await
            .unwrap();
        assert!(
            matches(
                &mut engine,
                json!({"and":{"left":literal(1,11),"right":literal(2,23)}})
            )
            .await
        );
        assert!(
            engine
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn id_only_property_mutation_responses_invalidate_old_value_proof() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write(&mut engine, QUERY, &Map::new(), &data(), VIEWER).await;
        let vars = json!({"input":{"entityType":"PROJECT","entityId":id(100),"propertyDefinitionId":id(1)}}).as_object().unwrap().clone();
        write(&mut engine, "mutation Set($input: SetEntityPropertyInput!) { setEntityProperty(input: $input) { id } }", &vars,
            &json!({"setEntityProperty":{"id":id(1001)}}), VIEWER).await;
        assert!(!matches(&mut engine, literal(1, 11)).await);
        assert!(!matches(&mut engine, json!({"not":literal(1,11)})).await);
    });
}

#[test]
fn property_optimism_only_patches_the_modified_definition() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write(&mut engine, QUERY, &Map::new(), &data(), VIEWER).await;
        let vars = json!({"input": {"entityType":"PROJECT", "entityId":id(100), "propertyDefinitionId":id(1)}}).as_object().unwrap().clone();
        let changes = augment_optimistic(
            cache_core::meta::bundled_schema_ref(),
            engine.storage(),
            SET,
            None,
            &vars,
            &json!({"setEntityProperty":property(1,12)}),
            vec![],
        )
        .await
        .unwrap();
        let [OptimisticProjectionMutation::Patch { exact, profile, .. }] = changes.as_slice()
        else {
            panic!("property patch expected")
        };
        assert_eq!(profile, &vocabulary::profile_v6());
        assert_eq!(exact.len(), 3);
        assert!(
            exact
                .iter()
                .all(|patch| patch.attribute.as_str().contains(&id(1)))
        );
    });
}

#[test]
fn a_field_no_input_names_never_changes_a_property_fact() {
    use cache_core::value::{CacheValue, Record};
    // A parent's property facts are the same whatever an unread field of the
    // property record holds, so a schema change that removes one keeps them.
    let key = cache_core::value::EntityKey::entity("GraphqlProperty", &[&id(1001)]);
    let mut record = Record::default();
    record
        .fields
        .insert("propertyDefinitionId".into(), CacheValue::String(id(1)));
    let option = CacheValue::Object(
        [
            (
                "__typename".to_owned(),
                CacheValue::String("GraphqlSelectOptionPropertyValue".into()),
            ),
            (
                "optionIds".to_owned(),
                CacheValue::List(vec![CacheValue::String(id(11))]),
            ),
        ]
        .into(),
    );
    record.fields.insert("value".into(), option);
    let facts = prepare::row_facts(&key, &record).unwrap();
    assert_eq!(facts.1.len(), 2, "the row and its option");
    let read = crate::projection_inputs()
        .fields()
        .filter(|(owner, _)| *owner == "GraphqlProperty")
        .map(|(_, field)| field.to_owned())
        .collect::<std::collections::BTreeSet<_>>();
    let unread = cache_core::meta::bundled_schema_ref()
        .type_meta("GraphqlProperty")
        .unwrap()
        .fields
        .iter()
        .filter(|field| !read.contains(&field.name))
        .map(|field| field.name.clone())
        .collect::<Vec<_>>();
    assert!(unread.len() > 5, "{unread:?}");
    for field in unread {
        for value in [
            CacheValue::Null,
            CacheValue::Bool(true),
            CacheValue::String("x".into()),
            CacheValue::List(Vec::new()),
            CacheValue::Object(std::collections::BTreeMap::new()),
            CacheValue::Opaque("\"x\"".into()),
        ] {
            let mut changed = record.clone();
            changed.fields.insert(field.clone(), value.clone());
            assert_eq!(
                prepare::row_facts(&key, &changed),
                Ok(facts.clone()),
                "GraphqlProperty.{field} = {value:?}"
            );
        }
    }
}

/// Storage derives the Inbox view sort fact in place only for the profiles the
/// rule names, so it must name every profile a Mail document is stored under:
/// the projection's own and the property-aware one this module relabels it to.
#[test]
fn inbox_view_derivation_covers_every_stored_mail_profile() {
    let mail = item_filter_index::mail::profile();
    let derivation = item_filter_index::mail::INBOX_VIEW_DERIVATION;
    for profile in [legacy_profile(&mail), current_profile(&mail)] {
        assert!(
            derivation.profiles.contains(&profile.token().as_str()),
            "{profile:?}"
        );
    }
}
