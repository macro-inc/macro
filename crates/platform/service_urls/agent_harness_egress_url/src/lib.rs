//! `AgentHarnessEgressUrl`: sandbox-facing agent harness egress proxy URL.

service_url::service_url! {
    /// Sandbox-facing agent harness egress proxy URL.
    /// Override the local default when sandbox clients need a Docker-network
    /// address or a public tunnel rather than the host's loopback address.
    pub struct AgentHarnessEgressUrl {
        local: "http://localhost:8102",
        dev: "https://dev-gateway.macro.com/agent-harness-egress",
        prod: "https://gateway.macro.com/agent-harness-egress",
    }
}
