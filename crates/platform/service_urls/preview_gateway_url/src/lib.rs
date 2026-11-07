//! `PreviewGatewayUrl`: control and internal MCP surface of the live preview service.

service_url::service_url! {
    /// Control and internal MCP surface of the live preview service.
    pub struct PreviewGatewayUrl {
        local: "http://localhost:8101/preview",
        dev: "https://dev-gateway.macro.com/preview",
        prod: "https://gateway.macro.com/preview",
    }
}
