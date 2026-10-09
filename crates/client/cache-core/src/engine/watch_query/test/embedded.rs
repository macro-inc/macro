use super::*;
use proptest::prelude::*;

const PROPERTIES: &str = include_str!("embedded.graphql");

fn property_page(count: usize) -> Json {
    json!({"user": {"id": "viewer", "soup": {"items": (0..count).map(|i| json!({
        "__typename": "GraphqlSoupDocument", "id": format!("doc-{i}"),
        "properties": [{"id": format!("property-{i}"), "value": {
            "kind": "GraphqlSelectOptionPropertyValue", "selected": ["initial"]
        }}]
    })).collect::<Vec<_>>()}}})
}

async fn set_value(engine: &mut Engine<InMemoryStorage>, id: usize, value: CacheValue) {
    engine
        .put_records_with_projections(
            None,
            vec![(
                EntityKey::entity("GraphqlProperty", &[&format!("property-{id}")]),
                Record {
                    fields: BTreeMap::from([("value".into(), value)]),
                },
            )],
            vec![],
        )
        .await
        .unwrap();
}

fn options(values: &[&str]) -> CacheValue {
    CacheValue::Object(BTreeMap::from([
        (
            "__typename".into(),
            CacheValue::String("GraphqlSelectOptionPropertyValue".into()),
        ),
        (
            "optionIds".into(),
            CacheValue::List(
                values
                    .iter()
                    .map(|value| CacheValue::String((*value).into()))
                    .collect(),
            ),
        ),
    ]))
}

#[test]
fn nested_property_edits_patch_each_subscriber_without_reading_other_rows() {
    block_on(async {
        let mut engine = Engine::with_capacity(InMemoryStorage::new(), 1);
        engine
            .write_query(None, PROPERTIES, None, &vars(), &property_page(1000), None)
            .await
            .unwrap();
        let mut cursors = Vec::new();
        for op in [1, 2] {
            let first = engine
                .watch_query(op, PROPERTIES, None, &vars(), &[], None)
                .await
                .unwrap();
            assert!(
                matches!(&first, QueryUpdate::Hit { data, .. } if *data == property_page(1000))
            );
            cursors.push((op, revision(&first)));
        }
        for values in [
            vec!["next"],
            vec!["next", "second"],
            vec![],
            vec!["initial"],
        ] {
            set_value(&mut engine, 17, options(&values)).await;
            let before = engine.storage().record_get_count();
            for (op, cursor) in &mut cursors {
                let update = engine
                    .watch_query(*op, PROPERTIES, None, &vars(), &[], Some(*cursor))
                    .await
                    .unwrap();
                *cursor = revision(&update);
                assert_eq!(
                    patches(update),
                    json!([{
                        "path": ["user", "soup", "items", 17, "properties", 0, "value", "selected"],
                        "value": values
                    }])
                );
            }
            assert!(
                engine.storage().record_get_count() - before <= 2,
                "a nested value must not reload the other 999 rows"
            );
        }
    });
}

#[test]
fn embedded_nulls_and_type_changes_replace_the_value_and_missing_fields_miss() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(None, PROPERTIES, None, &vars(), &property_page(1), None)
            .await
            .unwrap();
        let first = engine
            .watch_query(1, PROPERTIES, None, &vars(), &[], None)
            .await
            .unwrap();
        let mut cursor = revision(&first);
        for (value, expected) in [
            (CacheValue::Null, Json::Null),
            (
                options(&["restored"]),
                json!({"kind": "GraphqlSelectOptionPropertyValue", "selected": ["restored"]}),
            ),
            (
                CacheValue::Object(BTreeMap::from([
                    (
                        "__typename".into(),
                        CacheValue::String("GraphqlStringPropertyValue".into()),
                    ),
                    ("value".into(), CacheValue::String("text".into())),
                ])),
                json!({"kind": "GraphqlStringPropertyValue", "text": "text"}),
            ),
        ] {
            set_value(&mut engine, 0, value).await;
            let update = engine
                .watch_query(1, PROPERTIES, None, &vars(), &[], Some(cursor))
                .await
                .unwrap();
            cursor = revision(&update);
            assert_eq!(
                patches(update),
                json!([{
                    "path": ["user", "soup", "items", 0, "properties", 0, "value"],
                    "value": expected
                }])
            );
        }
        set_value(
            &mut engine,
            0,
            CacheValue::Object(BTreeMap::from([(
                "__typename".into(),
                CacheValue::String("GraphqlStringPropertyValue".into()),
            )])),
        )
        .await;
        assert!(matches!(
            engine
                .watch_query(1, PROPERTIES, None, &vars(), &[], Some(cursor))
                .await
                .unwrap(),
            QueryUpdate::Miss { .. }
        ));
    });
}

