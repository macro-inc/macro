//! Shared projection of Cursor's model catalog into ACP session configuration.

use super::model::{CursorModel, ModelFamily};
use agent_client_protocol::schema::v1::{
    SessionConfigGroupId, SessionConfigId, SessionConfigKind, SessionConfigOption,
    SessionConfigSelect, SessionConfigSelectGroup, SessionConfigSelectOption,
    SessionConfigSelectOptions, SessionConfigValueId,
};

/// ACP config id used for model selection.
pub const MODEL_CONFIG_ID: &str = "model";

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
    vec![SessionConfigOption::new(
        SessionConfigId::new(MODEL_CONFIG_ID),
        "Model",
        SessionConfigKind::Select(SessionConfigSelect::new(
            SessionConfigValueId::new(current),
            options,
        )),
    )]
}
