use std::str::FromStr;

use anyhow::Context;
use chrono::Utc;
use document_sub_type::DocumentSubType;
use model::document::{DocumentMetadata, FileType};
use models_properties::EntityType;
use models_search::document::MarkdownParseResult;
use models_search::unified::is_searchable_association;
use opensearch_client::{
    OpensearchClient,
    date_format::EpochSeconds,
    upsert::document::{IndexedProperty, UpsertDocumentArgs},
};
use properties_db_client::entity_properties::get::get_entity_properties_for_index;
use s3_key::{
    CONVERTED_DOCUMENT_FILE_NAME, build_cloud_storage_bucket_document_key,
    build_docx_to_pdf_converted_document_key,
};

use crate::{
    parsers::{canvas::parse_canvas, markdown::parse_markdown_legacy, pdf::parse_pdf_pages},
    process::document::document_info::{DocumentInfo, get_document_info},
};

use super::{DocumentPropertiesUpdate, SearchExtractorMessage};

async fn upsert_document(
    opensearch_client: &OpensearchClient,
    search_extractor_message: &SearchExtractorMessage,
    upserts: Vec<UpsertDocumentArgs>,
) -> anyhow::Result<()> {
    let index_override = search_extractor_message.index_override.as_deref();
    // Delete existing documents for the document id
    // This ensures we replace any old nodes with new ones for editable files
    match search_extractor_message.file_type {
        FileType::Md | FileType::Canvas => {
            tracing::debug!("deleting existing search results");
            opensearch_client
                .delete_document(&search_extractor_message.document_id, index_override)
                .await
                .context("unable to delete existing search results")?;
        }
        _ => {}
    }

    let results = opensearch_client
        .bulk_upsert_documents(&upserts, index_override)
        .await
        .context("unable to bulk upsert documents in opensearch")?;

    if !results.errors.is_empty() {
        tracing::error!(errors=?results.errors, "bulk upsert failed");

        // delete document that failed to upsert
        opensearch_client
            .delete_document(&search_extractor_message.document_id, index_override)
            .await
            .context("failed to delete document for failed bulk upsert")?;

        anyhow::bail!("failed to upsert documents");
    }

    tracing::trace!("upserted document");

    Ok(())
}

/// Properties are keyed under the task entity type for tasks, otherwise the
/// document entity type.
fn properties_entity_type(sub_type: Option<&str>) -> EntityType {
    sub_type
        .and_then(|s| s.parse::<DocumentSubType>().ok())
        .map(EntityType::from)
        .unwrap_or(EntityType::Document)
}

/// Fetch the entity's indexed properties and attach them to every chunk upsert
/// (parent metadata is denormalized identically across chunks).
///
/// A full index overwrites the parent doc, so an *empty* `properties` clears
/// previously-indexed values — the deliberate "omit == remove" behavior used
/// for `sub_type`. That is correct when the entity genuinely has no
/// properties, but a fetch *failure* must not be mistaken for "empty": we
/// propagate the error so the doc isn't overwritten and the message is retried
/// (mirroring the partial-update path).
async fn attach_indexed_properties(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
    sub_type: Option<&str>,
    upserts: &mut [UpsertDocumentArgs],
) -> anyhow::Result<()> {
    if upserts.is_empty() {
        return Ok(());
    }
    let properties =
        get_entity_properties_for_index(db, document_id, properties_entity_type(sub_type))
            .await
            .context("failed to fetch properties for search index")?;
    if properties.is_empty() {
        return Ok(());
    }
    let indexed: Vec<IndexedProperty> = properties
        .into_iter()
        .map(|p| IndexedProperty {
            definition_id: p.definition_id,
            values: p.values,
            number_value: p.number_value,
            date_value: p.date_value,
        })
        .collect();
    for upsert in upserts.iter_mut() {
        upsert.properties = indexed.clone();
    }
    Ok(())
}

