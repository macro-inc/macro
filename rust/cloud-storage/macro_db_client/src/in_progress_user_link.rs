use uuid::Uuid;

pub async fn count_existing_in_progress_user_links_for_user(
    db: &sqlx::Pool<sqlx::Postgres>,
    macro_user_id: &str,
) -> anyhow::Result<i64> {
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)?;
    let count = sqlx::query!(
        r#"
            SELECT
                COUNT(id) as count
            FROM
                in_progress_user_link
            WHERE
                macro_user_id = $1
        "#,
        &macro_user_id
    )
    .map(|row| row.count)
    .fetch_one(db)
    .await?;

    Ok(count.unwrap_or(0))
}

pub async fn create_in_progress_user_link(
    db: &sqlx::Pool<sqlx::Postgres>,
    macro_user_id: &str,
) -> anyhow::Result<Uuid> {
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)?;
    let link_id = macro_uuid::generate_uuid_v7();

    sqlx::query!(
        r#"
            INSERT INTO in_progress_user_link (id, macro_user_id)
            VALUES ($1, $2)
        "#,
        &link_id,
        &macro_user_id
    )
    .execute(db)
    .await?;

    Ok(link_id)
}

pub async fn delete_in_progress_user_link(
    db: &sqlx::Pool<sqlx::Postgres>,
    link_id: &str,
) -> anyhow::Result<()> {
    let link_id = macro_uuid::string_to_uuid(link_id)?;
    sqlx::query!(
        r#"
            DELETE FROM
                in_progress_user_link
            WHERE
                id = $1
        "#,
        &link_id
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Deletes all in progress email links that are older than 24 hours
pub async fn delete_day_old_in_progress_user_links(
    db: &sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    let now = chrono::Utc::now();
    let yesterday = now - chrono::Duration::hours(24);
    let yesterday = yesterday.naive_utc();

    sqlx::query!(
        r#"
            DELETE FROM
                in_progress_user_link
            WHERE
                created_at < $1
        "#,
        yesterday
    )
    .execute(db)
    .await?;

    Ok(())
}

pub async fn get_macro_user_id_by_link_id(
    db: &sqlx::Pool<sqlx::Postgres>,
    link_id: &str,
) -> anyhow::Result<Uuid> {
    let link_id = macro_uuid::string_to_uuid(link_id)?;
    let link = sqlx::query!(
        r#"
            SELECT
                id,
                macro_user_id
            FROM
                in_progress_user_link
            WHERE
                id = $1
        "#,
        &link_id
    )
    .map(|row| row.macro_user_id)
    .fetch_one(db)
    .await?;

    Ok(link)
}
