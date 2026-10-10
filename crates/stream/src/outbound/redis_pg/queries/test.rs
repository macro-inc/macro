use super::*;
use model_entity::EntityType;
use sqlx::PgPool;

const REPLAY_WINDOW: Duration = Duration::from_secs(45);
/// A window short enough for a test to wait out.
const SHORT_WINDOW: Duration = Duration::from_millis(200);

fn stream_id(entity_id: &str, stream: &str) -> StreamId {
    StreamId {
        entity_type: EntityType::Chat,
        entity_id: entity_id.to_string(),
        stream_id: stream.to_string(),
    }
}

/// Let streams closed before this call fall outside `SHORT_WINDOW`.
async fn wait_out_short_window() {
    tokio::time::sleep(SHORT_WINDOW * 2).await;
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_insert_and_get(pool: PgPool) {
    let id_a = stream_id("entity_1", "stream_a");
    let id_b = stream_id("entity_1", "stream_b");

    insert_active_stream(&pool, &id_a).await.unwrap();
    insert_active_stream(&pool, &id_b).await.unwrap();

    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert_eq!(keys.len(), 2);
    assert!(keys.contains(&id_a.to_string()));
    assert!(keys.contains(&id_b.to_string()));
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_insert_conflict_is_noop(pool: PgPool) {
    let id = stream_id("entity_1", "stream_a");

    insert_active_stream(&pool, &id).await.unwrap();
    // Duplicate insert should succeed (ON CONFLICT DO NOTHING)
    insert_active_stream(&pool, &id).await.unwrap();

    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert_eq!(keys.len(), 1);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_delete(pool: PgPool) {
    let id_a = stream_id("entity_1", "stream_a");
    let id_b = stream_id("entity_1", "stream_b");

    insert_active_stream(&pool, &id_a).await.unwrap();
    insert_active_stream(&pool, &id_b).await.unwrap();

    delete_active_stream(&pool, &id_a).await.unwrap();

    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert_eq!(keys, vec![id_b.to_string()]);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_delete_nonexistent_is_noop(pool: PgPool) {
    let id = stream_id("entity_1", "does_not_exist");
    delete_active_stream(&pool, &id).await.unwrap();
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_get_empty(pool: PgPool) {
    let keys = get_active_stream_keys(&pool, "no_such_entity")
        .await
        .unwrap();
    assert!(keys.is_empty());
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_get_filters_by_entity(pool: PgPool) {
    let id_1 = stream_id("entity_1", "stream_a");
    let id_2 = stream_id("entity_2", "stream_b");

    insert_active_stream(&pool, &id_1).await.unwrap();
    insert_active_stream(&pool, &id_2).await.unwrap();

    let keys_1 = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert_eq!(keys_1, vec![id_1.to_string()]);

    let keys_2 = get_active_stream_keys(&pool, "entity_2").await.unwrap();
    assert_eq!(keys_2, vec![id_2.to_string()]);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_closed_stream_is_not_active_but_still_replayable(pool: PgPool) {
    let open = stream_id("entity_1", "open");
    let closed = stream_id("entity_1", "closed");

    insert_active_stream(&pool, &open).await.unwrap();
    insert_active_stream(&pool, &closed).await.unwrap();
    mark_stream_closed(&pool, &closed).await.unwrap();

    let active = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert_eq!(active, vec![open.to_string()]);

    let mut replayable = get_replayable_stream_keys(&pool, "entity_1", REPLAY_WINDOW)
        .await
        .unwrap();
    replayable.sort();
    let mut expected = vec![open.to_string(), closed.to_string()];
    expected.sort();
    assert_eq!(replayable, expected);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_stream_closed_outside_window_is_not_replayable(pool: PgPool) {
    let stale = stream_id("entity_1", "stale");
    let recent = stream_id("entity_1", "recent");

    insert_active_stream(&pool, &stale).await.unwrap();
    insert_active_stream(&pool, &recent).await.unwrap();
    mark_stream_closed(&pool, &stale).await.unwrap();
    wait_out_short_window().await;
    mark_stream_closed(&pool, &recent).await.unwrap();

    let replayable = get_replayable_stream_keys(&pool, "entity_1", SHORT_WINDOW)
        .await
        .unwrap();
    assert_eq!(replayable, vec![recent.to_string()]);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_purge_removes_only_streams_closed_before_cutoff(pool: PgPool) {
    let open = stream_id("entity_1", "open");
    let recent = stream_id("entity_1", "recent");
    let stale = stream_id("entity_1", "stale");

    for id in [&open, &recent, &stale] {
        insert_active_stream(&pool, id).await.unwrap();
    }
    mark_stream_closed(&pool, &stale).await.unwrap();
    wait_out_short_window().await;
    mark_stream_closed(&pool, &recent).await.unwrap();

    let purged = purge_closed_streams(&pool, SHORT_WINDOW).await.unwrap();
    assert_eq!(purged, 1);

    let mut remaining = get_replayable_stream_keys(&pool, "entity_1", REPLAY_WINDOW)
        .await
        .unwrap();
    remaining.sort();
    let mut expected = vec![open.to_string(), recent.to_string()];
    expected.sort();
    assert_eq!(remaining, expected);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_mark_closed_nonexistent_is_noop(pool: PgPool) {
    let id = stream_id("entity_1", "does_not_exist");
    mark_stream_closed(&pool, &id).await.unwrap();
    assert!(
        get_replayable_stream_keys(&pool, "entity_1", REPLAY_WINDOW)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_full_lifecycle(pool: PgPool) {
    let id_a = stream_id("entity_1", "stream_a");
    let id_b = stream_id("entity_1", "stream_b");

    // Start empty
    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert!(keys.is_empty());

    // Insert two streams
    insert_active_stream(&pool, &id_a).await.unwrap();
    insert_active_stream(&pool, &id_b).await.unwrap();

    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert_eq!(keys.len(), 2);

    // Close one stream
    delete_active_stream(&pool, &id_a).await.unwrap();

    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert_eq!(keys, vec![id_b.to_string()]);

    // Close the other
    delete_active_stream(&pool, &id_b).await.unwrap();

    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert!(keys.is_empty());
}
