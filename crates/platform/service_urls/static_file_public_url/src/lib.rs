//! `StaticFilePublicUrl`: browser-facing static file base that file links are stamped with.

service_url::service_url! {
    /// Browser-facing static file base that file links are stamped with.
    /// `StaticFileServiceUrl` is the address services call; on a local
    /// stack the two differ, since containers reach the service
    /// in-network while browsers go through the frontend proxy.
    pub struct StaticFilePublicUrl {
        local: "http://localhost:8100",
        dev: "https://static-file-service-dev.macro.com",
        prod: "https://static-file-service.macro.com",
    }
}
