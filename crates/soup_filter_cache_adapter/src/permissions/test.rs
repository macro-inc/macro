use super::*;
use cache_core::store::{InMemoryStorage, Storage};
use pollster::block_on;
use serde_json::json;

fn key(kind: &str, id: &str) -> EntityKey<'static> {
    EntityKey::entity(kind, &[id])
}

fn record(fields: &[(&str, CacheValue)]) -> Record {
    Record {
        fields: fields
            .iter()
            .map(|(field, value)| ((*field).into(), value.clone()))
            .collect(),
    }
}

#[test]
fn orphan_projection_facts_retire_without_deleting_unrelated_facts_or_identity_aliases() {
    block_on(async {
        use cache_core::predicate::ProjectionMutation;
        use predicate_index::{IndexDocument, Profile, Token};
        let keys = [
            key("GraphqlSoupCrmCompany", ""),
            key("GraphqlSoupEmailThread", ""),
            key("GraphqlProperty", "orphan"),
            key("GraphqlSoupCrmContact", "alias"),
            key("GraphqlSoupDocument", "kept"),
        ];
        let mut storage = InMemoryStorage::new();
        storage
            .put_batch_with_projections(
                vec![],
                keys.iter()
                    .map(|key| {
                        ProjectionMutation::Replace(IndexDocument {
                            record_key: RecordKey::new(key.to_string()).unwrap(),
                            profile: Profile::new(Token::new("permission-test").unwrap()),
                            partition: Token::new("items").unwrap(),
                            exact_facts: vec![],
                            integer_facts: vec![],
                            sort_facts: vec![],
                        })
                    })
                    .collect(),
            )
            .await
            .unwrap();
        let alias = cache_core::identity::alias_record(&key("GraphqlSoupCrmContact", "canonical"));
        storage
            .put_batch(vec![(keys[3].clone(), alias.clone())])
            .await
            .unwrap();
        storage
            .put_batch(vec![(
                keys[0].clone(),
                record(&[("name", CacheValue::String("empty-id snapshot".into()))]),
            )])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        let before = engine.current_authority("profile").await.unwrap();
        transition_crm_authority(
            &mut engine,
            "profile",
            before.generation,
            "team:denied".into(),
        )
        .await
        .unwrap();
        for key in &keys[..4] {
            assert!(
                engine
                    .storage()
                    .projection_keys(key.typename().unwrap(), None, 500)
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
        assert_eq!(
            engine
                .storage()
                .projection_keys("GraphqlSoupDocument", None, 500)
                .await
                .unwrap(),
            vec![keys[4].clone()]
        );
        assert_eq!(
            engine
                .storage()
                .get_batch(&[keys[3].clone()])
                .await
                .unwrap(),
            vec![Some(alias)]
        );
    });
}

#[test]
fn a_later_transition_keeps_settled_coalescing_identity_and_deletion_tombstones() {
    block_on(async {
        use cache_core::identity::{DELETED_FIELD, MUTATION_UUID_FIELD};
        let draft = key("GraphqlMailDraftEntry", "draft");
        let deleted = key("GraphqlMailPreviewMessage", "deleted");
        let metadata = record(&[
            ("id", CacheValue::String("draft".into())),
            (
                MUTATION_UUID_FIELD,
                CacheValue::String(Uuid::now_v7().to_string()),
            ),
        ]);
        let tombstone = record(&[(DELETED_FIELD, CacheValue::Bool(true))]);
        let mut with_content = metadata.clone();
        with_content.fields.insert(
            "subject".into(),
            CacheValue::String("copied subject".into()),
        );
        let mut storage = InMemoryStorage::new();
        storage
            .put_batch(vec![
                (draft.clone(), with_content),
                (deleted.clone(), tombstone.clone()),
            ])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        let before = engine.current_authority("profile").await.unwrap();
        let denied = transition_crm_authority(
            &mut engine,
            "profile",
            before.generation,
            "team:denied".into(),
        )
        .await
        .unwrap();
        transition_crm_authority(
            &mut engine,
            "profile",
            denied.authority.generation,
            "team:allowed".into(),
        )
        .await
        .unwrap();
        assert_eq!(
            engine.storage().get_batch(&[draft, deleted]).await.unwrap(),
            vec![Some(metadata), Some(tombstone)]
        );
    });
}

#[test]
fn retirement_removes_children_orphans_and_aggregates_but_keeps_offline_work_and_history() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        let company = key("GraphqlSoupCrmCompany", "company");
        let document = key("GraphqlSoupDocument", "document");
        let crm_property = key("GraphqlProperty", "crm-property");
        let doc_property = key("GraphqlProperty", "doc-property");
        let orphan = key("GraphqlProperty", "orphan-property");
        let notification = key("GraphqlNotification", "notification");
        let viewer = key("GraphqlUser", "viewer");
        let notification_record = record(&[(
            "metadata",
            CacheValue::opaque(&json!({"text":"received comment"})),
        )]);
        let document_record = record(&[
            ("name", CacheValue::String("offline document".into())),
            (
                "properties",
                CacheValue::List(vec![CacheValue::Ref(doc_property.clone())]),
            ),
        ]);
        let value = record(&[("value", CacheValue::String("copied value".into()))]);
        storage
            .put_batch(vec![
                (
                    company.clone(),
                    record(&[(
                        "properties",
                        CacheValue::List(vec![CacheValue::Ref(crm_property.clone())]),
                    )]),
                ),
                (document.clone(), document_record.clone()),
                (crm_property.clone(), value.clone()),
                (doc_property.clone(), value.clone()),
                (orphan.clone(), value.clone()),
                (key("GraphqlMailPreviewMessage", "preview"), value.clone()),
                (
                    key("GraphqlSoupEmailMessageAttachment", "attachment"),
                    value.clone(),
                ),
                (notification.clone(), notification_record.clone()),
                (
                    viewer.clone(),
                    record(&[
                        ("id", CacheValue::String("viewer".into())),
                        (
                            "activityOverview({\"input\":{}})",
                            CacheValue::opaque(&json!({"total":42})),
                        ),
                        (
                            "groupSoup({\"input\":{}})",
                            CacheValue::opaque(&json!({"label":"copied label","totalCount":12})),
                        ),
                        (
                            "soup({\"input\":{\"initial\":{\"filters\":{\"crmCompanyFilter\":{\"literal\":{\"id\":\"00000000-0000-0000-0000-000000000000\"}},\"emailFilter\":{\"tree\":{\"literal\":{\"threadId\":\"00000000-0000-0000-0000-000000000000\"}}}}}}})",
                            CacheValue::List(vec![CacheValue::Ref(document.clone())]),
                        ),
                        ("contacts", CacheValue::List(vec![])),
                        ("calendars", CacheValue::List(vec![])),
                    ]),
                ),
            ])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        let initial = engine.current_authority("viewer").await.unwrap();
        transition_crm_authority(
            &mut engine,
            "viewer",
            initial.generation,
            "team:denied".into(),
        )
        .await
        .unwrap();
        let rows = engine
            .storage()
            .get_batch(&[
                company,
                crm_property,
                orphan,
                key("GraphqlMailPreviewMessage", "preview"),
                key("GraphqlSoupEmailMessageAttachment", "attachment"),
                document,
                doc_property,
                notification,
                viewer,
            ])
            .await
            .unwrap();
        assert!(rows[..5].iter().all(Option::is_none));
        assert_eq!(rows[5], Some(document_record));
        assert_eq!(rows[6], Some(value));
        assert_eq!(rows[7], Some(notification_record));
        let viewer = rows[8].as_ref().unwrap();
        assert_eq!(viewer.fields.len(), 4);
        assert!(!format!("{viewer:?}").contains("copied label"));
    });
}

