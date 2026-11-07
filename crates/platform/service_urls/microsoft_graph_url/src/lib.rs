//! `MicrosoftGraphUrl`: Microsoft Graph v1.0 API root.

service_url::service_url! {
    /// Microsoft Graph v1.0 API root. Microsoft's host in every environment;
    /// override it to run against `crates/testing/outlook_emulator`.
    pub struct MicrosoftGraphUrl {
        local: "https://graph.microsoft.com/v1.0/",
        dev: "https://graph.microsoft.com/v1.0/",
        prod: "https://graph.microsoft.com/v1.0/",
    }
}
