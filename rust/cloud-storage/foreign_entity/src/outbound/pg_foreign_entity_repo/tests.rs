use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgForeignEntityRepo;
use crate::domain::models::{CreateForeignEntity, ForeignEntity, PatchForeignEntity};
use crate::domain::ports::ForeignEntityRepository;

fn create_request(
    foreign_entity_id: impl Into<String>,
    foreign_entity_source: impl Into<String>,
) -> CreateForeignEntity {
    CreateForeignEntity {
        foreign_entity_id: foreign_entity_id.into(),
        foreign_entity_source: foreign_entity_source.into(),
        metadata: json!({ "origin": "test" }),
        stored_for_id: "document-1".to_string(),
        stored_for_auth_entity: "document".to_string(),
    }
}

async fn insert_foreign_entity(
    repo: &PgForeignEntityRepo,
    foreign_entity_id: &str,
    foreign_entity_source: &str,
) -> ForeignEntity {
    repo.create_foreign_entity(
        Uuid::now_v7(),
        create_request(foreign_entity_id, foreign_entity_source),
    )
    .await
    .expect("foreign entity should be inserted")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_inserts_row_and_returns_persisted_fields(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool.clone());
    let id = Uuid::now_v7();
    let create = CreateForeignEntity {
        foreign_entity_id: "external-entity-1".to_string(),
        foreign_entity_source: "linear".to_string(),
        metadata: json!({ "team": "engineering" }),
        stored_for_id: "document-1".to_string(),
        stored_for_auth_entity: "document".to_string(),
    };

    let entity = repo
        .create_foreign_entity(id, create)
        .await
        .expect("foreign entity should be created");

    assert_eq!(entity.id, id);
    assert_eq!(entity.foreign_entity_id, "external-entity-1");
    assert_eq!(entity.foreign_entity_source, "linear");
    assert_eq!(entity.metadata, json!({ "team": "engineering" }));
    assert_eq!(entity.stored_for_id, "document-1");
    assert_eq!(entity.stored_for_auth_entity, "document");
    assert!(entity.created_at <= chrono::Utc::now());
    assert!(entity.updated_at >= entity.created_at);

    let row = sqlx::query!(
        r#"
        SELECT COUNT(*) as "persisted_count!"
        FROM foreign_entity
        WHERE id = $1
        "#,
        id,
    )
    .fetch_one(&pool)
    .await
    .expect("persisted row count should be fetched");

    assert_eq!(row.persisted_count, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_by_id_returns_some_for_existing_and_none_for_missing(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    let entity = insert_foreign_entity(&repo, "external-entity-1", "linear").await;

    let fetched = repo
        .get_foreign_entity_by_id(entity.id)
        .await
        .expect("existing foreign entity lookup should succeed");
    let missing = repo
        .get_foreign_entity_by_id(Uuid::now_v7())
        .await
        .expect("missing foreign entity lookup should succeed");

    assert_eq!(fetched, Some(entity));
    assert_eq!(missing, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_by_foreign_entity_id_returns_all_matches_and_supports_source_filter(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    let first = insert_foreign_entity(&repo, "shared-external-id", "linear").await;
    let second = insert_foreign_entity(&repo, "shared-external-id", "github").await;
    insert_foreign_entity(&repo, "other-external-id", "linear").await;

    let all_matches = repo
        .get_foreign_entities_by_foreign_entity_id("shared-external-id", None)
        .await
        .expect("unfiltered lookup should succeed");
    let source_matches = repo
        .get_foreign_entities_by_foreign_entity_id("shared-external-id", Some("github"))
        .await
        .expect("source-filtered lookup should succeed");
    let missing_source_matches = repo
        .get_foreign_entities_by_foreign_entity_id("shared-external-id", Some("salesforce"))
        .await
        .expect("missing source lookup should succeed");

    let mut all_match_ids = all_matches
        .iter()
        .map(|entity| entity.id)
        .collect::<Vec<_>>();
    all_match_ids.sort_unstable();

    let mut expected_ids = vec![first.id, second.id];
    expected_ids.sort_unstable();

    assert_eq!(all_match_ids, expected_ids);
    assert_eq!(source_matches, vec![second]);
    assert!(missing_source_matches.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn patch_updates_selected_fields_preserves_others_and_refreshes_updated_at(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool.clone());
    let entity = insert_foreign_entity(&repo, "external-entity-1", "linear").await;

    sqlx::query!(
        r#"
        UPDATE foreign_entity
        SET updated_at = NOW() - INTERVAL '1 hour'
        WHERE id = $1
        "#,
        entity.id,
    )
    .execute(&pool)
    .await
    .expect("updated_at should be backdated");

    let backdated = repo
        .get_foreign_entity_by_id(entity.id)
        .await
        .expect("backdated foreign entity lookup should succeed")
        .expect("backdated foreign entity should exist");

    let patched = repo
        .patch_foreign_entity(
            entity.id,
            PatchForeignEntity {
                foreign_entity_id: Some("external-entity-2".to_string()),
                metadata: Some(json!({ "patched": true })),
                ..Default::default()
            },
        )
        .await
        .expect("patch should succeed")
        .expect("existing foreign entity should be patched");

    assert_eq!(patched.id, entity.id);
    assert_eq!(patched.foreign_entity_id, "external-entity-2");
    assert_eq!(patched.foreign_entity_source, entity.foreign_entity_source);
    assert_eq!(patched.metadata, json!({ "patched": true }));
    assert_eq!(patched.stored_for_id, entity.stored_for_id);
    assert_eq!(
        patched.stored_for_auth_entity,
        entity.stored_for_auth_entity
    );
    assert_eq!(patched.created_at, entity.created_at);
    assert!(patched.updated_at > backdated.updated_at);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn patch_missing_id_returns_none(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);

    let result = repo
        .patch_foreign_entity(
            Uuid::now_v7(),
            PatchForeignEntity {
                foreign_entity_source: Some("github".to_string()),
                ..Default::default()
            },
        )
        .await
        .expect("missing patch should succeed");

    assert_eq!(result, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_returns_true_once_and_false_when_repeated(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    let entity = insert_foreign_entity(&repo, "external-entity-1", "linear").await;

    let first_delete = repo
        .delete_foreign_entity(entity.id)
        .await
        .expect("first delete should succeed");
    let second_delete = repo
        .delete_foreign_entity(entity.id)
        .await
        .expect("second delete should succeed");
    let fetched = repo
        .get_foreign_entity_by_id(entity.id)
        .await
        .expect("deleted foreign entity lookup should succeed");

    assert!(first_delete);
    assert!(!second_delete);
    assert_eq!(fetched, None);
}
