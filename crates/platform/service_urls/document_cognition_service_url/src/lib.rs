//! `DocumentCognitionServiceUrl`: document cognition service API URL.

service_url::service_url! {
    /// Document cognition service API URL.
    pub struct DocumentCognitionServiceUrl {
        local: "http://localhost:8101/cognition",
        dev: "https://dev-gateway.macro.com/cognition",
        prod: "https://gateway.macro.com/cognition",
    }
}
