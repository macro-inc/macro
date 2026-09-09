//! Projection of ACP session configuration into the model selection exposed
//! by the fold and model-discovery callers.

use agent_client_protocol::schema::v1::{
    SessionConfigKind, SessionConfigOption, SessionConfigSelectOptions,
};
use agent_runtime_protocol::domain::action::MODEL_CONFIG_ID;

use crate::domain::model::ModelOption;

#[cfg(test)]
mod test;

/// The current model and ordered choices advertised by an ACP agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelSelection {
    /// The model value currently selected by the agent.
    pub current: String,
    /// Models offered by the agent, in advertised order.
    pub options: Vec<ModelOption>,
}

/// Project the ACP `model` select from a complete config-options list.
///
/// Both grouped and ungrouped selects are supported. Groups are flattened in
/// their advertised order. Missing, non-select, and unknown select shapes do
/// not describe a model selection and return `None`.
#[must_use]
pub fn model_selection(options: &[SessionConfigOption]) -> Option<ModelSelection> {
    let model = options
        .iter()
        .find(|option| option.id.to_string() == MODEL_CONFIG_ID)?;
    let SessionConfigKind::Select(select) = &model.kind else {
        return None;
    };

    let options = match &select.options {
        SessionConfigSelectOptions::Ungrouped(options) => options.iter(),
        SessionConfigSelectOptions::Grouped(groups) => {
            return Some(ModelSelection {
                current: select.current_value.to_string(),
                options: groups
                    .iter()
                    .flat_map(|group| {
                        group
                            .options
                            .iter()
                            .map(|option| project_option(option, Some(&group.name)))
                    })
                    .collect(),
            });
        }
        _ => return None,
    }
    .map(|option| project_option(option, None))
    .collect();

    Some(ModelSelection {
        current: select.current_value.to_string(),
        options,
    })
}

fn project_option(
    option: &agent_client_protocol::schema::v1::SessionConfigSelectOption,
    group: Option<&str>,
) -> ModelOption {
    ModelOption {
        id: option.value.to_string(),
        name: option.name.clone(),
        description: option.description.clone(),
        group: group.map(str::to_owned),
    }
}
