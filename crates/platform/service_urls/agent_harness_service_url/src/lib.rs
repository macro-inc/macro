//! `AgentHarnessServiceUrl`: agent harness service API URL. Serves the agent-session control

service_url::service_url! {
    /// Agent harness service API URL. Serves the agent-session control
    /// routes, which run in the process that owns the live sessions.
    pub struct AgentHarnessServiceUrl {
        local: "http://localhost:8101",
        dev: "https://dev-gateway.macro.com/agent-harness",
        prod: "https://gateway.macro.com/agent-harness",
    }
}