#[test]
fn mutation_only_property_ownership_survives_without_a_parent_record() {
    block_on(async {
        let mut engine =
            Engine::new(InMemoryStorage::new()).with_response_records(response_property_owners);
        let query = "mutation Set($input: SetEntityPropertyInput!, $first: Boolean!) { setEntityProperty(input: $input) { __typename first: id @include(if: $first) id propertyDefinitionId } }";
        for (id, entity_type) in [("crm-property", "COMPANY"), ("doc-property", "DOCUMENT")] {
            let variables =
                json!({"first":false,"input":{"entityType":entity_type,"entityId":"owner"}});
            let data = json!({"setEntityProperty":{"__typename":"GraphqlProperty","id":id,"propertyDefinitionId":"definition"}});
            engine
                .write_query(
                    None,
                    query,
                    Some("Set"),
                    variables.as_object().unwrap(),
                    &data,
                    None,
                )
                .await
                .unwrap();
        }
        let initial = engine.current_authority("viewer").await.unwrap();
        transition_crm_authority(
            &mut engine,
            "viewer",
            initial.generation,
            "team:denied".into(),
        )
        .await
        .unwrap();
        let engine = Engine::new(engine.into_storage());
        let rows = engine
            .storage()
            .get_batch(&[
                key("GraphqlProperty", "crm-property"),
                key("GraphqlProperty", "doc-property"),
                key(OWNER_TYPE, "crm-property"),
                key(OWNER_TYPE, "doc-property"),
            ])
            .await
            .unwrap();
        assert!(rows[0].is_none());
        assert!(rows[1].is_some());
        assert!(rows[2].is_none());
        assert!(rows[3].is_some());
    });
}

