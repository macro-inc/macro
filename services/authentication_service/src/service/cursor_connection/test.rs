use super::*;
use cursor_api_key::cipher::EncryptedCursorApiKey;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let email = user_id.strip_prefix("macro|").unwrap_or(user_id);
    let macro_user_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $2, $3)
        "#,
        macro_user_id,
        email,
        format!("stripe_{macro_user_id}"),
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn encrypted() -> EncryptedCursorApiKey {
    EncryptedCursorApiKey {
        key_ciphertext: vec![1, 2, 3],
        encryption_version: 1,
        kms_key_id: "test-key".to_owned(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn connect_disconnect_and_reconnect_preserve_the_persona(pool: PgPool) -> anyhow::Result<()> {
    let owner = MacroUserIdStr::try_from_email("owner@macro.com")?;
    insert_user(&pool, owner.as_ref()).await?;

    connect_cursor(&pool, &owner, &encrypted()).await?;
    let first = sqlx::query!(
        "SELECT id, deleted_at FROM bots WHERE owner_user_id = $1 AND provisioning_key = 'cursor'",
        owner.as_ref(),
    )
    .fetch_one(&pool)
    .await?;
    sqlx::query!("UPDATE bots SET name = 'My Cursor' WHERE id = $1", first.id)
        .execute(&pool)
        .await?;

    disconnect_cursor(&pool, &owner).await?;
    assert!(
        cursor_api_key::store::get_cursor_api_key(&pool, owner.as_ref())
            .await?
            .is_none()
    );
    let deleted_at = sqlx::query_scalar!("SELECT deleted_at FROM bots WHERE id = $1", first.id)
        .fetch_one(&pool)
        .await?;
    assert!(deleted_at.is_some());

    connect_cursor(&pool, &owner, &encrypted()).await?;
    let restored = sqlx::query!(
        "SELECT id, name, deleted_at FROM bots WHERE id = $1",
        first.id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(restored.name, "My Cursor");
    assert!(restored.deleted_at.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn non_staff_cannot_connect_cursor(pool: PgPool) -> anyhow::Result<()> {
    let owner = MacroUserIdStr::try_from_email("owner@example.com")?;
    insert_user(&pool, owner.as_ref()).await?;

    assert!(connect_cursor(&pool, &owner, &encrypted()).await.is_err());
    assert!(
        cursor_api_key::store::get_cursor_api_key(&pool, owner.as_ref())
            .await?
            .is_none()
    );
    Ok(())
}
