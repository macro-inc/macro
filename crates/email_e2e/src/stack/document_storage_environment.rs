//! The environment `document_storage_service` runs with: the email
//! services' own, the same database, Redis database, queues and providers,
//! and a placeholder for everything the service insists on at startup but
//! the email GraphQL surface never touches.

use std::collections::BTreeMap;

use super::environment::INTERNAL_API_KEY;

/// The stand-in that answers the search cluster's health check.
pub(crate) const SEARCH: &str = "search";
/// A value for settings nothing in a scenario reads.
const UNUSED: &str = "email-e2e-unused";
/// The shape the service parses at startup; no scenario books a meeting.
const CAL_EVENT_TYPES: &str = r#"{"1":{"content_name":"email-e2e","value":0}}"#;

/// What is specific to one `document_storage_service` process.
pub(crate) struct DocumentStorage<'a> {
    pub(crate) port: u16,
    /// The scenario database, under the names this service reads.
    pub(crate) database_url: String,
    /// The base URL of the Macro services stand-in's search cluster.
    pub(crate) search_url: String,
    /// What the email services run with.
    pub(crate) email_env: &'a BTreeMap<String, String>,
}

/// The environment of `document_storage_service`.
pub(crate) fn document_storage_env(service: &DocumentStorage<'_>) -> BTreeMap<String, String> {
    let mut env = service.email_env.clone();
    let own_url = format!("http://127.0.0.1:{}", service.port);
    let settings = [
        ("PORT", service.port.to_string()),
        ("DATABASE_URL", service.database_url.clone()),
        ("DATABASE_URL_READONLY", service.database_url.clone()),
        (
            "DOCUMENT_STORAGE_SERVICE_AUTH_KEY",
            INTERNAL_API_KEY.to_owned(),
        ),
        ("SYNC_SERVICE_AUTH_KEY", INTERNAL_API_KEY.to_owned()),
        ("OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL", own_url),
        ("OPENSEARCH_URL", service.search_url.clone()),
        (
            "CAL_EVENT_TYPE_CONTENT_NAMES_KEY",
            CAL_EVENT_TYPES.to_owned(),
        ),
        ("DOCUMENT_LIMIT", "20".to_owned()),
        (
            "DOCUMENT_STORAGE_SERVICE_PRESIGNED_URL_EXPIRY_SECONDS",
            "900".to_owned(),
        ),
        (
            "DOCUMENT_STORAGE_SERVICE_PRESIGNED_URL_BROWSER_CACHE_EXPIRY_SECONDS",
            "600".to_owned(),
        ),
        ("AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS", "500".to_owned()),
        ("AI_USAGE_INCLUDED_ALLOWANCE_CENTS", "1500".to_owned()),
        ("AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS", "15000".to_owned()),
        ("AI_USAGE_OVERAGE_MARKUP_PERCENT", "25".to_owned()),
        ("GITHUB_SYNC_APP_URL", "http://127.0.0.1:1".to_owned()),
        ("LIVEKIT_SERVER_URL", "http://127.0.0.1:1".to_owned()),
    ];
    for (name, value) in settings {
        env.insert(name.to_owned(), value);
    }
    for name in UNUSED_SETTINGS {
        env.insert((*name).to_owned(), UNUSED.to_owned());
    }
    env
}

/// Settings the service requires and no email operation reads.
const UNUSED_SETTINGS: &[&str] = &[
    "POSTHOG_API_KEY",
    "STATIC_STORAGE_BUCKET",
    "DOCUMENT_STORAGE_BUCKET",
    "DOCX_DOCUMENT_UPLOAD_BUCKET",
    "GITHUB_PULL_REQUEST_PATCH_BUCKET",
    "UPLOAD_STAGING_BUCKET",
    "BULK_UPLOAD_REQUESTS_TABLE",
    "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL",
    "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID",
    "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY",
    "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME",
    "DOCUMENT_PERMISSION_JWT",
    "OPENSEARCH_USERNAME",
    "OPENSEARCH_PASSWORD",
    "GITHUB_SYNC_APP_CLIENT_ID",
    "GITHUB_SYNC_APP_CLIENT_SECRET",
    "GITHUB_INSTALLATION_STATE_SECRET",
    "GITHUB_WEBHOOK_SECRET_KEY",
    "GITHUB_SYNC_APP_PEM_SECRET_KEY",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "OPENAI_API_KEY",
    "COHERE_API_KEY",
    "ANTHROPIC_API_KEY",
    "CAL_WEBHOOK_SECRET_KEY",
    "META_PIXEL_ID",
    "META_ACCESS_TOKEN",
];
