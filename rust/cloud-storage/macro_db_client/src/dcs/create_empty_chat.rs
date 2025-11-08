use model::IDWithTimeStamps;
use sqlx::{Postgres, Transaction};

#[tracing::instrument(skip(transaction))]
pub async fn create_empty_chat(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    name: &str,
    model: &str,
    project_id: Option<&str>,
    is_persistent: bool,
) -> anyhow::Result<IDWithTimeStamps> {
    let chat = sqlx::query_as!(
        IDWithTimeStamps,
        r#"
                INSERT INTO "Chat" ("userId", name, model, "projectId", "isPersistent")
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
            "#,
        &user_id,
        &name,
        model,
        project_id,
        is_persistent
    )
    .fetch_one(&mut **transaction)
    .await?;

    Ok(chat)
}
