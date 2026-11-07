//! `ConvertServiceUrl`: convert service API URL.

service_url::service_url! {
    /// Convert service API URL.
    pub struct ConvertServiceUrl {
        local: "http://localhost:8080",
        dev: "https://dev-gateway.macro.com/convert",
        prod: "https://gateway.macro.com/convert",
    }
}
