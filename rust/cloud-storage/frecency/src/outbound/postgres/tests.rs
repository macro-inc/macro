use crate::domain::models::{AggregateId, FrecencyData};

use super::*;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::{EntityType, TrackAction};
use std::collections::VecDeque;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_set_event(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = "test_user_set_event";

    // Create a test event record
    let event = EventRecord {
        event: TrackingData {
            entity: EntityType::Document
                .with_entity_str("doc123")
                .with_connection_str("conn456")
                .with_user_str(test_user_id),
            action: TrackAction::Open,
        },
        timestamp: Utc::now(),
    };

    // Insert the event
    let result = storage.set_event(event).await;
    assert!(result.is_ok(), "Failed to set event: {:?}", result);

    // Verify the event was inserted
    let row = sqlx::query!(
        r#"
        SELECT user_id, entity_type, event_type, entity_id, connection_id, was_processed
        FROM frecency_events
        WHERE user_id = $1 AND entity_id = $2
        "#,
        test_user_id,
        "doc123"
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.user_id, test_user_id);
    assert_eq!(row.entity_type, "document");
    assert_eq!(row.event_type, "open");
    assert_eq!(row.entity_id, "doc123");
    assert_eq!(row.connection_id, "conn456");
    assert_eq!(row.was_processed, false);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_set_and_get_aggregate(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    // Create a test aggregate
    let mut recent_events = VecDeque::new();
    recent_events.push_back(TimestampWeight {
        timestamp: Utc::now(),
        weight: 1.0,
    });

    let aggregate = AggregateFrecency {
        id: AggregateId {
            entity: EntityType::Document.with_entity_str("doc456"),
            user_id: test_user_id.clone(),
        },
        data: FrecencyData {
            event_count: 5,
            frecency_score: 75.5,
            first_event: Utc::now(),
            recent_events,
        },
    };

    // Insert the aggregate
    let result = storage.set_aggregate(aggregate.clone()).await;
    assert!(result.is_ok(), "Failed to set aggregate: {:?}", result);

    // Retrieve the aggregate
    let retrieved = storage
        .get_aggregate_for_user_entity_pair(
            test_user_id.copied(),
            EntityType::Document.with_entity_str("doc456"),
        )
        .await
        .unwrap();

    assert!(retrieved.is_some());
    let retrieved = retrieved.unwrap();
    assert_eq!(retrieved.id.user_id.as_ref(), test_user_id.as_ref());
    assert_eq!(retrieved.id.entity.entity_id, "doc456");
    assert_eq!(retrieved.id.entity.entity_type, EntityType::Document);
    assert_eq!(retrieved.data.event_count, 5);
    assert_eq!(retrieved.data.frecency_score, 75.5);
    assert_eq!(retrieved.data.recent_events.len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_update_aggregate(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    // Create initial aggregate
    let aggregate1 = AggregateFrecency {
        id: AggregateId {
            entity: EntityType::Chat.with_entity_str("chat789"),
            user_id: test_user_id.clone(),
        },
        data: FrecencyData {
            event_count: 3,
            frecency_score: 50.0,
            first_event: Utc::now(),
            recent_events: VecDeque::new(),
        },
    };

    storage.set_aggregate(aggregate1).await.unwrap();

    // Update with new values
    let mut updated_events = VecDeque::new();
    updated_events.push_back(TimestampWeight {
        timestamp: Utc::now(),
        weight: 2.0,
    });

    let aggregate2 = AggregateFrecency {
        id: AggregateId {
            entity: EntityType::Chat.with_entity_str("chat789"),
            user_id: test_user_id.clone(),
        },
        data: FrecencyData {
            event_count: 10,
            frecency_score: 95.0,
            first_event: Utc::now(),
            recent_events: updated_events,
        },
    };

    storage.set_aggregate(aggregate2).await.unwrap();

    // Verify the update
    let retrieved = storage
        .get_aggregate_for_user_entity_pair(
            test_user_id,
            EntityType::Chat.with_entity_str("chat789"),
        )
        .await
        .unwrap()
        .unwrap();

    assert_eq!(retrieved.data.event_count, 10);
    assert_eq!(retrieved.data.frecency_score, 95.0);
    assert_eq!(retrieved.data.recent_events.len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_top_entities(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    // Create multiple aggregates with different scores
    let entities = vec![
        ("doc1", EntityType::Document, 90.0),
        ("doc2", EntityType::Document, 70.0),
        ("chat1", EntityType::Chat, 85.0),
        ("project1", EntityType::Project, 60.0),
        ("doc3", EntityType::Document, 95.0),
    ];

    for (id, entity_type, score) in entities {
        let aggregate = AggregateFrecency {
            id: AggregateId {
                entity: entity_type.with_entity_string(id.to_string()),
                user_id: test_user_id.clone(),
            },
            data: FrecencyData {
                event_count: 1,
                frecency_score: score,
                first_event: Utc::now(),
                recent_events: VecDeque::new(),
            },
        };
        storage.set_aggregate(aggregate).await.unwrap();
    }

    // Get top 3 entities
    let top_entities = storage
        .get_top_entities(test_user_id.clone(), 3)
        .await
        .unwrap();

    assert_eq!(top_entities.len(), 3);
    assert_eq!(top_entities[0].id.entity.entity_id, "doc3");
    assert_eq!(top_entities[0].data.frecency_score, 95.0);
    assert_eq!(top_entities[1].id.entity.entity_id, "doc1");
    assert_eq!(top_entities[1].data.frecency_score, 90.0);
    assert_eq!(top_entities[2].id.entity.entity_id, "chat1");
    assert_eq!(top_entities[2].data.frecency_score, 85.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_aggregate_for_user_entities(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    // Create multiple aggregates
    let aggregates = vec![
        ("doc1", EntityType::Document, 80.0),
        ("doc2", EntityType::Document, 70.0),
        ("chat1", EntityType::Chat, 85.0),
        ("project1", EntityType::Project, 60.0),
    ];

    for (id, entity_type, score) in &aggregates {
        let aggregate = AggregateFrecency {
            id: AggregateId {
                entity: (*entity_type).with_entity_string(id.to_string()),
                user_id: test_user_id.clone(),
            },
            data: FrecencyData {
                event_count: 1,
                frecency_score: *score,
                first_event: Utc::now(),
                recent_events: VecDeque::new(),
            },
        };
        storage.set_aggregate(aggregate).await.unwrap();
    }

    // Query for specific entities
    let entities_to_query = vec![
        EntityType::Document.with_entity_str("doc1"),
        EntityType::Chat.with_entity_str("chat1"),
        EntityType::Document.with_entity_str("doc_nonexistent"),
    ];

    let results = storage
        .get_aggregate_for_user_entities(test_user_id.into_owned(), entities_to_query.into_iter())
        .await
        .unwrap();

    // Should return 2 results (doc1 and chat1), ordered by score
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].id.entity.entity_id, "chat1");
    assert_eq!(results[0].data.frecency_score, 85.0);
    assert_eq!(results[1].id.entity.entity_id, "doc1");
    assert_eq!(results[1].data.frecency_score, 80.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_aggregate_for_nonexistent_entity(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id =
        MacroUserIdStr::parse_from_str("macro|test-user-nonexistent@example.com").unwrap();

    // Try to get a non-existent aggregate
    let result = storage
        .get_aggregate_for_user_entity_pair(
            test_user_id.copied(),
            EntityType::Document.with_entity_str("nonexistent"),
        )
        .await
        .unwrap();

    assert!(result.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_top_entities_empty(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id =
        MacroUserIdStr::parse_from_str("macro|test-user-nonexistent@example.com").unwrap();

    // Get top entities for user with no data
    let top_entities = storage
        .get_top_entities(test_user_id.copied(), 10)
        .await
        .unwrap();

    assert_eq!(top_entities.len(), 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_aggregate_for_empty_entities_list(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    // Query with empty entities list
    let results = storage
        .get_aggregate_for_user_entities(test_user_id, std::iter::empty())
        .await
        .unwrap();

    assert_eq!(results.len(), 0);
}

// Tests for FrecencyPgProcessor

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_processor_get_unprocessed_events(pool: PgPool) {
    let processor = FrecencyPgProcessor::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    // Insert some unprocessed events directly
    for i in 0..3 {
        sqlx::query!(
            r#"
            INSERT INTO frecency_events (
                user_id, entity_type, event_type, timestamp,
                connection_id, entity_id, was_processed
            )
            VALUES ($1, $2, $3, $4, $5, $6, false)
            "#,
            test_user_id.as_ref(),
            "document",
            "open",
            Utc::now(),
            format!("conn_{}", i),
            format!("doc_{}", i)
        )
        .execute(&pool)
        .await
        .unwrap();
    }

    // Insert a processed event (should not be returned)
    sqlx::query!(
        r#"
        INSERT INTO frecency_events (
            user_id, entity_type, event_type, timestamp,
            connection_id, entity_id, was_processed
        )
        VALUES ($1, $2, $3, $4, $5, $6, true)
        "#,
        test_user_id.as_ref(),
        "document",
        "open",
        Utc::now(),
        "conn_processed",
        "doc_processed"
    )
    .execute(&pool)
    .await
    .unwrap();

    // Get unprocessed events
    let unprocessed = processor.get_unprocessed_events().await.unwrap();

    // Should have at least our 3 unprocessed events
    assert!(unprocessed.len() >= 3);

    // Verify none are marked as processed
    let unprocessed_for_user: Vec<_> = unprocessed
        .into_iter()
        .filter(|e| e.event_record.event.entity.user_id == test_user_id.as_ref())
        .collect();

    assert_eq!(unprocessed_for_user.len(), 3);
    for event in unprocessed_for_user {
        assert!(
            event
                .event_record
                .event
                .entity
                .extra
                .extra
                .entity_id
                .starts_with("doc_")
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_processor_mark_processed(pool: PgPool) {
    let processor = FrecencyPgProcessor::new(pool.clone());
    let test_user_id = "test_processor_mark";

    // Insert unprocessed events
    let mut event_ids = Vec::new();
    for i in 0..2 {
        let id = sqlx::query_scalar!(
            r#"
            INSERT INTO frecency_events (
                user_id, entity_type, event_type, timestamp,
                connection_id, entity_id, was_processed
            )
            VALUES ($1, $2, $3, $4, $5, $6, false)
            RETURNING id
            "#,
            test_user_id,
            "document",
            "open",
            Utc::now(),
            format!("conn_{}", i),
            format!("doc_mark_{}", i)
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        event_ids.push(id);
    }

    // Get unprocessed events (starts a transaction)
    let unprocessed = processor.get_unprocessed_events().await.unwrap();

    // Filter to just our test events
    let to_mark: Vec<_> = unprocessed
        .into_iter()
        .filter(|e| event_ids.contains(&e.id))
        .collect();

    assert_eq!(to_mark.len(), 2);

    // Mark them as processed (commits the transaction)
    processor.mark_processed(to_mark).await.unwrap();

    // Verify they are marked as processed in the database
    for id in event_ids {
        let was_processed = sqlx::query_scalar!(
            "SELECT was_processed FROM frecency_events WHERE id = $1",
            id
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert!(was_processed, "Event {} should be marked as processed", id);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_processor_get_aggregates_for_users_entities(pool: PgPool) {
    let processor = FrecencyPgProcessor::new(pool.clone());
    let test_user_id: MacroUserIdStr<'static> =
        MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    // Insert some aggregates directly
    let aggregates_data = vec![
        ("doc_agg_1", EntityType::Document, 90.0),
        ("chat_agg_1", EntityType::Chat, 80.0),
        ("project_agg_1", EntityType::Project, 70.0),
    ];

    for (entity_id, entity_type, score) in &aggregates_data {
        sqlx::query!(
            r#"
            INSERT INTO frecency_aggregates (
                entity_id, entity_type, user_id, event_count,
                frecency_score, first_event, recent_events
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
            entity_id,
            entity_type.to_string(),
            test_user_id.0.as_ref(),
            5,
            score,
            Utc::now(),
            serde_json::json!([])
        )
        .execute(&pool)
        .await
        .unwrap();
    }

    // Start a transaction by getting unprocessed events
    let _ = processor.get_unprocessed_events().await.unwrap();

    // Create aggregate IDs to query
    let aggregate_ids = vec![
        AggregateId {
            entity: EntityType::Document.with_entity_str("doc_agg_1"),
            user_id: test_user_id.clone(),
        },
        AggregateId {
            entity: EntityType::Chat.with_entity_str("chat_agg_1"),
            user_id: test_user_id.clone(),
        },
        AggregateId {
            entity: EntityType::Document.with_entity_str("nonexistent"),
            user_id: test_user_id.clone(),
        },
    ];

    let retrieved = processor
        .get_aggregates_for_users_entities(aggregate_ids)
        .await
        .unwrap();

    // Should get 2 results (doc_agg_1 and chat_agg_1)
    assert_eq!(retrieved.len(), 2);

    let doc_agg = retrieved
        .iter()
        .find(|a| a.id.entity.entity_id == "doc_agg_1");
    assert!(doc_agg.is_some());
    assert_eq!(doc_agg.unwrap().data.frecency_score, 90.0);

    let chat_agg = retrieved
        .iter()
        .find(|a| a.id.entity.entity_id == "chat_agg_1");
    assert!(chat_agg.is_some());
    assert_eq!(chat_agg.unwrap().data.frecency_score, 80.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_processor_set_aggregates(pool: PgPool) {
    let processor = FrecencyPgProcessor::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    // Start a transaction
    let _ = processor.get_unprocessed_events().await.unwrap();

    // Create new aggregates to insert
    let mut recent_events = VecDeque::new();
    recent_events.push_back(TimestampWeight {
        timestamp: Utc::now(),
        weight: 1.5,
    });

    let aggregates = vec![
        AggregateFrecency {
            id: AggregateId {
                entity: EntityType::Document.with_entity_str("doc_set_1"),
                user_id: test_user_id.clone(),
            },
            data: FrecencyData {
                event_count: 10,
                frecency_score: 85.0,
                first_event: Utc::now(),
                recent_events: recent_events.clone(),
            },
        },
        AggregateFrecency {
            id: AggregateId {
                entity: EntityType::Chat.with_entity_str("chat_set_1"),
                user_id: test_user_id.clone(),
            },
            data: FrecencyData {
                event_count: 5,
                frecency_score: 65.0,
                first_event: Utc::now(),
                recent_events: recent_events.clone(),
            },
        },
    ];

    // Set the aggregates
    processor.set_aggregates(aggregates.clone()).await.unwrap();

    // Commit the transaction by calling mark_processed with empty list
    processor.mark_processed(vec![]).await.unwrap();

    // Verify they were inserted
    let doc_result = sqlx::query!(
        r#"
        SELECT event_count, frecency_score
        FROM frecency_aggregates
        WHERE user_id = $1 AND entity_id = $2
        "#,
        test_user_id.as_ref(),
        "doc_set_1"
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(doc_result.event_count, 10);
    assert_eq!(doc_result.frecency_score, 85.0);

    let chat_result = sqlx::query!(
        r#"
        SELECT event_count, frecency_score
        FROM frecency_aggregates
        WHERE user_id = $1 AND entity_id = $2
        "#,
        test_user_id.as_ref(),
        "chat_set_1"
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(chat_result.event_count, 5);
    assert_eq!(chat_result.frecency_score, 65.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_processor_set_aggregates_update_existing(pool: PgPool) {
    let processor = FrecencyPgProcessor::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    // Insert initial aggregate
    sqlx::query!(
        r#"
        INSERT INTO frecency_aggregates (
            entity_id, entity_type, user_id, event_count,
            frecency_score, first_event, recent_events
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
        "doc_update_1",
        "document",
        test_user_id.as_ref(),
        3,
        50.0,
        Utc::now(),
        serde_json::json!([])
    )
    .execute(&pool)
    .await
    .unwrap();

    // Start a transaction
    let _ = processor.get_unprocessed_events().await.unwrap();

    // Create updated aggregate
    let mut recent_events = VecDeque::new();
    recent_events.push_back(TimestampWeight {
        timestamp: Utc::now(),
        weight: 2.0,
    });

    let updated_aggregate = vec![AggregateFrecency {
        id: AggregateId {
            entity: EntityType::Document.with_entity_str("doc_update_1"),
            user_id: test_user_id.clone(),
        },
        data: FrecencyData {
            event_count: 15,
            frecency_score: 95.0,
            first_event: Utc::now(),
            recent_events,
        },
    }];

    // Update the aggregate
    processor.set_aggregates(updated_aggregate).await.unwrap();

    // Commit the transaction by calling mark_processed with empty list
    processor.mark_processed(vec![]).await.unwrap();

    // Verify it was updated
    let result = sqlx::query!(
        r#"
        SELECT event_count, frecency_score
        FROM frecency_aggregates
        WHERE user_id = $1 AND entity_id = $2
        "#,
        test_user_id.as_ref(),
        "doc_update_1"
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(result.event_count, 15);
    assert_eq!(result.frecency_score, 95.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_processor_set_aggregates_empty_list(pool: PgPool) {
    let processor = FrecencyPgProcessor::new(pool.clone());

    // Start a transaction
    let _ = processor.get_unprocessed_events().await.unwrap();

    // Set empty list of aggregates (should handle gracefully)
    let result = processor.set_aggregates(Vec::new()).await;
    assert!(result.is_ok());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_processor_transaction_lifecycle(pool: PgPool) {
    let processor = FrecencyPgProcessor::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    // Insert an unprocessed event
    let event_id = sqlx::query_scalar!(
        r#"
        INSERT INTO frecency_events (
            user_id, entity_type, event_type, timestamp,
            connection_id, entity_id, was_processed
        )
        VALUES ($1, $2, $3, $4, $5, $6, false)
        RETURNING id
        "#,
        test_user_id.as_ref(),
        "document",
        "open",
        Utc::now(),
        "conn_tx",
        "doc_tx"
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    // Get unprocessed events (starts transaction)
    let events = processor.get_unprocessed_events().await.unwrap();
    let test_event = events.into_iter().find(|e| e.id == event_id);
    assert!(test_event.is_some());

    // Create an aggregate for the event
    let aggregate = AggregateFrecency {
        id: AggregateId {
            entity: EntityType::Document.with_entity_str("doc_tx"),
            user_id: test_user_id.clone(),
        },
        data: FrecencyData {
            event_count: 1,
            frecency_score: 100.0,
            first_event: Utc::now(),
            recent_events: VecDeque::new(),
        },
    };

    // Set the aggregate (uses same transaction)
    processor.set_aggregates(vec![aggregate]).await.unwrap();

    // Mark as processed (commits the same transaction)
    processor
        .mark_processed(vec![test_event.unwrap()])
        .await
        .unwrap();

    // Verify the aggregate was saved
    let saved_aggregate = sqlx::query!(
        r#"
        SELECT frecency_score
        FROM frecency_aggregates
        WHERE user_id = $1 AND entity_id = $2
        "#,
        test_user_id.as_ref(),
        "doc_tx"
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(saved_aggregate.frecency_score, 100.0);

    // Verify event is marked as processed
    let was_processed = sqlx::query_scalar!(
        "SELECT was_processed FROM frecency_events WHERE id = $1",
        event_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(was_processed);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn it_cannot_be_read_concurrently(pool: PgPool) {
    let test_user_id = "test_processor_tx_lifecycle";
    // Insert an unprocessed event
    let event_id = sqlx::query_scalar!(
        r#"
        INSERT INTO frecency_events (
            user_id, entity_type, event_type, timestamp,
            connection_id, entity_id, was_processed
        )
        VALUES ($1, $2, $3, $4, $5, $6, false)
        RETURNING id
        "#,
        test_user_id,
        "document",
        "open",
        Utc::now(),
        "conn_tx",
        "doc_tx"
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let processor = FrecencyPgProcessor::new(pool.clone());

    let events = processor.get_unprocessed_events().await.unwrap();

    assert_eq!(events.len(), 1);
    assert_eq!(events.first().unwrap().id, event_id);

    // try to create a second processor and read events
    let second = FrecencyPgProcessor::new(pool);
    // this fails because the original processor still holds the lock
    let _err = processor.get_unprocessed_events().await.unwrap_err();

    // finish the tx
    processor.mark_processed(Vec::new()).await.unwrap();

    // now second can read because the transaction has finished
    let res = second.get_unprocessed_events().await.unwrap();
    assert_eq!(res.len(), 1);
    assert_eq!(res.first().unwrap().id, event_id);
}
