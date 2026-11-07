//! `ScheduledActionServiceUrl`: scheduled action service API URL.

service_url::service_url! {
    /// Scheduled action service API URL.
    pub struct ScheduledActionServiceUrl {
        local: "http://localhost:8101/scheduled-action",
        dev: "https://dev-gateway.macro.com/scheduled-action",
        prod: "https://gateway.macro.com/scheduled-action",
    }
}
