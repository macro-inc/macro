use model::item::{
    Item,
    map_item::{map_chat_item, map_document_item, map_project_item},
};

/// Gets the users recently deleted items.
/// Supports pagination.
#[tracing::instrument(skip(db))]
pub async fn get_recently_deleted(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<Vec<Item>> {
    // NOTE: we may need to support pagination here at some point.
    let result: Vec<Item> = sqlx::query!(
        r#"
        SELECT
            'document' as "item_type!",
            d.id as "id!",
            CAST(COALESCE(di.id, db.id) as TEXT) as "document_version_id",
            d.owner as "user_id!",
            d.name as "name!",
            d."fileType" as "file_type",
            d."createdAt"::timestamptz as "created_at",
            d."updatedAt"::timestamptz as "updated_at",
            d."deletedAt"::timestamptz as "deleted_at",
            d."projectId" as "project_id",
            NULL as "is_persistent"
        FROM "Document" d
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
                i.id
            FROM
                "DocumentInstance" i
            WHERE
                i."documentId" = d.id
            ORDER BY
                i."updatedAt" DESC
            LIMIT 1
        ) di ON true
        WHERE d.owner = $1 AND d."deletedAt" IS NOT NULL
        UNION ALL
        SELECT
            'chat' as "item_type!",
            c.id as "id!",
            NULL as "document_version_id",
            c."userId" as "user_id!",
            c.name as "name!",
            NULL as "file_type",
            c."createdAt"::timestamptz as "created_at",
            c."updatedAt"::timestamptz as "updated_at",
            c."deletedAt"::timestamptz as "deleted_at",
            c."projectId" as "project_id",
            c."isPersistent" as "is_persistent"
        FROM "Chat" c
        WHERE c."userId" = $1 AND c."deletedAt" IS NOT NULL
        UNION ALL
        SELECT
            'project' as "item_type!",
            p.id as "id!",
            NULL as "document_version_id",
            p."userId" as "user_id!",
            p.name as "name!",
            NULL as "file_type",
            p."createdAt"::timestamptz as "created_at",
            p."updatedAt"::timestamptz as "updated_at",
            p."deletedAt"::timestamptz as "deleted_at",
            p."parentId" as "project_id",
            NULL as "is_persistent"
        FROM "Project" p
        WHERE p."userId" = $1 AND p."deletedAt" IS NOT NULL
    ORDER BY deleted_at DESC
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
                r.deleted_at,
                None, // don't care about sha
                r.file_type,
                None, // don't care about document_family_id
                None, // don't care about branched_from_id
                None, // don't care about branched_from_version_id
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
            r.deleted_at,
            r.project_id,
            r.is_persistent,
        ))),
        "project" => Ok(Item::Project(map_project_item(
            r.id,
            r.user_id,
            r.name,
            r.created_at,
            r.updated_at,
            r.deleted_at,
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

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("recently_deleted")))]
    async fn test_get_recently_deleted(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let items = get_recently_deleted(&pool, "macro|user@user.com").await?;
        assert_eq!(items.len(), 7);

        let ids = items
            .iter()
            .map(|i| match i {
                Item::Chat(c) => c.id.clone(),
                Item::Document(d) => d.document_id.clone(),
                Item::Project(p) => p.id.clone(),
            })
            .collect::<Vec<String>>();

        assert_eq!(ids, vec!["c2", "c1", "d2", "d1", "p3", "p2", "p1"]);

        Ok(())
    }
}
