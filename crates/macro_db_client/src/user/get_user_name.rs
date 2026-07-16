#[cfg(test)]
mod tests;

use macro_user_id::lowercased::Lowercase;
use macro_user_id::user_id::MacroUserId;
use model::user::UserName;
use non_empty::NonEmpty;

#[tracing::instrument(skip(db))]
pub async fn get_user_name(db: &sqlx::PgPool, macro_user_id: &str) -> anyhow::Result<UserName> {
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)?;
    let name: UserName = sqlx::query!(
        r#"
            SELECT macro_user_id, first_name, last_name FROM macro_user_info WHERE macro_user_id = $1
        "#,
        &macro_user_id
    )
    .map(|row| UserName {
        id: row.macro_user_id.to_string(), // TODO: this may mess up FE?
        first_name: row.first_name,
        last_name: row.last_name,
    })
    .fetch_one(db)
    .await?;

    Ok(name)
}

#[tracing::instrument(skip(db))]
pub async fn get_user_names(
    db: &sqlx::PgPool,
    user_profile_ids: &Vec<String>,
) -> anyhow::Result<Vec<UserName>> {
    let user_names = sqlx::query!(
        r#"
            SELECT 
                u.id as user_profile_id, 
                mui.first_name, 
                mui.last_name
            FROM macro_user_info mui
            JOIN "User" u ON mui.macro_user_id = u.macro_user_id
            WHERE u.id = ANY($1)
        "#,
        user_profile_ids
    )
    .map(|row| UserName {
        id: row.user_profile_id,
        first_name: row.first_name,
        last_name: row.last_name,
    })
    .fetch_all(db)
    .await?;

    Ok(user_names)
}

/// gets macro user names for passed user profile ids, falling back to the user's email contacts if they have any
#[tracing::instrument(skip(db), err)]
pub async fn get_user_names_with_email(
    db: &sqlx::PgPool,
    macro_user_id: &str,
    user_profile_ids: NonEmpty<Vec<MacroUserId<Lowercase<'_>>>>,
) -> anyhow::Result<Vec<UserName>> {
    let user_profile_ids_str: Vec<&str> = user_profile_ids.iter().map(|id| id.as_ref()).collect();

    let user_names = sqlx::query!(
        r#"
        WITH requested_ids AS (
            SELECT DISTINCT id
            FROM UNNEST($2::text[]) AS requested(id)
        )
        SELECT
            req.id as "user_profile_id!",
            CASE
                WHEN NULLIF(mui.first_name, 'N/A') IS NOT NULL
                  OR NULLIF(mui.last_name, 'N/A') IS NOT NULL
                THEN NULLIF(mui.first_name, 'N/A')
                ELSE SPLIT_PART(contact.name, ' ', 1)
            END as "first_name",
            CASE
                WHEN NULLIF(mui.first_name, 'N/A') IS NOT NULL
                  OR NULLIF(mui.last_name, 'N/A') IS NOT NULL
                THEN NULLIF(mui.last_name, 'N/A')
                ELSE CASE
                    WHEN POSITION(' ' IN contact.name) > 0
                    THEN NULLIF(TRIM(SUBSTRING(contact.name FROM POSITION(' ' IN contact.name) + 1)), '')
                    ELSE NULL
                END
            END as "last_name"
        FROM requested_ids req
        LEFT JOIN "User" u ON u.id = req.id
        LEFT JOIN macro_user_info mui ON mui.macro_user_id = u.macro_user_id
        LEFT JOIN LATERAL (
            SELECT ec.name
            FROM email_links li
            JOIN email_contacts ec
                ON ec.link_id = li.id
                AND ec.email_address = REPLACE(req.id, 'macro|', '')
                AND ec.name IS NOT NULL
            WHERE li.macro_id = $1
              AND NULLIF(mui.first_name, 'N/A') IS NULL
              AND NULLIF(mui.last_name, 'N/A') IS NULL
            LIMIT 1
        ) contact ON TRUE
        WHERE u.id IS NOT NULL OR contact.name IS NOT NULL
        "#,
        macro_user_id,
        &user_profile_ids_str as &[&str]
    )
        .map(|row| UserName {
            id: row.user_profile_id,
            first_name: row.first_name,
            last_name: row.last_name,
        })
        .fetch_all(db)
        .await?;

    Ok(user_names)
}
