use anyhow::Context;
use sqlx::{Pool, Postgres};

use model::{
    activity::map_item::{map_chat_item, map_document_item},
    item::{Item, map_item::map_project_item},
    pin::PinnedItem,
};

use model::pin::request::ReorderPinRequest;

#[tracing::instrument(skip(db))]
pub async fn upsert_pin(
    db: Pool<Postgres>,
    user_id: &str,
    pinned_item_id: &str,
    pinned_item_type: &str,
    pin_index: i32,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO "Pin" ("userId", "pinnedItemId", "pinnedItemType", "pinIndex", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        ON CONFLICT ("userId", "pinnedItemId", "pinnedItemType") DO UPDATE
        SET "updatedAt" = NOW();
        "#,
        user_id,
        pinned_item_id,
        pinned_item_type,
        pin_index,
    )
    .execute(&db)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(db))]
pub async fn get_pins(db: Pool<Postgres>, user_id: &str) -> anyhow::Result<Vec<PinnedItem>> {
    let total_pins = sqlx::query!(
        r#"
        SELECT COUNT(*) as "count"
        FROM "Pin"
        WHERE "userId" = $1
        "#,
        user_id,
    )
    .fetch_one(&db)
    .await?
    .count
    .unwrap_or(0);

    if total_pins == 0 {
        return Ok(vec![]);
    }

    let result: Vec<PinnedItem> = sqlx::query!(
        r#"
    WITH PinnedItems AS (
        SELECT
            p."pinnedItemId" as pin_item_id,
            p."pinnedItemType" as pin_item_type,
            p."pinIndex" as pin_index
        FROM "Pin" p
        WHERE p."userId" = $1
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
            di.sha as "sha",
            NULL as "is_persistent",
            pi.pin_index as "pin_index"
        FROM "Document" d
        INNER JOIN PinnedItems pi ON pi.pin_item_id = d.id AND pi.pin_item_type = 'document'
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
            NULL as "sha",
            c."isPersistent" as "is_persistent",
            pi.pin_index as "pin_index"
        FROM "Chat" c
        INNER JOIN PinnedItems pi ON pi.pin_item_id = c.id AND pi.pin_item_type = 'chat'
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
            NULL as "sha",
            NULL as "is_persistent",
            pi.pin_index as "pin_index"
        FROM "Project" p
        INNER JOIN PinnedItems pi ON pi.pin_item_id = p.id AND pi.pin_item_type = 'project'
    )
    SELECT * FROM Combined
    ORDER BY pin_index ASC
    "#,
        user_id
    )
    .try_map(|r| {
        let pin_index: i32 =
            r.pin_index
                .context("pin index is present")
                .map_err(|e| sqlx::Error::TypeNotFound {
                    type_name: e.to_string(),
                })?;
        match r.item_type.as_ref() {
            "document" => {
                let document = map_document_item(
                    r.id,
                    r.user_id,
                    r.document_version_id,
                    r.name,
                    r.created_at,
                    r.updated_at,
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
                Ok(PinnedItem {
                    pin_index,
                    item: Item::Document(document.clone()),
                    activity: Item::Document(document),
                })
            }
            "chat" => {
                let chat = map_chat_item(
                    r.id,
                    r.user_id,
                    r.name,
                    r.created_at,
                    r.updated_at,
                    r.project_id,
                    r.is_persistent,
                );
                Ok(PinnedItem {
                    pin_index,
                    item: Item::Chat(chat.clone()),
                    activity: Item::Chat(chat),
                })
            }
            "project" => {
                let project = map_project_item(
                    r.id,
                    r.user_id,
                    r.name,
                    r.created_at,
                    r.updated_at,
                    None, // Will never be deleted
                    r.project_id,
                );
                Ok(PinnedItem {
                    pin_index,
                    item: Item::Project(project.clone()),
                    activity: Item::Project(project),
                })
            }
            _ => Err(sqlx::Error::TypeNotFound {
                type_name: r.item_type,
            }),
        }
    })
    .fetch_all(&db)
    .await?;

    Ok(result)
}

#[tracing::instrument(skip(db))]
pub async fn remove_pin(
    db: Pool<Postgres>,
    user_id: &str,
    pinned_item_id: &str,
    pinned_item_type: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM "Pin" WHERE "userId" = $1 AND "pinnedItemId" = $2 AND "pinnedItemType" = $3
        "#,
        user_id,
        pinned_item_id,
        pinned_item_type,
    )
    .execute(&db)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(db))]
pub async fn remove_pin_by_pinned_item_id(
    db: Pool<Postgres>,
    pinned_item_id: &str,
    pinned_item_type: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM "Pin" WHERE "pinnedItemId" = $1 AND "pinnedItemType" = $2
        "#,
        pinned_item_id,
        pinned_item_type,
    )
    .execute(&db)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(db))]
