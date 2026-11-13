//! A noise notification never contributes to its parent's notification state.

use super::*;

const UPDATE_WITH_LANE: &str = r#"mutation Update($input: UpdateNotificationsInput!) { updateNotifications(input: $input) { id entityId entityType state lane } }"#;
const SNAPSHOT_WITH_LANE: &str = r#"query Snapshot { user { id soup(input: { initial: { limit: 20 } }) { items { __typename id cacheProjection notifications { id entityId entityType state lane } ... on GraphqlSoupDocument { ownerId projectId fileType subType { __typename } createdAt updatedAt } } } } }"#;

fn in_lane(id: &str, state: &str, lane: &str) -> Value {
    let mut notification = notification(id, state);
    notification["lane"] = json!(lane);
    notification
}

async fn noise_stays_out_of_its_parents_state<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    write(&mut engine, SNAPSHOT, &snapshot(vec![])).await;

    // What the Noise inbox returns: an unseen noise notification on a
    // document other lists already hold.
    write(
        &mut engine,
        UPDATE_WITH_LANE,
        &json!({"updateNotifications":[in_lane(A, "UNSEEN", "NOISE")]}),
    )
    .await;
    assert!(!matches(&mut engine, unseen()).await);

    // Marking it seen answers with the state alone; the stored lane still applies.
    write(
        &mut engine,
        UPDATE,
        &json!({"updateNotifications":[{"__typename":"GraphqlNotification", "id":A, "state":"SEEN"}]}),
    )
    .await;
    assert!(!matches(&mut engine, seen()).await);

    // A signal notification on the same document counts as before.
    write(
        &mut engine,
        UPDATE_WITH_LANE,
        &json!({"updateNotifications":[in_lane(B, "UNSEEN", "SIGNAL")]}),
    )
    .await;
    assert!(matches(&mut engine, unseen()).await);
}

#[test]
fn noise_stays_out_of_its_parents_state_in_memory() {
    pollster::block_on(noise_stays_out_of_its_parents_state(InMemoryStorage::new()));
}

#[test]
fn noise_stays_out_of_its_parents_state_real_turso() {
    pollster::block_on(async {
        noise_stays_out_of_its_parents_state(
            cache_turso::TursoStorage::open_in_memory("notification-lane").unwrap(),
        )
        .await
    });
}

#[test]
fn a_parents_snapshot_ignores_noise() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());

        write(
            &mut engine,
            SNAPSHOT_WITH_LANE,
            &snapshot(vec![
                in_lane(A, "UNSEEN", "NOISE"),
                in_lane(B, "SEEN", "SIGNAL"),
            ]),
        )
        .await;

        assert!(!matches(&mut engine, unseen()).await);
        assert!(matches(&mut engine, seen()).await);
    });
}
