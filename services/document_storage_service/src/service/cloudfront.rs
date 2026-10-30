//! CloudFront signing shared by document locations and exports.

use cloudfront_sign::{SignedOptions, get_signed_url};
use std::time::{SystemTime, UNIX_EPOCH};

/// Creates signed options for the cloudfront presigned url
#[tracing::instrument(skip(private_key), err)]
pub(crate) fn get_cloudfront_signed_options(
    public_key_id: &str,
    private_key: &str,
    presigned_url_expiry_seconds: u64,
) -> anyhow::Result<SignedOptions> {
    let current_unix_timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    let date_less_than = current_unix_timestamp + presigned_url_expiry_seconds;

    Ok(SignedOptions {
        key_pair_id: public_key_id.to_string(),
        date_less_than,
        private_key: private_key.to_string(),
        ..Default::default()
    })
}

/// Makes a cloudfront presigned url for the provided key
#[tracing::instrument(skip(options), err)]
pub(crate) fn get_presigned_url(
    cloudfront_distribution_url: &str,
    key: &str,
    options: &SignedOptions,
) -> anyhow::Result<String> {
    let constructed_url = format!("{}/{}", cloudfront_distribution_url, key);

    let signed_url = if !macro_aws_config::is_local_aws() {
        get_signed_url(&constructed_url, options)?
    } else {
        constructed_url
    };

    Ok(signed_url)
}
