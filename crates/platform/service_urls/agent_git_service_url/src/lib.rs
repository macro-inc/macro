//! `AgentGitServiceUrl`: agent workspace repos.

service_url::service_url! {
    /// Agent workspace repos: smart-HTTP clone/push of each agent's repo
    /// and the internal create/delete API, served by the agent harness
    /// under the `/agent-git` gateway prefix.
    pub struct AgentGitServiceUrl {
        local: "http://localhost:8101/agent-git",
        dev: "https://dev-gateway.macro.com/agent-git",
        prod: "https://gateway.macro.com/agent-git",
    }
}
