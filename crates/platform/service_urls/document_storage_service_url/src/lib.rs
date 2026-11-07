//! `DocumentStorageServiceUrl`: document storage service API URL.

service_url::service_url! {
    /// Document storage service API URL.
    pub struct DocumentStorageServiceUrl {
        local: "http://localhost:8086",
        dev: "https://dev-gateway.macro.com/dss",
        prod: "https://gateway.macro.com/dss",
    }
}