pub async fn reorder_pins(
    db: Pool<Postgres>,
    user_id: &str,
    pins: Vec<ReorderPinRequest>,
) -> anyhow::Result<()> {
    if pins.is_empty() {
        tracing::trace!("no pins to reorder");
        return Ok(());
    }
    let pinned_item_ids: Vec<&str> = pins.iter().map(|pin| pin.pinned_item_id.as_str()).collect();
    let pinned_item_types: Vec<&str> = pins
        .iter()
        .map(|pin| pin.pinned_item_type.as_str())
        .collect();
    let pin_indices: Vec<i32> = pins.iter().map(|pin| pin.pin_index).collect();

    sqlx::query(
        r#"
        UPDATE "Pin"
        SET "pinIndex" = data."pinIndex", "updatedAt" = NOW()
        FROM (
            SELECT
                unnest($1::text[]) AS "pinnedItemId",
                unnest($2::text[]) AS "pinnedItemType",
                unnest($3::int[]) AS "pinIndex"
        ) AS data
        WHERE
            "Pin"."userId" = $4
            AND "Pin"."pinnedItemId" = data."pinnedItemId"
            AND "Pin"."pinnedItemType" = data."pinnedItemType"
        "#,
    )
    .bind(&pinned_item_ids)
    .bind(&pinned_item_types)
    .bind(&pin_indices)
    .bind(user_id)
    .execute(&db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_pinned_document")))]
    async fn test_upsert_pin(pool: Pool<Postgres>) {
        upsert_pin(
            pool.clone(),
            "macro|user@user.com",
            "document-one",
            "document",
            0,
        )
        .await
        .unwrap();

        let time = sqlx::query!(
            r#"
            SELECT "createdAt", "updatedAt" FROM "Pin" WHERE "userId" = $1 AND "pinnedItemId" = $2 and "pinnedItemType" = $3
            "#,
            "macro|user@user.com",
            "document-one",
            "document",
        )
        .fetch_one(&pool.clone())
        .await
        .unwrap();

        assert_ne!(time.createdAt, time.updatedAt);

        upsert_pin(
            pool.clone(),
            "macro|user@user.com",
            "document-two",
            "document",
            0,
        )
        .await
        .unwrap();

        let time = sqlx::query!(
            r#"
            SELECT "createdAt", "updatedAt" FROM "Pin" WHERE "userId" = $1 AND "pinnedItemId" = $2 and "pinnedItemType" = $3
            "#,
            "macro|user@user.com",
            "document-two",
            "document"
        ).fetch_one(&pool.clone()).await.unwrap();

        assert_eq!(time.createdAt, time.updatedAt);
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_lots_of_documents")))]
    async fn test_get_pins(pool: Pool<Postgres>) {
        let pins = get_pins(pool.clone(), "macro|user@user.com").await.unwrap();

        assert_eq!(pins.len(), 7);
        let ids: Vec<String> = pins
            .iter()
            .map(|item| match &item.item {
                Item::Document(doc) => doc.document_id.clone(),
                Item::Project(project) => project.id.clone(),
                Item::Chat(chat) => chat.id.clone(),
            })
            .collect();

        assert_eq!(
            ids,
            vec![
                "project-one".to_string(),
                "document-six".to_string(),
                "document-two".to_string(),
                "document-three".to_string(),
                "document-four".to_string(),
                "document-five".to_string(),
                "document-one".to_string(),
            ]
        );
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_lots_of_documents")))]
    async fn test_get_pins_no_pins(pool: Pool<Postgres>) {
        // document doesn't exist
        let documents = get_pins(pool.clone(), "bad_user").await.unwrap();

        assert_eq!(documents.len(), 0);
        assert_eq!(documents, vec![]);
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_pinned_document")))]
    async fn test_remove_pin(pool: Pool<Postgres>) {
        // document doesn't exist
        remove_pin(
            pool.clone(),
            "macro|user@user.com",
            "document-one",
            "document",
        )
        .await
        .unwrap();

        let result = sqlx::query!(
            r#"
            SELECT "pinnedItemId" FROM "Pin" WHERE "userId" = $1 AND "pinnedItemId" = $2 AND "pinnedItemType" = $3
            "#,
            "macro|user@user.com",
            "document-one",
            "document",
        )
        .fetch_one(&pool.clone())
        .await;

        assert_eq!(result.is_err(), true);
        assert_eq!(
            result.err().unwrap().to_string(),
            "no rows returned by a query that expected to return at least one row"
        );

        remove_pin(
            pool.clone(),
            "macro|user@user.com",
            "document-random",
            "document",
        )
        .await
        .unwrap();
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_lots_of_documents")))]
    async fn test_reorder_pins(pool: Pool<Postgres>) {
        reorder_pins(
            pool.clone(),
            "macro|user@user.com",
            vec![
                ReorderPinRequest::new("document-one", "document", 0),
                ReorderPinRequest::new("document-two", "document", 5),
                ReorderPinRequest::new("document-three", "document", 4),
                ReorderPinRequest::new("document-four", "document", 3),
                ReorderPinRequest::new("document-five", "document", 2),
                ReorderPinRequest::new("document-six", "document", 1),
            ],
        )
        .await
        .unwrap();

        let mut result = sqlx::query!(
            r#"
            SELECT "pinnedItemId" as "pinned_item_id" FROM "Pin"
            WHERE "userId" = $1
            ORDER BY "pinIndex" ASC
            "#,
            "macro|user@user.com",
        )
        .fetch_all(&pool.clone())
        .await
        .unwrap();

        let result = result
            .iter_mut()
            .map(|r| r.pinned_item_id.clone())
            .collect::<Vec<_>>();

        assert_eq!(
            result,
            vec![
                "project-one",
                "document-one",
                "document-six",
                "document-five",
                "document-four",
                "document-three",
                "document-two",
            ]
        );
    }
}
