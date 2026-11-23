use super::*;
mod name_index;
use cache_core::engine::Engine;
use cache_core::predicate::{PredicateIndexStorage, ProjectionMutation};
use pollster::block_on;
#[path = "../../../tests/common/people_sql.rs"]
mod contract;

#[test]
fn facts_use_document_seeks_instead_of_quadratic_attribute_scans() {
    block_on(async {
        let storage = TursoStorage::open_in_memory("local-people-sql").unwrap();
        let mut engine = Engine::new(storage);
        let scope = contract::seed(&mut engine, 20).await;
        let plan = PeopleSqlPlan::compile(
            "SELECT email FROM macro.people WHERE name LIKE 'late%' ORDER BY email",
        )
        .unwrap();
        let connection = engine.storage().connection();
        let rows = driver::query(
            &connection,
            &format!("EXPLAIN QUERY PLAN {}", statement(&plan)),
            vec![Value::Null; plan.parameters().len() + 2],
        )
        .unwrap();
        let details: Vec<_> = rows
            .iter()
            .map(|row| required_text(row, 3).unwrap())
            .collect();
        for (index, _) in plan.attributes().enumerate() {
            let detail = details
                .iter()
                .find(|detail| detail.contains(&format!("f{index} ")))
                .unwrap();
            assert!(
                detail.contains("sqlite_autoindex_exact_facts_1"),
                "{detail}"
            );
            assert!(detail.contains("document_id"), "{detail}");
        }
        contract::contract(engine, &scope, 20).await;
    });
}

#[test]
fn normalized_authority_owns_membership_names_deletes_and_rebuilds() {
    block_on(async {
        let database = crate::TursoMemoryDatabase::new("local-people-sql-lifecycle.db");
        let mut engine = Engine::new(database.open("local-people-sql").unwrap());
        let scope = contract::seed(&mut engine, 20).await;
        let user = "macro|p000000@example.com";
        let key = EntityKey::entity("GraphqlContact", &[&contract::key(contract::VIEWER, user)]);
        let mut storage = engine.into_storage();
        let mut record = storage
            .get_batch(std::slice::from_ref(&key))
            .await
            .unwrap()
            .remove(0)
            .unwrap();
        let connection = storage.connection();
        let before = required_i64(
            &driver::query(&connection, "SELECT total_changes()", vec![]).unwrap()[0],
            0,
        )
        .unwrap();
        record.fields.insert(
            "__contact_search_context_v1".into(),
            CacheValue::opaque(&serde_json::json!({"epoch":"ignored"})),
        );
        storage
            .put_batch(vec![(key.clone(), record.clone())])
            .await
            .unwrap();
        let after = required_i64(
            &driver::query(&connection, "SELECT total_changes()", vec![]).unwrap()[0],
            0,
        )
        .unwrap();
        assert_eq!(
            after - before,
            3,
            "malformed context changes the record/search hash and invalid-context marker, not name/SQL facts"
        );
        let mut changed = record.clone();
        changed
            .fields
            .insert("name".into(), CacheValue::String("Changed".into()));
        // Last-write-wins also holds when the last duplicate matches old facts.
        storage
            .put_batch(vec![(key.clone(), changed), (key.clone(), record.clone())])
            .await
            .unwrap();
        let PeopleSqlResult::Result { outcome } = storage
            .read_people_sql(
                contract::VIEWER,
                &PeopleSqlPlan::identities(&[user.into()]).unwrap(),
            )
            .await
            .unwrap()
        else {
            panic!("unchanged name");
        };
        assert_eq!(
            serde_json::to_value(&outcome.rows[0][1]).unwrap(),
            serde_json::json!({"type":"text","value":"Group1"})
        );
        storage
            .put_batch_with_projections(
                vec![],
                vec![ProjectionMutation::Delete(
                    PredicateRecordKey::new(key.as_ref()).unwrap(),
                )],
            )
            .await
            .unwrap();
        let foreign = EntityKey::entity(
            "GraphqlContact",
            &[&contract::key("macro|other@example.com", user)],
        );
        storage
            .put_batch(vec![
                (foreign, record.clone()),
                (
                    EntityKey::entity("GraphqlUser", &["macro|public@example.com"]),
                    record.clone(),
                ),
                (
                    EntityKey::entity("GraphqlContact", &["context-only"]),
                    Record::default(),
                ),
            ])
            .await
            .unwrap();
        let count = PeopleSqlPlan::compile("SELECT COUNT(*) FROM macro.people").unwrap();
        let PeopleSqlResult::Result { outcome } = storage
            .read_people_sql(contract::VIEWER, &count)
            .await
            .unwrap()
        else {
            panic!("count");
        };
        assert_eq!(
            serde_json::to_value(outcome.rows).unwrap(),
            serde_json::json!([[{"type":"number","value":21.0}]])
        );
        record.fields.remove("name");
        storage
            .put_batch(vec![(key.clone(), record.clone())])
            .await
            .unwrap();
        assert!(matches!(
            storage
                .read_people_sql(contract::VIEWER, &count)
                .await
                .unwrap(),
            PeopleSqlResult::Incomplete
        ));
        record.fields.insert("name".into(), CacheValue::Null);
        storage
            .put_batch(vec![(key.clone(), record.clone())])
            .await
            .unwrap();
        let known = PeopleSqlPlan::identities(&[user.into()]).unwrap();
        let PeopleSqlResult::Result { outcome } = storage
            .read_people_sql(contract::VIEWER, &known)
            .await
            .unwrap()
        else {
            panic!("fallback name");
        };
        assert_eq!(
            serde_json::to_value(&outcome.rows[0][1]).unwrap(),
            serde_json::json!({"type":"text","value":"p000000"})
        );
        storage
            .delete_batch_with_projections(std::slice::from_ref(&key), &[])
            .await
            .unwrap();
        let PeopleSqlResult::Result { outcome } = storage
            .read_people_sql(contract::VIEWER, &known)
            .await
            .unwrap()
        else {
            panic!("deleted");
        };
        assert!(outcome.rows.is_empty());
        driver::write_transaction(&connection, || {
            driver::execute(
                &connection,
                "DELETE FROM meta WHERE key = ?",
                vec![text(VERSION_KEY)],
            )?;
            driver::execute(
                &connection,
                "DELETE FROM index_documents WHERE profile = ?",
                vec![text(projection::PROFILE)],
            )?;
            Ok(())
        })
        .unwrap();
        drop(connection);
        drop(storage);
        let mut engine = Engine::new(database.open("local-people-sql").unwrap());
        assert_eq!(
            engine.current_storage_generation().await.unwrap(),
            scope.storage_generation
        );
        let result = contract::read(&mut engine, &scope, "SELECT COUNT(*) FROM macro.people").await;
        assert_eq!(
            serde_json::to_value(result.rows).unwrap(),
            serde_json::json!([[{"type":"number","value":20.0}]])
        );
    });
}

