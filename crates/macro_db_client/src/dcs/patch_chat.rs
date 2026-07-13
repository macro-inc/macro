use sqlx::{Pool, Postgres, Transaction};

#[tracing::instrument(skip(db))]
pub async fn patch_chat(
    db: &Pool<Postgres>,
    chat_id: &str,
    name: Option<&str>,
    project_id: Option<&str>,
    model: Option<&str>,
    token_count: Option<&i64>,
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await?;
    patch_chat_transaction(
        &mut transaction,
        chat_id,
        name,
        project_id,
        model,
        token_count,
    )
    .await?;
    transaction.commit().await?;
    Ok(())
}

/// Patches a chat
#[tracing::instrument(skip(transaction))]
pub async fn patch_chat_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    chat_id: &str,
    name: Option<&str>,
    project_id: Option<&str>,
    model: Option<&str>,
    token_count: Option<&i64>,
) -> anyhow::Result<()> {
    // Update compare updated at time
    sqlx::query!(
        r#"
        UPDATE "Chat" SET "updatedAt" = NOW()
        WHERE id = $1
        "#,
        chat_id,
    )
    .execute(transaction.as_mut())
    .await?;

    if let Some(name) = name {
        sqlx::query!(
            r#"
            UPDATE "Chat" SET "name" = $1
            WHERE id = $2
            "#,
            name,
            chat_id,
        )
        .execute(transaction.as_mut())
        .await?;
    }

    if let Some(model) = model {
        sqlx::query!(
            r#"
            UPDATE "Chat" SET "model" = $1
            WHERE id = $2
            "#,
            model,
            chat_id,
        )
        .execute(transaction.as_mut())
        .await?;
    }

    if let Some(project_id) = project_id {
        if project_id.is_empty() {
            sqlx::query!(
                r#"
            UPDATE "Chat" SET "projectId" = NULL
            WHERE id = $1
            "#,
                chat_id,
            )
            .execute(transaction.as_mut())
            .await?;
        } else {
            sqlx::query!(
                r#"
            UPDATE "Chat" SET "projectId" = $1
            WHERE id = $2
            "#,
                project_id,
                chat_id,
            )
            .execute(transaction.as_mut())
            .await?;
        }
    }

    if let Some(token_count) = token_count {
        sqlx::query!(
            r#"
            UPDATE "Chat" SET "tokenCount" = $1
            WHERE id = $2
            "#,
            token_count,
            chat_id,
        )
        .execute(transaction.as_mut())
        .await?;
    }

    Ok(())
}
