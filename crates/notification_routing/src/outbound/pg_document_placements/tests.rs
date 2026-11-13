use macro_db_migrator::MACRO_DB_MIGRATIONS;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};
use uuid::Uuid;

use super::*;

const OWNER: &str = "macro|placement-owner@example.com";

fn placements(
    pool: PgPool,
) -> PgDocumentPlacements<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>> {
    PgDocumentPlacements::new(
        pool.clone(),
        SystemPropertiesServiceImpl::new(PgSystemPropertiesRepository::new(pool)),
    )
}

async fn insert_owner(pool: &PgPool) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        macro_user_id,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        OWNER,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_folder(pool: &PgPool, id: &str, parent: Option<&str>) {
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId", "parentId") VALUES ($1, $1, $2, $3)"#,
        id,
        OWNER,
        parent,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_document(pool: &PgPool, id: &str, folder: Option<&str>) {
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, "fileType", owner, "projectId")
        VALUES ($1, $1, 'md', $2, $3)"#,
        id,
        OWNER,
        folder,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_document_is_in_its_folder_and_every_folder_above(pool: PgPool) {
    insert_owner(&pool).await;
    insert_folder(&pool, "folder-top", None).await;
    insert_folder(&pool, "folder-middle", Some("folder-top")).await;
    insert_folder(&pool, "folder-leaf", Some("folder-middle")).await;
    insert_folder(&pool, "folder-sibling", Some("folder-top")).await;
    insert_document(&pool, "document-filed", Some("folder-leaf")).await;
    insert_document(&pool, "document-loose", None).await;
    let placements = placements(pool);

    let mut filed = placements.placement("document-filed", false).await.unwrap();
    filed.folders.sort();
    assert_eq!(
        filed,
        DocumentPlacement {
            folders: vec![
                "folder-leaf".to_string(),
                "folder-middle".to_string(),
                "folder-top".to_string()
            ],
            project: None,
        }
    );

    assert_eq!(
        placements.placement("document-loose", false).await.unwrap(),
        DocumentPlacement::default()
    );
    assert_eq!(
        placements.placement("document-gone", false).await.unwrap(),
        DocumentPlacement::default()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_task_is_in_the_project_its_property_names(pool: PgPool) {
    insert_owner(&pool).await;
    insert_document(&pool, "task-in-project", None).await;
    insert_document(&pool, "task-without", None).await;
    let project = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES ($1, 'task-in-project', 'TASK', '00000001-0000-0000-0000-000000000014',
            jsonb_build_object('type', 'EntityReference', 'value', jsonb_build_array(
                jsonb_build_object('entity_id', $2::text, 'entity_type', 'INITIATIVE'))))"#,
        Uuid::now_v7(),
        project.to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let placements = placements(pool);

    assert_eq!(
        placements
            .placement("task-in-project", true)
            .await
            .unwrap()
            .project,
        Some(project.to_string())
    );
    assert_eq!(
        placements
            .placement("task-without", true)
            .await
            .unwrap()
            .project,
        None
    );
    // The project is a task property, so it is not read for other documents.
    assert_eq!(
        placements
            .placement("task-in-project", false)
            .await
            .unwrap()
            .project,
        None
    );
}
