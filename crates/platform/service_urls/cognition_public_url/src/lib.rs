//! `CognitionPublicUrl`: public integration callback base, preserving registered OAuth redirect URIs.

service_url::service_url! {
    /// Public integration callback base, preserving registered OAuth redirect URIs.
    pub struct CognitionPublicUrl {
        local: "http://localhost:8101/cognition",
        dev: "https://document-cognition-dev.macro.com",
        prod: "https://document-cognition.macro.com",
    }
}
