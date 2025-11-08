use anyhow::Context;

use crate::document::get_basic_documents;
use crate::{
    chat::get_basic_chat, document::get_basic_document,
    projects::get_project::get_basic_project::get_basic_project,
};

pub mod document;
pub mod macrotation;
pub mod project;

/// Attaches to cloud storage item based notifications
#[derive(Debug, serde::Serialize)]
pub struct BasicCloudStorageItemMetadata {
    pub item_id: String,
    pub item_name: String,
    pub item_owner: String,
    pub file_type: Option<String>,
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
            let basic_document_metadata = get_basic_document(db, item_id)
                .await
                .context("unable to get document metadata")?;

            Ok(BasicCloudStorageItemMetadata {
                item_id: basic_document_metadata.document_id,
                item_name: basic_document_metadata.document_name,
                item_owner: basic_document_metadata.owner,
                file_type: basic_document_metadata.file_type,
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

    let basic_documents = get_basic_documents(db, document_ids)
        .await
        .context("unable to get documents metadata")?;

    // Transform documents into BasicCloudStorageItemMetadata with their IDs
    let result = basic_documents
        .into_iter()
        .map(|doc| BasicCloudStorageItemMetadata {
            item_id: doc.document_id,
            item_name: doc.document_name,
            item_owner: doc.owner,
            file_type: doc.file_type,
        })
        .collect();

    Ok(result)
}
