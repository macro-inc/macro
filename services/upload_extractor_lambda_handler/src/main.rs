use anyhow::{Context, Result};
use aws_lambda_events::{event::sqs::SqsEvent, sqs::SqsMessage};
use aws_sdk_s3::{Client as S3Client, primitives::ByteStream};
use connection_gateway_client::client::ConnectionGatewayClient;
use document_storage_service_client::DocumentStorageServiceClient;
use dynamodb_client::DynamodbClient;
use futures::{
    StreamExt, TryStreamExt,
    stream::{self},
};
use lambda_runtime::{
    Error, LambdaEvent, run, service_fn,
    tracing::{self},
};
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_vars;
use macro_service_urls::ConnectionGatewayUrl;
use model::{
    document::{FileType, FileTypeExt},
    folder::{FileSystemNodeWithIds, FolderItem, S3Destination, S3DestinationMap},
};
use model_entity::EntityType;
use models_bulk_upload::{
    UploadDocumentStatus, UploadFolderProgress, UploadFolderStatus, UploadFolderStatusUpdate,
};
use sha2::{Digest, Sha256};
use sqs_client::upload_extractor::UploadExtractQueueMessage;
use std::ffi::OsStr;
use std::path::Path;
use std::time::{Duration, Instant};
use std::{fs, str::FromStr};
use std::{path::PathBuf, sync::Arc};
use tempfile::tempdir;
use tokio::{fs::File, io::AsyncReadExt};
use tracing::Instrument;
use zip::read::root_dir_common_filter;

/// Files hashed or copied to storage at once. Lambda allows 1,024 open file
/// descriptors, and a copy holds both the file and its S3 connection.
const CONCURRENT_FILE_TASKS: usize = 64;

/// How often the extractor records how many files it has stored, for the
/// uploader's progress indicator.
const PROGRESS_INTERVAL: Duration = Duration::from_secs(2);

/// Attempts at marking an extracted tree uploaded. Marking is idempotent, and a
/// tree left unmarked stays hidden, so a brief DSS failure is retried.
const MARK_UPLOADED_ATTEMPTS: u32 = 3;

env_vars! {
    struct LocalZipPath;
    struct UploadBucketName;
    struct InternalApiSecretKey;
    struct DssUrl;
    struct DynamodbTable;
}

fn get_upload_message_from_sqs_record(record: SqsMessage) -> Result<UploadExtractQueueMessage> {
    let body = record.body.as_deref().unwrap_or_default();
    let message = serde_json::from_str::<UploadExtractQueueMessage>(body)?;
    Ok(message)
}

#[tracing::instrument(skip_all)]
async fn handler(
    s3_client: Arc<S3Client>,
    dss_client: Arc<DocumentStorageServiceClient>,
    dynamodb_client: Arc<DynamodbClient>,
    conn_gateway_client: Arc<ConnectionGatewayClient>,
    upload_bucket_name: &str,
    event: LambdaEvent<SqsEvent>,
) -> Result<(), Error> {
    tracing::debug!("Processing SQS event");

    for record in event.payload.records {
        let upload_request = match get_upload_message_from_sqs_record(record) {
            Ok(req) => req,
            Err(err) => {
                tracing::error!("Failed to get upload request from SQS record: {:?}", err);
                continue;
            }
        };

        tracing::debug!("Processing upload request {:?}", upload_request);

        let request_id = upload_request.upload_request_id();
        let user_id = upload_request.user_id().as_str();
        let zip_name = upload_request.name();
        let parent_id = match &upload_request {
            UploadExtractQueueMessage::ExtractZip(msg) => msg.parent_id.clone(),
        };

        let upload_status = match process_zipped_s3_object(
            &s3_client,
            &dss_client,
            &dynamodb_client,
            upload_request.key(),
            upload_bucket_name,
            request_id,
            user_id,
            zip_name,
            parent_id.as_deref(),
        )
        .await
        {
            Ok((upload_status, root_project_id)) => {
                let pid = root_project_id.as_str();

                // A partial upload still has a usable tree; leaving it pending would hide
                // every folder because of one bad file. The tree is marked uploaded before
                // the outcome is recorded, because the uploader polls that record and must
                // not hear of success while the folder is still hidden.
                let marked = match &upload_status {
                    UploadFolderStatus::Completed | UploadFolderStatus::PartiallyCompleted => {
                        with_retries(MARK_UPLOADED_ATTEMPTS, || {
                            dss_client.mark_projects_uploaded(user_id, pid)
                        })
                        .await
                        .map(|_| ())
                    }
                    _ => Ok(()),
                };

                let recorded_status = match &marked {
                    Ok(_) => upload_status.clone(),
                    Err(_) => UploadFolderStatus::Unknown,
                };
                dynamodb_client
                    .bulk_upload
                    .update_bulk_upload_request_status(request_id, recorded_status, None, Some(pid))
                    .await
                    .inspect_err(|e| tracing::error!("Failed to update dynamo status: {:?}", e))
                    .ok();

                match (marked, &upload_status) {
                    (Ok(_), UploadFolderStatus::Completed) => UploadFolderStatusUpdate::Completed {
                        request_id: request_id.clone(),
                        project_id: root_project_id.clone(),
                    },
                    (Ok(_), UploadFolderStatus::PartiallyCompleted) => {
                        UploadFolderStatusUpdate::PartiallyCompleted {
                            request_id: request_id.clone(),
                            project_id: root_project_id.clone(),
                        }
                    }
                    (Ok(_), _) => UploadFolderStatusUpdate::Failed {
                        request_id: request_id.clone(),
                    },
                    (Err(e), _) => {
                        tracing::error!("Failed to update dss status: {:?}", e);
                        UploadFolderStatusUpdate::Unknown {
                            request_id: request_id.clone(),
                        }
                    }
                }
            }
            Err(err) => {
                tracing::error!(
                    "Failed to process upload request {:?}: {:?}",
                    upload_request,
                    err
                );
                dynamodb_client
                    .bulk_upload
                    .update_bulk_upload_request_status(
                        request_id,
                        UploadFolderStatus::Failed,
                        Some(&err.to_string()),
                        None,
                    )
                    .await
                    .inspect_err(|e| tracing::error!("Failed to update dynamo status: {:?}", e))
                    .ok();

                UploadFolderStatusUpdate::Failed {
                    request_id: request_id.clone(),
                }
            }
        };

        update_bulk_upload_request_state(conn_gateway_client.as_ref(), user_id, upload_status)
            .await;
    }

    Ok(())
}

