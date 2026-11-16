use chrono::{DateTime, Utc};
use document_sub_type::DocumentSubType;
use model::item::{
    Item,
    map_item::{map_chat_item, map_document_item, map_project_item},
};
use system_properties::{StatusOption, SystemPropertyKey};

#[cfg(test)]
mod test;

/// The most items one trash page returns.
pub const MAX_TRASH_PAGE_SIZE: u16 = 500;

/// A point in the trash, newest first: pages continue after the item trashed
/// at `deleted_at` with this `id`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrashPosition {
    /// When the last item on the previous page was moved to the trash.
    pub deleted_at: DateTime<Utc>,
    /// The last item's id, ordering items trashed at the same moment.
    pub id: String,
}

/// One page of a user's trash.
#[derive(Debug)]
pub struct TrashPage {
    /// Trashed documents, chats and folders, most recently trashed first.
    pub items: Vec<Item>,
    /// Where the next page starts, or `None` when this page is the last.
    pub next: Option<TrashPosition>,
}

/// Gets one page of the user's trashed documents, chats and folders, most
/// recently trashed first, starting after `after`. `limit` is clamped to
/// 1..=[`MAX_TRASH_PAGE_SIZE`].
#[tracing::instrument(
    err,
    skip_all,
    fields(
        limit = tracing::field::Empty,
        has_cursor = after.is_some(),
        rows = tracing::field::Empty,
        has_more = tracing::field::Empty
    )
)]
pub async fn get_recently_deleted(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    after: Option<&TrashPosition>,
    limit: u16,
) -> anyhow::Result<TrashPage> {
    let limit = limit.clamp(1, MAX_TRASH_PAGE_SIZE);
    tracing::Span::current().record("limit", limit);
    let status_property_id = SystemPropertyKey::STATUS_UUID;
    let completed_option_id = StatusOption::COMPLETED_UUID.to_string();
    let after_deleted_at = after.map(|position| position.deleted_at);
    let after_id = after.map(|position| position.id.as_str());

    // One extra row tells whether another page follows.
    let fetch_limit = i64::from(limit) + 1;

    let mut tx = db.begin().await?;
    sqlx::query!("SET LOCAL statement_timeout = '5s'")
        .execute(&mut *tx)
        .await?;

    // Each table is read newest-trashed first from its partial trash index
    // (owner, "deletedAt", id) and stops after one page, so a page reads at
    // most three pages of rows however large the trash is. The tiebreak on id
    // keeps pages exact when a folder trash or batch job gives thousands of
    // items the same "deletedAt". The per-document version and task lookups
    // run only for the merged page.
    let mut items = sqlx::query!(
        r#"
        SELECT
            page.item_type as "item_type!",
            page.id as "id!",
            CAST(COALESCE(di.id, db.id) as TEXT) as "document_version_id",
            page.user_id as "user_id!",
            page.name as "name!",
            page.file_type as "file_type",
            page.created_at as "created_at",
            page.updated_at as "updated_at",
            page.deleted_at as "deleted_at!",
            page.project_id as "project_id",
            page.is_persistent as "is_persistent",
            dt.sub_type as "sub_type?: DocumentSubType",
            CASE
                WHEN dt.sub_type = 'task'
                    AND ep_status.values->'value' ? $5
                THEN true
                WHEN dt.sub_type = 'task'
                THEN false
                ELSE NULL
            END as "is_completed"
        FROM (
            (
                SELECT
                    'document' as item_type,
                    d.id,
                    d.owner as user_id,
                    d.name,
                    d."fileType" as file_type,
                    d."createdAt"::timestamptz as created_at,
                    d."updatedAt"::timestamptz as updated_at,
                    d."deletedAt"::timestamptz as deleted_at,
                    d."projectId" as project_id,
                    NULL::boolean as is_persistent
                FROM "Document" d
                WHERE d.owner = $1
                    AND d."deletedAt" IS NOT NULL
                    AND (d."deletedAt", d.id)
                        < (COALESCE($2::timestamptz, 'infinity'), COALESCE($3::text, ''))
                ORDER BY d."deletedAt" DESC, d.id DESC
                LIMIT $4
            )
            UNION ALL
            (
                SELECT
                    'chat',
                    c.id,
                    c."userId",
                    c.name,
                    NULL,
                    c."createdAt"::timestamptz,
                    c."updatedAt"::timestamptz,
                    c."deletedAt"::timestamptz,
                    c."projectId",
                    c."isPersistent"
                FROM "Chat" c
                WHERE c."userId" = $1
                    AND c."deletedAt" IS NOT NULL
                    AND (c."deletedAt", c.id)
                        < (COALESCE($2::timestamptz, 'infinity'), COALESCE($3::text, ''))
                ORDER BY c."deletedAt" DESC, c.id DESC
                LIMIT $4
            )
            UNION ALL
            (
                SELECT
                    'project',
                    p.id,
                    p."userId",
                    p.name,
                    NULL,
                    p."createdAt"::timestamptz,
                    p."updatedAt"::timestamptz,
                    p."deletedAt"::timestamptz,
                    p."parentId",
                    NULL
                FROM "Project" p
                WHERE p."userId" = $1
                    AND p."deletedAt" IS NOT NULL
                    AND (p."deletedAt", p.id)
                        < (COALESCE($2::timestamptz, 'infinity'), COALESCE($3::text, ''))
                ORDER BY p."deletedAt" DESC, p.id DESC
                LIMIT $4
            )
            ORDER BY deleted_at DESC, id DESC
            LIMIT $4
        ) page
        LEFT JOIN document_sub_type dt
            ON page.item_type = 'document'
            AND dt.document_id = page.id
        LEFT JOIN entity_properties ep_status
            ON dt.sub_type = 'task'
            AND ep_status.entity_id = page.id
            AND ep_status.entity_type = 'TASK'
            AND ep_status.property_definition_id = $6
        LEFT JOIN LATERAL (
            SELECT
                b.id
            FROM
                "DocumentBom" b
            WHERE
                page.item_type = 'document'
                AND b."documentId" = page.id
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
                page.item_type = 'document'
                AND i."documentId" = page.id
            ORDER BY
                i."updatedAt" DESC
            LIMIT 1
        ) di ON true
        ORDER BY page.deleted_at DESC, page.id DESC
        "#,
        user_id,
        after_deleted_at,
        after_id,
        fetch_limit,
        completed_option_id,
        status_property_id,
    )
    .try_map(|r| {
        let position = TrashPosition {
            deleted_at: r.deleted_at,
            id: r.id.clone(),
        };

        let item = match r.item_type.as_ref() {
            "document" => map_document_item(
                r.id,
                r.user_id,
                r.document_version_id,
                r.name,
                r.created_at,
                r.updated_at,
                Some(r.deleted_at),
                None, // don't care about sha
                r.file_type,
                None, // don't care about document_family_id
                None, // don't care about branched_from_id
                None, // don't care about branched_from_version_id
                r.project_id,
                r.sub_type,
                r.is_completed,
            )
            .map(Item::Document),
            "chat" => map_chat_item(
                r.id,
                r.user_id,
                r.name,
                r.created_at,
                r.updated_at,
                Some(r.deleted_at),
                r.project_id,
                r.is_persistent,
            )
            .map(Item::Chat),
            "project" => map_project_item(
                r.id,
                r.user_id,
                r.name,
                r.created_at,
                r.updated_at,
                Some(r.deleted_at),
                r.project_id,
            )
            .map(Item::Project),
            _ => {
                return Err(sqlx::Error::TypeNotFound {
                    type_name: r.item_type,
                });
            }
        }
        .map_err(|e| sqlx::Error::TypeNotFound {
            type_name: e.to_string(),
        })?;

        Ok((item, position))
    })
    .fetch_all(&mut *tx)
    .await?;

    tx.commit().await?;

    let has_more = items.len() > usize::from(limit);
    items.truncate(usize::from(limit));
    let next = if has_more {
        items.last().map(|(_, position)| position.clone())
    } else {
        None
    };

    let span = tracing::Span::current();
    span.record("rows", items.len());
    span.record("has_more", has_more);

    Ok(TrashPage {
        items: items.into_iter().map(|(item, _)| item).collect(),
        next,
    })
}