#[test]
fn oversized_projection_and_results_refuse_without_poisoning_storage() {
    block_on(async {
        let mut engine = Engine::new(TursoStorage::open_in_memory("local-people-sql").unwrap());
        contract::seed(&mut engine, 20).await;
        let mut storage = engine.into_storage();
        let key = EntityKey::entity(
            "GraphqlContact",
            &[&contract::key(contract::VIEWER, contract::VIEWER)],
        );
        let mut record = storage
            .get_batch(std::slice::from_ref(&key))
            .await
            .unwrap()
            .remove(0)
            .unwrap();
        let count = PeopleSqlPlan::compile("SELECT COUNT(*) FROM macro.people").unwrap();
        for name in ["x".repeat(16385), "nul\0name".into()] {
            record
                .fields
                .insert("name".into(), CacheValue::String(name));
            storage
                .put_batch(vec![(key.clone(), record.clone())])
                .await
                .unwrap();
            assert!(matches!(
                storage
                    .read_people_sql(contract::VIEWER, &count)
                    .await
                    .unwrap(),
                PeopleSqlResult::Incomplete
            ));
        }
        record
            .fields
            .insert("name".into(), CacheValue::String("x".repeat(16384)));
        storage.put_batch(vec![(key, record)]).await.unwrap();
        let columns = std::iter::repeat_n("name", 64)
            .collect::<Vec<_>>()
            .join(",");
        let wide = PeopleSqlPlan::compile(&format!(
            "SELECT {columns} FROM macro.people WHERE email = 'viewer@example.com'"
        ))
        .unwrap();
        assert!(matches!(
            storage
                .read_people_sql(contract::VIEWER, &wide)
                .await
                .unwrap(),
            PeopleSqlResult::ResultTooLarge
        ));
        assert!(matches!(
            storage
                .read_people_sql(contract::VIEWER, &count)
                .await
                .unwrap(),
            PeopleSqlResult::Result { .. }
        ));
    });
}
