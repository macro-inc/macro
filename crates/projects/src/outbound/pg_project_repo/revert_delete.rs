use model_owner::Owner;
use sqlx::{Postgres, Transaction};

use crate::domain::models::RevertDeleteResult;

pub(super) async fn revert_delete_project(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
    previous_parent_id: Option<&str>,
) -> Result<RevertDeleteResult, sqlx::Error> {
    let projects = sqlx::query!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT id, "userId" AS user_id
            FROM "Project" WHERE id = $1 AND "deletedAt" IS NOT NULL
            UNION ALL
            SELECT child.id, child."userId" AS user_id
            FROM "Project" child
            JOIN project_hierarchy parent ON child."parentId" = parent.id
            WHERE child."deletedAt" IS NOT NULL
        )
        SELECT id AS "id!", user_id AS "user_id!" FROM project_hierarchy
        "#,
        project_id,
    )
    .fetch_all(transaction.as_mut())
    .await?;
    let project_ids = projects
        .iter()
        .map(|row| row.id.clone())
        .collect::<Vec<_>>();
    let project_owner_ids = projects
        .iter()
        .map(|row| row.user_id.clone())
        .collect::<Vec<_>>();

    let documents = sqlx::query!(
        r#"
        SELECT id, owner FROM "Document"
        WHERE "projectId" = ANY($1) AND "deletedAt" IS NOT NULL
        "#,
        &project_ids,
    )
    .fetch_all(transaction.as_mut())
    .await?;
    let chats = sqlx::query!(
        r#"
        SELECT id, "userId" AS user_id FROM "Chat"
        WHERE "projectId" = ANY($1) AND "deletedAt" IS NOT NULL
        "#,
        &project_ids,
    )
    .fetch_all(transaction.as_mut())
    .await?;
    let document_ids = documents
        .iter()
        .map(|row| row.id.clone())
        .collect::<Vec<_>>();
    let document_owner_ids = documents
        .iter()
        .map(|row| row.owner.clone())
        .collect::<Vec<_>>();
    let chat_ids = chats.iter().map(|row| row.id.clone()).collect::<Vec<_>>();
    let chat_owner_ids = chats
        .iter()
        .map(|row| row.user_id.clone())
        .collect::<Vec<_>>();

    restore_items(transaction, "chat", &chat_ids, &chat_owner_ids).await?;
    restore_items(transaction, "document", &document_ids, &document_owner_ids).await?;
    restore_items(transaction, "project", &project_ids, &project_owner_ids).await?;
    let restored_ids = project_ids
        .iter()
        .chain(&document_ids)
        .chain(&chat_ids)
        .cloned()
        .collect::<Vec<_>>();
    clear_registered_entities(transaction, &restored_ids).await?;

    if let Some(parent_id) = previous_parent_id {
        let parent_is_deleted = sqlx::query_scalar!(
            r#"SELECT "deletedAt" IS NOT NULL AS "is_deleted!" FROM "Project" WHERE id = $1"#,
            parent_id,
        )
        .fetch_optional(transaction.as_mut())
        .await?
        .unwrap_or(false);
        if parent_is_deleted {
            sqlx::query!(
                r#"UPDATE "Project" SET "parentId" = NULL WHERE id = $1"#,
                project_id,
            )
            .execute(transaction.as_mut())
            .await?;
        }
    }

    Ok(RevertDeleteResult {
        project_ids,
        document_ids,
        chat_ids,
    })
}

async fn restore_items(
    transaction: &mut Transaction<'_, Postgres>,
    item_type: &str,
    item_ids: &[String],
    owner_ids: &[String],
) -> Result<(), sqlx::Error> {
    match item_type {
        "chat" => {
            sqlx::query!(
                r#"UPDATE "Chat" SET "deletedAt" = NULL WHERE id = ANY($1)"#,
                item_ids
            )
            .execute(transaction.as_mut())
            .await?
        }
        "document" => {
            sqlx::query!(
                r#"UPDATE "Document" SET "deletedAt" = NULL WHERE id = ANY($1)"#,
                item_ids
            )
            .execute(transaction.as_mut())
            .await?
        }
        "project" => {
            sqlx::query!(
                r#"UPDATE "Project" SET "deletedAt" = NULL WHERE id = ANY($1)"#,
                item_ids
            )
            .execute(transaction.as_mut())
            .await?
        }
        _ => unreachable!("known item type"),
    };
    let (history_item_ids, history_owner_ids) = user_history_pairs(item_ids, owner_ids)?;
    sqlx::query!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        SELECT value.owner_id, value.item_id, $3, NOW(), NOW()
        FROM UNNEST($1::text[], $2::text[]) AS value(item_id, owner_id)
        ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE
        SET "updatedAt" = NOW()
        "#,
        &history_item_ids,
        &history_owner_ids,
        item_type,
    )
    .execute(transaction.as_mut())
    .await?;
    Ok(())
}

fn user_history_pairs(
    item_ids: &[String],
    owner_ids: &[String],
) -> Result<(Vec<String>, Vec<String>), sqlx::Error> {
    item_ids
        .iter()
        .zip(owner_ids)
        .filter_map(
            |(item_id, owner_id)| match Owner::from_principal_str(owner_id) {
                Ok(Owner::User(user_id)) => Some(Ok((item_id.clone(), user_id.to_string()))),
                Ok(Owner::Bot(_) | Owner::Team(_)) => None,
                Err(error) => Some(Err(sqlx::Error::Decode(Box::new(error)))),
            },
        )
        .collect::<Result<Vec<_>, _>>()
        .map(|pairs| pairs.into_iter().unzip())
}

async fn clear_registered_entities(
    transaction: &mut Transaction<'_, Postgres>,
    ids: &[String],
) -> Result<(), sqlx::Error> {
    for id in ids {
        let uuid = id
            .parse()
            .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
        entity_registry_db_utils::clear_deleted(transaction, uuid)
            .await
            .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_history_pairs_keeps_users_and_skips_bot_and_team() {
        let item_ids = [
            "project-user".to_string(),
            "project-bot".to_string(),
            "project-team".to_string(),
        ];
        let owner_ids = [
            "macro|owner@example.com".to_string(),
            "bot|00000000-0000-0000-0000-00000000a1a1".to_string(),
            "01234567-89ab-cdef-0123-456789abcdef".to_string(),
        ];

        let (history_item_ids, history_owner_ids) =
            user_history_pairs(&item_ids, &owner_ids).expect("valid principals should parse");

        assert_eq!(history_item_ids, vec!["project-user".to_string()]);
        assert_eq!(
            history_owner_ids,
            vec!["macro|owner@example.com".to_string()]
        );
    }

    #[test]
    fn user_history_pairs_fails_the_restore_on_malformed_owners() {
        let item_ids = ["project-one".to_string(), "project-two".to_string()];
        let owner_ids = [
            "not-a-macro-user".to_string(),
            "macro|owner@example.com".to_string(),
        ];

        let error = user_history_pairs(&item_ids, &owner_ids)
            .expect_err("malformed owners should fail restore");

        assert!(matches!(error, sqlx::Error::Decode(_)));
    }
}