#[test]
fn nested_lists_preserve_aliases_and_replace_changed_membership() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let mut data = property_page(1);
        data["user"]["soup"]["items"][0]["properties"][0]["value"] = json!({
            "kind": "GraphqlEntityReferencePropertyValue", "references": [{"target": "first", "entityType": "USER"}]
        });
        engine
            .write_query(None, PROPERTIES, None, &vars(), &data, None)
            .await
            .unwrap();
        let first = engine
            .watch_query(1, PROPERTIES, None, &vars(), &[], None)
            .await
            .unwrap();
        data["user"]["soup"]["items"][0]["properties"][0]["value"]["references"][0]["target"] =
            json!("second");
        engine
            .write_query(None, PROPERTIES, None, &vars(), &data, None)
            .await
            .unwrap();
        let next = engine
            .watch_query(1, PROPERTIES, None, &vars(), &[], Some(revision(&first)))
            .await
            .unwrap();
        let cursor = revision(&next);
        assert_eq!(
            patches(next),
            json!([{
                "path": ["user", "soup", "items", 0, "properties", 0, "value", "references", 0, "target"], "value": "second"
            }])
        );
        data["user"]["soup"]["items"][0]["properties"][0]["value"]["references"] = json!([]);
        engine
            .write_query(None, PROPERTIES, None, &vars(), &data, None)
            .await
            .unwrap();
        let next = engine
            .watch_query(1, PROPERTIES, None, &vars(), &[], Some(cursor))
            .await
            .unwrap();
        assert_eq!(
            patches(next),
            json!([{
                "path": ["user", "soup", "items", 0, "properties", 0, "value", "references"], "value": []
            }])
        );
    });
}

#[test]
fn link_edits_patch_one_row_but_large_list_replacements_resend_the_result() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(None, PROPERTIES, None, &vars(), &property_page(1000), None)
            .await
            .unwrap();
        let first = engine
            .watch_query(1, PROPERTIES, None, &vars(), &[], None)
            .await
            .unwrap();
        let document =
            |id: usize| EntityKey::entity("GraphqlSoupDocument", &[&format!("doc-{id}")]);
        let property = |id: usize| {
            CacheValue::Ref(EntityKey::entity(
                "GraphqlProperty",
                &[&format!("property-{id}")],
            ))
        };
        let mut snapshot = property_page(1000);
        let mut cursor = apply(&mut snapshot, first);
        let edits = [
            (
                "properties",
                CacheValue::List(vec![property(17), property(18)]),
                false,
            ),
            (identity::DELETED_FIELD, CacheValue::Bool(true), true),
        ];
        for (field, value, resend) in edits {
            engine
                .put_records_with_projections(
                    None,
                    vec![(
                        document(17),
                        Record {
                            fields: BTreeMap::from([(field.into(), value)]),
                        },
                    )],
                    vec![],
                )
                .await
                .unwrap();
            let update = engine
                .watch_query(1, PROPERTIES, None, &vars(), &[], Some(cursor))
                .await
                .unwrap();
            match &update {
                QueryUpdate::Hit { .. } => assert!(resend, "{field} resent the result"),
                QueryUpdate::Patch { patches, .. } => {
                    assert!(!resend, "{field} patched a compacted list");
                    assert_eq!(
                        serde_json::to_value(patches).unwrap()[0]["path"],
                        json!(["user", "soup", "items", 17, "properties"])
                    );
                }
                QueryUpdate::Miss { .. } => panic!("complete page cannot miss"),
            }
            cursor = apply(&mut snapshot, update);
            let ReadResult::Hit { data } = engine
                .read_query(None, PROPERTIES, None, &vars())
                .await
                .unwrap()
            else {
                panic!("complete page cannot miss");
            };
            assert_eq!(snapshot, data);
        }
    });
}

