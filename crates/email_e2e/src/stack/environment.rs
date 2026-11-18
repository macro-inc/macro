//! The environment the service binaries run with: exactly what is listed
//! here, nothing inherited.

use std::collections::BTreeMap;

use gmail_emulator::GmailEmulator;
use outlook_emulator::OutlookEmulator;
use rootcause::prelude::*;

use crate::infra::sqs::Queues;
use crate::macro_services::{CONNECTION_GATEWAY, DOCUMENT_STORAGE, MacroServices, STATIC_FILES};

/// The key the scenario's requests and the services' calls to each other
/// carry.
pub(crate) const INTERNAL_API_KEY: &str = "email-e2e-internal";
/// The bucket draft attachments and cached attachment bytes go to.
const ATTACHMENT_BUCKET: &str = "email-attachments";
/// The bucket the static file and document storage stand-ins hand out
/// upload addresses in.
pub(crate) const UPLOADS_BUCKET: &str = "uploads";
/// The local stack's public key for Macro API tokens. The services only
/// parse it when such a token arrives.
const MACRO_API_TOKEN_PUBLIC_KEY: &str = include_str!(
    "../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
);
/// An RSA key for signing attachment links, which the CDN stand-in does not
/// check. A test fixture, not a secret.
const CDN_SIGNING_KEY: &str =
    include_str!("../../../call/src/outbound/s3_recording_storage/test_private_key.pem");

/// The suite's own names for the shared servers. Each falls back to the name
/// the rest of the workspace's tests use, which the development shell sets.
const DATABASE_URL: [&str; 2] = ["EMAIL_E2E_DATABASE_URL", "DATABASE_URL"];
const REDIS_URL: [&str; 2] = ["EMAIL_E2E_REDIS_URL", "REDIS_URI"];
const SQS_URL: [&str; 1] = ["EMAIL_E2E_SQS_URL"];
const KAFKA_BROKERS: [&str; 1] = ["EMAIL_E2E_KAFKA_BROKERS"];

/// The search cluster, which only a stack that searches needs.
const OPENSEARCH_URL: [&str; 1] = ["EMAIL_E2E_OPENSEARCH_URL"];

/// Where the shared search cluster answers.
pub(crate) fn opensearch_url() -> Result<String, Report> {
    required(
        &OPENSEARCH_URL,
        "an OpenSearch cluster with the search indices, such as http://localhost:9200",
    )
}

/// The servers every scenario shares, from the suite's environment.
pub(crate) struct Servers {
    pub(crate) postgres: String,
    pub(crate) redis: String,
    pub(crate) sqs: String,
    pub(crate) kafka: String,
}

impl Servers {
    pub(crate) fn from_env() -> Result<Self, Report> {
        Ok(Self {
            postgres: required(
                &DATABASE_URL,
                "a Postgres server, such as postgres://user:password@localhost:5432/macrodb",
            )?,
            redis: required(&REDIS_URL, "a Redis server, such as redis://localhost:6379")?,
            sqs: required(
                &SQS_URL,
                "an SQS-compatible server (ElasticMQ), such as http://localhost:9324",
            )?,
            kafka: required(&KAFKA_BROKERS, "a Kafka broker, such as localhost:9092")?,
        })
    }
}

/// The first of `names` that is set.
fn required(names: &[&str], what: &str) -> Result<String, Report> {
    for name in names {
        #[expect(
            clippy::disallowed_methods,
            reason = "test support: the suite's own settings come from the process environment"
        )]
        let value = std::env::var(name);
        if let Ok(value) = value {
            return Ok(value);
        }
    }
    bail!(
        "{} is not set: the suite needs {what}. See crates/email_e2e/AGENTS.md",
        names.join(" or ")
    )
}

/// Where everything a service talks to lives.
pub(crate) struct Addresses<'a> {
    pub(crate) port: u16,
    /// The API's public `https://` address.
    pub(crate) public_url: String,
    pub(crate) database_url: String,
    pub(crate) redis_url: String,
    pub(crate) kafka_brokers: String,
    pub(crate) aws_url: String,
    pub(crate) cdn_url: String,
    pub(crate) gmail: &'a GmailEmulator,
    pub(crate) outlook: &'a OutlookEmulator,
    pub(crate) macro_services: &'a MacroServices,
    pub(crate) queues: &'a Queues,
}

