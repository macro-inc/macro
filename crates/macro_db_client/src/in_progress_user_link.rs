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
                AND refused_at IS NULL
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

/// Create an in-progress Google link and record the exact scopes requested.
pub async fn create_in_progress_google_link(
    db: &sqlx::Pool<sqlx::Postgres>,
    macro_user_id: &str,
    requested_google_scopes: &[String],
) -> anyhow::Result<Uuid> {
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)?;
    let link_id = macro_uuid::generate_uuid_v7();

    sqlx::query!(
        r#"
            INSERT INTO in_progress_user_link (
                id,
                macro_user_id,
                requested_google_scopes
            )
            VALUES ($1, $2, $3)
        "#,
        &link_id,
        &macro_user_id,
        requested_google_scopes
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

/// Deletes all in progress email links that are older than 24 hours, except
/// those whose Google identity link the auth service must release first
/// ([`identity_link_attempts_to_release`]).
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
                AND NOT identity_link_created
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
    pub email_provider: String,
    pub macro_user_id: Uuid,
    pub linked_email: Option<String>,
    /// Scopes Macro placed on the authorization request.
    pub requested_google_scopes: Vec<String>,
    /// Actual scopes returned by Google's token exchange.
    pub granted_google_scopes: Vec<String>,
}

pub async fn get_in_progress_user_link(
    db: &sqlx::Pool<sqlx::Postgres>,
    link_id: &uuid::Uuid,
) -> anyhow::Result<InProgressUserLink> {
    let row = sqlx::query!(
        r#"
            SELECT
                email_provider::text AS "email_provider!",
                macro_user_id,
                linked_email,
                requested_google_scopes,
                granted_google_scopes
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
        email_provider: row.email_provider,
        macro_user_id: row.macro_user_id,
        linked_email: row.linked_email,
        requested_google_scopes: row.requested_google_scopes,
        granted_google_scopes: row.granted_google_scopes,
    })
}

/// Drops a refused linking attempt: deletes it, or, when it linked a Google
/// identity the auth service must release, marks it refused for that release.
/// Cleanup must not let a caller drop another principal's linking attempt.
pub async fn discard_owned_in_progress_user_link(
    db: &sqlx::PgPool,
    link_id: Uuid,
    owner: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            WITH refused AS (
                UPDATE in_progress_user_link SET refused_at = now()
                WHERE id = $1 AND macro_user_id::text = $2 AND identity_link_created
            )
            DELETE FROM in_progress_user_link
            WHERE id = $1 AND macro_user_id::text = $2 AND NOT identity_link_created
        "#,
        link_id,
        owner
    )
    .execute(db)
    .await?;
    Ok(())
}

/// A linking attempt whose Google identity link is due for release: it was
/// refused, or it lapsed unconsumed.
pub struct IdentityLinkAttempt {
    pub id: Uuid,
    pub fusionauth_user_id: Uuid,
    pub linked_email: String,
}

/// Attempts that created a Google identity link and ended without an inbox,
/// oldest first, at most `limit`.
pub async fn identity_link_attempts_to_release(
    db: &sqlx::PgPool,
    limit: i64,
) -> anyhow::Result<Vec<IdentityLinkAttempt>> {
    let cutoff = (chrono::Utc::now() - IN_PROGRESS_USER_LINK_MAX_AGE).naive_utc();
    Ok(sqlx::query_as!(
        IdentityLinkAttempt,
        r#"
            SELECT id, macro_user_id AS fusionauth_user_id, linked_email AS "linked_email!"
            FROM in_progress_user_link
            WHERE identity_link_created
                AND linked_email IS NOT NULL
                AND (refused_at IS NOT NULL OR created_at < $1)
            ORDER BY created_at
            LIMIT $2
        "#,
        cutoff,
        limit
    )
    .fetch_all(db)
    .await?)
}

/// Whether `requester` has another attempt for `linked_email` under way: past
/// the Google callback, neither refused nor lapsed. Its callback may be using
/// the identity link `attempt` created, whichever attempt started first.
pub async fn has_live_attempt_for_address(
    db: &sqlx::PgPool,
    attempt: Uuid,
    requester: Uuid,
    linked_email: &str,
) -> anyhow::Result<bool> {
    let cutoff = (chrono::Utc::now() - IN_PROGRESS_USER_LINK_MAX_AGE).naive_utc();
    Ok(sqlx::query_scalar!(
        r#"
            SELECT EXISTS(
                SELECT 1 FROM in_progress_user_link
                WHERE macro_user_id = $1
                    AND id <> $2
                    AND lower(linked_email) = lower($3)
                    AND refused_at IS NULL
                    AND created_at >= $4
            ) AS "live!"
        "#,
        requester,
        attempt,
        linked_email,
        cutoff
    )
    .fetch_one(db)
    .await?)
}

/// Record the identity and actual scopes returned by Google's OAuth callback,
/// and whether this attempt created the identity's FusionAuth link.
pub async fn set_linked_google_grant(
    db: &sqlx::Pool<sqlx::Postgres>,
    link_id: &uuid::Uuid,
    linked_email: &str,
    granted_google_scopes: &[String],
    identity_link_created: bool,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
            UPDATE in_progress_user_link
            SET linked_email = $1,
                granted_google_scopes = $2,
                identity_link_created = $4
            WHERE id = $3
        "#,
        linked_email,
        granted_google_scopes,
        link_id,
        identity_link_created
    )
    .execute(db)
    .await?;

    if result.rows_affected() == 0 {
        anyhow::bail!("in_progress_user_link not found for link_id={link_id}");
    }

    Ok(())
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
