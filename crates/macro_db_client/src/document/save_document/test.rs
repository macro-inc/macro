use super::*;
use model_entity::{AppearanceColor, AppearanceIcon, EntityAppearance};

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_with_documents")))]
async fn content_save_returns_the_stored_appearance(pool: PgPool) -> anyhow::Result<()> {
    let appearance = EntityAppearance {
        icon: Some(AppearanceIcon::Macro {
            name: "star".into(),
        }),
        color: Some(AppearanceColor::Blue),
    };
    sqlx::query!(
        r#"UPDATE "Document" SET "fileType" = 'md', appearance = $2 WHERE id = $1"#,
        "document-one",
        sqlx::types::Json(&appearance) as _,
    )
    .execute(&pool)
    .await?;

    let saved = save_document(&pool, "document-one", FileType::Md, Some("sha"), None, None).await?;
    assert_eq!(saved.appearance, Some(appearance));
    assert_eq!(saved.file_type.as_deref(), Some("md"));
    Ok(())
}
