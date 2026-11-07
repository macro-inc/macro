//! `StaticFileServiceUrl`: static file service/CDN URL.

service_url::service_url! {
    /// Static file service/CDN URL.
    pub struct StaticFileServiceUrl {
        local: "http://localhost:8100",
        dev: "https://static-file-service-dev.macro.com",
        prod: "https://static-file-service.macro.com",
    }
}
