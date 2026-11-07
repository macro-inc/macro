//! `ConnectionGatewayWebsocketUrl`: connection gateway WebSocket URL.

service_url::service_url! {
    /// Connection gateway WebSocket URL.
    pub struct ConnectionGatewayWebsocketUrl {
        local: "ws://localhost:8082",
        dev: "wss://dev-gateway.macro.com/connection-gateway",
        prod: "wss://gateway.macro.com/connection-gateway",
    }
}
