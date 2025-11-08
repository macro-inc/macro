use anyhow::Context;
use lambda_runtime::tracing::{self, Level};
use model::{
    convert::ConvertQueueMessage,
    document::{CONVERTED_DOCUMENT_FILE_NAME, SaveBomPart},
};

use crate::{
    context::{self},
    models::DocumentKeyParts,
    service,
};

#[tracing::instrument(skip(ctx), fields(key=%key, bucket=%bucket))]
/// Create a list of document bom parts from a document key parts and a bucket.
pub async fn process(
    ctx: context::Context,
    bucket: &String,
    key: &String,
) -> Result<(), anyhow::Error> {
    let document_key_parts = match DocumentKeyParts::from_s3_key(key) {
        Ok(parts) => parts,
        Err(e) => {
            tracing::error!(error=?e, "invalid key format");
            return Err(e);
        }
    };

    let span = tracing::span!(Level::TRACE, "process", document_id=%document_key_parts.document_id, document_bom_id=%document_key_parts.document_bom_id);
    let _guard = span.enter();

    tracing::info!("processing record");

    // Get docx upload job for job id using document id
    tracing::trace!("getting docx upload job");
    let job = macro_db_client::docx_unzip::get_job_for_docx_upload(
        &ctx.db,
        &document_key_parts.document_id,
    )
    .await?;

    let job_id = if let Some((job_id, _)) = job {
        job_id
    } else {
        tracing::warn!("no job id found. making a new uuid");
        macro_uuid::generate_uuid_v7().to_string()
    };

    // send convert message
    tracing::trace!("queueing convert");
    if let Err(e) = ctx
        .sqs_client
        .enqueue_convert_queue_message(ConvertQueueMessage {
            job_id,
            from_bucket: bucket.clone(),
            from_key: document_key_parts.to_key(),
            // The key for storing a converted version of a file is
            // "{user_id}/{document_id}/converted.{file_extension}"
            to_key: format!(
                "{}/{}/{}.pdf",
                document_key_parts.user_id,
                document_key_parts.document_id,
                CONVERTED_DOCUMENT_FILE_NAME
            ),
            to_bucket: ctx.config.document_storage_bucket.clone(),
        })
        .await
    {
        tracing::error!(error=?e, "unable to send convert message");
        return Err(e);
    }

    let document_data = match ctx
        .s3_client
        .get(bucket, &document_key_parts.to_key())
        .await
    {
        Ok(d) => d,
        Err(e) => {
            tracing::error!(error=?e, "unable to retrieve document");
            return Err(e);
        }
    };

    tracing::trace!("document retrieved");

    if let Err(e) = macro_db_client::docx_unzip::update_uploaded_status(
        &ctx.db,
        &document_key_parts.document_id,
    )
    .await
    {
        tracing::error!(error=?e, "unable to update uploaded status");
        return Err(e);
    }
    tracing::trace!("uploaded status updated");

    let bom_parts = match service::document::unzip(document_data) {
        Ok(parts) => parts,
        Err(e) => {
            tracing::error!(error=?e, "unable to create bom parts");
            return Err(e);
        }
    };

    tracing::trace!("docx unzipped");

    let shas: Vec<String> = bom_parts.iter().map(|bp| bp.sha.clone()).collect();

    // Get a list of shas that do not exist in redis yet
    let bom_parts_to_upload: Vec<String> = ctx
        .redis_client
        .find_non_existing_shas_string(shas.clone())
        .await?;

    tracing::trace!("got bom parts to upload");

    if !bom_parts_to_upload.is_empty() {
        tracing::trace!("uploading bom parts");
        service::document::upload_bom_parts(
            ctx.s3_client.clone(),
            ctx.config.document_storage_bucket.as_str(),
            bom_parts.clone(),
            bom_parts_to_upload,
        )
        .await?
    }
    tracing::trace!("bom parts uploaded");

    let save_bom_parts: Vec<SaveBomPart> = bom_parts
        .iter()
        .map(|bp| SaveBomPart {
            sha: bp.sha.clone(),
            path: bp.path.clone(),
        })
        .collect();

    macro_db_client::docx_unzip::save_bom_parts_to_db(
        &ctx.db,
        &save_bom_parts,
        document_key_parts.document_bom_id,
    )
    .await
    .context("unable to save bom parts to db")?;

    tracing::trace!("bom parts saved to db");

    tracing::trace!("incrementing sha counts");
    ctx.redis_client.increment_counts(shas).await?;

    tracing::info!("complete");

    Ok(())
}
