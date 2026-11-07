//! `MicrosoftLoginUrl`: the Microsoft identity platform's host, for the calls a service makes.

service_url::service_url! {
    /// The Microsoft identity platform's host, for the calls a service
    /// makes: code exchange, token refresh, the OpenID discovery document
    /// and its signing keys. Microsoft's host in every environment; override
    /// it to run against `crates/outlook_emulator`.
    pub struct MicrosoftLoginUrl {
        local: "https://login.microsoftonline.com/",
        dev: "https://login.microsoftonline.com/",
        prod: "https://login.microsoftonline.com/",
    }
}
