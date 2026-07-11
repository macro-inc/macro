#[cfg(feature = "outbound")]
mod email_pg_repo;
#[cfg(feature = "http_client")]
mod email_service_http;
#[cfg(feature = "gmail_token")]
mod gmail_token_provider;

#[cfg(feature = "outbound")]
pub use email_pg_repo::EmailPgRepo;
#[cfg(feature = "http_client")]
pub use email_service_http::EmailServiceHttpClient;
#[cfg(feature = "gmail_token")]
pub use gmail_token_provider::{
    GmailTokenProviderImpl, fetch_gmail_access_token, fetch_gmail_access_token_no_cache,
};