#[test]
fn legacy_draft_recovery_keeps_authored_attachments_without_thread_content() {
    let mut source = cache_core::queue::decode_optimistic_source(&json!({
        "saveEmailDraft":{"draft":{
            "id":"draft", "subject":"copied subject", "bodyText":"copied body",
            "linkId":"inbox", "from":{"email":"sender@example.com"},
            "attachmentsDraft":[{"id":"attachment", "fileName":"draft.txt", "s3Key":"draft-key"}],
            "attachmentsForwarded":[{"attachmentId":"forwarded", "filename":"forwarded.txt"}]
        }}
    }).to_string()).unwrap();
    preserve_legacy_draft(&mut source, Some("SaveEmailDraft"));
    let recovery = &source.client_metadata.as_ref().unwrap()["legacyDraftRecovery"];
    assert_eq!(recovery["attachmentsDraft"][0]["s3Key"], "draft-key");
    assert_eq!(
        recovery["attachmentsForwarded"][0]["attachmentId"],
        "forwarded"
    );
    assert_eq!(recovery["linkId"], "inbox");
    assert!(recovery.get("subject").is_none());
    assert!(recovery.get("bodyText").is_none());
}

#[test]
fn aliased_property_mutations_keep_each_assignments_actual_owner_in_both_orders() {
    block_on(async {
        for reverse in [false, true] {
            let mut engine = Engine::new(InMemoryStorage::new());
            let crm = "crm: setEntityProperty(input: {entityType: COMPANY, entityId: \"company\"}) { __typename key: id }";
            let doc = "doc: setEntityProperty(input: {entityType: DOCUMENT, entityId: \"document\"}) { __typename key: id }";
            let query = if reverse {
                format!("mutation {{ {doc} {crm} }}")
            } else {
                format!("mutation {{ {crm} {doc} }}")
            };
            let data = json!({"crm":{"__typename":"GraphqlProperty","key":"crm-property"},"doc":{"__typename":"GraphqlProperty","key":"doc-property"}});
            engine
                .write_query(None, &query, None, &Map::new(), &data, None)
                .await
                .unwrap();
            remember_property_owners(&mut engine, &query, None, &Map::new(), &data)
                .await
                .unwrap();
            let initial = engine.current_authority("viewer").await.unwrap();
            transition_crm_authority(
                &mut engine,
                "viewer",
                initial.generation,
                "team:denied".into(),
            )
            .await
            .unwrap();
            let rows = engine
                .storage()
                .get_batch(&[
                    key("GraphqlProperty", "crm-property"),
                    key("GraphqlProperty", "doc-property"),
                ])
                .await
                .unwrap();
            assert!(
                rows[0].is_none(),
                "CRM property must not inherit the document owner"
            );
            assert!(rows[1].is_some());
        }
    });
}

