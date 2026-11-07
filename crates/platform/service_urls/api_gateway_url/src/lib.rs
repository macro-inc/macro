//! `ApiGatewayUrl`: public API gateway origin.

service_url::service_url! {
    /// Public API gateway origin: every service's API under its path
    /// prefix (`/auth`, `/dss`, `/cognition`, `/agent-harness`, ...), as
    /// clients off Macro's network reach them. Locally this is the stack's
    /// proxy, which mirrors the gateway's prefixes.
    pub struct ApiGatewayUrl {
        local: "https://localhost:8090",
        dev: "https://dev-gateway.macro.com",
        prod: "https://gateway.macro.com",
    }
}
