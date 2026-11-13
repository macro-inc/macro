use cache_core::{
    engine::{Engine, EngineError, HydrationScope, NetworkWrite},
    people::{
        ContextAction, ContextUpdate, PersonFactPatch, PersonFacts,
        sync::{ContactReconcile, ContactScan, ContactSnapshotRequest},
    },
    store::Storage,
    value::EntityKey,
};
use serde_json::json;
use uuid::Uuid;

const VIEWER: &str = "macro|viewer@example.com";
const PERSON: &str = "macro|person@example.com";
/// Enumerate and verify a large corpus in bounded keyset windows. Deleting one
/// tenth must not skip the following keys or leave stale relational projections.
pub async fn verify<S: Storage>(
    mut engine: Engine<S>,
    scope: &HydrationScope,
    total: usize,
) -> Engine<S> {
    let mut after = None;
    let mut visited = 0;
    let mut windows = 0;
    loop {
        let page = engine
            .contact_snapshot(&ContactSnapshotRequest {
                scope: scope.clone(),
                scan: Some(ContactScan {
                    after: after.clone(),
                    limit: 500,
                }),
            })
            .await
            .unwrap();
        assert!(page.ids.len() <= 500);
        assert!(!page.incomplete);
        visited += page.ids.len();
        windows += 1;
        let present = page
            .ids
            .iter()
            .filter(|id| !id.email_str().ends_with("9@example.com"))
            .cloned()
            .collect();
        engine
            .reconcile_contacts(&ContactReconcile {
                scope: scope.clone(),
                fence: page.fence,
                viewer: scope.identity.clone(),
                requested: page.ids,
                present,
            })
            .await
            .unwrap();
        after = page.next_cursor;
        if after.is_none() {
            break;
        }
    }
    assert_eq!(visited, total + 1);
    assert_eq!(windows, (total + 1).div_ceil(500));
    let result = engine
        .read_people_sql(&cache_core::people::sql::PeopleSqlRequest {
            scope: scope.clone(),
            input: cache_core::people::sql::PeopleSqlInput::Statement {
                sql: "SELECT COUNT(*) FROM macro.people".into(),
            },
        })
        .await
        .unwrap();
    let cache_core::people::sql::PeopleSqlResult::Result { outcome } = result else {
        panic!("local count");
    };
    assert_eq!(
        serde_json::to_value(outcome.rows).unwrap(),
        json!([[{"type":"number","value":(total + 1 - total / 10) as f64}]])
    );
    engine
}

const DOCUMENT: &str =
    "{ user { id contacts(limit: 500) { nodes { __typename id userId name email } nextCursor } } }";

