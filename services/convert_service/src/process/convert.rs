use rs_libreoffice_bindings::Office;
use std::{borrow::Cow, ffi::OsStr, path::Path, sync::Arc, time::Duration};

use anyhow::Context;
use model::{convert::ConvertQueueMessage, document::FileType};

use crate::{
    config::{LOK_PATH, WEB_SOCKET_RESPONSE_LAMBDA},
    model::{BomPart, DocxUploadJobData, DocxUploadJobResult, DocxUploadJobSuccessDataInner},
    process::child::{ChildExit, run_confined, set_child_env},
    scratch::Scratch,
    utils::{conversion_timeout, get_lok_filter_from_file_types, resolve_file_type},
};

pub(super) fn is_docx_key(key: &str) -> bool {
    key.to_ascii_lowercase().ends_with(".docx")
}

/// Processes a message from the convert queue
/// Returns the job id and the convert queue message
#[tracing::instrument(err(Debug), skip(worker, s3_client, lambda_client, scratch, message), fields(message_id = message.message_id))]
pub async fn process_message(
    worker: &sqs_worker::SQSWorker,
    s3_client: &s3_client::S3,
    lambda_client: &lambda_client::Lambda,
    scratch: &Arc<Scratch>,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    tracing::info!("processing message");

    let job_id = if let Some(attributes) = message.message_attributes.as_ref() {
        let job_id = attributes
            .get("job_id")
            .map(|job_id| {
                tracing::trace!(job_id=?job_id, "found job_id in message attributes");
                job_id.string_value().unwrap_or_default()
            })
            .context("job_id should be a message attribute")?;

        job_id.to_string()
    } else {
        worker
            .cleanup_message(message)
            .await
            .context("failed to cleanup message")?;
        anyhow::bail!("required message attributes not found");
    };

    tracing::info!(job_id=%job_id, "message attributes");

    let req = if let Some(body) = message.body.as_ref() {
        tracing::trace!(job_id=%job_id, body=%body, "found body in message");
        serde_json::from_str::<ConvertQueueMessage>(body)
            .context("failed to deserialize message")?
    } else {
        worker
            .cleanup_message(message)
            .await
            .context("failed to cleanup message")?;
        anyhow::bail!("message body not provided");
    };

    tracing::info!(job_id=%job_id, message_body=?req, "message body");

    let result = convert(&job_id, &req, s3_client, scratch).await;

    if let Some(update) = job_update(&job_id, &req, result.is_ok()) {
        tracing::trace!(status=%update.status, "sending job update to lambda");
        lambda_client
            .invoke_event(&WEB_SOCKET_RESPONSE_LAMBDA, &update)
            .await?;
    }

    result?;

    if let Err(e) = worker.cleanup_message(message).await {
        tracing::error!(error=?e, job_id=&job_id, "failed to cleanup message");
    }

    Ok(())
}

/// The job update to send for a finished conversion, if a client job is
/// waiting on it.
pub(super) fn job_update<'a>(
    job_id: &'a str,
    req: &ConvertQueueMessage,
    converted: bool,
) -> Option<DocxUploadJobResult<'a>> {
    if !req.notify_job || !is_docx_key(&req.from_key) {
        return None;
    }

    // TODO: will need to pass in job type to the convert message eventually
    let job_type = "docx_upload".into();

    if !converted {
        return Some(DocxUploadJobResult {
            job_id: Cow::Borrowed(job_id),
            status: "Failed".into(),
            job_type,
            data: DocxUploadJobData {
                error: true,
                message: Some("error converting document".to_string()),
                data: None,
            },
        });
    }

    Some(DocxUploadJobResult {
        job_id: Cow::Borrowed(job_id),
        status: "Completed".into(),
        job_type,
        data: DocxUploadJobData {
            error: false,
            message: None,
            data: Some(DocxUploadJobSuccessDataInner {
                converted: true,
                bom_parts: vec![BomPart {
                    sha: "bogus".to_string(),
                    path: "bogus".to_string(),
                    id: "bogus".to_string(),
                    document_bom_id: 1,
                }],
            }),
        },
    })
}

pub async fn convert(
    job_id: &str,
    req: &ConvertQueueMessage,
    s3_client: &s3_client::S3,
    scratch: &Arc<Scratch>,
) -> anyhow::Result<()> {
    let from_file_type = resolve_file_type(req.from_file_type, &req.from_key)?;
    let to_file_type = resolve_file_type(req.to_file_type, &req.to_key)?;

    let filter = get_lok_filter_from_file_types(&from_file_type, &to_file_type)
        .context("unable to get lok filter")?;

    let input = s3_client
        .get(&req.from_bucket, &req.from_key)
        .await
        .context("unable to get object from S3")?;

    let conversion = Conversion::new(job_id, from_file_type, to_file_type, filter);
    let output = convert_file(scratch.clone(), conversion, input).await?;

    s3_client
        .put(&req.to_bucket, &req.to_key, &output)
        .await
        .context("unable to upload file")?;

    Ok(())
}