#[test]
fn conditional_embedded_fields_stay_unselected() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(None, PROPERTIES, None, &vars(), &property_page(1), None)
            .await
            .unwrap();
        let mut hidden = vars();
        hidden.insert("show".into(), json!(false));
        let first = engine
            .watch_query(1, PROPERTIES, None, &hidden, &[], None)
            .await
            .unwrap();
        set_value(&mut engine, 0, options(&["changed"])).await;
        assert_eq!(
            patches(
                engine
                    .watch_query(1, PROPERTIES, None, &hidden, &[], Some(revision(&first)))
                    .await
                    .unwrap()
            ),
            json!([])
        );
    });
}

#[test]
fn optimistic_embedded_values_and_rollback_stay_incremental() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(None, PROPERTIES, None, &vars(), &property_page(2), None)
            .await
            .unwrap();
        let first = engine
            .watch_query(1, PROPERTIES, None, &vars(), &[], None)
            .await
            .unwrap();
        engine.begin_optimistic_write(None, BeginOptimisticWrite {
            client_metadata: None,
            uuid: "00000000-0000-4000-8000-000000000001",
            query: include_str!("property-mutation.graphql"), operation_name: None,
            variables: json!({"input": {"entityType": "DOCUMENT", "entityId": "doc-0", "propertyDefinitionId": "status", "value": {"selectOption": "pending"}}}).as_object().unwrap(),
            data: &json!({"setEntityProperty": {"id": "property-0", "value": {"__typename": "GraphqlSelectOptionPropertyValue", "optionIds": ["pending"]}}}),
            link_patches: &[], revalidations: &[], identity_bindings: &[], created_at_ms: 0,
        }).await.unwrap();
        let pending = engine
            .watch_query(1, PROPERTIES, None, &vars(), &[], Some(revision(&first)))
            .await
            .unwrap();
        let cursor = revision(&pending);
        assert_eq!(patches(pending)[0]["value"], json!(["pending"]));
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
                claim.queued.id,
                MutationClaimToken {
                    owner: "test".into(),
                    generation: claim.lease_generation,
                },
            )
            .await
            .unwrap();
        let restored = engine
            .watch_query(1, PROPERTIES, None, &vars(), &[], Some(cursor))
            .await
            .unwrap();
        assert_eq!(
            patches(restored),
            json!([{
                "path": ["user", "soup", "items", 0, "properties", 0, "value", "selected"], "value": ["initial"]
            }])
        );
    });
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(128))]
    #[test]
    fn generated_nested_updates_match_full_reads(
        edits in prop::collection::vec((0usize..8, 0u8..3, prop::collection::vec("[a-z]{0,12}", 0..5)), 1..40)
    ) {
        block_on(async {
            let mut engine = Engine::with_capacity(InMemoryStorage::new(), 1);
            let mut snapshot = property_page(8);
            engine.write_query(None, PROPERTIES, None, &vars(), &snapshot, None).await.unwrap();
            let initial = engine.watch_query(1, PROPERTIES, None, &vars(), &[], None).await.unwrap();
            let mut cursor = revision(&initial);
            for (id, kind, values) in edits {
                let value = match kind {
                    0 => CacheValue::Null,
                    1 => options(&values.iter().map(String::as_str).collect::<Vec<_>>()),
                    _ => CacheValue::Object(BTreeMap::from([
                        ("__typename".into(), CacheValue::String("GraphqlStringPropertyValue".into())),
                        ("value".into(), CacheValue::String(values.join(","))),
                    ])),
                };
                set_value(&mut engine, id, value).await;
                let next = engine.watch_query(1, PROPERTIES, None, &vars(), &[], Some(cursor)).await.unwrap();
                cursor = apply(&mut snapshot, next);
                let full = engine.read_query(None, PROPERTIES, None, &vars()).await.unwrap();
                let ReadResult::Hit { data } = full else { panic!("full read missed") };
                prop_assert_eq!(&snapshot, &data);
            }
            Ok(())
        })?;
    }
}
