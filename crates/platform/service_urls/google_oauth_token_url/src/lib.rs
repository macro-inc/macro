//! `GoogleOauthTokenUrl`: Google's OAuth token endpoint.

service_url::service_url! {
    /// Google's OAuth token endpoint: authorization code exchange and token
    /// refresh. Google's host in every environment; override it to run
    /// against `crates/gmail_emulator`.
    pub struct GoogleOauthTokenUrl {
        local: "https://oauth2.googleapis.com/token",
        dev: "https://oauth2.googleapis.com/token",
        prod: "https://oauth2.googleapis.com/token",
    }
}
