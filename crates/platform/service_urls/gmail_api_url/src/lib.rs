//! `GmailApiUrl`: Gmail REST API base.

service_url::service_url! {
    /// Gmail REST API base. Google's host in every environment; override it
    /// to run against `crates/gmail_emulator`.
    pub struct GmailApiUrl {
        local: "https://www.googleapis.com/gmail/v1",
        dev: "https://www.googleapis.com/gmail/v1",
        prod: "https://www.googleapis.com/gmail/v1",
    }
}