/// Shared native/OPFS correctness scenario, including a preserved engine restart.
pub async fn contract<S: Storage>(storage: S) -> S {
    let mut engine = Engine::with_capacity(storage, 16);
    let mut scope = HydrationScope {
        identity: VIEWER.into(),
        storage_generation: engine.current_storage_generation().await.unwrap(),
        contact_fence: None,
    };
    let key = Uuid::new_v5(
        &Uuid::new_v5(&Uuid::NAMESPACE_OID, VIEWER.as_bytes()),
        PERSON.as_bytes(),
    )
    .to_string();
    let data = json!({"user":{"id":VIEWER,"contacts":{"nodes":[{"__typename":"GraphqlContact","id":key,"userId":PERSON,"email":"person@example.com","name":"Private name"}],"nextCursor":null}}});
    let variables = serde_json::Map::new();
    let write = NetworkWrite {
        query: DOCUMENT,
        operation_name: None,
        variables: &variables,
        data: &data,
        identity: Some(VIEWER),
    };
    assert!(matches!(
        engine.hydrate_query_in_scope(write, &scope, vec![]).await,
        Err(EngineError::UnfencedContactWrite)
    ));
    let capture = engine
        .contact_snapshot(&ContactSnapshotRequest {
            scope: scope.clone(),
            scan: None,
        })
        .await
        .unwrap();
    assert!(
        engine.current_identity().await.unwrap().is_none(),
        "capturing admission cannot bind an account"
    );
    scope.contact_fence = Some(capture.fence);
    engine
        .hydrate_query_in_scope(write, &scope, vec![])
        .await
        .unwrap();
    let snapshot = engine
        .contact_snapshot(&ContactSnapshotRequest {
            scope: scope.clone(),
            scan: Some(ContactScan {
                after: None,
                limit: 500,
            }),
        })
        .await
        .unwrap();
    assert_eq!(
        snapshot
            .ids
            .iter()
            .map(|id| id.as_ref())
            .collect::<Vec<_>>(),
        [PERSON]
    );
    assert!(!snapshot.incomplete);
    assert!(snapshot.next_cursor.is_none());
    scope.contact_fence = Some(snapshot.fence);
    let absent = ContactReconcile {
        scope: scope.clone(),
        fence: snapshot.fence,
        viewer: VIEWER.into(),
        requested: snapshot.ids.clone(),
        present: vec![],
    };
    // Identical authoritative values still invalidate earlier negative evidence.
    engine
        .hydrate_query_in_scope(write, &scope, vec![])
        .await
        .unwrap();
    assert!(matches!(
        engine.reconcile_contacts(&absent).await,
        Err(EngineError::StaleContactFence)
    ));
    let fresh = engine
        .contact_snapshot(&ContactSnapshotRequest {
            scope: scope.clone(),
            scan: None,
        })
        .await
        .unwrap();
    let absent = ContactReconcile {
        fence: fresh.fence,
        ..absent
    };
    scope.contact_fence = Some(fresh.fence);
    let removed = engine.reconcile_contacts(&absent).await.unwrap();
    assert_eq!(removed.changed.len(), 1);
    assert_eq!(
        removed
            .search_changed_buckets
            .unwrap()
            .into_iter()
            .collect::<Vec<_>>(),
        ["person"]
    );
    assert!(
        engine
            .storage()
            .get_batch(&[EntityKey::entity("GraphqlContact", &[&key])])
            .await
            .unwrap()[0]
            .is_none()
    );
    assert!(
        matches!(
            engine.hydrate_query_in_scope(write, &scope, vec![]).await,
            Err(EngineError::StaleContactFence)
        ),
        "late hydration cannot restore a verified removal"
    );
    assert!(matches!(
        engine
            .hydrate_query(DOCUMENT, None, &variables, &data, Some(VIEWER))
            .await,
        Err(EngineError::UnfencedContactWrite)
    ));
    // Local context is not membership and does not invalidate contact authority.
    let before = engine
        .contact_snapshot(&ContactSnapshotRequest {
            scope: scope.clone(),
            scan: None,
        })
        .await
        .unwrap();
    let epoch = Uuid::now_v7();
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
    engine
        .update_people_context(&ContextUpdate {
            scope: scope.clone(),
            epoch,
            action: ContextAction::Patch {
                updates: vec![PersonFactPatch {
                    user_id: PERSON.try_into().unwrap(),
                    facts: PersonFacts::default(),
                }],
            },
        })
        .await
        .unwrap();
    let after = engine
        .contact_snapshot(&ContactSnapshotRequest {
            scope: scope.clone(),
            scan: Some(ContactScan {
                after: None,
                limit: 500,
            }),
        })
        .await
        .unwrap();
    assert!(after.ids.is_empty());
    assert_eq!(before.fence, after.fence);
    // A fresh authorized read can re-add membership; a saved old request cannot.
    scope.contact_fence = Some(after.fence);
    engine
        .hydrate_query_in_scope(write, &scope, vec![])
        .await
        .unwrap();
    let before_restart = engine
        .contact_snapshot(&ContactSnapshotRequest {
            scope: scope.clone(),
            scan: None,
        })
        .await
        .unwrap();
    scope.contact_fence = Some(before_restart.fence);
    let mut engine = Engine::new(engine.into_storage());
    assert_eq!(
        engine.current_storage_generation().await.unwrap(),
        scope.storage_generation
    );
    assert!(matches!(
        engine.hydrate_query_in_scope(write, &scope, vec![]).await,
        Err(EngineError::StaleContactFence)
    ));
    let fresh = engine
        .contact_snapshot(&ContactSnapshotRequest {
            scope: scope.clone(),
            scan: None,
        })
        .await
        .unwrap();
    for request in [
        ContactReconcile {
            scope: scope.clone(),
            fence: fresh.fence,
            viewer: "macro|other@example.com".into(),
            requested: vec![PERSON.try_into().unwrap()],
            present: vec![],
        },
        ContactReconcile {
            scope: scope.clone(),
            fence: fresh.fence,
            viewer: VIEWER.into(),
            requested: vec![VIEWER.try_into().unwrap()],
            present: vec![],
        },
        ContactReconcile {
            scope: scope.clone(),
            fence: fresh.fence,
            viewer: VIEWER.into(),
            requested: vec![PERSON.try_into().unwrap()],
            present: vec![VIEWER.try_into().unwrap()],
        },
    ] {
        assert!(engine.reconcile_contacts(&request).await.is_err());
    }
    let all_present = ContactReconcile {
        scope: scope.clone(),
        fence: fresh.fence,
        viewer: VIEWER.into(),
        requested: vec![PERSON.try_into().unwrap()],
        present: vec![PERSON.try_into().unwrap()],
    };
    assert!(
        engine
            .reconcile_contacts(&all_present)
            .await
            .unwrap()
            .changed
            .is_empty()
    );
    assert!(matches!(
        engine
            .reconcile_contacts(&ContactReconcile {
                present: vec![],
                ..all_present
            })
            .await,
        Err(EngineError::StaleContactFence)
    ));
    engine.into_storage()
}
