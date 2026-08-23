use anyhow::Context;
use document_sub_type::DocumentSubType;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

use crate::{chat::get_basic_chat, projects::get_project::get_basic_project::get_basic_project};

pub mod document;
pub mod project;

/// Attaches to cloud storage item based notifications
#[derive(Debug, serde::Serialize)]
pub struct BasicCloudStorageItemMetadata {
    pub item_id: String,
    pub item_name: String,
    pub item_owner: MacroUserIdStr<'static>,
    pub file_type: Option<String>,
    /// Raw sub_type string from DB (e.g. "task"). None for non-task documents.
    pub sub_type: Option<String>,
}

/// Gets the basic cloud storage item metadata for a given item
#[tracing::instrument(skip(db))]
pub async fn get_basic_cloud_storage_item_metadata(
    db: &sqlx::Pool<sqlx::Postgres>,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<BasicCloudStorageItemMetadata> {
    match item_type {
        "document" => {
            tracing::trace!("getting document metadata");
            let row = sqlx::query!(
                r#"
                SELECT
                    d.id as "document_id",
                    d.owner,
                    d.name as "document_name",
                    d."fileType" as "file_type",
                    dst.sub_type as "sub_type?: DocumentSubType"
                FROM
                    "Document" d
                LEFT JOIN document_sub_type dst ON dst.document_id = d.id
                WHERE d.id = $1
                LIMIT 1
                "#,
                item_id,
            )
            .fetch_one(db)
            .await
            .context("unable to get document metadata")?;

            let owner = MacroUserIdStr::parse_from_str(&row.owner)
                .map_err(|e| anyhow::anyhow!("invalid owner id: {e}"))?
                .into_owned();

            Ok(BasicCloudStorageItemMetadata {
                item_id: row.document_id,
                item_name: row.document_name,
                item_owner: owner,
                file_type: row.file_type,
                sub_type: row.sub_type.map(|st| st.to_string()),
            })
        }
        "chat" => {
            tracing::trace!("getting chat metadata");
            let basic_chat_metadata = get_basic_chat(db, item_id)
                .await
                .context("unable to get chat metadata")?;

            Ok(BasicCloudStorageItemMetadata {
                item_id: basic_chat_metadata.id,
                item_name: basic_chat_metadata.name,
                item_owner: basic_chat_metadata.user_id,
                file_type: None,
                sub_type: None,
            })
        }
        "project" => {
            tracing::trace!("getting project metadata");
            let project_metadata = get_basic_project(db, item_id)
                .await
                .context("unable to get project metadata")?;
            Ok(BasicCloudStorageItemMetadata {
                item_id: project_metadata.id,
                item_name: project_metadata.name,
                item_owner: project_metadata.user_id,
                file_type: None,
                sub_type: None,
            })
        }
        _ => Err(anyhow::anyhow!("invalid item type")),
    }
}

/// Gets the basic cloud storage item metadata for a list of document items
#[tracing::instrument(skip(db))]
pub async fn get_basic_cloud_storage_documents_metadata(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_ids: &[String],
) -> anyhow::Result<Vec<BasicCloudStorageItemMetadata>> {
    if document_ids.is_empty() {
        return Ok(Vec::new());
    }

    tracing::trace!("getting metadata for {} documents", document_ids.len());

    let rows = sqlx::query!(
        r#"
        SELECT
            d.id as "document_id",
            d.owner,
            d.name as "document_name",
            d."fileType" as "file_type",
            dst.sub_type as "sub_type?: DocumentSubType"
        FROM
            "Document" d
        LEFT JOIN document_sub_type dst ON dst.document_id = d.id
        WHERE d.id = ANY($1)
        "#,
        document_ids,
    )
    .fetch_all(db)
    .await
    .context("unable to get documents metadata")?;

    let result = rows
        .into_iter()
        .map(|row| {
            MacroUserIdStr::parse_from_str(&row.owner)
                .map_err(|e| anyhow::anyhow!("invalid owner id: {e}"))
                .map(|owner| BasicCloudStorageItemMetadata {
                    item_id: row.document_id,
                    item_name: row.document_name,
                    item_owner: owner.into_owned(),
                    file_type: row.file_type,
                    sub_type: row.sub_type.map(|st| st.to_string()),
                })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;

    Ok(result)
}