/// Runs `operation` up to `attempts` times, backing off between failures, and
/// returns the first success or the last failure.
async fn with_retries<T, E, F, Fut>(attempts: u32, mut operation: F) -> Result<T, E>
where
    E: std::fmt::Debug,
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
{
    let mut attempt = 1;
    loop {
        match operation().await {
            Ok(value) => return Ok(value),
            Err(error) if attempt < attempts => {
                tracing::warn!(error = ?error, attempt, "attempt failed, retrying");
                tokio::time::sleep(Duration::from_secs(u64::from(attempt) * 2)).await;
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

#[tracing::instrument(skip_all)]
async fn update_bulk_upload_request_state(
    client: &ConnectionGatewayClient,
    user_id: &str,
    message: UploadFolderStatusUpdate,
) -> () {
    if cfg!(feature = "local") {
        tracing::info!("bypassing connection gateway");
    } else {
        let entities = vec![EntityType::User.with_entity_str(user_id)];

        match serde_json::to_value(message) {
            Ok(message) => {
                client
                    .batch_send_message("bulk_upload".to_string(), message, entities)
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error = ?e, "failed to send message to connection gateway");
                    })
                    .ok();
            }
            Err(e) => {
                tracing::error!(error = ?e, "failed to serialize message");
            }
        }
    }
}

#[tracing::instrument(name = "folder_upload.process", skip_all, err, fields(request_id = request_id))]
#[expect(clippy::too_many_arguments, reason = "too annoying to fix")]
async fn process_zipped_s3_object(
    s3_client: &S3Client,
    dss_client: &DocumentStorageServiceClient,
    dynamodb_client: &DynamodbClient,
    object_key: &str,
    staging_bucket: &str,
    request_id: &str,
    user_id: &str,
    zip_name: Option<&str>,
    parent_id: Option<&str>,
) -> Result<(UploadFolderStatus, String), Error> {
    tracing::debug!("Processing object: {}", object_key);

    dynamodb_client
        .bulk_upload
        .update_bulk_upload_request_status(request_id, UploadFolderStatus::Processing, None, None)
        .await?;

    // Create a temporary directory to extract files
    // automatically cleaned up when the process exits
    let temp_dir = tempdir()?;
    let zip_path = temp_dir.path().join("upload.zip");

    download_zip(s3_client, staging_bucket, object_key, &zip_path).await?;

    // Extract zip file
    let extract_dir = temp_dir.path().join("extracted");
    fs::create_dir_all(&extract_dir)?;

    tracing::debug!("Extracting zip file to {:?}", extract_dir);
    let root_folder_name = extract_zip_file(&zip_path, &extract_dir, zip_name)?;

    let ExtractedTree {
        items: folder_items,
        folders,
    } = build_file_system(&extract_dir).await?;

    let register_span = tracing::info_span!(
        "folder_upload.register",
        files = folder_items.len() as i64,
        folders = folders.len() as i64
    );
    let upload_result = dss_client
        .upload_unnested_folder(
            user_id.to_string(),
            root_folder_name,
            folder_items,
            folders,
            request_id.to_string(),
            parent_id.map(|s| s.to_string()),
        )
        .instrument(register_span)
        .await?;

    let file_system = upload_result.file_system;
    let root_project_id = file_system
        .get_project_id()
        .ok_or_else(|| anyhow::anyhow!("No project found for root folder"))?;

    tracing::debug!("root project id: {:?}", root_project_id);

    let destination_map = upload_result.destination_map;

    let request_status = move_files_to_cloud_storage_bucket(
        s3_client,
        dynamodb_client,
        request_id,
        &extract_dir,
        &file_system,
        &destination_map,
    )
    .await?;
    tracing::debug!("Request status: {:?}", request_status);

    return Ok((request_status, root_project_id.clone()));
}

/// Writes the uploaded archive to `zip_path`.
#[tracing::instrument(name = "folder_upload.download", skip_all, err, fields(zip_bytes = tracing::field::Empty))]
async fn download_zip(
    s3_client: &S3Client,
    staging_bucket: &str,
    object_key: &str,
    zip_path: &Path,
) -> Result<(), Error> {
    let mut destination = tokio::fs::File::create(zip_path).await?;

    let bytes = if cfg!(feature = "local") {
        tracing::info!("using local zip file, remove local feature to download s3 object");
        let file_path = LocalZipPath::new().context("LOCAL_ZIP_PATH must be set")?;
        tracing::info!("Loading local zip file from: {}", file_path.as_ref());
        let file = File::open(file_path.as_ref()).await?;
        tokio::io::copy(&mut tokio::io::BufReader::new(file), &mut destination).await?
    } else {
        let obj = s3_client
            .get_object()
            .bucket(staging_bucket)
            .key(object_key)
            .send()
            .await?;
        tokio::io::copy(&mut obj.body.into_async_read(), &mut destination).await?
    };

    tracing::Span::current().record("zip_bytes", i64::try_from(bytes).unwrap_or(i64::MAX));
    Ok(())
}

#[tracing::instrument(
    name = "folder_upload.store",
    skip_all,
    err,
    fields(
        request_id = request_id,
        files = tracing::field::Empty,
        stored = tracing::field::Empty,
        failed = tracing::field::Empty
    )
)]
async fn move_files_to_cloud_storage_bucket(
    s3_client: &S3Client,
    dynamodb_client: &DynamodbClient,
    request_id: &str,
    extract_dir: &Path,
    file_system: &FileSystemNodeWithIds,
    destination_map: &S3DestinationMap,
) -> Result<UploadFolderStatus, Error> {
    let folder_items = file_system.get_folder_items();

    let document_ids: Vec<String> = folder_items.keys().cloned().collect();
    let document_count = document_ids.len();
    let span = tracing::Span::current();
    span.record("files", document_count as i64);
    if document_count == 0 {
        tracing::error!("No documents found in file system {}", request_id);
        return Ok(UploadFolderStatus::Completed);
    }

    dynamodb_client
        .bulk_upload
        .bulk_update_file_status(
            request_id,
            document_ids.clone(),
            UploadDocumentStatus::Pending,
        )
        .await?;

    let mut progress = UploadFolderProgress {
        files_total: u32::try_from(document_count).context("too many files in folder")?,
        files_stored: 0,
        files_failed: 0,
    };
    record_progress(dynamodb_client, request_id, progress).await;

    let upload_tasks = folder_items.into_iter().map(|(document_id, item)| {
        let destination = destination_map.get(&document_id).cloned();
        let s3_client = s3_client.clone();
        let extract_dir = extract_dir.to_path_buf();

        async move {
            match destination {
                None => {
                    let error_message = format!("No destination found for {}", document_id);
                    (document_id, false, Some(error_message))
                }
                Some(S3Destination::External(_)) => {
                    let error_message = format!(
                        "External destination not implemented for file {}",
                        document_id
                    );
                    (document_id, false, Some(error_message))
                }
                Some(S3Destination::Internal(s3_info)) => {
                    let path = get_file_path_for_item(&extract_dir, &item);

                    if !path.is_file() {
                        let error_message = format!("Not a file: {}", path.display());
                        return (document_id, false, Some(error_message));
                    }

                    let byte_stream = match ByteStream::from_path(&path).await {
                        Ok(bs) => bs,
                        Err(e) => {
                            let error_message = format!(
                                "Failed to read file for upload: {:?} {} {} {} {:?}",
                                e,
                                document_id,
                                s3_info.bucket,
                                s3_info.key,
                                path.display()
                            );
                            return (document_id, false, Some(error_message));
                        }
                    };

                    match s3_client
                        .put_object()
                        .bucket(&s3_info.bucket)
                        .key(&s3_info.key)
                        .body(byte_stream)
                        .send()
                        .await
                    {
                        Ok(_) => (document_id, true, None),
                        Err(e) => {
                            let error_message =
                                format!("Failed to upload {}: {:?}", document_id, e);
                            (document_id, false, Some(error_message))
                        }
                    }
                }
            }
        }
    });

    let mut results = stream::iter(upload_tasks).buffer_unordered(CONCURRENT_FILE_TASKS);

    let mut success_ids = Vec::new();
    let mut failed_ids = Vec::new();
    let mut progress_recorded_at = Instant::now();

    while let Some((document_id, success, error_message)) = results.next().await {
        match success {
            true => {
                success_ids.push(document_id);
                progress.files_stored += 1;
            }
            false => {
                match error_message {
                    Some(error_message) => tracing::error!(error_message),
                    None => tracing::error!("Failed to upload {}", document_id),
                }
                failed_ids.push(document_id);
                progress.files_failed += 1;
            }
        };

        if progress_recorded_at.elapsed() >= PROGRESS_INTERVAL {
            record_progress(dynamodb_client, request_id, progress).await;
            progress_recorded_at = Instant::now();
        }
    }
    record_progress(dynamodb_client, request_id, progress).await;

    let success_count = success_ids.len();
    let failed_count = failed_ids.len();
    span.record("stored", success_count as i64);
    span.record("failed", failed_count as i64);

    match (success_count == 0, failed_count == 0) {
        (true, true) => Ok(UploadFolderStatus::Completed),
        (false, true) => {
            dynamodb_client
                .bulk_upload
                .bulk_update_file_status(request_id, success_ids, UploadDocumentStatus::Completed)
                .await?;
            Ok(UploadFolderStatus::Completed)
        }
        (true, false) => {
            dynamodb_client
                .bulk_upload
                .bulk_update_file_status(request_id, failed_ids, UploadDocumentStatus::Failed)
                .await?;
            Ok(UploadFolderStatus::Failed)
        }
        (false, false) => {
            let (success_res, failed_res) = tokio::join!(
                dynamodb_client.bulk_upload.bulk_update_file_status(
                    request_id,
                    success_ids,
                    UploadDocumentStatus::Completed
                ),
                dynamodb_client.bulk_upload.bulk_update_file_status(
                    request_id,
                    failed_ids,
                    UploadDocumentStatus::Failed
                )
            );

            if let Err(e) = success_res {
                tracing::error!("Failed to update completed statuses: {:?}", e);
            }
            if let Err(e) = failed_res {
                tracing::error!("Failed to update failed statuses: {:?}", e);
            }

            Ok(UploadFolderStatus::PartiallyCompleted)
        }
    }
}

