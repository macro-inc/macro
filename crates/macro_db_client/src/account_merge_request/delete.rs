pub async fn delete_account_merge_request(
    db: &sqlx::Pool<sqlx::Postgres>,
    account_merge_request_id: &str,
) -> anyhow::Result<()> {
    let account_merge_request_id = macro_uuid::string_to_uuid(account_merge_request_id)?;

    sqlx::query!(
        r#"
        DELETE FROM "account_merge_request"
        WHERE "id" = $1
    "#,
        &account_merge_request_id
    )
    .execute(db)
    .await?;

    Ok(())
}
