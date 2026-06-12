use std::time::Duration;

use aws_sdk_s3 as s3;
use aws_sdk_s3::presigning::PresigningConfig;

const EXPIRY: Duration = Duration::from_secs(5 * 60);

/// Generates a presigned PUT URL for service-to-service uploads of opaque
/// blobs (e.g. CRDT snapshots). Unlike
/// [`put_presigned_url::put_presigned_url`], this does not validate a SHA
/// checksum or content type — the caller is trusted (another internal
/// service) and the bytes are not user content.
///
/// Uses the docker-internal host in local dev so a service inside the docker
/// network can reach LocalStack.
pub(in crate::service::s3) async fn put_internal_presigned_url(
    client: &s3::Client,
    bucket: &str,
    key: &str,
) -> anyhow::Result<String> {
    if cfg!(feature = "local") {
        return Ok("fake".to_string());
    }
    let presigned = client
        .put_object()
        .bucket(bucket)
        .key(key)
        .presigned(PresigningConfig::expires_in(EXPIRY)?)
        .await?;
    Ok(macro_aws_config::transform_aws_url_for_internal_fetch(
        presigned.uri(),
    ))
}

/// Generates a presigned GET URL for the browser to fetch an opaque blob
/// directly from S3 (e.g. CRDT snapshots used for optimistic seeds).
/// Browser-facing transform — the user's browser resolves the URL via the
/// host-mapped LocalStack port in local dev.
pub(in crate::service::s3) async fn get_presigned_url(
    client: &s3::Client,
    bucket: &str,
    key: &str,
) -> anyhow::Result<String> {
    if cfg!(feature = "local") {
        return Ok("fake".to_string());
    }
    let presigned = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .presigned(PresigningConfig::expires_in(EXPIRY)?)
        .await?;
    Ok(macro_aws_config::transform_aws_url(presigned.uri()))
}
