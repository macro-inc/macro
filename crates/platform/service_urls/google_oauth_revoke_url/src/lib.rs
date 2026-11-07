//! `GoogleOauthRevokeUrl`: Google's OAuth token revocation endpoint.

service_url::service_url! {
    /// Google's OAuth token revocation endpoint. Google's host in every
    /// environment; override it to run against `crates/testing/gmail_emulator`.
    pub struct GoogleOauthRevokeUrl {
        local: "https://oauth2.googleapis.com/revoke",
        dev: "https://oauth2.googleapis.com/revoke",
        prod: "https://oauth2.googleapis.com/revoke",
    }
}
