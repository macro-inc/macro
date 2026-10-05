//! Immutable, checksum-bound uploads and bounded streaming reads using the S3 SDK.

use std::time::{Duration, SystemTime};

use aws_sdk_s3::{Client, presigning::PresigningConfig, types::ChecksumMode};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use futures::stream;
use s3_key::SlackImportKey;
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;

use crate::domain::{
    models::*,
    ports::{ByteStream, ImportStorage, PortResult},
};

#[cfg(test)]
mod test;

const GRANT_LIFETIME: Duration = Duration::from_secs(300);
const READ_CHUNK_BYTES: usize = 64 * 1024;

/// S3 staging adapter. The composition root supplies an already configured AWS client.
/// Manifest lookup and team/job authorization remain the domain service's responsibility.
#[derive(Clone)]
pub struct S3ImportStorage {
    client: Client,
    bucket: String,
    limits: ImportLimits,
}

impl S3ImportStorage {
    /// Validate configuration once. Grants expire after five minutes.
    pub fn new(client: Client, bucket: String, limits: ImportLimits) -> PortResult<Self> {
        if bucket.is_empty()
            || limits.part_bytes == 0
            || limits.json_bytes == 0
            || limits.part_bytes > i64::MAX as u64
            || limits.json_bytes > i64::MAX as u64
        {
            return Err(ImportError::InvalidInput.into());
        }
        Ok(Self {
            client,
            bucket,
            limits,
        })
    }

    fn validate(&self, upload: &RegisteredUpload) -> PortResult<()> {
        upload
            .descriptor
            .validate(&self.limits)
            .map_err(|error| rootcause::Report::new(error).context(ImportError::LimitExceeded))?;
        let key = SlackImportKey::from_s3_key(upload.key.as_str())
            .map_err(|error| rootcause::Report::new(error).context(ImportError::UploadMismatch))?;
        let matches = match (&upload.descriptor.upload, key.part()) {
            (UploadId::Users, None) => true,
            (
                UploadId::ConversationPart {
                    slack_channel_id,
                    part_index,
                },
                Some((id, index)),
            ) => slack_channel_id.as_str() == id && *part_index == index,
            _ => false,
        };
        if !matches {
            return Err(ImportError::UploadMismatch.into());
        }
        Ok(())
    }
}

impl ImportStorage for S3ImportStorage {
    async fn grant(&self, upload: &RegisteredUpload) -> PortResult<UploadGrant> {
        self.validate(upload)?;
        let start = SystemTime::now();
        let config = PresigningConfig::builder()
            .start_time(start)
            .expires_in(GRANT_LIFETIME)
            .build()
            .map_err(|error| rootcause::Report::new(error).context(ImportError::Internal))?;
        let signed = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(upload.key.as_str())
            .content_type(content_type(&upload.descriptor.upload))
            .content_length(upload.descriptor.byte_length as i64)
            .checksum_sha256(checksum(&upload.descriptor.sha256))
            .if_none_match("*")
            .presigned(config)
            .await
            .map_err(|error| rootcause::Report::new(error).context(ImportError::Retryable))?;
        // Content-Length is signed, but browsers must derive it from the exact Blob
        // rather than trying to set this forbidden request header in fetch().
        let required_headers = signed
            .headers()
            .filter(|(name, _)| {
                !name.eq_ignore_ascii_case("content-length") && !name.eq_ignore_ascii_case("host")
            })
            .map(|(name, value)| (name.to_owned(), value.to_owned()))
            .collect();
        Ok(UploadGrant {
            descriptor: upload.descriptor.clone(),
            url: macro_aws_config::transform_aws_url(signed.uri()),
            required_headers,
            expires_at: DateTime::<Utc>::from(start + GRANT_LIFETIME),
        })
    }

    async fn verify(&self, upload: &RegisteredUpload) -> PortResult<VerifiedUpload> {
        self.validate(upload)?;
        let head = self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(upload.key.as_str())
            .checksum_mode(ChecksumMode::Enabled)
            .send()
            .await
            .map_err(|error| {
                let code = match error.raw_response().map(|r| r.status().as_u16()) {
                    Some(404 | 412) => ImportError::UploadMismatch,
                    _ => ImportError::Retryable,
                };
                rootcause::Report::new(error).context(code)
            })?;
        verify_properties(
            upload,
            head.content_length(),
            head.checksum_sha256(),
            head.content_type(),
        )?;
        // S3's literal "null" version is mutable in unversioned/suspended buckets.
        let identity = if let Some(version) = head.version_id().filter(|v| *v != "null") {
            ObjectIdentity::Version(validator(version)?)
        } else {
            ObjectIdentity::EntityTag(validator(head.e_tag().ok_or(ImportError::UploadMismatch)?)?)
        };
        Ok(VerifiedUpload {
            registered: upload.clone(),
            identity,
        })
    }

