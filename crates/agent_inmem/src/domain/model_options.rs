//! ACP session configuration advertised by the in-memory agent.

use agent::ReasoningEffort;
use agent_client_protocol::schema::v1::{
    SessionConfigOption, SessionConfigOptionCategory, SessionConfigSelectOption,
    SessionConfigValueId,
};
use agent_runtime_protocol::domain::action::MODEL_CONFIG_ID;

/// Build session configuration from the actual turn engine catalog and state.
#[must_use]
pub fn session_config_options(
    current_model: &str,
    models: &[&str],
    current_effort: ReasoningEffort,
) -> Vec<SessionConfigOption> {
    let options: Vec<_> = models
        .iter()
        .map(|model| {
            SessionConfigSelectOption::new(SessionConfigValueId::new((*model).to_owned()), *model)
        })
        .collect();
    vec![
        SessionConfigOption::select(
            MODEL_CONFIG_ID,
            "Model",
            SessionConfigValueId::new(current_model.to_owned()),
            options,
        )
        .category(SessionConfigOptionCategory::Model),
        reasoning_effort_config_option(current_effort),
    ]
}

/// ACP id for Macro's portable reasoning-effort selector.
pub const REASONING_EFFORT_CONFIG_ID: &str = "reasoning_effort";

/// Build the effort option at its current value.
#[must_use]
pub fn reasoning_effort_config_option(current: ReasoningEffort) -> SessionConfigOption {
    SessionConfigOption::select(
        REASONING_EFFORT_CONFIG_ID,
        "Reasoning effort",
        SessionConfigValueId::new(current.to_string()),
        ReasoningEffort::ALL
            .into_iter()
            .map(|effort| {
                SessionConfigSelectOption::new(
                    SessionConfigValueId::new(effort.to_string()),
                    effort.display_name(),
                )
            })
            .collect::<Vec<_>>(),
    )
    .category(SessionConfigOptionCategory::ThoughtLevel)
}
