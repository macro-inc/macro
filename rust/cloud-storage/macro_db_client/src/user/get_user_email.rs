use model::user::UserInfo;
use sqlx::{Pool, Postgres, Transaction};

#[tracing::instrument(skip(db))]
pub async fn get_user_by_email(db: Pool<Postgres>, email: &str) -> anyhow::Result<UserInfo> {
    let result: UserInfo = sqlx::query!(
        r#"
        SELECT
            u.id,
            u."organizationId" as organization_id
        FROM
            "User" u
        WHERE
            u.email = $1
        "#,
        email,
    )
    .map(|r| UserInfo {
        id: r.id,
        email: email.to_string(),
        organization_id: r.organization_id,
    })
    .fetch_one(&db)
    .await?;

    Ok(result)
}

#[tracing::instrument(skip(transaction))]
pub async fn get_user_email(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
) -> anyhow::Result<String> {
    let result = sqlx::query!(
        r#"
        SELECT
            u.email
        FROM
            "User" u
        WHERE
            u.id = $1
        "#,
        user_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    Ok(result.email)
}

#[tracing::instrument(skip(transaction))]
pub async fn get_users_ids_from_emails(
    transaction: &mut Transaction<'_, Postgres>,
    user_ids: Vec<String>,
) -> Result<Vec<String>, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        SELECT
            u.id
        FROM
            "User" u
        WHERE
            u.email = ANY($1)
        "#,
        &user_ids,
    )
    .fetch_all(transaction.as_mut())
    .await?;

    Ok(result.into_iter().map(|r| r.id).collect())
}
