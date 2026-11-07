//! `ConnectionGatewayUrl`: connection gateway HTTP API URL.

service_url::service_url! {
    /// Connection gateway HTTP API URL.
    pub struct ConnectionGatewayUrl {
        local: "http://localhost:8082",
        dev: "https://dev-gateway.macro.com/connection-gateway",
        prod: "https://gateway.macro.com/connection-gateway",
    }
}
