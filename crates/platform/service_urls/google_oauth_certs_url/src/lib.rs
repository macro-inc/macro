//! `GoogleOauthCertsUrl`: Google's public keys for verifying Gmail push tokens.

service_url::service_url! {
    /// Google's public keys for verifying Gmail push tokens. Google's host in
    /// every environment; override it to run against `crates/testing/gmail_emulator`.
    pub struct GoogleOauthCertsUrl {
        local: "https://www.googleapis.com/oauth2/v3/certs",
        dev: "https://www.googleapis.com/oauth2/v3/certs",
        prod: "https://www.googleapis.com/oauth2/v3/certs",
    }
}
