use model::organization::User;

/// Gets all user ids in the database with null macro user id
pub async fn get_all_user_ids_stripe_customer_id_with_null_macro_user_id(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    cursor: Option<String>,
) -> anyhow::Result<Vec<(String, Option<String>)>> {
    let result = if let Some(cursor) = cursor {
        sqlx::query!(
            r#"
            SELECT
                u.id,
                u."stripeCustomerId" as "stripe_customer_id"
            FROM "User" u
            WHERE u."macro_user_id" IS NULL
                AND u.id > $1
            ORDER BY u.id ASC
            LIMIT $2
        "#,
            cursor,
            limit
        )
        .map(|r| (r.id, r.stripe_customer_id))
        .fetch_all(db)
        .await?
    } else {
        sqlx::query!(
            r#"
            SELECT
                u.id,
                u."stripeCustomerId" as "stripe_customer_id"
            FROM "User" u
            WHERE u."macro_user_id" IS NULL
            ORDER BY u.id ASC
            LIMIT $1
        "#,
            limit
        )
        .map(|r| (r.id, r.stripe_customer_id))
        .fetch_all(db)
        .await?
    };
    Ok(result)
}

pub async fn get_user_ids_by_organization(
    db: &sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
    limit: i64,
    offset: i64,
) -> anyhow::Result<(Vec<String>, i64)> {
    let count = sqlx::query!(
        r#"SELECT COUNT(*) as "count" FROM "User" WHERE "organizationId" = $1"#,
        organization_id
    )
    .map(|r| r.count.unwrap_or(0))
    .fetch_one(db)
    .await?;

    if count == 0 {
        return Ok((vec![], 0));
    }

    let users = sqlx::query!(
        r#"
        SELECT
            u.id as user_id
        FROM "User" u
        WHERE u."organizationId" = $1
        LIMIT $2
        OFFSET $3
    "#,
        organization_id,
        limit,
        offset
    )
    .map(|r| r.user_id)
    .fetch_all(db)
    .await?;

    Ok((users, count))
}

/// Gets all users in a given organization
/// Returns the user's id, email and whether they are an it admin or not as well as the total
/// number of users in the organization
#[tracing::instrument(skip(db))]
pub async fn get_users_by_organization(
    db: sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
    limit: i64,
    offset: i64,
) -> anyhow::Result<(Vec<User>, i64)> {
    let count = sqlx::query!(
        r#"SELECT COUNT(*) as "count" FROM "User" WHERE "organizationId" = $1"#,
        organization_id
    )
    .map(|r| r.count.unwrap_or(0))
    .fetch_one(&db)
    .await?;

    if count == 0 {
        return Ok((vec![], 0));
    }

    let users = sqlx::query!(
        r#"
        SELECT
            u.id as user_id,
            u.email as user_email,
            array_agg(DISTINCT rop."permissionId") AS permissions
        FROM "User" u
        LEFT JOIN "RolesOnUsers" rou ON rou."userId" = u.id
        LEFT JOIN "Role" r ON r.id = rou."roleId"
        LEFT JOIN "RolesOnPermissions" rop ON rop."roleId" = r.id
        WHERE u."organizationId" = $1
        GROUP BY u.id
        LIMIT $2
        OFFSET $3
    "#,
        organization_id,
        limit,
        offset
    )
    .map(|r| User {
        id: r.user_id,
        email: r.user_email,
        is_it_admin: is_it_admin(r.permissions),
    })
    .fetch_all(&db)
    .await?;

    Ok((users, count))
}

// TODO: extract to model
pub static MACRO_IT_PANEL_PERMISSION: &str = "write:it_panel";
/// Determines if a user is an it admin based on their permissions
fn is_it_admin(permissions: Option<Vec<String>>) -> bool {
    if let Some(permissions) = permissions {
        permissions.contains(&MACRO_IT_PANEL_PERMISSION.to_string())
    } else {
        false
    }
}