/// Progress only feeds the uploader's indicator, so a failed write is logged
/// and the upload carries on.
async fn record_progress(
    dynamodb_client: &DynamodbClient,
    request_id: &str,
    progress: UploadFolderProgress,
) {
    dynamodb_client
        .bulk_upload
        .update_bulk_upload_request_progress(request_id, progress)
        .await
        .inspect_err(|e| tracing::warn!(error = ?e, "failed to record upload progress"))
        .ok();
}

// returns the root folder name
#[tracing::instrument(name = "folder_upload.unzip", skip_all, err, fields(entries = tracing::field::Empty))]
fn extract_zip_file(
    zip_path: &Path,
    extract_dir: &Path,
    zip_name: Option<&str>,
) -> Result<String, Error> {
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    tracing::Span::current().record("entries", archive.len() as i64);

    let extract_to: PathBuf;
    let root_dir_name = match archive
        .root_dir(root_dir_common_filter)?
        .and_then(|root| root.file_name().map(|f| f.to_string_lossy().to_string()))
    {
        Some(root_dir_name) => {
            extract_to = extract_dir.join(&root_dir_name);
            root_dir_name
        }
        None => {
            tracing::error!("No root directory found, using provided root folder name");
            let extract_folder = match zip_name {
                Some(zip_name) => zip_name.to_string(),
                None => {
                    let default_extract_folder = "Folder Upload".to_string();
                    tracing::error!(
                        "No zip name provided, using default extract folder {}",
                        default_extract_folder
                    );
                    default_extract_folder
                }
            };
            extract_to = extract_dir.join(&extract_folder);
            extract_folder
        }
    };
    fs::create_dir_all(&extract_to)?;

    tracing::debug!("Extracting to: {:?}", extract_to);
    archive.extract_unwrapped_root_dir(&extract_to, root_dir_common_filter)?;

    Ok(root_dir_name)
}

