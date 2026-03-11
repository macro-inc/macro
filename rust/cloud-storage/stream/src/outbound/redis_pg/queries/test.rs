use super::*;
use model_entity::EntityType;
use sqlx::PgPool;

fn stream_id(entity_id: &str, stream: &str) -> StreamId {
    StreamId {
        entity_type: EntityType::Chat,
        entity_id: entity_id.to_string(),
        stream_id: stream.to_string(),
    }
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