#[test]
fn embedded_crm_parent_cannot_inherit_viewer_ownership_and_history_membership_survives() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        let property = key("GraphqlProperty", "embedded-property");
        let history = CacheValue::Object(
            [
                (
                    "entity".into(),
                    CacheValue::Ref(key("GraphqlSoupCrmCompany", "company")),
                ),
                (
                    "rows".into(),
                    CacheValue::List(vec![CacheValue::Ref(key("NotificationInboxRow", "row"))]),
                ),
            ]
            .into(),
        );
        storage
            .put_batch(vec![
                (
                    key("GraphqlUser", "viewer"),
                    record(&[
                        (
                            "soup",
                            CacheValue::Object(
                                [(
                                    "properties".into(),
                                    CacheValue::List(vec![CacheValue::Ref(property.clone())]),
                                )]
                                .into(),
                            ),
                        ),
                        ("notificationInbox", history.clone()),
                    ]),
                ),
                (
                    property.clone(),
                    record(&[("value", CacheValue::String("private".into()))]),
                ),
            ])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        let initial = engine.current_authority("viewer").await.unwrap();
        transition_crm_authority(
            &mut engine,
            "viewer",
            initial.generation,
            "team:denied".into(),
        )
        .await
        .unwrap();
        let rows = engine
            .storage()
            .get_batch(&[property, key("GraphqlUser", "viewer")])
            .await
            .unwrap();
        assert!(rows[0].is_none());
        assert_eq!(
            rows[1].as_ref().unwrap().fields.get("notificationInbox"),
            Some(&history)
        );
    });
}

#[test]
fn shared_options_and_calendar_properties_survive_but_unknown_options_and_database_activity_do_not()
{
    block_on(async {
        let mut storage = InMemoryStorage::new();
        let property = key("GraphqlProperty", "calendar-property");
        let shared = key("GraphqlPropertyOption", "shared-option");
        let definition = key("GraphqlPropertyDefinition", "shared-definition");
        let value = record(&[("name", CacheValue::String("cached value".into()))]);
        storage
            .put_batch(vec![
                (
                    key("GraphqlSoupCalendarEvent", "event"),
                    record(&[(
                        "properties",
                        CacheValue::List(vec![CacheValue::Ref(property.clone())]),
                    )]),
                ),
                (property.clone(), value.clone()),
                (
                    definition,
                    record(&[
                        (
                            "owner",
                            CacheValue::Object(
                                [("scope".into(), CacheValue::String("TEAM".into()))].into(),
                            ),
                        ),
                        (
                            "options",
                            CacheValue::List(vec![CacheValue::Ref(shared.clone())]),
                        ),
                    ]),
                ),
                (shared.clone(), value.clone()),
                (
                    key("GraphqlCrmPipelineColumn", "column"),
                    record(&[(
                        "options",
                        CacheValue::List(vec![CacheValue::Ref(shared.clone())]),
                    )]),
                ),
                (key("GraphqlPropertyOption", "orphan-option"), value.clone()),
                (key("GraphqlSoupDatabaseRow", "orphan-row"), value.clone()),
                (
                    key("GraphqlActivityEvent", "db-activity"),
                    record(&[("entityType", CacheValue::String("DATABASE".into()))]),
                ),
                (
                    key("GraphqlActivityEvent", "doc-activity"),
                    record(&[("entityType", CacheValue::String("DOCUMENT".into()))]),
                ),
            ])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        let initial = engine.current_authority("viewer").await.unwrap();
        transition_crm_authority(
            &mut engine,
            "viewer",
            initial.generation,
            "team:denied".into(),
        )
        .await
        .unwrap();
        let rows = engine
            .storage()
            .get_batch(&[
                property,
                shared,
                key("GraphqlPropertyOption", "orphan-option"),
                key("GraphqlSoupDatabaseRow", "orphan-row"),
                key("GraphqlActivityEvent", "db-activity"),
                key("GraphqlActivityEvent", "doc-activity"),
            ])
            .await
            .unwrap();
        assert_eq!(rows[0], Some(value.clone()));
        assert_eq!(rows[1], Some(value));
        assert!(rows[2..5].iter().all(Option::is_none));
        assert!(rows[5].is_some());
    });
}