/// Files and folders collected from an extracted upload.
#[derive(Debug, Default)]
struct ExtractedTree {
    items: Vec<FolderItem>,
    /// Every kept folder, as a path relative to the extract dir, so empty
    /// folders still become projects.
    folders: Vec<String>,
}

/// OS and editor clutter that should never become a document or project.
fn is_ignored_name(name: &OsStr) -> bool {
    let name = name.to_string_lossy();
    let lower = name.to_ascii_lowercase();
    // Hidden files/folders, including `.DS_Store`, `._*` and `.~lock.*#`.
    name.starts_with('.')
        || name == "__MACOSX"
        // Office owner/lock files written next to open documents.
        || name.starts_with("~$")
        || lower == "thumbs.db"
        || lower == "ehthumbs.db"
        || lower == "desktop.ini"
        // macOS custom folder icon file.
        || name == "Icon\r"
}

/// Whether a path under the extract dir should be skipped. The first component
/// is the root folder the user picked, which is kept whatever its name.
fn is_ignored_entry(relative_path: &Path) -> bool {
    relative_path.iter().skip(1).any(is_ignored_name)
}

#[tracing::instrument(
    name = "folder_upload.hash",
    skip_all,
    err,
    fields(files = tracing::field::Empty, folders = tracing::field::Empty)
)]
async fn build_file_system(extract_dir: &Path) -> Result<ExtractedTree, Error> {
    let mut tasks = Vec::new();
    let mut folders = Vec::new();

    let walker = walkdir::WalkDir::new(extract_dir)
        .min_depth(1)
        .sort_by_file_name()
        .into_iter()
        // Pruning here also skips everything inside an ignored folder.
        .filter_entry(|entry| {
            entry
                .path()
                .strip_prefix(extract_dir)
                .map(|relative| !is_ignored_entry(relative))
                .unwrap_or(false)
        });

    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path().to_path_buf();
        let relative = path
            .strip_prefix(extract_dir)
            .map_err(|e| Error::from(format!("strip_prefix failed: {:?}", e)))?
            .to_path_buf();

        if entry.file_type().is_dir() {
            let folder = relative
                .to_str()
                .ok_or_else(|| Error::from(format!("Invalid folder name: {:?}", relative)))?;
            folders.push(folder.to_string());
            continue;
        }

        if !entry.file_type().is_file() {
            continue;
        }

        let fut = async move {
            let full_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or_else(|| Error::from(format!("Invalid file name: {:?}", path)))?;

            let (file_name, file_type) = match FileType::split_suffix_match(full_name) {
                Some((file, extension)) => {
                    let file_type = FileType::from_str(extension).ok();
                    (file, file_type)
                }
                None => (full_name, None),
            };

            let relative_path_without_filename = relative
                .parent()
                .ok_or_else(|| Error::from(format!("No parent for path: {:?}", path)))?
                .to_string_lossy()
                .to_string();

            let sha = compute_sha256(&path).await?;

            Ok::<_, Error>(FolderItem {
                name: file_name.to_string(),
                full_name: full_name.to_string(),
                file_type,
                relative_path: relative_path_without_filename,
                sha,
            })
        };

        tasks.push(fut);
    }

    // Exits at the first failure. Each task holds its file open while hashing,
    // so only a bounded number run at once.
    let items: Vec<FolderItem> = stream::iter(tasks)
        .buffered(CONCURRENT_FILE_TASKS)
        .try_collect()
        .await?;

    let span = tracing::Span::current();
    span.record("files", items.len() as i64);
    span.record("folders", folders.len() as i64);
    Ok(ExtractedTree { items, folders })
}

async fn compute_sha256(path: &Path) -> Result<String, Error> {
    let mut file = File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 256 * 1024];

    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    let result = hasher.finalize();
    Ok(format!("{:x}", result)) // hex string
}

