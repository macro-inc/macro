//! `EmailServiceUrl`: email service API URL.

service_url::service_url! {
    /// Email service API URL.
    pub struct EmailServiceUrl {
        local: "http://localhost:8087",
        dev: "https://dev-gateway.macro.com/email",
        prod: "https://gateway.macro.com/email",
    }
}
