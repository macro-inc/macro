use uuid::Uuid;

#[cfg(test)]
mod test;

/// The age after which an in-progress user link is considered expired: it no longer counts
/// toward a user's in-progress link cap, and is eligible for cleanup by
/// [`delete_day_old_in_progress_user_links`].
const IN_PROGRESS_USER_LINK_MAX_AGE: chrono::Duration = chrono::Duration::hours(24);

pub async fn count_existing_in_progress_user_links_for_user(
    db: &sqlx::Pool<sqlx::Postgres>,
    macro_user_id: &str,
) -> anyhow::Result<i64> {
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)?;
    let cutoff = (chrono::Utc::now() - IN_PROGRESS_USER_LINK_MAX_AGE).naive_utc();
    let count = sqlx::query!(
        r#"
            SELECT
                COUNT(id) as count
            FROM
                in_progress_user_link
            WHERE
                macro_user_id = $1
                AND created_at > $2
        "#,
        &macro_user_id,
        cutoff
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

pub async fn delete_in_progress_user_link<'e, E>(db: E, link_id: &uuid::Uuid) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query!(
        r#"
            DELETE FROM
                in_progress_user_link
            WHERE
                id = $1
        "#,
        link_id
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Deletes all in progress email links that are older than 24 hours
pub async fn delete_day_old_in_progress_user_links(
    db: &sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    let yesterday = (chrono::Utc::now() - IN_PROGRESS_USER_LINK_MAX_AGE).naive_utc();

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
    link_id: &uuid::Uuid,
) -> anyhow::Result<Uuid> {
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
        link_id
    )
    .map(|row| row.macro_user_id)
    .fetch_one(db)
    .await?;

    Ok(link)
}

pub struct InProgressUserLink {
    pub macro_user_id: Uuid,
    pub linked_email: Option<String>,
}

pub async fn get_in_progress_user_link(
    db: &sqlx::Pool<sqlx::Postgres>,
    link_id: &uuid::Uuid,
) -> anyhow::Result<InProgressUserLink> {
    let row = sqlx::query!(
        r#"
            SELECT
                macro_user_id,
                linked_email
            FROM
                in_progress_user_link
            WHERE
                id = $1
        "#,
        link_id
    )
    .fetch_one(db)
    .await?;

    Ok(InProgressUserLink {
        macro_user_id: row.macro_user_id,
        linked_email: row.linked_email,
    })
}

pub async fn set_linked_email(
    db: &sqlx::Pool<sqlx::Postgres>,
    link_id: &uuid::Uuid,
    linked_email: &str,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
            UPDATE in_progress_user_link
            SET linked_email = $1
            WHERE id = $2
        "#,
        linked_email,
        link_id
    )
    .execute(db)
    .await?;

    if result.rows_affected() == 0 {
        anyhow::bail!("in_progress_user_link not found for link_id={link_id}");
    }

    Ok(())
}