/// `full_name` is the name on disk; rebuilding it from the parsed type would
/// lowercase extensions like `.DOCX` and miss the file.
fn get_file_path_for_item(extract_dir: &Path, item: &FolderItem) -> PathBuf {
    extract_dir.join(&item.relative_path).join(&item.full_name)
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();
    tracing::trace!("initiating lambda");

    let upload_staging_bucket = UploadBucketName::new()
        .context("UPLOAD_BUCKET_NAME must be set")?
        .to_string();
    let internal_api_secret_key = InternalApiSecretKey::new()
        .context("INTERNAL_API_SECRET_KEY must be set")?
        .to_string();
    let dss_url = DssUrl::new().context("DSS_URL must be set")?.to_string();
    let dynamo_table_name = DynamodbTable::new()
        .context("DYNAMODB_TABLE must be set")?
        .to_string();
    let connection_gateway_url = ConnectionGatewayUrl::new()?.to_string();

    let config = macro_aws_config::get_macro_aws_config().await;
    let s3_client = S3Client::new(&config);

    let dss_client = DocumentStorageServiceClient::new(internal_api_secret_key.clone(), dss_url);

    let dynamodb_client = DynamodbClient::new(&config, Some(dynamo_table_name));

    let conn_gateway_client =
        ConnectionGatewayClient::new(internal_api_secret_key, connection_gateway_url);

    let shared_s3_client = Arc::new(s3_client);
    let shared_dss_client = Arc::new(dss_client);
    let shared_dynamodb_client = Arc::new(dynamodb_client);
    let shared_conn_gateway_client = Arc::new(conn_gateway_client);
    let upload_staging_bucket_str = upload_staging_bucket.as_str();

    let func = service_fn(move |event: LambdaEvent<SqsEvent>| {
        handler(
            shared_s3_client.clone(),
            shared_dss_client.clone(),
            shared_dynamodb_client.clone(),
            shared_conn_gateway_client.clone(),
            upload_staging_bucket_str,
            event,
        )
    });

    run(func).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::document::FileType;
    use model::folder::FolderItem;
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_build_file_system() {
        // Create a temporary directory for testing
        let temp_dir = tempdir().unwrap();
        let extract_dir = temp_dir.path();

        // Create a test file structure
        let root_dir = extract_dir.join("root");
        fs::create_dir_all(&root_dir).unwrap();

        // Create a file in the root directory
        let root_file_path = root_dir.join("root_file.txt");
        let mut root_file = File::create(&root_file_path).unwrap();
        root_file.write_all(b"root file content").unwrap();

        // Create a subdirectory
        let subdir_path = root_dir.join("subdir");
        fs::create_dir_all(&subdir_path).unwrap();

        // Create a file in the subdirectory
        let subdir_file_path = subdir_path.join("subdir_file.pdf");
        let mut subdir_file = File::create(&subdir_file_path).unwrap();
        subdir_file.write_all(b"subdir file content").unwrap();

        // Create a nested subdirectory
        let nested_subdir_path = subdir_path.join("nested");
        fs::create_dir_all(&nested_subdir_path).unwrap();

        // Create a file in the nested subdirectory
        let nested_file_path = nested_subdir_path.join("nested_file.docx");
        let mut nested_file = File::create(&nested_file_path).unwrap();
        nested_file.write_all(b"nested file content").unwrap();

        // Run the build_file_system function
        let result = build_file_system(extract_dir).await.unwrap().items;

        // Verify the results
        assert_eq!(result.len(), 3); // Should have 3 files total

        // Check that each file has the correct relative path and name
        let root_file_item = result.iter().find(|item| item.name == "root_file").unwrap();
        assert_eq!(root_file_item.relative_path, "root");
        assert_eq!(root_file_item.file_type, Some(FileType::Txt));

        let subdir_file_item = result
            .iter()
            .find(|item| item.name == "subdir_file")
            .unwrap();
        assert_eq!(subdir_file_item.relative_path, "root/subdir");
        assert_eq!(subdir_file_item.file_type, Some(FileType::Pdf));

        let nested_file_item = result
            .iter()
            .find(|item| item.name == "nested_file")
            .unwrap();
        assert_eq!(nested_file_item.relative_path, "root/subdir/nested");
        assert_eq!(nested_file_item.file_type, Some(FileType::Docx));
    }

    #[test]
    fn test_get_file_path_for_item_with_file_type() {
        let extract_dir = PathBuf::from("/tmp/extract");
        let item = FolderItem {
            name: "document".to_string(),
            full_name: "document.pdf".to_string(),
            file_type: Some(FileType::Pdf),
            relative_path: "folder/subfolder".to_string(),
            sha: "abcd1234".to_string(),
        };

        let path = get_file_path_for_item(&extract_dir, &item);
        assert_eq!(
            path,
            PathBuf::from("/tmp/extract/folder/subfolder/document.pdf")
        );
    }

    #[test]
    fn test_get_file_path_for_item_with_multi_part_extension() {
        let extract_dir = PathBuf::from("/tmp/extract");
        let item = FolderItem {
            name: "document".to_string(),
            full_name: "document.tar.gz".to_string(),
            file_type: Some(FileType::TarGz),
            relative_path: "folder/subfolder".to_string(),
            sha: "abcd1234".to_string(),
        };

        let path = get_file_path_for_item(&extract_dir, &item);
        assert_eq!(
            path,
            PathBuf::from("/tmp/extract/folder/subfolder/document.tar.gz")
        );
    }

    #[test]
    fn test_get_file_path_for_item_without_file_type() {
        let extract_dir = PathBuf::from("/tmp/extract");
        let item = FolderItem {
            name: "config".to_string(),
            full_name: "config".to_string(),
            file_type: None,
            relative_path: "settings".to_string(),
            sha: "efgh5678".to_string(),
        };

        let path = get_file_path_for_item(&extract_dir, &item);
        assert_eq!(path, PathBuf::from("/tmp/extract/settings/config"));
    }

    #[test]
    fn test_get_file_path_for_item_with_periods_in_name() {
        let extract_dir = PathBuf::from("/tmp/extract");
        let item = FolderItem {
            name: "test.1.5.5".to_string(),
            full_name: "test.1.5.5.tar.gz".to_string(),
            file_type: Some(FileType::TarGz),
            relative_path: "settings".to_string(),
            sha: "efgh5678".to_string(),
        };

        let path = get_file_path_for_item(&extract_dir, &item);
        assert_eq!(
            path,
            PathBuf::from("/tmp/extract/settings/test.1.5.5.tar.gz")
        );
    }

    #[test]
    fn test_get_file_path_for_item_with_empty_relative_path() {
        let extract_dir = PathBuf::from("/tmp/extract");
        let item = FolderItem {
            name: "root_file".to_string(),
            full_name: "root_file.txt".to_string(),
            file_type: Some(FileType::Txt),
            relative_path: "".to_string(),
            sha: "ijkl9012".to_string(),
        };

        let path = get_file_path_for_item(&extract_dir, &item);
        assert_eq!(path, PathBuf::from("/tmp/extract/root_file.txt"));
    }

    #[tokio::test]
    async fn test_build_file_system_handles_empty_directory() {
        // Create an empty temporary directory
        let temp_dir = tempdir().unwrap();
        let extract_dir = temp_dir.path();

        // Run the build_file_system function
        let result = build_file_system(extract_dir).await.unwrap().items;

        // Verify the results
        assert_eq!(result.len(), 0); // Should be empty
        let tree = build_file_system(extract_dir).await.unwrap();
        assert!(tree.folders.is_empty());
    }

    #[tokio::test]
    async fn test_build_file_system_skips_hidden_files() {
        // Create a temporary directory
        let temp_dir = tempdir().unwrap();
        let extract_dir = temp_dir.path();

        let root_dir = extract_dir.join("root");
        fs::create_dir_all(&root_dir).unwrap();

        // Create a visible file
        let visible_file_path = root_dir.join("visible.txt");
        let mut visible_file = File::create(&visible_file_path).unwrap();
        visible_file.write_all(b"visible content").unwrap();

        // Create a hidden file
        let hidden_file_path = root_dir.join(".hidden.txt");
        let mut hidden_file = File::create(&hidden_file_path).unwrap();
        hidden_file.write_all(b"hidden content").unwrap();

        // Run the build_file_system function
        let result = build_file_system(extract_dir).await.unwrap().items;

        // Verify that only the visible file is included
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "visible");
        assert_eq!(result[0].file_type, Some(FileType::Txt));
    }

    #[tokio::test]
    async fn test_build_file_system_handles_file_without_extension() {
        // Create a temporary directory
        let temp_dir = tempdir().unwrap();
        let extract_dir = temp_dir.path();

        // Create a file without extension
        let file_path = extract_dir.join("no_extension");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(b"content without extension").unwrap();

        // Run the build_file_system function
        let result = build_file_system(extract_dir).await.unwrap().items;

        // Verify the results
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "no_extension");
        assert_eq!(result[0].file_type, None);
    }

    #[tokio::test]
    async fn test_build_file_system_computes_correct_sha() {
        // Create a temporary directory
        let temp_dir = tempdir().unwrap();
        let extract_dir = temp_dir.path();

        // Create a file with known content for SHA verification
        let file_path = extract_dir.join("test.txt");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(b"test content for SHA").unwrap();

        // Manually compute the SHA256 hash for comparison
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(b"test content for SHA");
        let expected_sha = format!("{:x}", hasher.finalize());

        // Run the build_file_system function
        let result = build_file_system(extract_dir).await.unwrap().items;

        // Verify the SHA256 hash
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].sha, expected_sha);
    }

    #[test]
    fn test_get_file_path_for_item_keeps_extension_case() {
        let extract_dir = PathBuf::from("/tmp/extract");
        let item = FolderItem {
            name: "REPORT".to_string(),
            full_name: "REPORT.DOCX".to_string(),
            file_type: Some(FileType::Docx),
            relative_path: "Root".to_string(),
            sha: "abcd".to_string(),
        };

        assert_eq!(
            get_file_path_for_item(&extract_dir, &item),
            PathBuf::from("/tmp/extract/Root/REPORT.DOCX")
        );
    }

    #[test]
    fn test_is_ignored_entry() {
        for ignored in [
            "Root/.DS_Store",
            "Root/~$Summary.docx",
            "Root/Sub/~$Deck.pptx",
            "Root/Thumbs.db",
            "Root/THUMBS.DB",
            "Root/desktop.ini",
            "Root/Desktop.ini",
            "Root/ehthumbs.db",
            "Root/Icon\r",
            "Root/.git/config",
            "Root/__MACOSX/._a.docx",
            "Root/Sub/.~lock.Budget.xlsx#",
        ] {
            assert!(is_ignored_entry(Path::new(ignored)), "{ignored}");
        }
        for kept in [
            "Root",
            ".dotted-root",
            ".dotted-root/a.docx",
            "Root/a.docx",
            "Root/Sub/b.pptx",
            "Root/Thumbs.db.xlsx",
            "Root/report~$.docx",
            "Root/Icon.png",
        ] {
            assert!(!is_ignored_entry(Path::new(kept)), "{kept}");
        }
    }

    /// Zip entries as the web app's zip worker writes them for a dropped folder.
    fn write_browser_zip(path: &Path, entries: &[(&str, Option<&[u8]>)]) {
        let file = File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        for (name, contents) in entries {
            match contents {
                Some(bytes) => {
                    zip.start_file(*name, options).unwrap();
                    zip.write_all(bytes).unwrap();
                }
                None => zip.add_directory(*name, options).unwrap(),
            }
        }
        zip.finish().unwrap();
    }

    async fn extract_tree(
        entries: &[(&str, Option<&[u8]>)],
        zip_name: &str,
    ) -> (String, ExtractedTree, PathBuf, tempfile::TempDir) {
        let temp_dir = tempdir().unwrap();
        let zip_path = temp_dir.path().join("upload.zip");
        write_browser_zip(&zip_path, entries);
        let extract_dir = temp_dir.path().join("extracted");
        fs::create_dir_all(&extract_dir).unwrap();
        let root = extract_zip_file(&zip_path, &extract_dir, Some(zip_name)).unwrap();
        let tree = build_file_system(&extract_dir).await.unwrap();
        (root, tree, extract_dir, temp_dir)
    }

    #[tokio::test]
    async fn test_nested_office_folder_upload() {
        let entries: &[(&str, Option<&[u8]>)] = &[
            ("Board Pack/", None),
            ("Board Pack/Summary.docx", Some(b"docx")),
            ("Board Pack/REPORT UPPER.DOCX", Some(b"upper")),
            ("Board Pack/Deck.PPTX", Some(b"upper pptx")),
            ("Board Pack/Café Menü.docx", Some(b"unicode")),
            ("Board Pack/~$Summary.docx", Some(b"lock")),
            ("Board Pack/.DS_Store", Some(b"ds")),
            ("Board Pack/Thumbs.db", Some(b"thumbs")),
            ("Board Pack/desktop.ini", Some(b"ini")),
            ("Board Pack/.git/", None),
            ("Board Pack/.git/config", Some(b"git")),
            ("Board Pack/Empty Folder/", None),
            ("Board Pack/Finance/", None),
            ("Board Pack/Finance/Budget.xlsx", Some(b"xlsx")),
            ("Board Pack/Finance/Forecasts/", None),
            ("Board Pack/Finance/Forecasts/Scenarios/", None),
            (
                "Board Pack/Finance/Forecasts/Scenarios/Downside.xlsx",
                Some(b"xlsx2"),
            ),
            ("Board Pack/Finance/Forecasts/Scenarios/Empty Leaf/", None),
            ("Board Pack/Decks/", None),
            ("Board Pack/Decks/Archive/", None),
            ("Board Pack/Decks/Archive/Old.pptx", Some(b"pptx")),
            ("Board Pack/Decks/Archive/~$Old.pptx", Some(b"lock")),
        ];
        let (root, tree, extract_dir, _guard) = extract_tree(entries, "Board Pack").await;
        assert_eq!(root, "Board Pack");

        let mut files: Vec<String> = tree
            .items
            .iter()
            .map(|item| format!("{}/{}", item.relative_path, item.full_name))
            .collect();
        files.sort();
        assert_eq!(
            files,
            vec![
                "Board Pack/Café Menü.docx",
                "Board Pack/Deck.PPTX",
                "Board Pack/Decks/Archive/Old.pptx",
                "Board Pack/Finance/Budget.xlsx",
                "Board Pack/Finance/Forecasts/Scenarios/Downside.xlsx",
                "Board Pack/REPORT UPPER.DOCX",
                "Board Pack/Summary.docx",
            ]
        );

        // Every kept file must be found again when it is copied to storage.
        for item in &tree.items {
            assert!(
                get_file_path_for_item(&extract_dir, item).is_file(),
                "{item:?}"
            );
        }
        let upper = tree
            .items
            .iter()
            .find(|item| item.full_name == "REPORT UPPER.DOCX")
            .unwrap();
        assert_eq!(upper.file_type, Some(FileType::Docx));
        assert_eq!(upper.name, "REPORT UPPER");
        let deck = tree
            .items
            .iter()
            .find(|item| item.full_name == "Deck.PPTX")
            .unwrap();
        assert_eq!(deck.file_type, Some(FileType::Pptx));

        assert_eq!(
            tree.folders,
            vec![
                "Board Pack",
                "Board Pack/Decks",
                "Board Pack/Decks/Archive",
                "Board Pack/Empty Folder",
                "Board Pack/Finance",
                "Board Pack/Finance/Forecasts",
                "Board Pack/Finance/Forecasts/Scenarios",
                "Board Pack/Finance/Forecasts/Scenarios/Empty Leaf",
            ]
        );
    }

    /// A path, and for a file its contents and their CRC-32.
    type StreamedEntry<'a> = (&'a str, Option<(&'a [u8], u32)>);

    /// An archive laid out the way the web app streams a folder: every entry
    /// stored, files followed by a data descriptor that carries their CRC-32
    /// and size, then the central directory.
    fn write_streamed_browser_zip(path: &Path, entries: &[StreamedEntry]) {
        let mut bytes: Vec<u8> = Vec::new();
        let mut central: Vec<u8> = Vec::new();
        for (name, contents) in entries {
            let offset = bytes.len() as u32;
            let flags: u16 = if contents.is_some() { 0x0808 } else { 0x0800 };
            bytes.extend(0x0403_4b50_u32.to_le_bytes());
            bytes.extend(20_u16.to_le_bytes());
            bytes.extend(flags.to_le_bytes());
            bytes.extend([0; 18]);
            bytes.extend((name.len() as u16).to_le_bytes());
            bytes.extend(0_u16.to_le_bytes());
            bytes.extend(name.as_bytes());

            let (crc, size) = match contents {
                Some((data, crc)) => {
                    bytes.extend(*data);
                    bytes.extend(0x0807_4b50_u32.to_le_bytes());
                    bytes.extend(crc.to_le_bytes());
                    bytes.extend((data.len() as u32).to_le_bytes());
                    bytes.extend((data.len() as u32).to_le_bytes());
                    (*crc, data.len() as u32)
                }
                None => (0, 0),
            };

            central.extend(0x0201_4b50_u32.to_le_bytes());
            central.extend(20_u16.to_le_bytes());
            central.extend(20_u16.to_le_bytes());
            central.extend(flags.to_le_bytes());
            central.extend([0; 6]);
            central.extend(crc.to_le_bytes());
            central.extend(size.to_le_bytes());
            central.extend(size.to_le_bytes());
            central.extend((name.len() as u16).to_le_bytes());
            central.extend([0; 8]);
            let external: u32 = if contents.is_some() { 0 } else { 0x10 };
            central.extend(external.to_le_bytes());
            central.extend(offset.to_le_bytes());
            central.extend(name.as_bytes());
        }
        let central_offset = bytes.len() as u32;
        bytes.extend(&central);
        bytes.extend(0x0605_4b50_u32.to_le_bytes());
        bytes.extend([0; 4]);
        bytes.extend((entries.len() as u16).to_le_bytes());
        bytes.extend((entries.len() as u16).to_le_bytes());
        bytes.extend((central.len() as u32).to_le_bytes());
        bytes.extend(central_offset.to_le_bytes());
        bytes.extend(0_u16.to_le_bytes());
        fs::write(path, bytes).unwrap();
    }

    #[tokio::test]
    async fn test_streamed_browser_zip_extracts_files_and_folders() {
        let temp_dir = tempdir().unwrap();
        let zip_path = temp_dir.path().join("upload.zip");
        write_streamed_browser_zip(
            &zip_path,
            &[
                ("Archive/", None),
                ("Archive/Site/", None),
                ("Archive/Empty/", None),
                (
                    "Archive/Summary.docx",
                    Some((b"quarterly summary".as_slice(), 0x2e1d_df62)),
                ),
                (
                    "Archive/Site/Photo 01.png",
                    Some((b"site photo bytes".as_slice(), 0x4c4c_da58)),
                ),
                ("Archive/Site/blank.txt", Some((b"".as_slice(), 0))),
            ],
        );
        let extract_dir = temp_dir.path().join("extracted");
        fs::create_dir_all(&extract_dir).unwrap();

        let root = extract_zip_file(&zip_path, &extract_dir, Some("Archive")).unwrap();
        let tree = build_file_system(&extract_dir).await.unwrap();

        assert_eq!(root, "Archive");
        let mut files: Vec<String> = tree
            .items
            .iter()
            .map(|item| format!("{}/{}", item.relative_path, item.full_name))
            .collect();
        files.sort();
        assert_eq!(
            files,
            vec![
                "Archive/Site/Photo 01.png",
                "Archive/Site/blank.txt",
                "Archive/Summary.docx"
            ]
        );
        assert_eq!(
            fs::read(extract_dir.join("Archive/Site/Photo 01.png")).unwrap(),
            b"site photo bytes"
        );
        assert_eq!(
            tree.folders,
            vec!["Archive", "Archive/Empty", "Archive/Site"]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn with_retries_returns_the_first_success() {
        let calls = std::cell::Cell::new(0);
        let result: Result<u32, &str> = with_retries(3, || {
            calls.set(calls.get() + 1);
            let call = calls.get();
            async move {
                if call < 3 {
                    Err("unavailable")
                } else {
                    Ok(call)
                }
            }
        })
        .await;

        assert_eq!(result, Ok(3));
        assert_eq!(calls.get(), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn with_retries_gives_up_after_the_last_attempt() {
        let calls = std::cell::Cell::new(0);
        let result: Result<(), &str> = with_retries(3, || {
            calls.set(calls.get() + 1);
            async { Err("unavailable") }
        })
        .await;

        assert_eq!(result, Err("unavailable"));
        assert_eq!(calls.get(), 3);
    }

    #[tokio::test]
    async fn test_folder_with_only_empty_subfolders() {
        let entries: &[(&str, Option<&[u8]>)] =
            &[("Shell/", None), ("Shell/A/", None), ("Shell/A/B/", None)];
        let (root, tree, _extract_dir, _guard) = extract_tree(entries, "Shell").await;
        assert_eq!(root, "Shell");
        assert!(tree.items.is_empty());
        assert_eq!(tree.folders, vec!["Shell", "Shell/A", "Shell/A/B"]);
    }

    #[tokio::test]
    async fn test_single_subfolder_keeps_picked_root() {
        // The picked folder holds one subfolder and no files of its own.
        let entries: &[(&str, Option<&[u8]>)] = &[
            ("Wrapper/", None),
            ("Wrapper/Inner/", None),
            ("Wrapper/Inner/a.docx", Some(b"a")),
        ];
        let (root, tree, _extract_dir, _guard) = extract_tree(entries, "Wrapper").await;
        assert_eq!(root, "Wrapper");
        assert_eq!(tree.items.len(), 1);
        assert_eq!(tree.items[0].relative_path, "Wrapper/Inner");
        assert_eq!(tree.folders, vec!["Wrapper", "Wrapper/Inner"]);
    }
}
