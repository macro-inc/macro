use nix::{
    libc::exit,
    unistd::{ForkResult, fork},
};
use rs_libreoffice_bindings::Office;
use std::{borrow::Cow, fs::File, io::Write, str::FromStr, thread, time::Duration};

use anyhow::Context;
use model::{convert::ConvertQueueMessage, document::FileType};

use crate::{
    config::{LOK_PATH, WEB_SOCKET_RESPONSE_LAMBDA},
    model::{BomPart, DocxUploadJobData, DocxUploadJobResult, DocxUploadJobSuccessDataInner},
    utils::{cleanup_folder, get_lok_filter_from_file_types},
};

static MAX_WAIT_TIME_SECONDS: u64 = 30;

/// Processes a message from the convert queue
/// Returns the job id and the convert queue message
#[tracing::instrument(skip(worker, s3_client, lambda_client, message), fields(message_id = message.message_id))]
pub async fn process_message(
    worker: &sqs_worker::SQSWorker,
    s3_client: &s3_client::S3,
    lambda_client: &lambda_client::Lambda,
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
        return Err(anyhow::anyhow!("required message attributes not found"));
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
        return Err(anyhow::anyhow!("message body not provided"));
    };

    tracing::info!(job_id=%job_id, message_body=?req, "message body");

    let result = convert(&job_id, &req, s3_client).await;

    if let Err(e) = cleanup_folder(&job_id) {
        tracing::error!(error=?e, job_id=%job_id, "unable to cleanup folder");
    }

    match result {
        Ok(_) => {
            if req.from_key.ends_with(".docx") {
                tracing::trace!("sending success message to lambda");
                lambda_client
                    .invoke_event(
                        &WEB_SOCKET_RESPONSE_LAMBDA,
                        &DocxUploadJobResult {
                            job_id: Cow::Borrowed(&job_id),
                            status: "Completed".into(),
                            job_type: "docx_upload".into(), // TODO: will need to pass in job type to the convert message eventually
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
                        },
                    )
                    .await?;
            }
        }
        Err(e) => {
            if req.from_key.ends_with(".docx") {
                tracing::trace!("sending failure message to lambda");
                lambda_client
                    .invoke_event(
                        &WEB_SOCKET_RESPONSE_LAMBDA,
                        &DocxUploadJobResult {
                            job_id: Cow::Borrowed(&job_id),
                            status: "Failed".into(),
                            job_type: "docx_upload".into(), // TODO: will need to pass in job type to the convert message eventually
                            data: DocxUploadJobData {
                                error: true,
                                message: Some("error converting document".to_string()),
                                data: None,
                            },
                        },
                    )
                    .await?;
            }
            return Err(e);
        }
    }

    if let Err(e) = worker.cleanup_message(message).await {
        tracing::error!(error=?e, job_id=&job_id, "failed to cleanup message");
    }

    Ok(())
}