/// One conversion to run.
pub(crate) struct Conversion {
    /// Names the job in logs.
    pub job_id: String,
    pub from: FileType,
    pub to: FileType,
    /// LibreOfficeKit filter options, see `get_lok_filter_from_file_types`.
    pub filter: String,
    /// How long the conversion may run before it is killed.
    pub max_wait: Duration,
}

impl Conversion {
    pub(crate) fn new(job_id: &str, from: FileType, to: FileType, filter: String) -> Self {
        Self {
            job_id: job_id.to_string(),
            max_wait: conversion_timeout(&from, &to),
            from,
            to,
            filter,
        }
    }
}

/// Converts `input` and returns the converted file.
///
/// The conversion blocks until LibreOffice finishes, so it runs on a blocking
/// thread: on the async workers it would starve the health check and every
/// other request for as long as it ran.
pub(crate) async fn convert_file(
    scratch: Arc<Scratch>,
    conversion: Conversion,
    input: Vec<u8>,
) -> anyhow::Result<Vec<u8>> {
    let span = tracing::Span::current();
    let task = tokio::task::spawn_blocking(move || {
        let _entered = span.enter();
        convert_in_job_folder(&scratch, &LOK_PATH, &conversion, &input)
    });

    match task.await {
        Ok(result) => result,
        Err(e) => match e.try_into_panic() {
            Ok(panic) => std::panic::resume_unwind(panic),
            Err(e) => Err(e).context("conversion was cancelled"),
        },
    }
}

/// Converts `input` inside a job folder of its own, which is removed when
/// this returns or panics.
pub(crate) fn convert_in_job_folder(
    scratch: &Scratch,
    office_path: &str,
    conversion: &Conversion,
    input: &[u8],
) -> anyhow::Result<Vec<u8>> {
    let folder = scratch.create_job()?;
    let in_file_path = folder
        .path()
        .join(format!("IN.{}", conversion.from.as_str()));
    let out_file_path = folder
        .path()
        .join(format!("OUT.{}", conversion.to.as_str()));

    std::fs::write(&in_file_path, input).context("unable to write input file")?;

    run_lok_conversion(
        conversion,
        office_path,
        folder.path(),
        scratch.cache(),
        &in_file_path,
        &out_file_path,
    )?;

    std::fs::read(&out_file_path).context("unable to read result file")
}

/// Converts `in_file_path` to `out_file_path` with LibreOfficeKit in a child
/// process confined to `folder`, killing it after the conversion's time limit.
///
/// The child process keeps a LibreOffice crash or hang from taking down the
/// worker. Removing `folder` cleans up after the child however it ended.
pub(crate) fn run_lok_conversion(
    conversion: &Conversion,
    office_path: &str,
    folder: &Path,
    cache: &Path,
    in_file_path: &Path,
    out_file_path: &Path,
) -> anyhow::Result<()> {
    let job_id = conversion.job_id.as_str();
    let in_file_path = in_file_path
        .to_str()
        .context("input file path is not UTF-8")?;
    let out_file_path = out_file_path
        .to_str()
        .context("output file path is not UTF-8")?;

    let exit = run_confined(folder, cache, conversion.max_wait, || {
        tracing::info!(job_id=%job_id, "child process: initializing lok");
        let result: anyhow::Result<()> = (|| {
            set_child_env(c"SAL_LOG", OsStr::new(""))?;
            let office = Office::new(office_path)
                .map_err(|e| anyhow::anyhow!(e))
                .context("unable to initialize lok")?;
            tracing::trace!("office initialized");

            let document = office
                .load_document(in_file_path)
                .map_err(|e| anyhow::anyhow!(e))
                .context("unable to load document")?;
            tracing::trace!("document loaded");

            document
                .save_as(out_file_path, conversion.to.as_str(), &conversion.filter)
                .map_err(|e| anyhow::anyhow!(e))
                .context("unable to save document")?;
            tracing::trace!("document saved");

            // The child exits right after this, so skip LibreOffice's
            // teardown: Writer can crash while destroying a document it
            // has already saved, which would fail a finished conversion.
            std::mem::forget(document);
            std::mem::forget(office);

            Ok(())
        })();

        result.inspect_err(|e| tracing::error!(job_id=%job_id, error=?e, "unable to convert"))
    })?;

    match exit {
        ChildExit::Succeeded => Ok(()),
        ChildExit::TimedOut => {
            anyhow::bail!("conversion timed out after {:?}", conversion.max_wait)
        }
        ChildExit::Failed(status) => anyhow::bail!("conversion failed with status {status}"),
        ChildExit::Signaled(signal) => anyhow::bail!("conversion crashed with {signal}"),
    }
}
