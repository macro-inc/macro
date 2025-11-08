use std::collections::HashSet;

/// Matches a user to an organization based on their email
#[tracing::instrument(skip(db))]
pub async fn match_user_to_organization(
    db: &sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> anyhow::Result<Option<i32>> {
    let email_options = [
        email.to_string(),
        email.split('@').collect::<Vec<&str>>()[1].to_string(),
    ];

    let organization_id = sqlx::query!(
        r#"
        SELECT "organizationId" as organization_id
        FROM "OrganizationEmailMatches"
        WHERE email = ANY($1)
        "#,
        &email_options
    )
    .map(|row| row.organization_id)
    .fetch_optional(db)
    .await?;

    Ok(organization_id)
}

/// Given a users email, returns the roles that user has in the organization
/// We require the email to check for potential `OrganizationIT` and `OrganizationBilling` roles
#[tracing::instrument(skip(db))]
pub async fn get_organization_roles_for_user(
    db: &sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
    email: &str,
) -> anyhow::Result<HashSet<String>> {
    let roles = sqlx::query!(
        r#"
        SELECT "roleId" as id
        FROM "RolesOnOrganizations"
        WHERE "organizationId" = $1
        "#,
        organization_id
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    let mut roles: HashSet<String> = roles.into_iter().collect();

    // Check for organization it
    let it = sqlx::query!(
        r#"
        SELECT "organizationId" as id
        FROM "OrganizationIT"
        WHERE "email" = $1
        "#,
        email
    )
    .fetch_optional(db)
    .await?;

    if it.is_some() {
        tracing::debug!("user is an organization it contact");
        roles.insert("organization_it".to_string());
    }

    let billing = sqlx::query!(
        r#"
        SELECT "organizationId" as id
        FROM "OrganizationBilling"
        WHERE "email" = $1
        "#,
        email
    )
    .fetch_optional(db)
    .await?;

    if billing.is_some() {
        tracing::debug!("user is an organization billing contact");
        roles.insert("manage_organization_subscription".to_string());
    }

    Ok(roles)
}
