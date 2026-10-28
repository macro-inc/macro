//! Shared projection of Cursor's model catalog into ACP session configuration.

use super::model::{CursorModel, ModelChoice, ModelFamily};
use agent_client_protocol::schema::v1::{
    SessionConfigGroupId, SessionConfigId, SessionConfigKind, SessionConfigOption,
    SessionConfigOptionCategory, SessionConfigSelect, SessionConfigSelectGroup,
    SessionConfigSelectOption, SessionConfigSelectOptions, SessionConfigValueId,
};

/// ACP config id used for model selection.
pub const MODEL_CONFIG_ID: &str = "model";

/// Portable ACP config id used for Cursor model reasoning variants.
pub const REASONING_EFFORT_CONFIG_ID: &str = "reasoning_effort";

/// Parameter ids Cursor currently uses for reasoning effort across models.
pub const REASONING_PARAMETER_IDS: [&str; 2] = ["effort", "reasoning"];

/// Cursor's server-selected model entry.
pub const AUTO_MODEL_ID: &str = "default";

/// Build the same model select advertised by Cursor ACP sessions.
#[must_use]
pub fn cursor_model_config_options(
    models: &[CursorModel],
    current: Option<String>,
) -> Vec<SessionConfigOption> {
    let current = current.or_else(|| {
        models
            .iter()
            .find(|model| model.id == AUTO_MODEL_ID)
            .map(|model| model.id.clone())
    });
    let Some(current) = current else {
        return Vec::new();
    };
    let select_option = |model: &CursorModel| {
        SessionConfigSelectOption::new(
            SessionConfigValueId::new(model.id.clone()),
            model.display_name.clone(),
        )
    };
    let families = ModelFamily::group(models);
    let options = if ModelFamily::is_informative(&families) {
        SessionConfigSelectOptions::Grouped(
            families
                .iter()
                .map(|family| {
                    SessionConfigSelectGroup::new(
                        SessionConfigGroupId::new(family.id.clone()),
                        family.name.clone(),
                        family.models.iter().map(select_option).collect(),
                    )
                })
                .collect(),
        )
    } else {
        SessionConfigSelectOptions::Ungrouped(models.iter().map(select_option).collect())
    };
    vec![
        SessionConfigOption::new(
            SessionConfigId::new(MODEL_CONFIG_ID),
            "Model",
            SessionConfigKind::Select(SessionConfigSelect::new(
                SessionConfigValueId::new(current),
                options,
            )),
        )
        .category(SessionConfigOptionCategory::Model),
    ]
}

/// Build Cursor's model select and the selected model's reasoning-effort select.
///
/// Cursor enumerates valid model parameter combinations as variants. The
/// effort control is therefore advertised only when the current concrete
/// model has more than one accepted value.
#[must_use]
pub fn cursor_session_config_options(
    models: &[CursorModel],
    current: Option<&ModelChoice>,
) -> Vec<SessionConfigOption> {
    let mut options = cursor_model_config_options(models, current.map(|model| model.id.clone()));
    let Some(current) = current else {
        return options;
    };
    let Some(model) = models.iter().find(|model| model.id == current.id) else {
        return options;
    };
    let Some(parameter) = current
        .params
        .iter()
        .find(|param| REASONING_PARAMETER_IDS.contains(&param.id.as_str()))
    else {
        return options;
    };
    let mut values = Vec::new();
    for variant in &model.variants {
        if !model_params_match_except(&variant.params, &current.params, &parameter.id) {
            continue;
        }
        let Some(value) = variant
            .params
            .iter()
            .find(|param| param.id == parameter.id)
            .map(|param| param.value.as_str())
        else {
            continue;
        };
        if !values.contains(&value) {
            values.push(value);
        }
    }
    if values.len() < 2 {
        return options;
    }
    options.push(
        SessionConfigOption::select(
            REASONING_EFFORT_CONFIG_ID,
            "Reasoning effort",
            SessionConfigValueId::new(parameter.value.clone()),
            values
                .into_iter()
                .map(|value| {
                    SessionConfigSelectOption::new(
                        SessionConfigValueId::new(value.to_owned()),
                        display_value(value),
                    )
                })
                .collect::<Vec<_>>(),
        )
        .category(SessionConfigOptionCategory::ThoughtLevel),
    );
    options
}

fn display_value(value: &str) -> String {
    let mut chars = value.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

pub(super) fn model_params_match_except(
    left: &[crate::domain::model::ModelParam],
    right: &[crate::domain::model::ModelParam],
    excluded_id: &str,
) -> bool {
    let left = left
        .iter()
        .filter(|param| param.id != excluded_id)
        .collect::<Vec<_>>();
    let right = right
        .iter()
        .filter(|param| param.id != excluded_id)
        .collect::<Vec<_>>();
    left.len() == right.len() && left.iter().all(|param| right.contains(param))
}

#[cfg(test)]
mod test;