/// Processes a message for a standard document and reads the updated contents from s3 and updates
/// the document in opensearch.
#[tracing::instrument(skip(opensearch_client, db, s3_client, document_storage_bucket, search_extractor_message), fields(document_id=search_extractor_message.document_id, file_type=?search_extractor_message.file_type))]
pub async fn update_search_with_raw_document(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    s3_client: &s3_client::S3,
    document_storage_bucket: &str,
    search_extractor_message: &SearchExtractorMessage,
) -> anyhow::Result<()> {
    if !is_searchable_association(&search_extractor_message.file_type.macro_app_path()) {
        tracing::warn!("unsupported file type");
        return Ok(());
    }

    // This ensures we only process the latest version
    let document_info = match get_document_info(db, search_extractor_message)
        .await
        .context("failed to get document info")?
    {
        DocumentInfo::Active(info) => *info,
        DocumentInfo::Removable => {
            tracing::trace!("document is deleted or missing, removing from search index");
            opensearch_client
                .delete_document(
                    &search_extractor_message.document_id,
                    search_extractor_message.index_override.as_deref(),
                )
                .await
                .context("failed to delete document from search index")?;
            return Ok(());
        }
        DocumentInfo::Skip => {
            tracing::trace!("no document info returned");
            return Ok(());
        }
    };

    let document_name = document_info.document_name;
    let sub_type = document_info.sub_type.map(|st| st.to_string());

    // TODO: this is hacky, update the search event message to use the correctly serialized
    // document key parts from the s3_key crate
    let document_version_id = match search_extractor_message.file_type {
        // For static/converted files, we want to use the version from the search extractor message since
        // that is what is in s3 and document saves don't change the actual file in s3.
        FileType::Pdf | FileType::Docx => search_extractor_message
            .document_version_id
            .clone()
            .context("expected document version id to be provided for pdf/docx")?,
        // For all other files we want to ensure we are only updating search if this message
        // contains the latest document version id
        _ => document_info.document_version_id.to_string(),
    };

    if document_info.file_type.is_none() {
        tracing::debug!("file type is none");
        return Ok(());
    }

    let file_type = FileType::from_str(
        document_info
            .file_type
            .context("expected a file type")?
            .as_str(),
    )?;

    let key = if document_version_id == CONVERTED_DOCUMENT_FILE_NAME {
        build_docx_to_pdf_converted_document_key(
            &search_extractor_message.user_id,
            &search_extractor_message.document_id,
        )
    } else if let Some(msg_version_id) = search_extractor_message.document_version_id.as_ref()
        && msg_version_id != &document_version_id
    {
        tracing::debug!(
            msg_version_id,
            document_version_id,
            "document version is not latest, skipping"
        );
        return Ok(());
    } else {
        build_cloud_storage_bucket_document_key(
            &search_extractor_message.user_id,
            &search_extractor_message.document_id,
            &document_version_id,
        )
    };

    let content = s3_client
        .get(document_storage_bucket, &key)
        .await
        .context("unable to get file")?;

    // Handle empty content for things like new markdown/canvas files
    if content.is_empty() {
        tracing::debug!("empty content");
        return Ok(());
    }

    tracing::trace!("got raw file content");

    let updated_at = EpochSeconds::new(Utc::now().timestamp())?;
    let uuid = macro_uuid::generate_uuid_v7().to_string();

    let mut upserts: Vec<UpsertDocumentArgs> = match file_type {
        FileType::Pdf | FileType::Docx => {
            let pages_content = parse_pdf_pages(content).context("unable to parse pdf")?;
            pages_content
                .iter()
                .enumerate()
                .map(|(i, page_content)| UpsertDocumentArgs {
                    document_id: search_extractor_message.document_id.clone(),
                    node_id: i.to_string(), // page number
                    raw_content: None,
                    document_name: document_name.clone(),
                    content: page_content.clone(),
                    owner_id: search_extractor_message.user_id.clone(),
                    file_type: file_type.to_string(),
                    updated_at_seconds: updated_at,
                    sub_type: sub_type.clone(),
                    properties: vec![],
                })
                .collect()
        }
        FileType::Canvas => {
            let content =
                parse_canvas(&String::from_utf8(content)?).context("unable to parse canvas")?;
            vec![UpsertDocumentArgs {
                document_id: search_extractor_message.document_id.clone(),
                node_id: uuid,
                raw_content: None,
                document_name,
                content: content.clone(),
                owner_id: search_extractor_message.user_id.clone(),
                file_type: file_type.to_string(),
                updated_at_seconds: updated_at,
                sub_type: sub_type.clone(),
                properties: vec![],
            }]
        }
        FileType::Md => {
            // NOTE: this is legacy now. MD parsing mainly happens through sync service via
            // LexicalClient
            tracing::trace!("markdown parsing from DSS is deprecated");
            let result = parse_markdown_legacy(&String::from_utf8(content)?)
                .context("unable to parse markdown")?;
            result
                .into_iter()
                .map(|result| UpsertDocumentArgs {
                    document_id: search_extractor_message.document_id.clone(),
                    node_id: result.node_id,
                    raw_content: Some(result.raw_content),
                    document_name: document_name.clone(),
                    content: result.content,
                    owner_id: search_extractor_message.user_id.clone(),
                    file_type: file_type.to_string(),
                    updated_at_seconds: updated_at,
                    sub_type: sub_type.clone(),
                    properties: vec![],
                })
                .collect::<Vec<UpsertDocumentArgs>>()
        }
        file_type => {
            let content = String::from_utf8(content)?;
            if content.is_empty() {
                vec![]
            } else {
                vec![UpsertDocumentArgs {
                    document_id: search_extractor_message.document_id.clone(),
                    node_id: uuid,
                    raw_content: None,
                    document_name,
                    content: content.clone(),
                    owner_id: search_extractor_message.user_id.clone(),
                    file_type: file_type.to_string(),
                    updated_at_seconds: updated_at,
                    sub_type: sub_type.clone(),
                    properties: vec![],
                }]
            }
        }
    };

    attach_indexed_properties(
        db,
        &search_extractor_message.document_id,
        sub_type.as_deref(),
        &mut upserts,
    )
    .await?;

    upsert_document(opensearch_client, search_extractor_message, upserts).await?;

    Ok(())
}