/// The environment of `email_service` and `pubsub_workers`.
pub(crate) fn service_env(addresses: &Addresses<'_>) -> BTreeMap<String, String> {
    let gmail = addresses.gmail.base_url();
    let outlook = addresses.outlook.base_url();
    let services = addresses.macro_services;

    let mut env: BTreeMap<String, String> = [
        ("ENVIRONMENT", "local".to_owned()),
        // The services' debug builds need a deep stack, as in the local stack.
        ("RUST_MIN_STACK", "67108864".to_owned()),
        ("RUST_LOG", "info".to_owned()),
        ("NO_COLOR", "1".to_owned()),
        ("PORT", addresses.port.to_string()),
        ("MACRO_DB_URL", addresses.database_url.clone()),
        ("REDIS_URI", addresses.redis_url.clone()),
        ("KAFKA_BROKERS", addresses.kafka_brokers.clone()),
        ("LOCAL_AWS_URL", addresses.aws_url.clone()),
        ("ATTACHMENT_BUCKET", ATTACHMENT_BUCKET.to_owned()),
        (
            "EMAIL_SERVICE_CLOUDFRONT_DISTRIBUTION_URL",
            addresses.cdn_url.clone(),
        ),
        (
            "EMAIL_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY",
            CDN_SIGNING_KEY.to_owned(),
        ),
        (
            "EMAIL_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID",
            "email-e2e".to_owned(),
        ),
        (
            "GMAIL_GCP_QUEUE",
            "projects/email-e2e/topics/gmail".to_owned(),
        ),
        (
            "AUTHENTICATION_SERVICE_SECRET_KEY",
            INTERNAL_API_KEY.to_owned(),
        ),
        ("INTERNAL_API_KEY", INTERNAL_API_KEY.to_owned()),
        ("AUDIENCE", "email-e2e".to_owned()),
        ("ISSUER", "email-e2e".to_owned()),
        ("JWT_SECRET_KEY", "email-e2e".to_owned()),
        ("MACRO_API_TOKEN_ISSUER", "email-e2e".to_owned()),
        (
            "MACRO_API_TOKEN_PUBLIC_KEY",
            MACRO_API_TOKEN_PUBLIC_KEY.to_owned(),
        ),
        // Production's values, except where a scenario would only wait.
        ("NOTIFICATIONS_ENABLED", "true".to_owned()),
        ("OUTLOOK_CONNECTIONS_ENABLED", "true".to_owned()),
        ("OUTLOOK_SYNC_ENABLED", "true".to_owned()),
        ("OUTLOOK_WRITES_ENABLED", "true".to_owned()),
        ("SENT_UNDO_DELAY_SECS", "1".to_owned()),
        ("QUEUE_WAIT_TIME_SECONDS", "2".to_owned()),
        ("BACKFILL_QUEUE_WORKERS", "4".to_owned()),
        ("INBOX_SYNC_QUEUE_WORKERS", "3".to_owned()),
        ("INBOX_SYNC_RETRY_QUEUE_WORKERS", "2".to_owned()),
        // The providers, through their typed URL overrides.
        ("OVERRIDE_GMAIL_API_URL", format!("{gmail}/gmail/v1")),
        (
            "OVERRIDE_GOOGLE_PEOPLE_API_URL",
            format!("{gmail}/people/v1"),
        ),
        (
            "OVERRIDE_GOOGLE_CALENDAR_API_URL",
            addresses.gmail.calendar_url(),
        ),
        (
            "OVERRIDE_GOOGLE_OAUTH_CERTS_URL",
            addresses.gmail.certs_url(),
        ),
        (
            "OVERRIDE_GOOGLE_OAUTH_TOKEN_INFO_URL",
            format!("{gmail}/oauth2/v3/tokeninfo"),
        ),
        ("OVERRIDE_MICROSOFT_GRAPH_URL", format!("{outlook}/v1.0/")),
        (
            "OVERRIDE_MICROSOFT_LOGIN_URL",
            addresses.outlook.login_url(),
        ),
        // The other Macro services.
        ("OVERRIDE_AUTH_SERVICE_URL", services.authentication_url()),
        (
            "OVERRIDE_STATIC_FILE_SERVICE_URL",
            services.url(STATIC_FILES),
        ),
        (
            "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL",
            services.url(DOCUMENT_STORAGE),
        ),
        (
            "OVERRIDE_CONNECTION_GATEWAY_URL",
            services.url(CONNECTION_GATEWAY),
        ),
        // The API's public address: Outlook subscriptions call it, and Graph
        // only notifies https URLs.
        ("OVERRIDE_EMAIL_SERVICE_URL", addresses.public_url.clone()),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_owned(), value))
    .collect();

    for queue in addresses.queues.all() {
        env.insert(queue.override_env.to_owned(), queue.url.clone());
    }
    env
}
