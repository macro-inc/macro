use aws_sdk_s3 as s3;
use std::time::Duration;
use tracing::instrument;

use s3::presigning::PresigningConfig;

#[instrument(skip(client))]
pub(in crate::service::s3) async fn get_presigned_url(
    client: &s3::Client,
    bucket: &str,
    key: &str,
) -> anyhow::Result<String> {
    #[cfg(feature = "local")]
    {
        return Ok("fake".to_string());
    }

    // Allows the app 2 minutes to grab the document
    let expiry_duration = Duration::from_secs(2 * 60);

    // Generate the presigned URL.
    let presigned_url = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .presigned(PresigningConfig::expires_in(expiry_duration)?)
        .await?;

    Ok(presigned_url.uri().to_string())
}
