use anyhow::Context;
use chrono::Utc;
use model::document::{
    CONVERTED_DOCUMENT_FILE_NAME, DocumentMetadata, FileType,
    build_cloud_storage_bucket_document_key,
};
use models_search::document::MarkdownParseResult;
use opensearch_client::{
    OpensearchClient, date_format::EpochSeconds, upsert::document::UpsertDocumentArgs,
};

use crate::{
    parsers::{canvas::parse_canvas, markdown::parse_markdown_legacy, pdf::parse_pdf_pages},
    process::document::document_info::get_document_info,
};

use super::SearchExtractorMessage;

async fn upsert_document(
    opensearch_client: &OpensearchClient,
    search_extractor_message: &SearchExtractorMessage,
    upserts: Vec<UpsertDocumentArgs>,
) -> anyhow::Result<()> {
    // Delete existing documents for the document id
    // This ensures we replace any old nodes with new ones for editable files
    match search_extractor_message.file_type {
        FileType::Md | FileType::Canvas => {
            tracing::debug!("deleting existing search results");
            opensearch_client
                .delete_document(&search_extractor_message.document_id)
                .await
                .context("unable to delete existing search results")?;
        }
        _ => {}
    }

    let results = opensearch_client
        .bulk_upsert_documents(&upserts)
        .await
        .context("unable to bulk upsert documents in opensearch")?;

    if !results.errors.is_empty() {
        tracing::error!(errors=?results.errors, "bulk upsert failed");

        // delete document that failed to upsert
        opensearch_client
            .delete_document(&search_extractor_message.document_id)
            .await
            .context("failed to delete document for failed bulk upsert")?;

        anyhow::bail!("failed to upsert documents");
    }

    tracing::trace!("upserted document");

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
    // Early exit if we do not support search on the file type
    // TODO: support other documents
    match search_extractor_message.file_type.macro_app_path().as_str() {
        "pdf" | "write" | "code" | "canvas" | "md" => {}
        _ => {
            tracing::warn!("unsupported file type");
            return Ok(());
        }
    }

    // This ensures we only process the latest version
    let document_info = get_document_info(db, search_extractor_message)
        .await
        .context("failed to get document info")?;

    let document_info = if let Some(document_info) = document_info {
        document_info
    } else {
        tracing::trace!("no document info returned");
        return Ok(());
    };

    let document_name = document_info.document_name;

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

    let file_type: FileType = document_info
        .file_type
        .context("expected a file type")?
        .as_str()
        .try_into()
        .context("unable to parse file type")?;

    // This is a check to see if the document version id in the message matches the document version
    if let Some(search_message_document_version_id) =
        search_extractor_message.document_version_id.as_ref()
        && !search_message_document_version_id.eq(&document_version_id)
    {
        if search_message_document_version_id.eq(CONVERTED_DOCUMENT_FILE_NAME) {
            tracing::debug!("document is a convert document, continue");
        } else {
            tracing::debug!(
                search_message_document_version_id = search_message_document_version_id,
                document_version_id = document_version_id,
                "document version is not latest, skipping"
            );
            return Ok(());
        }
    }

    let key = build_cloud_storage_bucket_document_key(
        &search_extractor_message.user_id,
        &search_extractor_message.document_id,
        document_version_id, // will be "converted" or document version id
        Some(search_extractor_message.file_type.as_str()),
    );

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

    let upserts: Vec<UpsertDocumentArgs> = match file_type {
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
                }]
            }
        }
    };

    upsert_document(opensearch_client, search_extractor_message, upserts).await?;

    Ok(())
}

fn generate_upserts(
    document_info: DocumentMetadata,
    markdown_result: Vec<MarkdownParseResult>,
) -> anyhow::Result<Vec<UpsertDocumentArgs>> {
    let result = markdown_result;
    let updated_at = EpochSeconds::new(Utc::now().timestamp())?;
    let file_type: FileType = document_info
        .file_type
        .context("expected a file type")?
        .as_str()
        .try_into()
        .context("unable to parse file type")?;
    let document_name = document_info.document_name;

    let upserts = result
        .into_iter()
        .map(|result| UpsertDocumentArgs {
            document_id: document_info.document_id.clone(),
            node_id: result.node_id,
            raw_content: Some(result.raw_content),
            document_name: document_name.clone(),
            content: result.content,
            owner_id: document_info.owner.clone(),
            file_type: file_type.to_string(),
            updated_at_seconds: updated_at,
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
    match search_extractor_message.file_type.macro_app_path().as_str() {
        "md" => {}
        _ => {
            tracing::warn!("unsupported file type");
            return Ok(());
        }
    }

    let document_info = get_document_info(db, search_extractor_message)
        .await
        .context("failed to get document info")?;

    let document_info = if let Some(document_info) = document_info {
        document_info
    } else {
        tracing::trace!("no document info returned");
        return Ok(());
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

    let upserts = generate_upserts(document_info, result).context("unable to generate upserts")?;

    upsert_document(opensearch_client, search_extractor_message, upserts).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_generate_upsert() {
        let document_info = DocumentMetadata {
            document_id: "AAA".to_string(),
            document_version_id: 0,
            owner: "fake|nobody@macro.com".to_string(),
            document_name: "test_document".to_string(),
            file_type: Some("md".to_string()),
            ..Default::default()
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
    }
}
