#![deny(missing_docs)]

//! This crate creates a standard way to make AWS configs.

pub use aws_config::SdkConfig;
use macro_env_var::maybe_env_var;

maybe_env_var! {
    #[derive(Clone)]
    pub struct LocalAwsUrl;
}

maybe_env_var! {
    #[derive(Clone)]
    pub struct S3EndpointUrl;
}

/// Creates an S3 client
///
/// `S3_ENDPOINT_URL` overrides the endpoint for S3 alone, leaving SQS, DynamoDB
/// and KMS on whatever [`get_macro_aws_config`] resolves. A self-hosted
/// deployment needs this because a presigned URL's signature covers the host it
/// is signed for: the endpoint has to be the *public* object-storage hostname
/// the browser will use, even though the storage itself is in-network.
#[cfg(feature = "s3")]
pub async fn s3_client() -> aws_sdk_s3::Client {
    let mut builder = aws_sdk_s3::config::Builder::from(&get_macro_aws_config().await)
        // Path-style for any non-AWS endpoint: neither LocalStack nor a
        // self-hosted origin has per-bucket DNS.
        .force_path_style(is_local_aws() || s3_endpoint_override().is_some());
    if let Some(endpoint) = s3_endpoint_override() {
        builder = builder.endpoint_url(endpoint);
    }
    aws_sdk_s3::Client::from_conf(builder.build())
}

/// The configured public S3 endpoint, if any.
fn s3_endpoint_override() -> Option<String> {
    S3EndpointUrl::new().map(|url| url.as_ref().to_string())
}

/// Creates an SQS client
#[cfg(feature = "sqs")]
pub async fn sqs_client() -> aws_sdk_sqs::Client {
    aws_sdk_sqs::Client::new(&get_macro_aws_config().await)
}

/// Creates a aws_config to use.
/// If you provide `LOCAL_AWS_URL` environment variable we create a local aws
/// config with test credentials.
/// Otherwise we load normally.
pub async fn get_macro_aws_config() -> aws_config::SdkConfig {
    if let Some(local_aws_url) = LocalAwsUrl::new() {
        local_aws_config(local_aws_url.as_ref()).await
    } else {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await
    }
}

/// Creates an AWS SDK config pointed at a LocalStack endpoint.
pub async fn local_aws_config(local_aws_url: &str) -> aws_config::SdkConfig {
    aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .test_credentials()
        .endpoint_url(local_aws_url)
        .load()
        .await
}

/// Returns if the aws config is local or not
pub fn is_local_aws() -> bool {
    LocalAwsUrl::new().is_some()
}

/// Whether object URLs are already addressed by a public hostname.
///
/// When `S3_ENDPOINT_URL` is set, S3 URLs are minted against a real, routable
/// host, so the local-development rewriting below must not touch them — the
/// signature is bound to that host, and rewriting it would invalidate it.
fn s3_urls_are_public() -> bool {
    S3EndpointUrl::new().is_some()
}

/// internal method to transform the local aws url
fn transform_local_url(url: &str) -> String {
    // NOTE: it is ok to use expect as this is only run locally
    let parsed = url::Url::parse(url).expect("valid url");
    let host = parsed.host_str().unwrap();
    let port = parsed.port().unwrap_or(4566);
    let path = parsed.path();
    let query = parsed.query().map(|q| format!("?{q}")).unwrap_or_default();

    // Path-style LocalStack URLs generated inside Docker use `localstack` as
    // the host, which the browser on the host machine cannot resolve. Keep the
    // existing path (`/{bucket}/{key}`) and only swap the host to localhost.
    if host == "localstack" || host == "localhost" {
        return format!("http://localhost:{port}{path}{query}");
    }

    // hostname should be in the form {asset}.localstack or {asset}.localhost
    let asset = host
        .strip_suffix(".localstack")
        .or_else(|| host.strip_suffix(".localhost"))
        .unwrap();

    format!("http://localhost:{port}/{asset}{path}{query}")
}

/// Transforms a localstack url into one that will work within the app
/// For example, presigned urls for localstack come out as `http://{BUCKET_NAME}.localstack:{PORT}`
/// but we need them to be formulated as `http://localhost:{PORT}/bucket-name`.
pub fn transform_aws_url(url: &str) -> String {
    if is_local_aws() && !s3_urls_are_public() {
        return transform_local_url(url);
    }
    url.to_string()
}

/// internal method to transform a browser-facing local url into one reachable
/// from inside the docker network
fn transform_internal_url(url: &str) -> String {
    // NOTE: it is ok to use expect as this is only run locally
    let parsed = url::Url::parse(url).expect("valid url");
    let host = parsed.host_str().unwrap();
    let port = parsed.port().unwrap_or(4566);
    let path = parsed.path();
    let query = parsed.query().map(|q| format!("?{q}")).unwrap_or_default();

    // Browser-facing local URLs use `localhost`, which inside a container
    // resolves to the container itself. Swap it for the `localstack` service
    // hostname so service-to-service fetches reach LocalStack. Leave any other
    // host untouched.
    if host == "localhost" || host == "localstack" {
        return format!("http://localstack:{port}{path}{query}");
    }

    url.to_string()
}

/// Transforms a browser-facing local URL into one reachable from inside the
/// app's own containers when fetching an object server-side.
///
/// The inverse of [`transform_aws_url`]: presigned and distribution URLs are
/// minted with the `localhost` host so the browser on the host machine can
/// reach LocalStack, but a service fetching the same object from inside the
/// Docker network must use the `localstack` service hostname instead. No-op
/// outside local AWS.
pub fn transform_aws_url_for_internal_fetch(url: &str) -> String {
    if is_local_aws() && !s3_urls_are_public() {
        return transform_internal_url(url);
    }
    url.to_string()
}

#[cfg(test)]
mod test;
