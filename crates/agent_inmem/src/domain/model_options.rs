//! ACP model configuration advertised by the in-memory agent.

use agent_client_protocol::schema::v1::{
    SessionConfigOption, SessionConfigSelectOption, SessionConfigValueId,
};
use agent_runtime_protocol::domain::action::MODEL_CONFIG_ID;

/// Build model configuration from the actual turn engine catalog.
#[must_use]
pub fn model_config_options(current: &str, models: &[&str]) -> Vec<SessionConfigOption> {
    let options: Vec<_> = models
        .iter()
        .map(|model| {
            SessionConfigSelectOption::new(SessionConfigValueId::new((*model).to_owned()), *model)
        })
        .collect();
    vec![SessionConfigOption::select(
        MODEL_CONFIG_ID,
        "Model",
        SessionConfigValueId::new(current.to_owned()),
        options,
    )]
}