#[test]
fn document_favorite_optimism_survives_without_restoring_the_old_mixed_list() {
    block_on(async {
        use cache_core::engine::BeginOptimisticWrite;
        use cache_core::link_patch::{LinkOperation, LinkPathSegment, OptimisticLinkPatch};
        use cache_turso::TursoFileDatabase;
        use predicate_index::{IndexDocument, OptimisticProjectionMutation, Profile, Token};
        let directory = tempfile::tempdir().unwrap();
        let database =
            TursoFileDatabase::new(directory.path().join("favorite-retirement.turso")).unwrap();
        let mut engine = Engine::new(database.open("viewer").unwrap());
        let favorites =
            "query Favorites { user { __typename id favorites { __typename id entityType } } }";
        engine.write_query(None, favorites, Some("Favorites"), &Map::new(), &json!({"user":{"__typename":"GraphqlUser","id":"viewer","favorites":[{"__typename":"GraphqlFavorite","id":"company","entityType":"CRM_COMPANY"}]}}), None).await.unwrap();
        let mutation =
            "mutation Favorite { setFavorite { favorite { __typename id entityType } } }";
        let patch = OptimisticLinkPatch {
            query: favorites.into(),
            record_root: None,
            operation_name: Some("Favorites".into()),
            variables_json: "{}".into(),
            path: vec![
                LinkPathSegment::Field {
                    field: "user".into(),
                },
                LinkPathSegment::Field {
                    field: "favorites".into(),
                },
            ],
            operation: LinkOperation::PrependUnique {
                entity_key: key("GraphqlFavorite", "document"),
            },
        };
        let projection_key = RecordKey::new("GraphqlFavorite:document").unwrap();
        engine
            .begin_optimistic_write_with_projections(
                None,
                BeginOptimisticWrite { task_dependency_recipe: None,
                    uuid: &Uuid::now_v7().to_string(),
                    client_metadata: Some(&json!({"intent":"favorite document"})),
                    query: mutation,
                    operation_name: Some("Favorite"),
                    variables: &Map::new(),
                    data: &json!({"setFavorite":{"favorite":{"__typename":"GraphqlFavorite","id":"document","entityType":"DOCUMENT"}}}),
                    link_patches: &[patch],
                    revalidations: &[],
                    identity_bindings: &[],
                    created_at_ms: 1,
                },
                vec![OptimisticProjectionMutation::Replace(IndexDocument {
                    record_key: projection_key.clone(),
                    profile: Profile::new(Token::new("permission-test").unwrap()),
                    partition: Token::new("favorites").unwrap(),
                    exact_facts: vec![],
                    integer_facts: vec![],
                    sort_facts: vec![],
                })],
            )
            .await
            .unwrap();
        let before = engine.storage().load_mutation_queue().await.unwrap();
        assert!(
            format!("{:?}", before[0].optimistic.normalized_updates)
                .contains("GraphqlFavorite:company")
        );
        let shadows = engine
            .storage()
            .load_optimistic_projections(std::slice::from_ref(&projection_key))
            .await
            .unwrap();
        assert!(shadows[0].is_some());
        let initial = engine.current_authority("profile").await.unwrap();
        transition_crm_authority(
            &mut engine,
            "profile",
            initial.generation,
            "team:denied".into(),
        )
        .await
        .unwrap();
        let after = engine.storage().load_mutation_queue().await.unwrap();
        assert_eq!(before[0].mutation, after[0].mutation);
        assert_eq!(before[0].id, after[0].id);
        assert_eq!(before[0].uuid, after[0].uuid);
        assert_eq!(before[0].superseded, after[0].superseded);
        assert!(
            !format!("{:?}", after[0].optimistic.normalized_updates)
                .contains("GraphqlFavorite:company")
        );
        assert_eq!(
            after[0].optimistic.optimistic_data_json,
            before[0].optimistic.optimistic_data_json
        );
        assert_eq!(
            engine
                .storage()
                .load_optimistic_projections(std::slice::from_ref(&projection_key))
                .await
                .unwrap(),
            shadows
        );
        let source = decode_optimistic_source(&after[0].optimistic.optimistic_data_json).unwrap();
        assert_eq!(
            source.mutation_data["setFavorite"]["favorite"]["entityType"],
            "DOCUMENT"
        );
        assert_eq!(source.link_patches.len(), 1);
        let viewer = engine
            .storage()
            .get_batch(&[key("GraphqlUser", "viewer")])
            .await
            .unwrap();
        assert!(!viewer[0].as_ref().unwrap().fields.contains_key("favorites"));
        assert!(
            engine
                .storage()
                .get_batch(&[key("GraphqlFavorite", "company")])
                .await
                .unwrap()[0]
                .is_none()
        );
        engine.into_storage().try_close().unwrap();
        let mut reopened = Engine::new(database.open("viewer").unwrap());
        reopened.refresh_optimistic_queue().await.unwrap();
        assert_eq!(
            reopened.storage().load_mutation_queue().await.unwrap(),
            after
        );
        assert_eq!(
            reopened
                .storage()
                .load_optimistic_projections(&[projection_key])
                .await
                .unwrap(),
            shadows
        );
        reopened.into_storage().try_close().unwrap();
        directory.close().unwrap();
    });
}

