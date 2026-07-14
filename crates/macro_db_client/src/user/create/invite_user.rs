/// Inserts a users email into the organization invitations table
#[tracing::instrument(skip(db))]
pub async fn invite_user(
    db: sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
    email: &str,
    allow_list_only: bool,
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await?;
    // Insert into organization invitations
    sqlx::query!(
        r#"
        INSERT INTO "OrganizationInvitation" ("organization_id", "email")
        VALUES ($1, $2)
        "#,
        organization_id,
        email,
    )
    .execute(&mut *transaction)
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to insert organization invitation");
        if e.to_string().contains(
            "duplicate key value violates unique constraint \"OrganizationInvitation_organization_id_email_key\"",
        ) {
            return anyhow::anyhow!("user is already invited to your organization");
        }
        e.into()
    })?;

    // If organization is allow list only we need to insert the email into the organization email matches table so the user is actually associated with the organization when they login
    if allow_list_only {
        // Insert into organization email matches
        sqlx::query!(
            r#"
            INSERT INTO "OrganizationEmailMatches" ("organizationId", "email")
            VALUES ($1, $2)
            ON CONFLICT ("email") DO NOTHING
            "#,
            organization_id,
            email,
        )
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("invite_user")))]
    async fn test_invite_user(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // invite user already exists
        invite_user(pool.clone(), 1, "new@macro.com", false).await?;

        // invite user with allow list only
        invite_user(pool.clone(), 2, "new@test.com", true).await?;
        sqlx::query!(
            r#"SELECT email FROM "OrganizationInvitation" WHERE email=$1 AND organization_id = $2"#,
            "new@test.com",
            2
        )
        .fetch_one(&pool)
        .await?;

        // Test conflicts are ignored
        let result = invite_user(pool.clone(), 2, "new@test.com", true).await;
        assert_eq!(
            result.err().unwrap().to_string(),
            "user is already invited to your organization"
        );

        Ok(())
    }
}