fn generate_upserts(
    document_info: DocumentMetadata,
    markdown_result: Vec<MarkdownParseResult>,
) -> anyhow::Result<Vec<UpsertDocumentArgs>> {
    let result = markdown_result;
    let updated_at = EpochSeconds::new(Utc::now().timestamp())?;
    let file_type = FileType::from_str(
        document_info
            .file_type
            .context("expected a file type")?
            .as_str(),
    )?;
    let document_name = document_info.document_name;
    let sub_type = document_info.sub_type.map(|st| st.to_string());

    let upserts = result
        .into_iter()
        .map(|result| UpsertDocumentArgs {
            document_id: document_info.document_id.clone(),
            node_id: result.node_id,
            raw_content: Some(result.raw_content),
            document_name: document_name.clone(),
            content: result.content,
            owner_id: document_info.owner.to_string(),
            file_type: file_type.to_string(),
            updated_at_seconds: updated_at,
            sub_type: sub_type.clone(),
            properties: vec![],
        })
        .collect::<Vec<UpsertDocumentArgs>>();

    Ok(upserts)
}

/// Processes a message for a standard document and reads the updated contents from sync service and updates
/// the document in opensearch.
#[tracing::instrument(skip(opensearch_client, search_extractor_message, db, s3_client, document_storage_bucket, lexical_client), fields(document_id=search_extractor_message.document_id, file_type=?search_extractor_message.file_type))]
pub async fn update_search_with_sync_document(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    s3_client: &s3_client::S3,
    document_storage_bucket: &str,
    lexical_client: &lexical_client::LexicalClient,
    search_extractor_message: &SearchExtractorMessage,
) -> anyhow::Result<()> {
    match search_extractor_message.file_type.macro_app_path() {
        model_file_type::FileAssociation::Md(_) => {}
        _ => {
            tracing::warn!("unsupported file type");
            return Ok(());
        }
    }

    let document_info = match get_document_info(db, search_extractor_message)
        .await
        .context("failed to get document info")?
    {
        DocumentInfo::Active(info) => *info,
        DocumentInfo::Removable => {
            tracing::trace!("document is deleted or missing, removing from search index");
            opensearch_client
                .delete_document(
                    &search_extractor_message.document_id,
                    search_extractor_message.index_override.as_deref(),
                )
                .await
                .context("failed to delete document from search index")?;
            return Ok(());
        }
        DocumentInfo::Skip => {
            tracing::trace!("no document info returned");
            return Ok(());
        }
    };

    let document_id = &search_extractor_message.document_id;
    let result = match lexical_client.parse_markdown(document_id).await {
        Ok(result) => result,
        Err(e) => {
            tracing::warn!(error=?e, "failed to parse markdown with lexical");
            // call DSS as fallback if lexical/sync service fails
            update_search_with_raw_document(
                opensearch_client,
                db,
                s3_client,
                document_storage_bucket,
                search_extractor_message,
            )
            .await?;
            return Ok(());
        }
    };

    let sub_type = document_info.sub_type.as_ref().map(|st| st.to_string());
    let mut upserts =
        generate_upserts(document_info, result).context("unable to generate upserts")?;

    attach_indexed_properties(db, document_id, sub_type.as_deref(), &mut upserts).await?;

    let chunk_count = upserts.len();
    upsert_document(opensearch_client, search_extractor_message, upserts).await?;
    tracing::info!(document_id = %document_id, chunk_count, "sync document indexed");

    Ok(())
}

