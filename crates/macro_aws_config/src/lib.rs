#![deny(missing_docs)]

//! This crate creates a standard way to make AWS configs.

pub use aws_config::SdkConfig;
use macro_env_var::maybe_env_var;

maybe_env_var! {
    #[derive(Clone)]
    pub struct LocalAwsUrl;
}

maybe_env_var! {
    /// Where a browser on the host machine reaches the local AWS endpoint.
    ///
    /// Inside the Docker network LocalStack is `LOCAL_AWS_URL`
    /// (`http://localstack:4566`), but Compose publishes it on a per-instance
    /// host port, so browser-facing URLs need a different origin. Optional:
    /// when unset, the public origin is `http://localhost:{port}` with the port
    /// of `LOCAL_AWS_URL`, which is the default instance's port mapping.
    #[derive(Clone)]
    pub struct LocalAwsPublicUrl;
}

/// Creates an S3 client
#[cfg(feature = "s3")]
pub async fn s3_client() -> aws_sdk_s3::Client {
    let s3_config = aws_sdk_s3::config::Builder::from(&get_macro_aws_config().await)
        .force_path_style(is_local_aws())
        .build();
    aws_sdk_s3::Client::from_conf(s3_config)
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

/// The two faces of the local AWS endpoint.
///
/// Services and the SDK talk to LocalStack over the Docker network
/// (`internal`); the browser on the host machine reaches the same LocalStack
/// through the host port Compose publishes (`public`). Presigned and
/// distribution URLs are minted against one and have to be rewritten to the
/// other depending on who fetches them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAwsEndpoints {
    internal: url::Url,
    public: url::Url,
}

impl LocalAwsEndpoints {
    /// Build from explicit endpoint URLs. Only the origin (scheme, host, port)
    /// of each is used; any path or query is ignored.
    ///
    /// # Panics
    /// If either URL does not parse or has no host. Both come from local-only
    /// configuration, never from user input.
    pub fn new(internal: &str, public: &str) -> Self {
        Self {
            internal: parse_origin(internal, "LOCAL_AWS_URL"),
            public: parse_origin(public, "LOCAL_AWS_PUBLIC_URL"),
        }
    }

    /// Resolve from `LOCAL_AWS_URL` and `LOCAL_AWS_PUBLIC_URL`. `None` outside
    /// local AWS. See [`LocalAwsPublicUrl`] for the fallback when only the
    /// internal endpoint is configured.
    pub fn from_env() -> Option<Self> {
        let internal = parse_origin(LocalAwsUrl::new()?.as_ref(), "LOCAL_AWS_URL");
        let public = match LocalAwsPublicUrl::new() {
            Some(public) => parse_origin(public.as_ref(), "LOCAL_AWS_PUBLIC_URL"),
            None => {
                let mut public = internal.clone();
                public
                    .set_host(Some("localhost"))
                    .expect("localhost is a valid host");
                public
            }
        };
        Some(Self { internal, public })
    }

    /// Rewrite a LocalStack URL so a browser on the host machine can reach it.
    ///
    /// Accepts the path-style form the SDK mints (`http://localstack:4566/{bucket}/{key}`),
    /// the virtual-host form (`http://{bucket}.localstack:4566/{key}`), a
    /// distribution-style URL already on `localhost`, and the public origin
    /// itself (idempotent). The `/{bucket}/{key}` path and the query string are
    /// preserved; only the origin changes. Any other host is returned unchanged.
    pub fn to_public_url(&self, url: &str) -> String {
        let Some((bucket, parsed)) = self.parse_local(url) else {
            return url.to_string();
        };
        rebuild(&self.public, bucket.as_deref(), &parsed)
    }

    /// Rewrite a browser-facing local URL so a service inside the Docker
    /// network can fetch it. The inverse of [`Self::to_public_url`]: the
    /// origin becomes the internal endpoint, including its port, and the
    /// path and query are preserved. Any other host is returned unchanged.
    pub fn to_internal_url(&self, url: &str) -> String {
        let Some((bucket, parsed)) = self.parse_local(url) else {
            return url.to_string();
        };
        rebuild(&self.internal, bucket.as_deref(), &parsed)
    }

    /// Parse `url` if it points at the local AWS endpoint on either face.
    /// Returns the bucket carried in a virtual-host hostname (if any) and the
    /// parsed URL.
    fn parse_local(&self, url: &str) -> Option<(Option<String>, url::Url)> {
        let parsed = url::Url::parse(url).ok()?;
        let host = parsed.host_str()?;
        if self.is_local_host(host) {
            return Some((None, parsed));
        }
        let bucket = self.local_hosts().find_map(|local| {
            host.strip_suffix(local)
                .and_then(|prefix| prefix.strip_suffix('.'))
                .filter(|bucket| !bucket.is_empty())
                .map(str::to_string)
        })?;
        Some((Some(bucket), parsed))
    }

    fn is_local_host(&self, host: &str) -> bool {
        self.local_hosts().any(|local| local == host)
    }

    /// Every hostname that means "the local AWS endpoint": the fixed Docker
    /// alias and loopback name, plus whatever the two configured origins use.
    fn local_hosts(&self) -> impl Iterator<Item = &str> {
        ["localstack", "localhost"]
            .into_iter()
            .chain(self.internal.host_str())
            .chain(self.public.host_str())
    }
}

fn parse_origin(value: &str, what: &str) -> url::Url {
    // NOTE: it is ok to panic as these are only read locally
    let parsed =
        url::Url::parse(value).unwrap_or_else(|e| panic!("{what}={value} is not a valid url: {e}"));
    assert!(parsed.host_str().is_some(), "{what}={value} has no host");
    parsed
}

/// `{origin}[/{bucket}]{path}{query}` on the given origin.
fn rebuild(origin: &url::Url, bucket: Option<&str>, parsed: &url::Url) -> String {
    let scheme = origin.scheme();
    let host = origin
        .host_str()
        .expect("origins are validated to have a host");
    let port = origin.port().map(|p| format!(":{p}")).unwrap_or_default();
    let bucket = bucket.map(|b| format!("/{b}")).unwrap_or_default();
    let path = parsed.path();
    let query = parsed.query().map(|q| format!("?{q}")).unwrap_or_default();
    format!("{scheme}://{host}{port}{bucket}{path}{query}")
}

/// Transforms a localstack url into one that will work in the browser.
/// For example, presigned urls for localstack come out as `http://{BUCKET_NAME}.localstack:{PORT}`
/// or `http://localstack:{PORT}/{BUCKET_NAME}`, but the browser on the host needs
/// `http://localhost:{HOST_PORT}/{BUCKET_NAME}` where `HOST_PORT` is the port
/// Compose published for this instance (see [`LocalAwsPublicUrl`]). No-op
/// outside local AWS.
pub fn transform_aws_url(url: &str) -> String {
    match LocalAwsEndpoints::from_env() {
        Some(endpoints) => endpoints.to_public_url(url),
        None => url.to_string(),
    }
}

/// Transforms a browser-facing local URL into one reachable from inside the
/// app's own containers when fetching an object server-side.
///
/// The inverse of [`transform_aws_url`]: presigned and distribution URLs are
/// minted on the public origin so the browser on the host machine can reach
/// LocalStack, but a service fetching the same object from inside the Docker
/// network must use the configured `LOCAL_AWS_URL` origin instead. No-op
/// outside local AWS.
pub fn transform_aws_url_for_internal_fetch(url: &str) -> String {
    match LocalAwsEndpoints::from_env() {
        Some(endpoints) => endpoints.to_internal_url(url),
        None => url.to_string(),
    }
}

#[cfg(test)]
mod test;
