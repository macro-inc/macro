use super::*;

const MEMBER_COUNT: u128 = 1_024;

fn member_id(index: u128) -> String {
    uuid::Uuid::from_u128(index + 1000).to_string()
}

fn large_snapshot() -> Value {
    let mut notifications = (1..=MEMBER_COUNT)
        .map(|id| notification(&member_id(id), "SEEN"))
        .collect::<Vec<_>>();
    notifications.extend([notification(A, "UNSEEN"), notification(B, "UNSEEN")]);
    snapshot(notifications)
}

async fn large_set_lifecycle<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    write(&mut engine, SNAPSHOT, &large_snapshot()).await;
    assert!(matches(&mut engine, unseen()).await);
    assert!(matches(&mut engine, seen()).await);

    let data = json!({"updateNotifications": (1..=MEMBER_COUNT).map(|id| json!({
        "__typename": "GraphqlNotification", "id": member_id(id), "state": "DONE"
    })).collect::<Vec<_>>()});
    let vars = variables();
    let edits = notification_projection_updates(engine.storage(), UPDATE, None, &vars, &data)
        .await
        .unwrap();
    let [ProjectionMutation::PatchExact { remove, insert, .. }] = edits.as_slice() else {
        panic!("bulk updates compose the parent once");
    };
    assert_eq!(remove.len(), MEMBER_COUNT as usize * 2);
    assert!(insert.is_empty());
    let (bulk, _) = engine
        .begin_optimistic_write_with_projections(
            None,
            BeginOptimisticWrite {
                uuid: "00000000-0000-0000-0000-000000000101",
                query: UPDATE,
                operation_name: None,
                variables: &vars,
                data: &data,
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 1,
            },
            optimistic_notification_updates(edits).unwrap(),
        )
        .await
        .unwrap();
    let single = mark_done(&mut engine, A, "00000000-0000-0000-0000-000000000102").await;
    assert!(!matches(&mut engine, seen()).await);
    assert!(matches(&mut engine, unseen()).await, "B is still unseen");

    let mut engine = Engine::new(engine.into_storage());
    assert!(
        !matches(&mut engine, seen()).await,
        "pending bulk edit survives reopen"
    );
    let token = claim(&mut engine, bulk).await;
    engine.rollback_optimistic_write(bulk, token).await.unwrap();
    assert!(
        matches(&mut engine, seen()).await,
        "rollback restores all seen members"
    );

    // A remains optimistically done while B changes through realtime.
    write(
        &mut engine,
        UPDATE,
        &json!({"updateNotifications":[notification(B, "SEEN")]}),
    )
    .await;
    assert!(!matches(&mut engine, unseen()).await);
    // A full refresh rebases, rather than replacing, the pending removal of A.
    write(&mut engine, SNAPSHOT, &large_snapshot()).await;
    assert!(matches(&mut engine, unseen()).await);
    write(
        &mut engine,
        UPDATE,
        &json!({"updateNotifications":[notification(B, "SEEN")]}),
    )
    .await;
    assert!(
        !matches(&mut engine, unseen()).await,
        "refresh must not resurrect A"
    );

    let token = claim(&mut engine, single).await;
    let settled = json!({"updateNotifications":[notification(A, "DONE")]});
    let edits = notification_projection_updates(engine.storage(), UPDATE, None, &vars, &settled)
        .await
        .unwrap();
    engine
        .commit_optimistic_write_with_projections(
            single, token, UPDATE, None, &vars, &settled, edits,
        )
        .await
        .unwrap();

    let keys = (1..=MEMBER_COUNT)
        .map(|id| format!("GraphqlNotification:{}", member_id(id)))
        .collect::<Vec<_>>();
    let edits = notification_deletion_updates(engine.storage(), &keys, false)
        .await
        .unwrap();
    assert_eq!(
        edits.len(),
        1,
        "bulk deletions also compose the parent once"
    );
    let keys = keys
        .into_iter()
        .map(|key| EntityKey(key.into()))
        .collect::<Vec<_>>();
    engine
        .delete_keys_with_projection_changes(&keys, edits)
        .await
        .unwrap();
    assert!(
        matches(&mut engine, seen()).await,
        "B remains after unrelated members are deleted"
    );
    write(
        &mut engine,
        UPDATE,
        &json!({"updateNotifications":[notification(B, "DONE")]}),
    )
    .await;
    assert!(!matches(&mut engine, seen()).await);
    assert!(!matches(&mut engine, unseen()).await);
}

#[test]
fn large_notification_lifecycle_in_memory() {
    pollster::block_on(large_set_lifecycle(InMemoryStorage::new()));
}

#[test]
fn large_notification_lifecycle_in_turso() {
    pollster::block_on(async {
        large_set_lifecycle(
            cache_turso::TursoStorage::open_in_memory("large-notifications").unwrap(),
        )
        .await
    });
}