/// Refresh only the indexed `properties` of a document after a property
/// mutation, without re-extracting its content.
pub async fn update_search_with_property_update(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    message: &DocumentPropertiesUpdate,
) -> anyhow::Result<()> {
    let entity_type = EntityType::from_str(&message.entity_type)
        .with_context(|| format!("invalid entity_type '{}'", message.entity_type))?;
    let properties = get_entity_properties_for_index(db, &message.document_id, entity_type)
        .await
        .context("failed to fetch properties for reindex")?;
    let indexed: Vec<IndexedProperty> = properties
        .into_iter()
        .map(|p| IndexedProperty {
            definition_id: p.definition_id,
            values: p.values,
            number_value: p.number_value,
            date_value: p.date_value,
        })
        .collect();
    opensearch_client
        .update_document_properties(&message.document_id, &indexed)
        .await
        .context("failed to update document properties in search index")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use macro_user_id::user_id::MacroUserIdStr;

    use super::*;

    #[tokio::test]
    async fn test_generate_upsert() {
        let document_info = DocumentMetadata {
            document_id: "AAA".to_string(),
            document_version_id: 0,
            owner: MacroUserIdStr::parse_from_str("macro|nobody@macro.com").unwrap(),
            document_name: "test_document".to_string(),
            file_type: Some("md".to_string()),
            sha: None,
            project_id: None,
            project_name: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            document_bom: None,
            modification_data: None,
            created_at: None,
            updated_at: None,
            sub_type: None,
            deleted_at: None,
        };

        let markdown_result = vec![
            MarkdownParseResult {
                node_id: "node1".to_string(),
                raw_content: "# Test Header".to_string(),
                content: "Test Header".to_string(),
            },
            MarkdownParseResult {
                node_id: "node2".to_string(),
                raw_content: "This is test content.".to_string(),
                content: "This is test content.".to_string(),
            },
        ];

        let upserts =
            generate_upserts(document_info, markdown_result).expect("Could not generate upserts");

        assert!(!upserts.is_empty());
        assert_eq!(upserts.len(), 2);
        assert_eq!(upserts[0].sub_type, None);
    }

    #[tokio::test]
    async fn test_generate_upsert_with_sub_type() {
        use document_sub_type::DocumentSubType;

        let document_info = DocumentMetadata {
            document_id: "BBB".to_string(),
            document_version_id: 0,
            owner: MacroUserIdStr::parse_from_str("macro|nobody@macro.com").unwrap(),
            document_name: "test_task".to_string(),
            file_type: Some("md".to_string()),
            sha: None,
            project_id: None,
            project_name: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            document_bom: None,
            modification_data: None,
            created_at: None,
            updated_at: None,
            sub_type: Some(DocumentSubType::Task),
            deleted_at: None,
        };

        let markdown_result = vec![MarkdownParseResult {
            node_id: "node1".to_string(),
            raw_content: "# Task content".to_string(),
            content: "Task content".to_string(),
        }];

        let upserts =
            generate_upserts(document_info, markdown_result).expect("Could not generate upserts");

        assert_eq!(upserts.len(), 1);
        assert_eq!(upserts[0].sub_type, Some("task".to_string()));
    }
}
