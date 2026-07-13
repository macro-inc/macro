async fn update(
    db: &sqlx::PgPool,
    macro_user_id: &uuid::Uuid,
    first_name: Option<String>,
    last_name: Option<String>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO macro_user_info (macro_user_id, first_name, last_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (macro_user_id)
        DO UPDATE SET 
            first_name = COALESCE(EXCLUDED.first_name, macro_user_info.first_name),
            last_name = COALESCE(EXCLUDED.last_name, macro_user_info.last_name)
    "#,
        macro_user_id,
        first_name,
        last_name
    )
    .execute(db)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(db))]
pub async fn update_user_name(
    db: &sqlx::PgPool,
    macro_user_id: &str,
    first_name: Option<String>,
    last_name: Option<String>,
) -> anyhow::Result<()> {
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)?;
    update(db, &macro_user_id, first_name, last_name).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;
    use uuid::Uuid;

    #[sqlx::test]
    async fn test_update_name_none_and_some_fields(pool: PgPool) -> anyhow::Result<()> {
        // Insert a new user
        let user_id = Uuid::new_v4();
        let orig_first = "Alice".to_string();
        let orig_last = "Smith".to_string();
        sqlx::query!(
            r#"INSERT INTO macro_user (id, stripe_customer_id, username, email) VALUES ($1, 'bogus', 'username', 'bogus')"#,
            &user_id,
        )
        .execute(&pool)
        .await?;

        sqlx::query!(
            r#"INSERT INTO macro_user_info (macro_user_id, first_name, last_name) VALUES ($1, $2, $3)"#,
            &user_id,
            orig_first,
            orig_last,
        )
        .execute(&pool)
        .await?;

        // Update with None for both fields
        update(&pool, &user_id, None, None).await?;

        // Check: Values should be unchanged
        let row = sqlx::query!(
            r#"SELECT first_name, last_name FROM macro_user_info WHERE macro_user_id = $1"#,
            &user_id
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(row.first_name, Some(orig_first.clone()));
        assert_eq!(row.last_name, Some(orig_last.clone()));

        // Update with Some for first_name
        let updated_first = "Bob".to_string();
        update(&pool, &user_id, Some(updated_first.clone()), None).await?;

        // Check: firstName should update, lastName should not
        let row = sqlx::query!(
            r#"SELECT first_name, last_name FROM macro_user_info WHERE macro_user_id = $1"#,
            &user_id
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(row.first_name, Some(updated_first.clone()));
        assert_eq!(row.last_name, Some(orig_last.clone()));

        // Update with Some for last_name, None for first_name
        let updated_last = "Jones".to_string();
        update(&pool, &user_id, None, Some(updated_last.clone())).await?;

        // lastName should update, firstName should not
        let row = sqlx::query!(
            r#"SELECT first_name, last_name FROM macro_user_info WHERE macro_user_id = $1"#,
            &user_id
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(row.first_name, Some(updated_first));
        assert_eq!(row.last_name, Some(updated_last));

        Ok(())
    }
}
