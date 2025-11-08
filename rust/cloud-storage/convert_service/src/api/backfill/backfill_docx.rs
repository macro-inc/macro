use std::{
    collections::HashMap,
    io::{Cursor, Write},
};

use anyhow::Context;
use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures::StreamExt;
use model::{
    convert::ConvertQueueMessage,
    document::{BomPart, BomPartWithContent, CONVERTED_DOCUMENT_FILE_NAME, DocumentMetadata},
    request::pagination::{Pagination, PaginationQueryParams},
    response::ErrorResponse,
};

use crate::api::context::ApiContext;

/// All files in temp_files automatically get removed from document storage bucket after 1 day
static BULK_DOCX_CONVERT_PREFIX: &str = "temp_files";

/// Backfill docx all
#[utoipa::path(
        post,
        path = "/internal/backfill/docx",
        operation_id = "backfill_docx",
        security(
            ("internal" = [])
        ),
        params(
            ("limit" = i64, Query, description = "The maximum number of documents to retreive. Default 10, max 500"),
            ("offset" = i64, Query, description = "The offset to start from. Default 0."),
        ),
        responses(
            (status = 200, description = "success", body = String),
            (status = 401, description = "unauthorized", body = ErrorResponse),
            (status = 500, description = "internal server error", body = ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    extract::Query(pagination): extract::Query<PaginationQueryParams>,
) -> Result<Response, Response> {
    let pagination = Pagination::from_query_params(pagination);
    let (documents, total_count) =
        macro_db_client::convert::get_docx_files(&ctx.db, pagination.limit, pagination.offset)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get documents");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to get documents",
                    }),
                )
                    .into_response()
            })?;

    let total_chunks = documents.len() / 25;
    for (processed_chunks, chunk) in documents.chunks(25).enumerate() {
        tracing::info!("processing chunk {}/{}", processed_chunks, total_chunks);
        let chunk_result = futures::stream::iter(chunk.iter())
            .then(|doc| {
                let s3_client = ctx.s3_client.clone();
                let document_storage_bucket = ctx.config.document_storage_bucket.clone();

                async move { process_docx(&s3_client, &document_storage_bucket, doc).await }
            })
            .collect::<Vec<Result<Option<ConvertQueueMessage>, (String, anyhow::Error)>>>()
            .await;
        tracing::trace!("chunk processed");

        for result in chunk_result {
            match result {
                Ok(Some(convert_queue_message)) => {
                    if let Err(e) = ctx
                        .sqs_client
                        .enqueue_convert_queue_message(convert_queue_message)
                        .await
                    {
                        tracing::error!(error=?e, "unable to enqueue message");
                    }
                }
                Ok(None) => {}
                Err((document_id, e)) => {
                    tracing::error!(error=?e, document_id=%document_id, "unable to process document");
                }
            }
        }
    }

    // Only include the next offset if there are more documents to fetch
    let next_offset = if pagination.offset + pagination.limit < total_count {
        Some(pagination.offset + pagination.limit)
    } else {
        None
    };

    Ok((StatusCode::OK, next_offset.unwrap_or(0).to_string()).into_response())
}

/// Processes a single document, storing the zipped docx file in s3 to be converted by the convert service
#[tracing::instrument(skip(s3_client, document_storage_bucket, document), fields(document_id=%document.document_id))]
async fn process_docx(
    s3_client: &s3_client::S3,
    document_storage_bucket: &str,
    document: &DocumentMetadata,
) -> Result<Option<ConvertQueueMessage>, (String, anyhow::Error)> {
    let result: anyhow::Result<Option<ConvertQueueMessage>> = async {
        if let Some(bom_parts) = document.document_bom.clone() {
            let bom_parts: Vec<BomPart> =
                serde_json::from_value(bom_parts).context("unable to serialize bom parts")?;

            // check if the converted item exists in s3
            let key = format!(
                "{}/{}/{}.pdf",
                document.owner, document.document_id, CONVERTED_DOCUMENT_FILE_NAME
            );

            let exists = s3_client
                .exists(document_storage_bucket, &key)
                .await
                .context("unable to check if converted file exists")?;

            if exists {
                tracing::info!("converted file already exists");
                return Ok(None);
            }

            let shas: Vec<String> = bom_parts
                .iter()
                .map(|part| part.sha.clone())
                .collect::<Vec<_>>();

            let result = futures::stream::iter(shas.iter())
                .then(|sha| {
                    let s3_client = s3_client.clone();
                    async move {
                        let content = s3_client.get(document_storage_bucket, sha).await?;

                        Ok((sha.clone(), content))
                    }
                })
                .collect::<Vec<anyhow::Result<(String, Vec<u8>)>>>()
                .await;

            if result.iter().any(|r| r.is_err()) {
                tracing::error!("unable to get all shas");
                return Ok(None);
            }

            let sha_hashmap: HashMap<String, Vec<u8>> =
                result.into_iter().map(|r| r.unwrap()).collect();

            let bom_parts_with_content: Vec<BomPartWithContent> = bom_parts
                .into_iter()
                .map(|part| BomPartWithContent {
                    id: part.id,
                    path: part.path,
                    content: sha_hashmap.get(&part.sha).unwrap().to_vec(),
                    sha: part.sha,
                })
                .collect();

            let zipped_docx = zip_bom_parts(bom_parts_with_content).await?;

            let from_key = format!("{}/{}.docx", BULK_DOCX_CONVERT_PREFIX, document.document_id);
            let to_key = format!(
                "{}/{}/{}.pdf",
                document.owner, document.document_id, CONVERTED_DOCUMENT_FILE_NAME
            );

            s3_client
                .put(document_storage_bucket, &from_key, &zipped_docx)
                .await
                .context("unable to put converted file")?;

            return Ok(Some(ConvertQueueMessage {
                job_id: macro_uuid::generate_uuid_v7().to_string(),
                from_bucket: document_storage_bucket.to_string(),
                to_bucket: document_storage_bucket.to_string(),
                from_key: from_key.clone(),
                to_key: to_key.clone(),
            }));
        }

        tracing::warn!("unable to get bom parts for document");
        Ok(None)
    }
    .await;

    match result {
        Ok(Some(convert_queue_message)) => {
            tracing::info!("converted file created");
            Ok(Some(convert_queue_message))
        }
        Ok(None) => Ok(None),
        Err(e) => {
            tracing::error!(error=?e, "unable to process document");
            Err((document.document_id.clone(), e))
        }
    }
}

/// Creates the zipped docx file from the provided parts
async fn zip_bom_parts(parts: Vec<BomPartWithContent>) -> anyhow::Result<Vec<u8>> {
    let writer = Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(writer);

    for part in parts {
        zip.start_file::<_, ()>(part.path, zip::write::FileOptions::default())?;
        zip.write_all(&part.content)?;
    }

    // Finish the ZIP archive
    let writer = zip.finish()?;
    let data = writer.into_inner();

    Ok(data)
}
