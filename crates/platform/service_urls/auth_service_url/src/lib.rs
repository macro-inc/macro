//! `AuthServiceUrl`: authentication service API URL.

service_url::service_url! {
    /// Authentication service API URL.
    pub struct AuthServiceUrl {
        local: "http://localhost:8080",
        dev: "https://dev-gateway.macro.com/auth",
        prod: "https://gateway.macro.com/auth",
    }
}