#[test]
fn authored_inspection_recovers_legacy_draft_without_exposing_its_thread_snapshot() {
    block_on(async {
        use cache_core::engine::BeginOptimisticWrite;
        use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
        let mut engine = Engine::new(InMemoryStorage::new());
        let (id, _) = engine.begin_optimistic_write(None, BeginOptimisticWrite { task_dependency_recipe: None, uuid: &Uuid::now_v7().to_string(), client_metadata: None, query: "mutation SaveEmailDraft($input: Input!) { saveEmailDraft(input:$input) { draft { id subject linkId attachmentsDraft { id fileName s3Key } } thread { __typename id name } } }", operation_name: Some("SaveEmailDraft"), variables: json!({"input":{"draftId":"draft","subject":"authored subject","bodyText":"authored reply"}}).as_object().unwrap(), data: &json!({"saveEmailDraft":{"draft":{"id":"draft","subject":"copied draft","linkId":"mailbox","attachmentsDraft":[{"id":"file","fileName":"draft.txt","s3Key":"object"}]},"thread":{"__typename":"GraphqlSoupEmailThread","id":"thread","name":"private thread"}}}), link_patches: &[], revalidations: &[], identity_bindings: &[], created_at_ms: 1 }).await.unwrap();
        let claim = engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "departed-page".into(),
                now_ms: 10,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        let commands = inspect_authored_mutations(&engine).await.unwrap();
        assert_eq!(commands[0].optimistic_data, json!({}));
        assert_eq!(commands[0].variables["input"]["bodyText"], "authored reply");
        assert_eq!(
            commands[0].client_metadata.as_ref().unwrap()["legacyDraftRecovery"]["attachmentsDraft"]
                [0]["s3Key"],
            "object"
        );
        assert!(
            !serde_json::to_string(&commands)
                .unwrap()
                .contains("private thread")
        );
        // Redacting copied content must preserve the lease needed to release
        // a departed page's claim; the engine still requires its exact token.
        let lease = commands[0].lease.as_ref().unwrap();
        assert_eq!(lease.owner, "departed-page");
        assert_eq!(lease.generation, claim.lease_generation.to_string());
        assert_eq!(lease.expires_at_ms, 100);
        let mut token = MutationClaimToken {
            owner: lease.owner.clone(),
            generation: lease.generation.parse().unwrap(),
        };
        token.generation += 1;
        assert!(
            engine
                .defer_optimistic_write(id, token.clone(), 20, "page left".into(), false)
                .await
                .is_err()
        );
        token.generation -= 1;
        engine
            .defer_optimistic_write(id, token, 20, "page left".into(), false)
            .await
            .unwrap();
        let commands = inspect_authored_mutations(&engine).await.unwrap();
        assert!(commands[0].lease.is_none());
        assert_eq!(commands[0].optimistic_data, json!({}));
    });
}

