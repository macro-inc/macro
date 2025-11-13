//! This module contains db queries to filter out a list of provided items and only return those
//! matching the criteria

use model::item::ShareableItemType;

use crate::projects::get_project::get_sub_items::bulk_get_all_sub_project_ids;

mod document;
mod channel;

pub use channel::*;
pub use document::*;

/// Given a list of item ids, the item type and a list of project_ids, this will
/// return a subset list of items that are within the provided project ids and their sub-projects.
#[tracing::instrument(skip(db), err)]
pub async fn filter_items_by_project_ids(
    db: &sqlx::PgPool,
    items: &[String],
    item_type: ShareableItemType,
    project_ids: &[String],
) -> anyhow::Result<Vec<String>> {
    let all_project_ids = bulk_get_all_sub_project_ids(db, project_ids).await?;
    let items = match item_type {
        ShareableItemType::Document => {
            sqlx::query!(
                r#"
                SELECT
                    d.id
                FROM
                    "Document" d
                WHERE
                    d.id = ANY($1)
                    AND d."projectId" = ANY($2)
                "#,
                items,
                &all_project_ids,
            )
            .map(|row| row.id)
            .fetch_all(db)
            .await?
        }
        ShareableItemType::Chat => {
            sqlx::query!(
                r#"
                    SELECT
                        c.id
                    FROM
                        "Chat" c
                    WHERE
                        c.id = ANY($1)
                        AND c."projectId" = ANY($2)
                    "#,
                items,
                &all_project_ids,
            )
            .map(|row| row.id)
            .fetch_all(db)
            .await?
        }
        _ => {
            anyhow::bail!("item type not supported");
        }
    };

    Ok(items)
}

/// Given a list of item ids, the item type and a list of owner ids, this will
/// return a subset list of items that are within the provided owner ids.
#[tracing::instrument(skip(db), err)]
pub async fn filter_items_by_owner_ids(
    db: &sqlx::PgPool,
    items: &[String],
    item_type: ShareableItemType,
    owner_ids: &[String],
) -> anyhow::Result<Vec<String>> {
    let items = match item_type {
        ShareableItemType::Document => {
            sqlx::query!(
                r#"
                SELECT
                    d.id
                FROM
                    "Document" d
                WHERE
                    d.id = ANY($1)
                    AND d."owner" = ANY($2)
                "#,
                items,
                owner_ids,
            )
            .map(|row| row.id)
            .fetch_all(db)
            .await?
        }
        ShareableItemType::Chat => {
            sqlx::query!(
                r#"
                    SELECT
                        c.id
                    FROM
                        "Chat" c
                    WHERE
                        c.id = ANY($1)
                        AND c."userId" = ANY($2)
                    "#,
                items,
                owner_ids,
            )
            .map(|row| row.id)
            .fetch_all(db)
            .await?
        }
        ShareableItemType::Project => {
            sqlx::query!(
                r#"
                    SELECT
                        p.id
                    FROM
                        "Project" p
                    WHERE
                        p.id = ANY($1)
                        AND p."userId" = ANY($2)
                    "#,
                items,
                owner_ids,
            )
            .map(|row| row.id)
            .fetch_all(db)
            .await?
        }
        _ => {
            anyhow::bail!("item type not supported");
        }
    };

    Ok(items)
}