    async fn read(&self, upload: &VerifiedUpload) -> PortResult<ByteStream> {
        self.validate(&upload.registered)?;
        let mut request = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(upload.registered.key.as_str())
            .checksum_mode(ChecksumMode::Enabled);
        request = match &upload.identity {
            ObjectIdentity::Version(version) if version.as_str() != "null" => {
                request.version_id(version.as_str())
            }
            ObjectIdentity::Version(_) => return Err(ImportError::UploadMismatch.into()),
            ObjectIdentity::EntityTag(tag) => request.if_match(tag.as_str()),
        };
        let output = request.send().await.map_err(|error| {
            let code = match error.raw_response().map(|r| r.status().as_u16()) {
                Some(404 | 412) => ImportError::UploadMismatch,
                _ => ImportError::Retryable,
            };
            rootcause::Report::new(error).context(code)
        })?;
        verify_properties(
            &upload.registered,
            output.content_length(),
            output.checksum_sha256(),
            output.content_type(),
        )?;
        let pinned = match &upload.identity {
            ObjectIdentity::Version(version) => output.version_id() == Some(version.as_str()),
            ObjectIdentity::EntityTag(tag) => output.e_tag() == Some(tag.as_str()),
        };
        if !pinned {
            return Err(ImportError::UploadMismatch.into());
        }
        Ok(bounded_stream(output.body, &upload.registered.descriptor))
    }
}

fn validator(value: &str) -> PortResult<ObjectValidator> {
    value
        .parse()
        .map_err(|error| rootcause::Report::new(error).context(ImportError::UploadMismatch))
}

fn content_type(upload: &UploadId) -> &'static str {
    match upload {
        UploadId::Users => "application/json",
        UploadId::ConversationPart { .. } => "application/x-ndjson",
    }
}

fn checksum(digest: &Sha256Digest) -> String {
    // The domain type already guarantees exactly 64 lowercase hexadecimal digits.
    let bytes: Vec<_> = digest
        .as_str()
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            fn digit(b: u8) -> u8 {
                if b <= b'9' { b - b'0' } else { b - b'a' + 10 }
            }
            (digit(pair[0]) << 4) | digit(pair[1])
        })
        .collect();
    STANDARD.encode(bytes)
}

fn verify_properties(
    upload: &RegisteredUpload,
    length: Option<i64>,
    sha256: Option<&str>,
    mime: Option<&str>,
) -> PortResult<()> {
    if length != Some(upload.descriptor.byte_length as i64)
        || sha256 != Some(checksum(&upload.descriptor.sha256).as_str())
        || mime != Some(content_type(&upload.descriptor.upload))
    {
        return Err(ImportError::UploadMismatch.into());
    }
    Ok(())
}

fn bounded_stream(
    body: aws_sdk_s3::primitives::ByteStream,
    descriptor: &UploadDescriptor,
) -> ByteStream {
    let expected_length = descriptor.byte_length;
    let expected_digest = descriptor.sha256.clone();
    let state = (body.into_async_read(), 0u64, Sha256::new());
    Box::pin(stream::try_unfold(
        state,
        move |(mut reader, mut total, mut digest)| {
            let expected_digest = expected_digest.clone();
            async move {
                // Probe at most one byte past the descriptor, never buffer the object.
                let capacity =
                    (expected_length - total).min(READ_CHUNK_BYTES as u64 - 1) as usize + 1;
                let mut bytes = vec![0; capacity];
                let count = reader.read(&mut bytes).await.map_err(|error| {
                    rootcause::Report::new(error).context(ImportError::Retryable)
                })?;
                total += count as u64;
                if total > expected_length {
                    return Err(ImportError::LimitExceeded.into());
                }
                if count == 0 {
                    if total != expected_length
                        || format!("{:x}", digest.finalize()) != expected_digest.as_str()
                    {
                        return Err(ImportError::UploadMismatch.into());
                    }
                    return Ok(None);
                }
                bytes.truncate(count);
                digest.update(&bytes);
                Ok(Some((bytes, (reader, total, digest))))
            }
        },
    ))
}
