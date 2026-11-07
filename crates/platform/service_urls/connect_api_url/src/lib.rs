//! `ConnectApiUrl`: macro Connect API base URL: Macro's OAuth broker for MCP connectors.

service_url::service_url! {
    /// Macro Connect API base URL: Macro's OAuth broker for MCP connectors.
    pub struct ConnectApiUrl {
        local: "http://localhost:8080",
        dev: "https://connect-dev.macro.com",
        prod: "https://connect.macro.com",
    }
}
