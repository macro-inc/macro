//! `GoogleOauthAuthorizationUrl`: Google's OAuth authorization endpoint, where a browser goes to
//! sign in and consent.

service_url::service_url! {
    /// Google's OAuth authorization endpoint, where a browser goes to sign in
    /// and consent. Google's host in every environment; override it to run
    /// against `crates/gmail_emulator`. The override is opened by a browser,
    /// so it names an address the browser reaches, not an in-network one.
    pub struct GoogleOauthAuthorizationUrl {
        local: "https://accounts.google.com/o/oauth2/v2/auth",
        dev: "https://accounts.google.com/o/oauth2/v2/auth",
        prod: "https://accounts.google.com/o/oauth2/v2/auth",
    }
}
