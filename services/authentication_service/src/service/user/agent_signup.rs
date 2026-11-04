//! Agent accounts: an account flagged at signup that gets an SDK token instead
//! of onboarding.

/// FusionAuth user metadata key marking a signup that asked for an agent.
pub(crate) const AGENT_SIGNUP_DATA_KEY: &str = "isAgent";

/// Name of the API key shown during agent setup. Repeating setup replaces it.
pub(crate) const AGENT_SIGNUP_KEY_NAME: &str = "Agent signup";
