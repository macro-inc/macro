use sqlx::{Pool, Postgres};
mod delete_history;
mod upsert_history;
pub use delete_history::*;
pub use upsert_history::*;

use model::item::{
    Item,
    map_item::{map_chat_item, map_document_item, map_project_item},
};

/// Gets a users recently opened history.
#[tracing::instrument(skip(db))]
pub async fn get_user_history(db: &Pool<Postgres>, user_id: &str) -> anyhow::Result<Vec<Item>> {
    let result: Vec<Item> = sqlx::query!(
        r#"
    WITH UserHistories AS (
        SELECT
            h."itemId" as item_id,
            h."itemType" as item_type
        FROM "UserHistory" h
        WHERE h."userId" = $1
    ), Combined AS (
        SELECT
            'document' as "item_type!",
            d.id as "id!",
            CAST(COALESCE(di.id, db.id) as TEXT) as "document_version_id",
            d.owner as "user_id!",
            d.name as "name!",
            d."branchedFromId" as "branched_from_id",
            d."branchedFromVersionId" as "branched_from_version_id",
            d."documentFamilyId" as "document_family_id",
            d."fileType" as "file_type",
            d."createdAt"::timestamptz as "created_at",
            d."updatedAt"::timestamptz as "updated_at",
            d."projectId" as "project_id",
            d."deletedAt"::timestamptz as "deleted_at",
            NULL as "is_persistent",
            di.sha as "sha"
        FROM "Document" d
        INNER JOIN UserHistories uh ON uh.item_id = d.id AND uh.item_type = 'document'
        LEFT JOIN LATERAL (
            SELECT
                b.id
            FROM
                "DocumentBom" b
            WHERE
                b."documentId" = d.id
            ORDER BY
                b."createdAt" DESC
            LIMIT 1
        ) db ON true
        LEFT JOIN LATERAL (
            SELECT
                i.id,
                i."documentId",
                i."sha",
                i."createdAt",
                i."updatedAt"
            FROM
                "DocumentInstance" i
            WHERE
                i."documentId" = d.id
            ORDER BY
                i."updatedAt" DESC
            LIMIT 1
        ) di ON true
        UNION ALL
        SELECT
            'chat' as "item_type!",
            c.id as "id!",
            NULL as "document_version_id",
            c."userId" as "user_id!",
            c.name as "name!",
            NULL as "branched_from_id",
            NULL as "branched_from_version_id",
            NULL as "document_family_id",
            NULL as "file_type",
            c."createdAt"::timestamptz as "created_at",
            c."updatedAt"::timestamptz as "updated_at",
            c."projectId" as "project_id",
            c."deletedAt"::timestamptz as "deleted_at",
            c."isPersistent" as "is_persistent",
            NULL as "sha"
        FROM "Chat" c
        INNER JOIN UserHistories uh ON uh.item_id = c.id AND uh.item_type = 'chat'
        UNION ALL
        SELECT
            'project' as "item_type!",
            p.id as "id!",
            NULL as "document_version_id",
            p."userId" as "user_id!",
            p.name as "name!",
            NULL as "branched_from_id",
            NULL as "branched_from_version_id",
            NULL as "document_family_id",
            NULL as "file_type",
            p."createdAt"::timestamptz as "created_at",
            p."updatedAt"::timestamptz as "updated_at",
            p."parentId" as "project_id",
            p."deletedAt"::timestamptz as "deleted_at",
            NULL as "is_persistent",
            NULL as "sha"
        FROM "Project" p
        INNER JOIN UserHistories uh ON uh.item_id = p.id AND uh.item_type = 'project'
    )
    SELECT * FROM Combined
    ORDER BY updated_at DESC
    "#,
        user_id,
    )
    .try_map(|r| match r.item_type.as_ref() {
        "document" => {
            let document = map_document_item(
                r.id,
                r.user_id,
                r.document_version_id,
                r.name,
                r.created_at,
                r.updated_at,
                None, // Will never be deleted
                r.sha,
                r.file_type,
                r.document_family_id,
                r.branched_from_id,
                r.branched_from_version_id,
                r.project_id,
            )
            .map_err(|e| sqlx::Error::TypeNotFound {
                type_name: e.to_string(),
            })?;
            Ok(Item::Document(document))
        }
        "chat" => Ok(Item::Chat(map_chat_item(
            r.id,
            r.user_id,
            r.name,
            r.created_at,
            r.updated_at,
            None, // Will never be deleted
            r.project_id,
            r.is_persistent,
        ))),
        "project" => Ok(Item::Project(map_project_item(
            r.id,
            r.user_id,
            r.name,
            r.created_at,
            r.updated_at,
            None, // Will never be deleted
            r.project_id,
        ))),
        _ => Err(sqlx::Error::TypeNotFound {
            type_name: r.item_type,
        }),
    })
    .fetch_all(db)
    .await?;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("simple_history")))]
    async fn test_get_user_history_simple(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let recent = get_user_history(&pool, "macro|user@user.com").await?;
        assert_eq!(recent.len(), 3);

        let recent = recent
            .iter()
            .map(|i| match i {
                Item::Chat(c) => c.id.clone(),
                Item::Document(d) => d.document_id.clone(),
                Item::Project(p) => p.id.clone(),
            })
            .collect::<Vec<String>>();

        assert_eq!(
            recent,
            vec!["document-one", "document-two", "document-three"]
        );

        Ok(())
    }
}