#[test]
fn first_non_denied_proof_preserves_legacy_offline_snapshots() {
    block_on(async {
        for policy in ["team:allowed", "none"] {
            let keys = [
                key("GraphqlSoupEmailThread", "thread"),
                key("GraphqlSoupEmailMessage", "message"),
                key("GraphqlSoupCrmContact", "contact"),
                key("GraphqlUser", "viewer"),
            ];
            let rows = vec![
                record(&[("name", CacheValue::String("offline subject".into()))]),
                record(&[("bodyText", CacheValue::String("offline body".into()))]),
                record(&[("name", CacheValue::String("offline contact".into()))]),
                record(&[("emailThread", CacheValue::Ref(keys[0].clone()))]),
            ];
            let mut storage = InMemoryStorage::new();
            storage
                .put_batch(keys.iter().cloned().zip(rows.iter().cloned()).collect())
                .await
                .unwrap();
            let mut engine = Engine::new(storage);
            let before = engine.current_authority("profile").await.unwrap();
            assert_eq!(before.policy, None);
            let revision = engine.current_revision();
            let allowed =
                transition_crm_authority(&mut engine, "profile", before.generation, policy.into())
                    .await
                    .unwrap();
            assert!(allowed.authority.ready);
            assert_eq!(allowed.revision, revision);
            assert!(allowed.affected_ops.is_empty());
            assert_eq!(
                engine.storage().get_batch(&keys).await.unwrap(),
                rows.into_iter().map(Some).collect::<Vec<_>>()
            );
            assert!(
                engine
                    .snapshot_is_current(Some(allowed.authority.generation))
                    .await
                    .unwrap()
            );
            let denied = transition_crm_authority(
                &mut engine,
                "profile",
                allowed.authority.generation,
                "team:denied".into(),
            )
            .await
            .unwrap();
            assert!(denied.authority.ready);
            assert!(
                engine
                    .storage()
                    .get_batch(&keys[..3])
                    .await
                    .unwrap()
                    .iter()
                    .all(Option::is_none)
            );
        }
    });
}

#[test]
fn changing_or_leaving_a_team_retires_the_previous_scope() {
    block_on(async {
        for policy in ["none", "other-team:allowed"] {
            let mut engine = Engine::new(InMemoryStorage::new());
            let initial = engine.current_authority("profile").await.unwrap();
            let allowed = transition_crm_authority(
                &mut engine,
                "profile",
                initial.generation,
                "team:allowed".into(),
            )
            .await
            .unwrap();
            let contact = key("GraphqlSoupCrmContact", "contact");
            engine
                .put_records_with_projections(
                    None,
                    vec![(
                        contact.clone(),
                        record(&[("name", CacheValue::String("old team".into()))]),
                    )],
                    vec![],
                )
                .await
                .unwrap();
            transition_crm_authority(
                &mut engine,
                "profile",
                allowed.authority.generation,
                policy.into(),
            )
            .await
            .unwrap();
            assert!(engine.storage().get_batch(&[contact]).await.unwrap()[0].is_none());
        }
    });
}

#[test]
fn interrupted_scope_retirement_resumes_before_accepting_the_same_proof() {
    block_on(async {
        for policy in ["other-team:allowed", "none"] {
            let mut engine = Engine::new(InMemoryStorage::new());
            let initial = engine.current_authority("profile").await.unwrap();
            let allowed = transition_crm_authority(
                &mut engine,
                "profile",
                initial.generation,
                "team:allowed".into(),
            )
            .await
            .unwrap();
            let contact = key("GraphqlSoupCrmContact", "old-contact");
            let document = key("GraphqlSoupDocument", "independent");
            let independent = record(&[("name", CacheValue::String("kept".into()))]);
            engine
                .put_records_with_projections(
                    None,
                    vec![
                        (
                            contact.clone(),
                            record(&[("name", CacheValue::String("old team".into()))]),
                        ),
                        (document.clone(), independent.clone()),
                    ],
                    vec![],
                )
                .await
                .unwrap();
            let interrupted = engine
                .begin_authority_transition(
                    "profile",
                    allowed.authority.generation,
                    policy.into(),
                    true,
                )
                .await
                .unwrap();
            assert!(!interrupted.ready);
            // Reopening after interruption retains the new policy and the old
            // records; an identical proof still has to finish the cleanup.
            let mut reopened = Engine::new(engine.into_storage());
            let resumed = transition_crm_authority(
                &mut reopened,
                "profile",
                interrupted.generation,
                policy.into(),
            )
            .await
            .unwrap();
            assert!(resumed.authority.ready);
            assert_eq!(
                reopened
                    .storage()
                    .get_batch(&[contact, document])
                    .await
                    .unwrap(),
                vec![None, Some(independent)]
            );
        }
    });
}
