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
            SessionConfigSelectOption::new(
                SessionConfigValueId::new((*model).to_owned()),
                super::models::display_name(model),
            )
        })
        .collect();
    vec![SessionConfigOption::select(
        MODEL_CONFIG_ID,
        "Model",
        SessionConfigValueId::new(current.to_owned()),
        options,
    )]
}

#[cfg(test)]
mod test {
    use super::model_config_options;
    use agent_fold::domain::model_selection::model_selection;

    #[test]
    fn open_weight_options_use_house_names() {
        let options = model_config_options(
            "fireworks/kimi-k3",
            &["fireworks/kimi-k3", "anthropic/claude-sonnet-5"],
        );
        let selection = model_selection(&options).expect("a model select");
        assert_eq!(selection.current, "fireworks/kimi-k3");
        assert_eq!(
            selection
                .options
                .iter()
                .map(|model| (model.id.as_str(), model.name.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("fireworks/kimi-k3", "Kimi K3"),
                ("anthropic/claude-sonnet-5", "anthropic/claude-sonnet-5"),
            ]
        );
    }
}
