//! `SyncServiceUrl`: sync service API URL.

service_url::service_url! {
    /// Sync service API URL.
    pub struct SyncServiceUrl {
        local: "http://localhost:8787",
        dev: "https://sync-service-dev3.macroverse.workers.dev",
        prod: "https://sync-service-prod2.macroverse.workers.dev",
    }
}
