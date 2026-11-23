use super::*;
use cache_core::people::name_search::projection as names;
use cache_core::people::{ContextAction, ContextUpdate, PersonFactPatch, PersonFacts};

#[test]
fn activity_and_name_deltas_preserve_unrelated_fact_rows() {
    block_on(async {
        let mut engine = Engine::new(TursoStorage::open_in_memory("name-fact-deltas").unwrap());
        let scope = contract::seed(&mut engine, 20).await;
        let user = "macro|p000000@example.com";
        let key = EntityKey::entity("GraphqlContact", &[&contract::key(contract::VIEWER, user)]);
        let connection = engine.storage().connection();
        let id = required_i64(
            &driver::query(&connection, INDEX_DOCUMENT_ID, vec![text(key.as_ref())]).unwrap()[0],
            0,
        )
        .unwrap();
        let words_before=driver::query(&connection,"SELECT rowid,value FROM exact_facts WHERE document_id=? AND attribute=? ORDER BY value",vec![Value::from_i64(id),text(names::WORD)]).unwrap();
        let epoch = uuid::Uuid::from_u128(12);
        engine
            .update_people_context(&ContextUpdate {
                scope: scope.clone(),
                epoch,
                action: ContextAction::Begin {
                    previous_epoch: None,
                },
            })
            .await
            .unwrap();
        for time in [10, 20] {
            engine
                .update_people_context(&ContextUpdate {
                    scope: scope.clone(),
                    epoch,
                    action: ContextAction::Patch {
                        updates: vec![PersonFactPatch {
                            user_id: user.try_into().unwrap(),
                            facts: PersonFacts {
                                last_interaction_ms: Some(time),
                                secondary_inbox: true,
                                direct_message: None,
                            },
                        }],
                    },
                })
                .await
                .unwrap();
            let words_after=driver::query(&connection,"SELECT rowid,value FROM exact_facts WHERE document_id=? AND attribute=? ORDER BY value",vec![Value::from_i64(id),text(names::WORD)]).unwrap();
            assert_eq!(words_before, words_after);
        }
        let ranks_before = driver::query(
            &connection,
            "SELECT rowid,value FROM exact_facts WHERE document_id=? AND attribute=?",
            vec![Value::from_i64(id), text(names::USER_RANK)],
        )
        .unwrap();
        assert_eq!(ranks_before.len(), 1);
        assert_eq!(
            required_blob(&ranks_before[0], 1).unwrap(),
            cache_core::people::name_search::RecentKey::new(Some(20), &user.try_into().unwrap())
                .in_epoch(epoch)
        );
        let mut storage = engine.into_storage();
        let mut record = storage
            .get_batch(std::slice::from_ref(&key))
            .await
            .unwrap()
            .remove(0)
            .unwrap();
        record
            .fields
            .insert("name".into(), CacheValue::String("Updated User".into()));
        storage
            .put_batch(vec![(key.clone(), record)])
            .await
            .unwrap();
        assert_eq!(
            ranks_before,
            driver::query(
                &connection,
                "SELECT rowid,value FROM exact_facts WHERE document_id=? AND attribute=?",
                vec![Value::from_i64(id), text(names::USER_RANK)]
            )
            .unwrap()
        );
        let words = driver::query(
            &connection,
            "SELECT value FROM exact_facts WHERE document_id=? AND attribute=? ORDER BY value",
            vec![Value::from_i64(id), text(names::WORD)],
        )
        .unwrap();
        assert_eq!(
            words,
            vec![
                vec![Value::from_blob(b"updated".to_vec())],
                vec![Value::from_blob(b"user".to_vec())]
            ]
        );
        storage.delete_batch(&[key]).await.unwrap();
        assert!(
            driver::query(
                &connection,
                "SELECT 1 FROM exact_facts WHERE document_id=?",
                vec![Value::from_i64(id)]
            )
            .unwrap()
            .is_empty()
        );
    });
}

