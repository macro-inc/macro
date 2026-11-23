use cache_core::engine::{Engine, EngineError, HydrationScope, NetworkWrite};
use cache_core::people::sync::{ContactReconcile, ContactScan, ContactSnapshotRequest};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{EntityKey, Record};
use pollster::block_on;
use serde_json::json;
use uuid::Uuid;

#[test]
fn in_memory_verification_preserves_empty_continuations_and_rejects_old_hydration() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        // Context-only keys precede the member. The scan budget is raw rows,
        // not successful membership decodes, so an empty window must continue.
        storage
            .put_batch(
                (0..501)
                    .map(|index| {
                        (
                            EntityKey::entity(
                                "GraphqlContact",
                                &[&format!("00000000-0000-0000-0000-{index:012}")],
                            ),
                            Record::default(),
                        )
                    })
                    .collect(),
            )
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        let viewer = "macro|viewer@example.com";
        let user = "macro|person@example.com";
        let mut scope = HydrationScope {
            identity: viewer.into(),
            storage_generation: engine.current_storage_generation().await.unwrap(),
            contact_fence: None,
        };
        scope.contact_fence = Some(
            engine
                .contact_snapshot(&ContactSnapshotRequest {
                    scope: scope.clone(),
                    scan: None,
                })
                .await
                .unwrap()
                .fence,
        );
        assert_eq!(engine.current_identity().await.unwrap(), None);
        let id = Uuid::new_v5(
            &Uuid::new_v5(&Uuid::NAMESPACE_OID, viewer.as_bytes()),
            user.as_bytes(),
        )
        .to_string();
        let variables = json!({});
        let data = json!({"user":{"id":viewer,"contacts":{"nodes":[{"id":id,"userId":user,"name":"Member","email":"person@example.com"}],"nextCursor":null}}});
        let write = NetworkWrite {
            query: "{ user { id contacts(limit: 500) { nodes { id userId name email } nextCursor } } }",
            operation_name: None,
            variables: variables.as_object().unwrap(),
            data: &data,
            identity: Some(viewer),
        };
        engine
            .hydrate_query_in_scope(write, &scope, vec![])
            .await
            .unwrap();
        let first = engine
            .contact_snapshot(&ContactSnapshotRequest {
                scope: scope.clone(),
                scan: Some(ContactScan {
                    after: None,
                    limit: 500,
                }),
            })
            .await
            .unwrap();
        assert!(first.ids.is_empty());
        assert!(!first.incomplete);
        assert!(first.next_cursor.is_some());
        let last = engine
            .contact_snapshot(&ContactSnapshotRequest {
                scope: scope.clone(),
                scan: Some(ContactScan {
                    after: first.next_cursor,
                    limit: 500,
                }),
            })
            .await
            .unwrap();
        assert_eq!(last.ids.len(), 1);
        assert!(last.next_cursor.is_none());
        scope.contact_fence = Some(last.fence);
        engine
            .reconcile_contacts(&ContactReconcile {
                scope: scope.clone(),
                fence: last.fence,
                viewer: viewer.into(),
                requested: last.ids,
                present: vec![],
            })
            .await
            .unwrap();
        assert!(matches!(
            engine.hydrate_query_in_scope(write, &scope, vec![]).await,
            Err(EngineError::StaleContactFence)
        ));
        assert!(
            engine
                .storage()
                .get_batch(&[EntityKey::entity("GraphqlContact", &[&id])])
                .await
                .unwrap()[0]
                .is_none()
        );
    });
}
