//! Tests for dynamic frecency filtering

use super::*;
use crate::domain::models::{AggregateId, FrecencyData};
use chrono::Utc;
use item_filters::{ChatFilters, DocumentFilters, EntityFilters, ProjectFilters};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use std::collections::VecDeque;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_by_document_ids(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    // Create test UUIDs
    let doc_id_1 = Uuid::new_v4();
    let doc_id_2 = Uuid::new_v4();
    let chat_id_1 = Uuid::new_v4();

    // Create aggregates
    for (id, entity_type, score) in [
        (doc_id_1.to_string(), EntityType::Document, 100.0),
        (doc_id_2.to_string(), EntityType::Document, 80.0),
        (chat_id_1.to_string(), EntityType::Chat, 90.0),
    ] {
        storage
            .set_aggregate(AggregateFrecency {
                id: AggregateId {
                    entity: entity_type.with_entity_string(id.clone()),
                    user_id: test_user_id.clone(),
                },
                data: FrecencyData {
                    event_count: 1,
                    frecency_score: score,
                    first_event: Utc::now(),
                    recent_events: VecDeque::new(),
                },
            })
            .await
            .unwrap();
    }

    // Filter for specific document ID
    let filter = item_filters::ast::EntityFilterAst::new_from_filters(EntityFilters {
        document_filters: DocumentFilters {
            document_ids: vec![doc_id_1.to_string()],
            ..Default::default()
        },
        ..Default::default()
    })
    .unwrap()
    .unwrap();

    let results = storage
        .get_top_entities(FrecencyPageRequest {
            user_id: test_user_id.copied(),
            from_score: None,
            limit: 10,
            filters: Some(filter),
        })
        .await
        .unwrap();

    // Should return filtered document (doc_id_1) + all chats (chat_id_1)
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].id.entity.entity_id, doc_id_1.to_string());
    assert_eq!(results[0].data.frecency_score, 100.0);
    assert_eq!(results[1].id.entity.entity_id, chat_id_1.to_string());
    assert_eq!(results[1].data.frecency_score, 90.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_by_chat_ids(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    let chat_id_1 = Uuid::new_v4();
    let chat_id_2 = Uuid::new_v4();
    let doc_id_1 = Uuid::new_v4();

    for (id, entity_type, score) in [
        (chat_id_1.to_string(), EntityType::Chat, 100.0),
        (chat_id_2.to_string(), EntityType::Chat, 80.0),
        (doc_id_1.to_string(), EntityType::Document, 90.0),
    ] {
        storage
            .set_aggregate(AggregateFrecency {
                id: AggregateId {
                    entity: entity_type.with_entity_string(id.clone()),
                    user_id: test_user_id.clone(),
                },
                data: FrecencyData {
                    event_count: 1,
                    frecency_score: score,
                    first_event: Utc::now(),
                    recent_events: VecDeque::new(),
                },
            })
            .await
            .unwrap();
    }

    let filter = item_filters::ast::EntityFilterAst::new_from_filters(EntityFilters {
        chat_filters: ChatFilters {
            chat_ids: vec![chat_id_1.to_string()],
            ..Default::default()
        },
        ..Default::default()
    })
    .unwrap()
    .unwrap();

    let results = storage
        .get_top_entities(FrecencyPageRequest {
            user_id: test_user_id.copied(),
            from_score: None,
            limit: 10,
            filters: Some(filter),
        })
        .await
        .unwrap();

    // Should return filtered chat (chat_id_1) + all documents (doc_id_1)
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].id.entity.entity_id, chat_id_1.to_string());
    assert_eq!(results[0].data.frecency_score, 100.0);
    assert_eq!(results[1].id.entity.entity_id, doc_id_1.to_string());
    assert_eq!(results[1].data.frecency_score, 90.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_by_project_ids(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    let project_id_1 = Uuid::new_v4();
    let project_id_2 = Uuid::new_v4();
    let doc_id_1 = Uuid::new_v4();

    for (id, entity_type, score) in [
        (project_id_1.to_string(), EntityType::Project, 100.0),
        (project_id_2.to_string(), EntityType::Project, 80.0),
        (doc_id_1.to_string(), EntityType::Document, 90.0),
    ] {
        storage
            .set_aggregate(AggregateFrecency {
                id: AggregateId {
                    entity: entity_type.with_entity_string(id.clone()),
                    user_id: test_user_id.clone(),
                },
                data: FrecencyData {
                    event_count: 1,
                    frecency_score: score,
                    first_event: Utc::now(),
                    recent_events: VecDeque::new(),
                },
            })
            .await
            .unwrap();
    }

    let filter = item_filters::ast::EntityFilterAst::new_from_filters(EntityFilters {
        project_filters: ProjectFilters {
            project_ids: vec![project_id_1.to_string()],
            ..Default::default()
        },
        ..Default::default()
    })
    .unwrap()
    .unwrap();

    let results = storage
        .get_top_entities(FrecencyPageRequest {
            user_id: test_user_id.copied(),
            from_score: None,
            limit: 10,
            filters: Some(filter),
        })
        .await
        .unwrap();

    // Should return filtered project (project_id_1) + all documents (doc_id_1)
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].id.entity.entity_id, project_id_1.to_string());
    assert_eq!(results[0].data.frecency_score, 100.0);
    assert_eq!(results[1].id.entity.entity_id, doc_id_1.to_string());
    assert_eq!(results[1].data.frecency_score, 90.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_multiple_document_ids(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    let doc_id_1 = Uuid::new_v4();
    let doc_id_2 = Uuid::new_v4();
    let doc_id_3 = Uuid::new_v4();

    for (id, entity_type, score) in [
        (doc_id_1.to_string(), EntityType::Document, 100.0),
        (doc_id_2.to_string(), EntityType::Document, 90.0),
        (doc_id_3.to_string(), EntityType::Document, 80.0),
    ] {
        storage
            .set_aggregate(AggregateFrecency {
                id: AggregateId {
                    entity: entity_type.with_entity_string(id.clone()),
                    user_id: test_user_id.clone(),
                },
                data: FrecencyData {
                    event_count: 1,
                    frecency_score: score,
                    first_event: Utc::now(),
                    recent_events: VecDeque::new(),
                },
            })
            .await
            .unwrap();
    }

    // Filter for two of the three documents (OR filter)
    let filter = item_filters::ast::EntityFilterAst::new_from_filters(EntityFilters {
        document_filters: DocumentFilters {
            document_ids: vec![doc_id_1.to_string(), doc_id_2.to_string()],
            ..Default::default()
        },
        ..Default::default()
    })
    .unwrap()
    .unwrap();

    let results = storage
        .get_top_entities(FrecencyPageRequest {
            user_id: test_user_id.copied(),
            from_score: None,
            limit: 10,
            filters: Some(filter),
        })
        .await
        .unwrap();

    // Should return 2 filtered documents (no chats/projects exist in this test)
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].id.entity.entity_id, doc_id_1.to_string());
    assert_eq!(results[0].data.frecency_score, 100.0);
    assert_eq!(results[1].id.entity.entity_id, doc_id_2.to_string());
    assert_eq!(results[1].data.frecency_score, 90.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_mixed_entity_types(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    let doc_id_1 = Uuid::new_v4();
    let chat_id_1 = Uuid::new_v4();
    let project_id_1 = Uuid::new_v4();
    let doc_id_2 = Uuid::new_v4();

    for (id, entity_type, score) in [
        (doc_id_1.to_string(), EntityType::Document, 100.0),
        (chat_id_1.to_string(), EntityType::Chat, 90.0),
        (project_id_1.to_string(), EntityType::Project, 80.0),
        (doc_id_2.to_string(), EntityType::Document, 70.0),
    ] {
        storage
            .set_aggregate(AggregateFrecency {
                id: AggregateId {
                    entity: entity_type.with_entity_string(id.clone()),
                    user_id: test_user_id.clone(),
                },
                data: FrecencyData {
                    event_count: 1,
                    frecency_score: score,
                    first_event: Utc::now(),
                    recent_events: VecDeque::new(),
                },
            })
            .await
            .unwrap();
    }

    // Filter for one document and one chat
    let filter = item_filters::ast::EntityFilterAst::new_from_filters(EntityFilters {
        document_filters: DocumentFilters {
            document_ids: vec![doc_id_1.to_string()],
            ..Default::default()
        },
        chat_filters: ChatFilters {
            chat_ids: vec![chat_id_1.to_string()],
            ..Default::default()
        },
        ..Default::default()
    })
    .unwrap()
    .unwrap();

    let results = storage
        .get_top_entities(FrecencyPageRequest {
            user_id: test_user_id.copied(),
            from_score: None,
            limit: 10,
            filters: Some(filter),
        })
        .await
        .unwrap();

    // Should return filtered doc + filtered chat + all projects
    assert_eq!(results.len(), 3);
    assert_eq!(results[0].id.entity.entity_id, doc_id_1.to_string());
    assert_eq!(results[0].data.frecency_score, 100.0);
    assert_eq!(results[1].id.entity.entity_id, chat_id_1.to_string());
    assert_eq!(results[1].data.frecency_score, 90.0);
    assert_eq!(results[2].id.entity.entity_id, project_id_1.to_string());
    assert_eq!(results[2].data.frecency_score, 80.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_with_from_score_pagination(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    let doc_id_1 = Uuid::new_v4();
    let doc_id_2 = Uuid::new_v4();
    let doc_id_3 = Uuid::new_v4();
    let chat_id_1 = Uuid::new_v4();

    for (id, entity_type, score) in [
        (doc_id_1.to_string(), EntityType::Document, 100.0),
        (doc_id_2.to_string(), EntityType::Document, 80.0),
        (doc_id_3.to_string(), EntityType::Document, 60.0),
        (chat_id_1.to_string(), EntityType::Chat, 90.0),
    ] {
        storage
            .set_aggregate(AggregateFrecency {
                id: AggregateId {
                    entity: entity_type.with_entity_string(id.clone()),
                    user_id: test_user_id.clone(),
                },
                data: FrecencyData {
                    event_count: 1,
                    frecency_score: score,
                    first_event: Utc::now(),
                    recent_events: VecDeque::new(),
                },
            })
            .await
            .unwrap();
    }

    // Filter for all three documents
    let filter = item_filters::ast::EntityFilterAst::new_from_filters(EntityFilters {
        document_filters: DocumentFilters {
            document_ids: vec![
                doc_id_1.to_string(),
                doc_id_2.to_string(),
                doc_id_3.to_string(),
            ],
            ..Default::default()
        },
        ..Default::default()
    })
    .unwrap()
    .unwrap();

    // Use from_score to paginate (filter out items with score >= 85.0)
    let results = storage
        .get_top_entities(FrecencyPageRequest {
            user_id: test_user_id.copied(),
            from_score: Some(85.0),
            limit: 10,
            filters: Some(filter),
        })
        .await
        .unwrap();

    // Should return filtered docs with score < 85 + all chats with score < 85
    // doc_id_1 (100) filtered out by from_score
    // doc_id_2 (80) included
    // doc_id_3 (60) included
    // chat_id_1 (90) filtered out by from_score
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].id.entity.entity_id, doc_id_2.to_string());
    assert_eq!(results[0].data.frecency_score, 80.0);
    assert_eq!(results[1].id.entity.entity_id, doc_id_3.to_string());
    assert_eq!(results[1].data.frecency_score, 60.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_no_matches(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    let doc_id_1 = Uuid::new_v4();
    let non_existent_id = Uuid::new_v4();

    storage
        .set_aggregate(AggregateFrecency {
            id: AggregateId {
                entity: EntityType::Document.with_entity_string(doc_id_1.to_string()),
                user_id: test_user_id.clone(),
            },
            data: FrecencyData {
                event_count: 1,
                frecency_score: 100.0,
                first_event: Utc::now(),
                recent_events: VecDeque::new(),
            },
        })
        .await
        .unwrap();

    // Filter for non-existent document
    let filter = item_filters::ast::EntityFilterAst::new_from_filters(EntityFilters {
        document_filters: DocumentFilters {
            document_ids: vec![non_existent_id.to_string()],
            ..Default::default()
        },
        ..Default::default()
    })
    .unwrap()
    .unwrap();

    let results = storage
        .get_top_entities(FrecencyPageRequest {
            user_id: test_user_id.copied(),
            from_score: None,
            limit: 10,
            filters: Some(filter),
        })
        .await
        .unwrap();

    assert_eq!(results.len(), 0);
}
