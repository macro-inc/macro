use super::*;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::SaveBomPart;
use models_permissions::share_permission::SharePermissionV2;
use sqlx::{Pool, Postgres, Row};

const USER_ID: &str = "macro|user@user.com";

async fn assert_owned_document_rows(
    pool: &Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<()> {
    let document_uuid = macro_uuid::string_to_uuid(document_id)?;
    let entity = sqlx::query(
        r#"
        SELECT
            owner_type::text AS owner_type,
            owner_id,
            entity_type,
            deleted_at
        FROM entity
        WHERE id = $1
        "#,
    )
    .bind(document_uuid)
    .fetch_one(pool)
    .await?;
    assert_eq!(entity.get::<String, _>("owner_type"), "user");
    assert_eq!(entity.get::<String, _>("owner_id"), USER_ID);
    assert_eq!(entity.get::<String, _>("entity_type"), "document");
    assert_eq!(
        entity.get::<Option<chrono::DateTime<chrono::Utc>>, _>("deleted_at"),
        None
    );

    let access_level: String = sqlx::query_scalar(
        r#"
        SELECT access_level::text
        FROM entity_access
        WHERE entity_id = $1
          AND source_id = $2
          AND granted_from_project_id IS NULL
        "#,
    )
    .bind(document_uuid)
    .bind(USER_ID)
    .fetch_one(pool)
    .await?;
    assert_eq!(access_level, "owner");
    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_with_documents")))]
async fn create_onboarding_documents_registers_entity_and_owner_grant(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str(USER_ID)?.into_owned();
    let share_permission = SharePermissionV2::new_project_share_permission(None);

    let mut transaction = pool.begin().await?;
    let project = create_project_transaction(
        &mut transaction,
        user_id.copied(),
        "Starter Docs",
        None,
        &share_permission,
    )
    .await?;
    let documents = create_onboarding_documents(
        &mut transaction,
        user_id.clone(),
        &project.id,
        &share_permission,
        vec![("Alpha".into(), "md".into()), ("Beta".into(), "pdf".into())],
    )
    .await?;
    transaction.commit().await?;

    assert_eq!(documents.len(), 2);
    for document in &documents {
        assert_owned_document_rows(&pool, &document.document_id).await?;
    }
    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_with_documents")))]
async fn create_onboarding_docx_registers_entity_and_owner_grant(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let user_id = MacroUserIdStr::parse_from_str(USER_ID)?.into_owned();
    let share_permission = SharePermissionV2::new_project_share_permission(None);

    let mut transaction = pool.begin().await?;
    let project = create_project_transaction(
        &mut transaction,
        user_id.copied(),
        "Starter Docs",
        None,
        &share_permission,
    )
    .await?;
    let document = create_onboarding_docx(
        &mut transaction,
        user_id.clone(),
        &project.id,
        &share_permission,
        "Onboarding Docx",
        vec![SaveBomPart {
            sha: "sha".into(),
            path: "path".into(),
        }],
    )
    .await?;
    transaction.commit().await?;

    assert_owned_document_rows(&pool, &document.document_id).await?;
    Ok(())
}
