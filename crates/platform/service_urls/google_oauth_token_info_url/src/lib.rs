//! `GoogleOauthTokenInfoUrl`: Google's endpoint that reports which scopes an access token carries.

service_url::service_url! {
    /// Google's endpoint that reports which scopes an access token carries.
    /// Google's host in every environment; override it to run against
    /// `crates/gmail_emulator`.
    pub struct GoogleOauthTokenInfoUrl {
        local: "https://www.googleapis.com/oauth2/v3/tokeninfo",
        dev: "https://www.googleapis.com/oauth2/v3/tokeninfo",
        prod: "https://www.googleapis.com/oauth2/v3/tokeninfo",
    }
}