pub async fn convert(
    job_id: &str,
    req: &ConvertQueueMessage,
    s3_client: &s3_client::S3,
) -> anyhow::Result<()> {
    let from_file_type: FileType = req
        .from_key
        .split('.')
        .next_back()
        .context("expected key to contain a file type")
        .and_then(|s| Ok(FileType::from_str(s)?))?;

    let to_file_type: FileType = req
        .to_key
        .split('.')
        .next_back()
        .context("expected key to contain a file type")
        .and_then(|s| Ok(FileType::from_str(s)?))?;

    let filter = get_lok_filter_from_file_types(&from_file_type, &to_file_type)
        .context("unable to get lok filter")?;

    let directory = format!("./{}", job_id);
    let in_file_path = format!("{directory}/IN.{}", from_file_type.as_str());
    let out_file_path = format!("{directory}/OUT.{}", to_file_type.as_str());

    // Make directory of job_id
    let file_content = s3_client
        .get(&req.from_bucket, &req.from_key)
        .await
        .context("unable to get object from S3")?;

    std::fs::create_dir(&directory).map_err(|e| {
        anyhow::anyhow!(
            "unable to create directory {}: {}",
            directory,
            e.to_string()
        )
    })?;

    let mut file = File::create(&in_file_path).context("unable to create input file")?;

    file.write_all(&file_content)
        .context("unable to write to input file")?;

    let office_path = &*LOK_PATH;
    let mut child_pids = vec![];
    match unsafe { fork() } {
        Ok(ForkResult::Parent { child }) => {
            tracing::info!(job_id=%job_id, "parent process: spawned child with PID: {}", child);
            child_pids.push(child);
        }
        Ok(ForkResult::Child) => unsafe {
            tracing::info!(job_id=%job_id, "child process: initializing lok");
            let result: anyhow::Result<()> = (|| {
                std::env::set_var("SAL_LOG", "");
                let office = Office::new(office_path)
                    .map_err(|e| anyhow::anyhow!(e))
                    .context("unable to initialize lok")?;
                tracing::trace!("office initialized");

                let document = office
                    .load_document(&in_file_path)
                    .map_err(|e| anyhow::anyhow!(e))
                    .context("unable to load document")?;
                tracing::trace!("document loaded");

                document
                    .save_as(&out_file_path, to_file_type.as_str(), &filter)
                    .map_err(|e| anyhow::anyhow!(e))
                    .context("unable to save document")?;
                tracing::trace!("document saved");

                drop(document);
                drop(office);

                Ok(())
            })();

            match result {
                Ok(_) => exit(0),
                Err(e) => {
                    tracing::error!(job_id=%job_id, error=?e, "unable to convert");
                    exit(1)
                }
            }
        },
        Err(err) => {
            tracing::error!(job_id=%job_id, error=?err, "fork failed");
            return Err(anyhow::anyhow!("fork failed"));
        }
    }

    // Assume failure
    let mut status_code = 1;
    let start_time = std::time::Instant::now();
    loop {
        if child_pids.is_empty() {
            break;
        }

        // Check if we've exceeded the timeout
        if start_time.elapsed().as_secs() > MAX_WAIT_TIME_SECONDS {
            tracing::error!(job_id=%job_id, "conversion timed out");
            // Kill any remaining child processes
            for &pid in &child_pids {
                tracing::trace!(job_id=%job_id, pid=%pid, "killing pid");
                if let Err(e) = nix::sys::signal::kill(
                    nix::unistd::Pid::from_raw(pid.into()),
                    nix::sys::signal::Signal::SIGKILL,
                ) {
                    tracing::error!(job_id=%job_id, error=?e, "failed to kill child process {}", pid);
                }
            }
        }

        // Prevent locking
        thread::sleep(Duration::from_millis(200));

        // check for completed children
        child_pids.retain(|&pid| {
            match nix::sys::wait::waitpid(
                nix::unistd::Pid::from_raw(pid.into()),
                Some(nix::sys::wait::WaitPidFlag::WNOHANG),
            ) {
                Ok(nix::sys::wait::WaitStatus::StillAlive) => true,
                Ok(nix::sys::wait::WaitStatus::Exited(_, status)) => {
                    tracing::debug!(job_id=%job_id, status=status, "pid {} completed", pid);
                    status_code = status;
                    false
                }
                _ => {
                    // This is called when the child process was forcefully killed above.
                    false
                }
            }
        });
    }

    if status_code != 0 {
        tracing::error!(job_id=%job_id, status=status_code, "conversion failed with non-zero status code");
        if let Err(e) = cleanup_folder(job_id) {
            tracing::error!(error=?e, job_id=%job_id, "unable to cleanup folder");
        }
        return Err(anyhow::anyhow!("conversion failed"));
    }

    let file_content = std::fs::read(out_file_path).context("unable to read result file")?;

    s3_client
        .put(&req.to_bucket, &req.to_key, &file_content)
        .await
        .context("unable to upload file")?;

    Ok(())
}
