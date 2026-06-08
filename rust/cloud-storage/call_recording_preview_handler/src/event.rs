use std::{path::PathBuf, time::Duration};

use anyhow::{Context, bail};
use aws_lambda_events::event::s3::{S3Event, S3EventRecord};
use aws_sdk_s3::{Client as S3Client, primitives::ByteStream};
use lambda_runtime::{Error, LambdaEvent};
use sqlx::{PgPool, Postgres};
use tracing::Instrument;

use crate::{db, ffmpeg::FfmpegTools, key};

const DEFAULT_PRESIGNED_URL_SECONDS: u64 = 900;
const JPEG_CONTENT_TYPE: &str = "image/jpeg";

/// Runtime configuration for the call recording preview handler.
#[derive(Debug, Clone)]
pub struct HandlerConfig {
    ffmpeg_path: PathBuf,
    ffprobe_path: PathBuf,
    default_bucket_name: Option<String>,
    presigned_url_duration: Duration,
}

impl HandlerConfig {
    /// Builds handler configuration from environment variables.
    ///
    /// `FFMPEG_PATH` and `FFPROBE_PATH` override the default Lambda paths under
    /// `${LAMBDA_TASK_ROOT}/bin`. `CALL_RECORDING_BUCKET_NAME` is used only as a
    /// fallback when a malformed local S3 event does not include a bucket name.
    pub fn from_env() -> Self {
        let task_root = std::env::var_os("LAMBDA_TASK_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/var/task"));
        let ffmpeg_path = std::env::var_os("FFMPEG_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| task_root.join("bin/ffmpeg"));
        let ffprobe_path = std::env::var_os("FFPROBE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| task_root.join("bin/ffprobe"));
        let default_bucket_name = std::env::var("CALL_RECORDING_BUCKET_NAME")
            .ok()
            .filter(|bucket| !bucket.trim().is_empty());

        Self {
            ffmpeg_path,
            ffprobe_path,
            default_bucket_name,
            presigned_url_duration: Duration::from_secs(DEFAULT_PRESIGNED_URL_SECONDS),
        }
    }

    /// Builds handler configuration with explicit ffmpeg and ffprobe paths.
    pub fn with_tool_paths(
        ffmpeg_path: impl Into<PathBuf>,
        ffprobe_path: impl Into<PathBuf>,
    ) -> Self {
        Self {
            ffmpeg_path: ffmpeg_path.into(),
            ffprobe_path: ffprobe_path.into(),
            default_bucket_name: None,
            presigned_url_duration: Duration::from_secs(DEFAULT_PRESIGNED_URL_SECONDS),
        }
    }
}

/// Shared Lambda handler state.
#[derive(Clone)]
pub struct HandlerState {
    s3_client: S3Client,
    db: PgPool,
    tools: FfmpegTools,
    default_bucket_name: Option<String>,
    presigned_url_duration: Duration,
}

impl HandlerState {
    /// Creates handler state from AWS, database, and handler configuration.
    pub fn new(s3_client: S3Client, db: PgPool, config: HandlerConfig) -> Self {
        Self {
            s3_client,
            db,
            tools: FfmpegTools::new(config.ffmpeg_path, config.ffprobe_path),
            default_bucket_name: config.default_bucket_name,
            presigned_url_duration: config.presigned_url_duration,
        }
    }
}

/// Processes an S3 event and generates previews for eligible MP4 recordings.
#[tracing::instrument(skip(state, event), err)]
pub async fn handler(state: HandlerState, event: LambdaEvent<S3Event>) -> Result<(), Error> {
    tracing::info!(
        record_count = event.payload.records.len(),
        "processing call recording preview event"
    );

    for (index, record) in event.payload.records.into_iter().enumerate() {
        let span = tracing::info_span!(
            "process_s3_record",
            record_index = index,
            encoded_key = record.s3.object.key.as_deref().unwrap_or_default(),
        );

        process_record(&state, record, index)
            .instrument(span)
            .await?;
    }

    Ok(())
}

#[tracing::instrument(skip(state, record), err)]
async fn process_record(
    state: &HandlerState,
    record: S3EventRecord,
    record_index: usize,
) -> anyhow::Result<()> {
    let encoded_key = record
        .s3
        .object
        .key
        .as_deref()
        .context("S3 event record did not include an object key")?;

    let preview_keys = match key::preview_keys_from_encoded_s3_key(encoded_key)? {
        key::KeyDecision::Process(preview_keys) => preview_keys,
        key::KeyDecision::Skip(reason) => {
            tracing::info!(reason = reason.as_str(), "skipping S3 object");
            return Ok(());
        }
    };

    let bucket_name = bucket_name_from_record(&record, state)
        .context("S3 event record did not include a bucket name")?;
    tracing::info!(
        bucket = %bucket_name,
        source_key = %preview_keys.source_key,
        preview_key = %preview_keys.preview_key,
        "generating call recording preview"
    );

    let source_url = presign_source_object(
        &state.s3_client,
        bucket_name,
        &preview_keys.source_key,
        state.presigned_url_duration,
    )
    .await?;
    let output_path = temp_preview_path(record_index);

    state
        .tools
        .create_preview_jpeg(&source_url, &output_path)
        .await
        .with_context(|| {
            format!(
                "failed to create preview JPEG for {}",
                preview_keys.source_key
            )
        })?;

    upload_preview_jpeg(
        &state.s3_client,
        bucket_name,
        &preview_keys.preview_key,
        &output_path,
    )
    .await?;

    persist_preview_key(
        &state.db,
        &preview_keys.recording_key,
        &preview_keys.preview_key,
    )
    .await?;

    tokio::fs::remove_file(&output_path)
        .await
        .inspect_err(|error| tracing::warn!(error=?error, path=%output_path.display(), "failed to remove temporary preview image"))
        .ok();

    Ok(())
}

fn bucket_name_from_record<'a>(
    record: &'a S3EventRecord,
    state: &'a HandlerState,
) -> Option<&'a str> {
    record
        .s3
        .bucket
        .name
        .as_deref()
        .filter(|bucket| !bucket.trim().is_empty())
        .or(state.default_bucket_name.as_deref())
}

