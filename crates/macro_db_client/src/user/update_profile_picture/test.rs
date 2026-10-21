use super::*;
use sqlx::PgPool;
use uuid::Uuid;

const GOOGLE_PHOTO: &str = "https://static-file-service.macro.com/file/google-photo";
const NEW_GOOGLE_PHOTO: &str = "https://static-file-service.macro.com/file/new-google-photo";
const CUSTOM_PHOTO: &str = "https://static-file-service.macro.com/file/custom-photo";

async fn insert_user(pool: &PgPool, profile_picture: Option<&str>) -> anyhow::Result<Uuid> {
    let user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, stripe_customer_id, username, email) VALUES ($1, 'bogus', $2, $2)"#,
        &user_id,
        user_id.to_string(),
    )
    .execute(pool)
    .await?;

    if let Some(profile_picture) = profile_picture {
        update_profile_picture(pool, &user_id.to_string(), profile_picture, "000").await?;
    }

    Ok(user_id)
}

async fn profile_picture(pool: &PgPool, user_id: &Uuid) -> anyhow::Result<Option<String>> {
    let picture = sqlx::query_scalar!(
        r#"SELECT profile_picture FROM macro_user_info WHERE macro_user_id = $1"#,
        user_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(picture.flatten())
}

#[sqlx::test]
async fn import_profile_picture_fills_a_user_without_profile_info(
    pool: PgPool,
) -> anyhow::Result<()> {
    let user_id = insert_user(&pool, None).await?;

    let changed = import_profile_picture(&pool, &user_id.to_string(), GOOGLE_PHOTO, None).await?;

    assert!(changed);
    assert_eq!(
        profile_picture(&pool, &user_id).await?.as_deref(),
        Some(GOOGLE_PHOTO)
    );
    Ok(())
}

#[sqlx::test]
async fn import_profile_picture_fills_a_never_set_picture(pool: PgPool) -> anyhow::Result<()> {
    let user_id = insert_user(&pool, None).await?;
    sqlx::query!(
        r#"INSERT INTO macro_user_info (macro_user_id, first_name) VALUES ($1, 'Alice')"#,
        &user_id
    )
    .execute(&pool)
    .await?;

    let changed = import_profile_picture(&pool, &user_id.to_string(), GOOGLE_PHOTO, None).await?;

    assert!(changed);
    assert_eq!(
        profile_picture(&pool, &user_id).await?.as_deref(),
        Some(GOOGLE_PHOTO)
    );
    Ok(())
}

#[sqlx::test]
async fn import_profile_picture_follows_a_changed_google_photo(pool: PgPool) -> anyhow::Result<()> {
    let user_id = insert_user(&pool, None).await?;
    import_profile_picture(&pool, &user_id.to_string(), GOOGLE_PHOTO, None).await?;

    let changed = import_profile_picture(
        &pool,
        &user_id.to_string(),
        NEW_GOOGLE_PHOTO,
        Some(GOOGLE_PHOTO),
    )
    .await?;

    assert!(changed);
    assert_eq!(
        profile_picture(&pool, &user_id).await?.as_deref(),
        Some(NEW_GOOGLE_PHOTO)
    );
    Ok(())
}

#[sqlx::test]
async fn import_profile_picture_keeps_a_custom_upload(pool: PgPool) -> anyhow::Result<()> {
    let user_id = insert_user(&pool, Some(CUSTOM_PHOTO)).await?;

    let changed = import_profile_picture(
        &pool,
        &user_id.to_string(),
        NEW_GOOGLE_PHOTO,
        Some(GOOGLE_PHOTO),
    )
    .await?;

    assert!(!changed);
    assert_eq!(
        profile_picture(&pool, &user_id).await?.as_deref(),
        Some(CUSTOM_PHOTO)
    );
    Ok(())
}

#[sqlx::test]
async fn import_profile_picture_keeps_a_removed_picture(pool: PgPool) -> anyhow::Result<()> {
    let user_id = insert_user(&pool, Some("")).await?;

    // Even a previous import that is itself empty must not reopen a removal.
    let changed =
        import_profile_picture(&pool, &user_id.to_string(), GOOGLE_PHOTO, Some("")).await?;

    assert!(!changed);
    assert_eq!(profile_picture(&pool, &user_id).await?.as_deref(), Some(""));
    Ok(())
}

#[sqlx::test]
async fn import_profile_picture_reports_no_change_for_the_same_photo(
    pool: PgPool,
) -> anyhow::Result<()> {
    let user_id = insert_user(&pool, None).await?;
    import_profile_picture(&pool, &user_id.to_string(), GOOGLE_PHOTO, None).await?;

    let changed = import_profile_picture(
        &pool,
        &user_id.to_string(),
        GOOGLE_PHOTO,
        Some(GOOGLE_PHOTO),
    )
    .await?;

    assert!(!changed);
    Ok(())
}
