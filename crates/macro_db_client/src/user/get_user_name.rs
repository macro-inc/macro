#[cfg(test)]
mod tests;

use macro_user_id::lowercased::Lowercase;
use macro_user_id::user_id::MacroUserId;
use model::user::UserName;
use non_empty::NonEmpty;

#[tracing::instrument(skip(db))]
pub async fn get_user_name(db: &sqlx::PgPool, macro_user_id: &str) -> anyhow::Result<UserName> {
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)?;
    let name: Option<UserName> = sqlx::query!(
        r#"
            SELECT
                u.macro_user_id,
                mui.first_name as "first_name?",
                mui.last_name as "last_name?",
                BOOL_OR(u."isAgent") as "is_agent!"
            FROM "User" u
            LEFT JOIN macro_user_info mui ON mui.macro_user_id = u.macro_user_id
            WHERE u.macro_user_id = $1
            GROUP BY u.macro_user_id, mui.first_name, mui.last_name
        "#,
        &macro_user_id
    )
    .map(|row| UserName {
        id: row.macro_user_id.to_string(), // TODO: this may mess up FE?
        first_name: row.first_name,
        last_name: row.last_name,
        is_agent: row.is_agent,
    })
    .fetch_optional(db)
    .await?;

    // The row is created lazily by the first name write (put_name upserts),
    // so a user who never set their name has none — that's "no name yet",
    // not an error.
    Ok(name.unwrap_or_else(|| UserName {
        id: macro_user_id.to_string(),
        first_name: None,
        last_name: None,
        is_agent: false,
    }))
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
                mui.last_name,
                u."isAgent" as is_agent
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
        is_agent: row.is_agent,
    })
    .fetch_all(db)
    .await?;

    Ok(user_names)
}

/// gets macro user names for passed user profile ids, falling back to the user's email contacts if they have any
#[tracing::instrument(skip_all, err)]
pub async fn get_user_names_with_email(
    db: &sqlx::PgPool,
    macro_user_id: &str,
    user_profile_ids: NonEmpty<Vec<MacroUserId<Lowercase<'_>>>>,
) -> anyhow::Result<Vec<UserName>> {
    let user_profile_ids_str: Vec<&str> = user_profile_ids.iter().map(|id| id.as_ref()).collect();

    let user_names = sqlx::query_file!(
        "src/user/get_user_name/names_with_email.sql",
        macro_user_id,
        &user_profile_ids_str as &[&str]
    )
    .map(|row| UserName {
        id: row.user_profile_id,
        first_name: row.first_name,
        last_name: row.last_name,
        is_agent: row.is_agent,
    })
    .fetch_all(db)
    .await?;

    Ok(user_names)
}