#[tracing::instrument(skip(client), err)]
async fn presign_source_object(
    client: &S3Client,
    bucket_name: &str,
    source_key: &str,
    duration: Duration,
) -> anyhow::Result<String> {
    let presigning_config = aws_sdk_s3::presigning::PresigningConfig::expires_in(duration)?;
    let presigned = client
        .get_object()
        .bucket(bucket_name)
        .key(source_key)
        .presigned(presigning_config)
        .await
        .with_context(|| format!("failed to presign s3://{bucket_name}/{source_key}"))?;

    Ok(macro_aws_config::transform_aws_url_for_internal_fetch(
        presigned.uri(),
    ))
}

#[tracing::instrument(skip(client, output_path), err)]
async fn upload_preview_jpeg(
    client: &S3Client,
    bucket_name: &str,
    preview_key: &str,
    output_path: &std::path::Path,
) -> anyhow::Result<()> {
    let body = tokio::fs::read(output_path)
        .await
        .with_context(|| format!("failed to read {}", output_path.display()))?;

    client
        .put_object()
        .bucket(bucket_name)
        .key(preview_key)
        .content_type(JPEG_CONTENT_TYPE)
        .body(ByteStream::from(body))
        .send()
        .await
        .with_context(|| format!("failed to upload s3://{bucket_name}/{preview_key}"))?;

    Ok(())
}

#[tracing::instrument(skip(db), err)]
async fn persist_preview_key(
    db: &sqlx::Pool<Postgres>,
    recording_key: &str,
    preview_key: &str,
) -> anyhow::Result<()> {
    let rows_updated = db::update_preview_key(db, recording_key, preview_key)
        .await
        .with_context(|| format!("failed to persist preview key for {recording_key}"))?;

    if rows_updated > 0 {
        return Ok(());
    }

    bail!("no call rows matched recording_key {recording_key}")
}

fn temp_preview_path(record_index: usize) -> PathBuf {
    PathBuf::from("/tmp").join(format!(
        "call-recording-preview-{}-{record_index}.jpg",
        std::process::id()
    ))
}
