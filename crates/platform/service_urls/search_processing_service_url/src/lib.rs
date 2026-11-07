//! `SearchProcessingServiceUrl`: search processing service API URL.

service_url::service_url! {
    /// Search processing service API URL.
    pub struct SearchProcessingServiceUrl {
        local: "http://localhost:8092",
        dev: "https://dev-gateway.macro.com/search-processing",
        prod: "https://gateway.macro.com/search-processing",
    }
}
