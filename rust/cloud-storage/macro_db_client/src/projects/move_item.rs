use sqlx::{Postgres, Transaction};

#[tracing::instrument(skip(transaction))]
pub async fn move_item_to_project(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<()> {
    let project_id = if project_id.is_empty() {
        None
    } else {
        Some(project_id)
    };

    match item_type {
        "document" => {
            sqlx::query!(
                r#"UPDATE "Document" SET "projectId"=$2 WHERE "id"=$1"#,
                item_id,
                project_id
            )
            .execute(transaction.as_mut())
            .await?;
        }
        "chat" => {
            sqlx::query!(
                r#"UPDATE "Chat" SET "projectId"=$2 WHERE "id"=$1"#,
                item_id,
                project_id
            )
            .execute(transaction.as_mut())
            .await?;
        }
        "project" => {
            sqlx::query!(
                r#"UPDATE "Project" SET "parentId"=$2 WHERE "id"=$1"#,
                item_id,
                project_id
            )
            .execute(transaction.as_mut())
            .await?;
        }
        _ => {
            return Err(anyhow::anyhow!("Invalid item type"));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_lots_of_documents")))]
    async fn test_move_item_to_project(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        move_item_to_project(&mut transaction, "", "document-one", "document").await?;
        transaction.commit().await?;

        Ok(())
    }
}
