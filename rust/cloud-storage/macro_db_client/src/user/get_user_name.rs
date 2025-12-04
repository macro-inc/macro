use model::user::UserName;

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
#[tracing::instrument(skip(db))]
pub async fn get_user_names_with_email(
    db: &sqlx::PgPool,
    macro_user_id: &str,
    user_profile_ids: &Vec<String>,
) -> anyhow::Result<Vec<UserName>> {
    let user_names = sqlx::query!(
        r#"
        WITH requested_ids AS (
            SELECT UNNEST($2::text[]) as id
        ),
        user_links AS (
            SELECT id as link_id
            FROM email_links
            WHERE macro_id = $1
        ),
        users_found AS (
            SELECT
                u.id as user_profile_id,
                mui.first_name as mui_first_name,
                mui.last_name as mui_last_name
            FROM requested_ids req
            JOIN "User" u ON u.id = req.id
            LEFT JOIN macro_user_info mui ON u.macro_user_id = mui.macro_user_id
        ),
        contacts_requested AS (
            SELECT
                req.id as user_profile_id,
                ec.name as contact_name
            FROM requested_ids req
            CROSS JOIN user_links li
            JOIN email_contacts ec
                ON ec.link_id = li.link_id
                AND ec.email_address = REPLACE(req.id, 'macro|', '')
                AND ec.name IS NOT NULL
        )
        SELECT DISTINCT ON (user_profile_id)
            user_profile_id as "user_profile_id!",
            -- user's name in macro takes precedence over email contact name
            COALESCE(
                NULLIF(mui_first_name, 'N/A'),
                -- first word in email contact name is approximation of first name
                SPLIT_PART(contact_name, ' ', 1)
            ) as "first_name",
            -- user's name in macro takes precedence over email contact name
            COALESCE(
                NULLIF(mui_last_name, 'N/A'),
                CASE
                    -- if there is a space in the email contact name, the rest is the last name
                    WHEN POSITION(' ' IN contact_name) > 0
                    THEN NULLIF(TRIM(SUBSTRING(contact_name FROM POSITION(' ' IN contact_name) + 1)), '')
                    ELSE NULL
                END
            ) as "last_name"
        FROM (
            -- Users in User table with contact fallback (in case user hasn't set name in Macro)
            SELECT
                uf.user_profile_id,
                uf.mui_first_name,
                uf.mui_last_name,
                cr.contact_name
            FROM users_found uf
            LEFT JOIN contacts_requested cr ON cr.user_profile_id = uf.user_profile_id

            UNION ALL

            -- People only in email_contacts (haven't joined Macro yet)
            SELECT
                cr.user_profile_id,
                NULL::text as mui_first_name,
                NULL::text as mui_last_name,
                cr.contact_name
            FROM contacts_requested cr
            WHERE NOT EXISTS (
                SELECT 1
                FROM users_found uf
                WHERE uf.user_profile_id = cr.user_profile_id
            )
        ) combined
        ORDER BY user_profile_id
        "#,
        macro_user_id,
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

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_names_with_email")))]
    async fn test_get_user_names_with_email_basic(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_profile_ids = vec![
            "macro|user_profile_1@macro.com".to_string(),
            "macro|user_profile_2@macro.com".to_string(),
        ];

        let names =
            get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", &user_profile_ids)
                .await?;

        assert_eq!(names.len(), 2);

        let john = names
            .iter()
            .find(|n| n.id == "macro|user_profile_1@macro.com")
            .unwrap();
        assert_eq!(john.first_name, Some("JohnMacroContact".to_string()));
        assert_eq!(john.last_name, Some("DoeMacroContact".to_string()));

        let jane = names
            .iter()
            .find(|n| n.id == "macro|user_profile_2@macro.com")
            .unwrap();
        assert_eq!(jane.first_name, Some("JaneMacroContact".to_string()));
        assert_eq!(jane.last_name, Some("SmithMacroContact".to_string()));

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_names_with_email")))]
    async fn test_get_user_names_with_email_fallback_to_contact(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        // User with N/A name should fall back to email contact name
        let user_profile_ids = vec!["macro|user_profile_3@macro.com".to_string()];

        let names =
            get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", &user_profile_ids)
                .await?;

        assert_eq!(names.len(), 1);

        let bob = &names[0];
        assert_eq!(bob.id, "macro|user_profile_3@macro.com");
        assert_eq!(bob.first_name, Some("BobEmailContact".to_string()));
        assert_eq!(bob.last_name, Some("JohnsonEmailContact".to_string()));

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_names_with_email")))]
    async fn test_get_user_names_with_email_contact_only(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        // User not in User table, only in email_contacts
        let user_profile_ids = vec!["macro|contact@example.com".to_string()];

        let names =
            get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", &user_profile_ids)
                .await?;

        assert_eq!(names.len(), 1);

        let alice = &names[0];
        assert_eq!(alice.id, "macro|contact@example.com");
        assert_eq!(alice.first_name, Some("AliceEmailContact".to_string()));
        assert_eq!(alice.last_name, Some("WilliamsEmailContact".to_string()));

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_names_with_email")))]
    async fn test_get_user_names_with_email_mixed(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Mix of users with names, N/A fallback, and contact-only
        let user_profile_ids = vec![
            "macro|user_profile_1@macro.com".to_string(),
            "macro|user_profile_3@macro.com".to_string(),
            "macro|contact@example.com".to_string(),
        ];

        let names =
            get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", &user_profile_ids)
                .await?;

        assert_eq!(names.len(), 3);

        let john = names
            .iter()
            .find(|n| n.id == "macro|user_profile_1@macro.com")
            .unwrap();
        assert_eq!(john.first_name, Some("JohnMacroContact".to_string()));
        assert_eq!(john.last_name, Some("DoeMacroContact".to_string()));

        let bob = names
            .iter()
            .find(|n| n.id == "macro|user_profile_3@macro.com")
            .unwrap();
        assert_eq!(bob.first_name, Some("BobEmailContact".to_string()));
        assert_eq!(bob.last_name, Some("JohnsonEmailContact".to_string()));

        let alice = names
            .iter()
            .find(|n| n.id == "macro|contact@example.com")
            .unwrap();
        assert_eq!(alice.first_name, Some("AliceEmailContact".to_string()));
        assert_eq!(alice.last_name, Some("WilliamsEmailContact".to_string()));

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_names_with_email")))]
    async fn test_get_user_names_with_email_empty_list(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_profile_ids = vec![];

        let names =
            get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", &user_profile_ids)
                .await?;

        assert_eq!(names.len(), 0);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_names_with_email")))]
    async fn test_get_user_names_with_email_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_profile_ids = vec!["nonexistent_user".to_string()];

        let names =
            get_user_names_with_email(&pool, "macro|user_profile_1@macro.com", &user_profile_ids)
                .await?;

        // Should return empty list for users that don't exist
        assert_eq!(names.len(), 0);

        Ok(())
    }
}