#[test]
fn failed_fact_delta_rolls_back_deleted_words_and_record_values() {
    block_on(async {
        let mut engine = Engine::new(TursoStorage::open_in_memory("name-delta-failure").unwrap());
        contract::seed(&mut engine, 2).await;
        let key = EntityKey::entity(
            "GraphqlContact",
            &[&contract::key(
                contract::VIEWER,
                "macro|p000000@example.com",
            )],
        );
        let mut storage = engine.into_storage();
        let original = storage
            .get_batch(std::slice::from_ref(&key))
            .await
            .unwrap()
            .remove(0)
            .unwrap();
        let connection = storage.connection();
        let id = required_i64(
            &driver::query(&connection, INDEX_DOCUMENT_ID, vec![text(key.as_ref())]).unwrap()[0],
            0,
        )
        .unwrap();
        let before = driver::query(
            &connection,
            "SELECT attribute,value FROM exact_facts WHERE document_id=? ORDER BY attribute,value",
            vec![Value::from_i64(id)],
        )
        .unwrap();
        let mut changed = original.clone();
        changed.fields.insert(
            "name".into(),
            CacheValue::String("Replacement label".into()),
        );
        driver::arm_reset_failure(EXACT_FACT_INSERT);
        assert!(
            storage
                .put_batch(vec![(key.clone(), changed)])
                .await
                .is_err()
        );
        let after = driver::query(
            &connection,
            "SELECT attribute,value FROM exact_facts WHERE document_id=? ORDER BY attribute,value",
            vec![Value::from_i64(id)],
        )
        .unwrap();
        assert_eq!(after, before);
        let rows = driver::query(
            &connection,
            RECORD_GET,
            vec![text("GraphqlContact"), text(key.id().unwrap())],
        )
        .unwrap();
        assert_eq!(
            decode_record(&required_blob(&rows[0], 0).unwrap()).unwrap(),
            original
        );
    });
}

#[test]
fn prior_projection_rebuild_preserves_authority_generation_and_queue() {
    block_on(async {
        let database = crate::TursoMemoryDatabase::new("name-fact-upgrade.db");
        let mut engine = Engine::new(database.open("scope").unwrap());
        let scope = contract::seed(&mut engine, 20).await;
        let mut storage = engine.into_storage();
        storage
            .enqueue_mutation(crate::storage::test::queued("Preserved"))
            .await
            .unwrap();
        let queued = storage.load_mutation_queue().await.unwrap();
        let connection = storage.connection();
        driver::execute(
            &connection,
            "UPDATE meta SET value=? WHERE key=?",
            vec![
                text(&format!("1:{}", projection::partition(contract::VIEWER))),
                text(VERSION_KEY),
            ],
        )
        .unwrap();
        driver::execute(
            &connection,
            "DELETE FROM exact_facts WHERE attribute LIKE 'people_%'",
            vec![],
        )
        .unwrap();
        drop(connection);
        storage.try_close().unwrap();
        let storage = database.open("scope").unwrap();
        assert_eq!(storage.load_mutation_queue().await.unwrap(), queued);
        let connection = storage.connection();
        assert_eq!(
            required_i64(
                &driver::query(
                    &connection,
                    "SELECT COUNT(*) FROM exact_facts WHERE attribute=?",
                    vec![text(names::DEFAULT_RANK)]
                )
                .unwrap()[0],
                0
            )
            .unwrap(),
            21
        );
        assert_eq!(
            required_text(
                &driver::query(
                    &connection,
                    "SELECT value FROM meta WHERE key=?",
                    vec![text(VERSION_KEY)]
                )
                .unwrap()[0],
                0
            )
            .unwrap(),
            stamp(Some(contract::VIEWER))
        );
        let mut engine = Engine::new(storage);
        assert_eq!(
            engine.current_storage_generation().await.unwrap(),
            scope.storage_generation
        );
    });
}
