//! Tests for dynamic frecency filtering

use super::*;
use crate::domain::models::{AggregateId, FrecencyData};
use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::ast::{date::DateLiteral, document::DocumentLiteral};
use item_filters::{
    ChatFilters, DocumentFilters, EntityFilters, NotificationFilters, ProjectFilters, TaskFilters,
    ast::EntityFilterAst,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use std::collections::VecDeque;
use std::sync::Arc;
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

    let parent_project_id = Uuid::new_v4();
    let child_project_id = Uuid::new_v4();
    let unrelated_project_id = Uuid::new_v4();
    let doc_id_1 = Uuid::new_v4();
    let macro_user_id = Uuid::new_v4();

    sqlx::query(
        r#"INSERT INTO "macro_user" ("id", "username", "email", "stripe_customer_id") VALUES ($1, $2, $3, $4)"#,
    )
    .bind(macro_user_id)
    .bind("test@example.com")
    .bind("test@example.com")
    .bind("stripe_id")
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(r#"INSERT INTO "User" ("id", "email", "macro_user_id") VALUES ($1, $2, $3)"#)
        .bind(test_user_id.as_ref())
        .bind("test@example.com")
        .bind(macro_user_id)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(
        r#"
        INSERT INTO "Project" ("id", "name", "userId", "parentId") VALUES
            ($1, 'parent', $4, NULL),
            ($2, 'child', $4, $1),
            ($3, 'unrelated', $4, NULL)
        "#,
    )
    .bind(parent_project_id.to_string())
    .bind(child_project_id.to_string())
    .bind(unrelated_project_id.to_string())
    .bind(test_user_id.as_ref())
    .execute(&pool)
    .await
    .unwrap();

    for (id, entity_type, score) in [
        (parent_project_id.to_string(), EntityType::Project, 100.0),
        (child_project_id.to_string(), EntityType::Project, 70.0),
        (unrelated_project_id.to_string(), EntityType::Project, 80.0),
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
            project_ids: vec![parent_project_id.to_string()],
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

    // Default include_root=false: only the child of parent_project_id matches the project
    // filter; doc_id_1 passes through since document_filters is unconstrained.
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].id.entity.entity_id, doc_id_1.to_string());
    assert_eq!(results[0].data.frecency_score, 90.0);
    assert_eq!(results[1].id.entity.entity_id, child_project_id.to_string());
    assert_eq!(results[1].data.frecency_score, 70.0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_by_project_ids_include_root(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    let parent_project_id = Uuid::new_v4();
    let child_project_id = Uuid::new_v4();
    let unrelated_project_id = Uuid::new_v4();
    let macro_user_id = Uuid::new_v4();

    sqlx::query(
        r#"INSERT INTO "macro_user" ("id", "username", "email", "stripe_customer_id") VALUES ($1, $2, $3, $4)"#,
    )
    .bind(macro_user_id)
    .bind("test@example.com")
    .bind("test@example.com")
    .bind("stripe_id")
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(r#"INSERT INTO "User" ("id", "email", "macro_user_id") VALUES ($1, $2, $3)"#)
        .bind(test_user_id.as_ref())
        .bind("test@example.com")
        .bind(macro_user_id)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(
        r#"
        INSERT INTO "Project" ("id", "name", "userId", "parentId") VALUES
            ($1, 'parent', $3, NULL),
            ($2, 'child', $3, $1),
            ($4, 'unrelated', $3, NULL)
        "#,
    )
    .bind(parent_project_id.to_string())
    .bind(child_project_id.to_string())
    .bind(test_user_id.as_ref())
    .bind(unrelated_project_id.to_string())
    .execute(&pool)
    .await
    .unwrap();

    for (id, score) in [
        (parent_project_id.to_string(), 100.0),
        (child_project_id.to_string(), 70.0),
        (unrelated_project_id.to_string(), 80.0),
    ] {
        storage
            .set_aggregate(AggregateFrecency {
                id: AggregateId {
                    entity: EntityType::Project.with_entity_string(id.clone()),
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
            project_ids: vec![parent_project_id.to_string()],
            include_root: true,
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

    // include_root=true: parent itself + its child match; unrelated_project is filtered out.
    assert_eq!(results.len(), 2);
    let ids: std::collections::HashSet<String> = results
        .iter()
        .map(|r| r.id.entity.entity_id.to_string())
        .collect();
    assert!(ids.contains(&parent_project_id.to_string()));
    assert!(ids.contains(&child_project_id.to_string()));
    assert!(!ids.contains(&unrelated_project_id.to_string()));
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_document_notification_done(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    let doc_id_1 = Uuid::new_v4();
    let doc_id_2 = Uuid::new_v4();

    for (id, score) in [(doc_id_1.to_string(), 100.0), (doc_id_2.to_string(), 90.0)] {
        storage
            .set_aggregate(AggregateFrecency {
                id: AggregateId {
                    entity: EntityType::Document.with_entity_string(id),
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

    // Notification for doc 1 is not done/unseen.
    let notification_id_1 = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO notification
            (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata, sender_id)
        VALUES
            ($1, 'test', $2, 'document', 'test', '{}'::jsonb, NULL)
        "#,
    )
    .bind(notification_id_1)
    .bind(doc_id_1.to_string())
    .execute(&pool)
    .await
    .unwrap();

    // Notification for doc 2 is done/seen.
    let notification_id_2 = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO notification
            (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata, sender_id)
        VALUES
            ($1, 'test', $2, 'document', 'test', '{}'::jsonb, NULL)
        "#,
    )
    .bind(notification_id_2)
    .bind(doc_id_2.to_string())
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO user_notification (user_id, notification_id, created_at, seen_at, done)
        VALUES ($1, $2, NOW(), NULL, false), ($1, $3, NOW(), NOW(), true)
        "#,
    )
    .bind(test_user_id.as_ref())
    .bind(notification_id_1)
    .bind(notification_id_2)
    .execute(&pool)
    .await
    .unwrap();

    let filter = item_filters::ast::EntityFilterAst::new_from_filters(EntityFilters {
        document_filters: DocumentFilters {
            notification_filters: NotificationFilters {
                done: Some(false),
                seen: None,
            },
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

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id.entity.entity_id, doc_id_1.to_string());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_document_task_include_cbm_atm_nc(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let test_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    // Ensure owner row exists for foreign keys from Document.owner.
    let macro_user_uuid = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO "macro_user" ("id", "username", "email", "stripe_customer_id")
        VALUES ($1, 'test', $2, 'stripe_test')
        ON CONFLICT ("id") DO NOTHING
        "#,
    )
    .bind(macro_user_uuid)
    .bind("test@example.com")
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO "User" ("id", "email", "macro_user_id")
        VALUES ($1, $2, $3)
        ON CONFLICT ("id") DO NOTHING
        "#,
    )
    .bind(test_user_id.as_ref())
    .bind("test@example.com")
    .bind(macro_user_uuid)
    .execute(&pool)
    .await
    .unwrap();

    let matching_task_id = Uuid::new_v4();
    let non_matching_task_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO "Document" ("id", "name", "owner", "fileType", "createdAt", "updatedAt")
        VALUES
            ($1, 'Matching Task', $3, 'txt', NOW(), NOW()),
            ($2, 'Non Matching Task', $3, 'txt', NOW(), NOW())
        "#,
    )
    .bind(matching_task_id.to_string())
    .bind(non_matching_task_id.to_string())
    .bind(test_user_id.as_ref())
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO document_sub_type (document_id, sub_type)
        VALUES ($1, 'task'), ($2, 'task')
        "#,
    )
    .bind(matching_task_id.to_string())
    .bind(non_matching_task_id.to_string())
    .execute(&pool)
    .await
    .unwrap();

    // Matching task: assigned to current user + status in progress.
    sqlx::query(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES
            (
                gen_random_uuid(),
                $1,
                'TASK',
                '00000001-0000-0000-0000-000000000001',
                jsonb_build_object(
                    'type', 'EntityReference',
                    'value', jsonb_build_array(
                        jsonb_build_object('entity_id', $3, 'entity_type', 'USER')
                    )
                )
            ),
            (
                gen_random_uuid(),
                $1,
                'TASK',
                '00000001-0000-0000-0000-000000000002',
                '{"type":"SelectOption","value":["00000001-0000-0000-0002-000000000002"]}'::jsonb
            ),
            (
                gen_random_uuid(),
                $2,
                'TASK',
                '00000001-0000-0000-0000-000000000001',
                '{"type":"EntityReference","value":[{"entity_id":"macro|other@example.com","entity_type":"USER"}]}'::jsonb
            ),
            (
                gen_random_uuid(),
                $2,
                'TASK',
                '00000001-0000-0000-0000-000000000002',
                '{"type":"SelectOption","value":["00000001-0000-0000-0002-000000000002"]}'::jsonb
            )
        "#,
    )
    .bind(matching_task_id.to_string())
    .bind(non_matching_task_id.to_string())
    .bind(test_user_id.as_ref())
    .execute(&pool)
    .await
    .unwrap();

    for (id, score) in [
        (matching_task_id.to_string(), 100.0),
        (non_matching_task_id.to_string(), 90.0),
    ] {
        storage
            .set_aggregate(AggregateFrecency {
                id: AggregateId {
                    entity: EntityType::Document.with_entity_string(id),
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
        document_filters: DocumentFilters {
            task_filters: TaskFilters {
                include_cbm_atm_nc: Some(true),
            },
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

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id.entity.entity_id, matching_task_id.to_string());
}

async fn setup_date_filter_user(pool: &PgPool, user_id: &MacroUserIdStr<'_>) {
    let macro_user_uuid = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO "macro_user" ("id", "username", "email", "stripe_customer_id")
        VALUES ($1, 'test', $2, 'stripe_test')
        ON CONFLICT ("id") DO NOTHING
        "#,
    )
    .bind(macro_user_uuid)
    .bind("test@example.com")
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO "User" ("id", "email", "macro_user_id")
        VALUES ($1, $2, $3)
        ON CONFLICT ("id") DO NOTHING
        "#,
    )
    .bind(user_id.as_ref())
    .bind("test@example.com")
    .bind(macro_user_uuid)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_doc_with_timestamps(
    pool: &PgPool,
    id: Uuid,
    owner: &str,
    created_at: &str,
    updated_at: &str,
) {
    sqlx::query(
        r#"
        INSERT INTO "Document" ("id", "name", "owner", "fileType", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, 'txt', $4::timestamptz, $5::timestamptz)
        "#,
    )
    .bind(id.to_string())
    .bind(id.to_string())
    .bind(owner)
    .bind(created_at)
    .bind(updated_at)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_document_date_created_at_gt(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    setup_date_filter_user(&pool, &user_id).await;

    let doc_early = Uuid::new_v4();
    let doc_mid = Uuid::new_v4();
    let doc_late = Uuid::new_v4();

    insert_doc_with_timestamps(
        &pool,
        doc_early,
        user_id.as_ref(),
        "2023-01-01T10:00:00Z",
        "2023-01-01T10:00:00Z",
    )
    .await;
    insert_doc_with_timestamps(
        &pool,
        doc_mid,
        user_id.as_ref(),
        "2023-01-01T12:00:00Z",
        "2023-01-01T12:00:00Z",
    )
    .await;
    insert_doc_with_timestamps(
        &pool,
        doc_late,
        user_id.as_ref(),
        "2023-01-01T14:00:00Z",
        "2023-01-01T14:00:00Z",
    )
    .await;

    for (id, score) in [
        (doc_early.to_string(), 100.0),
        (doc_mid.to_string(), 90.0),
        (doc_late.to_string(), 80.0),
    ] {
        storage
            .set_aggregate(AggregateFrecency {
                id: AggregateId {
                    entity: EntityType::Document.with_entity_string(id),
                    user_id: user_id.clone(),
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

    let cutoff: DateTime<Utc> = DateTime::parse_from_rfc3339("2023-01-01T11:00:00Z")
        .unwrap()
        .into();
    let filter = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::Literal(DocumentLiteral::CreatedAt(
            DateLiteral::GreaterThan(cutoff),
        )))),
        project_filter: None,
        chat_filter: None,
        email_filter: item_filters::ast::EmailFilterAst::default(),
        channel_filter: None,
        call_filter: None,
        crm_company_filter: None,
        foreign_entity_filter: None,
        properties_filter: None,
    };

    let results = storage
        .get_top_entities(FrecencyPageRequest {
            user_id: user_id.copied(),
            from_score: None,
            limit: 10,
            filters: Some(filter),
        })
        .await
        .unwrap();

    assert_eq!(results.len(), 2);
    let ids: Vec<String> = results
        .iter()
        .map(|r| r.id.entity.entity_id.as_ref().to_string())
        .collect();
    assert!(ids.contains(&doc_mid.to_string()));
    assert!(ids.contains(&doc_late.to_string()));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_document_date_created_at_lt(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    setup_date_filter_user(&pool, &user_id).await;

    let doc_early = Uuid::new_v4();
    let doc_mid = Uuid::new_v4();
    let doc_late = Uuid::new_v4();

    insert_doc_with_timestamps(
        &pool,
        doc_early,
        user_id.as_ref(),
        "2023-01-01T10:00:00Z",
        "2023-01-01T10:00:00Z",
    )
    .await;
    insert_doc_with_timestamps(
        &pool,
        doc_mid,
        user_id.as_ref(),
        "2023-01-01T12:00:00Z",
        "2023-01-01T12:00:00Z",
    )
    .await;
    insert_doc_with_timestamps(
        &pool,
        doc_late,
        user_id.as_ref(),
        "2023-01-01T14:00:00Z",
        "2023-01-01T14:00:00Z",
    )
    .await;

    for (id, score) in [
        (doc_early.to_string(), 100.0),
        (doc_mid.to_string(), 90.0),
        (doc_late.to_string(), 80.0),
    ] {
        storage
            .set_aggregate(AggregateFrecency {
                id: AggregateId {
                    entity: EntityType::Document.with_entity_string(id),
                    user_id: user_id.clone(),
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

    let cutoff: DateTime<Utc> = DateTime::parse_from_rfc3339("2023-01-01T11:00:00Z")
        .unwrap()
        .into();
    let filter = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::Literal(DocumentLiteral::CreatedAt(
            DateLiteral::LessThan(cutoff),
        )))),
        project_filter: None,
        chat_filter: None,
        email_filter: item_filters::ast::EmailFilterAst::default(),
        channel_filter: None,
        call_filter: None,
        crm_company_filter: None,
        foreign_entity_filter: None,
        properties_filter: None,
    };

    let results = storage
        .get_top_entities(FrecencyPageRequest {
            user_id: user_id.copied(),
            from_score: None,
            limit: 10,
            filters: Some(filter),
        })
        .await
        .unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id.entity.entity_id, doc_early.to_string());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_document_date_updated_at_gt(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    setup_date_filter_user(&pool, &user_id).await;

    let doc_early = Uuid::new_v4();
    let doc_mid = Uuid::new_v4();
    let doc_late = Uuid::new_v4();

    // createdAt is old for all; updatedAt varies
    insert_doc_with_timestamps(
        &pool,
        doc_early,
        user_id.as_ref(),
        "2023-01-01T10:00:00Z",
        "2023-01-01T10:00:00Z",
    )
    .await;
    insert_doc_with_timestamps(
        &pool,
        doc_mid,
        user_id.as_ref(),
        "2023-01-01T10:00:00Z",
        "2023-01-01T12:00:00Z",
    )
    .await;
    insert_doc_with_timestamps(
        &pool,
        doc_late,
        user_id.as_ref(),
        "2023-01-01T10:00:00Z",
        "2023-01-01T14:00:00Z",
    )
    .await;

    for (id, score) in [
        (doc_early.to_string(), 100.0),
        (doc_mid.to_string(), 90.0),
        (doc_late.to_string(), 80.0),
    ] {
        storage
            .set_aggregate(AggregateFrecency {
                id: AggregateId {
                    entity: EntityType::Document.with_entity_string(id),
                    user_id: user_id.clone(),
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

    let cutoff: DateTime<Utc> = DateTime::parse_from_rfc3339("2023-01-01T11:00:00Z")
        .unwrap()
        .into();
    let filter = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::Literal(DocumentLiteral::UpdatedAt(
            DateLiteral::GreaterThan(cutoff),
        )))),
        project_filter: None,
        chat_filter: None,
        email_filter: item_filters::ast::EmailFilterAst::default(),
        channel_filter: None,
        call_filter: None,
        crm_company_filter: None,
        foreign_entity_filter: None,
        properties_filter: None,
    };

    let results = storage
        .get_top_entities(FrecencyPageRequest {
            user_id: user_id.copied(),
            from_score: None,
            limit: 10,
            filters: Some(filter),
        })
        .await
        .unwrap();

    assert_eq!(results.len(), 2);
    let ids: Vec<String> = results
        .iter()
        .map(|r| r.id.entity.entity_id.as_ref().to_string())
        .collect();
    assert!(ids.contains(&doc_mid.to_string()));
    assert!(ids.contains(&doc_late.to_string()));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_dynamic_filter_document_date_updated_at_lt(pool: PgPool) {
    let storage = FrecencyPgStorage::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    setup_date_filter_user(&pool, &user_id).await;

    let doc_early = Uuid::new_v4();
    let doc_mid = Uuid::new_v4();
    let doc_late = Uuid::new_v4();

    // createdAt is old for all; updatedAt varies
    insert_doc_with_timestamps(
        &pool,
        doc_early,
        user_id.as_ref(),
        "2023-01-01T10:00:00Z",
        "2023-01-01T10:00:00Z",
    )
    .await;
    insert_doc_with_timestamps(
        &pool,
        doc_mid,
        user_id.as_ref(),
        "2023-01-01T10:00:00Z",
        "2023-01-01T12:00:00Z",
    )
    .await;
    insert_doc_with_timestamps(
        &pool,
        doc_late,
        user_id.as_ref(),
        "2023-01-01T10:00:00Z",
        "2023-01-01T14:00:00Z",
    )
    .await;

    for (id, score) in [
        (doc_early.to_string(), 100.0),
        (doc_mid.to_string(), 90.0),
        (doc_late.to_string(), 80.0),
    ] {
        storage
            .set_aggregate(AggregateFrecency {
                id: AggregateId {
                    entity: EntityType::Document.with_entity_string(id),
                    user_id: user_id.clone(),
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

    let cutoff: DateTime<Utc> = DateTime::parse_from_rfc3339("2023-01-01T11:00:00Z")
        .unwrap()
        .into();
    let filter = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::Literal(DocumentLiteral::UpdatedAt(
            DateLiteral::LessThan(cutoff),
        )))),
        project_filter: None,
        chat_filter: None,
        email_filter: item_filters::ast::EmailFilterAst::default(),
        channel_filter: None,
        call_filter: None,
        crm_company_filter: None,
        foreign_entity_filter: None,
        properties_filter: None,
    };

    let results = storage
        .get_top_entities(FrecencyPageRequest {
            user_id: user_id.copied(),
            from_score: None,
            limit: 10,
            filters: Some(filter),
        })
        .await
        .unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id.entity.entity_id, doc_early.to_string());
}
