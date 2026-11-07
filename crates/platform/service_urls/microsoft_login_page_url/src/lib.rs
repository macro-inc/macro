//! `MicrosoftLoginPageUrl`: the Microsoft identity platform's host, for the pages a browser opens.

service_url::service_url! {
    /// The Microsoft identity platform's host, for the pages a browser
    /// opens: sign-in and consent, and admin consent. Microsoft's host in
    /// every environment; override it to run against
    /// `crates/outlook_emulator`. The override names an address the browser
    /// reaches, not an in-network one.
    pub struct MicrosoftLoginPageUrl {
        local: "https://login.microsoftonline.com/",
        dev: "https://login.microsoftonline.com/",
        prod: "https://login.microsoftonline.com/",
    }
}
