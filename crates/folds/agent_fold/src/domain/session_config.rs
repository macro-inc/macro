//! Projection of ACP session configuration into the stable domain vocabulary
//! consumed by discovery and folded session metadata.

use agent_client_protocol::schema::v1::{
    SessionConfigKind as AcpConfigKind, SessionConfigOption as AcpConfigOption,
    SessionConfigSelectOption as AcpSelectOption, SessionConfigSelectOptions,
};
use serde::Serialize;
use specta::Type;

/// One session setting advertised by an ACP agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfigOption {
    /// Opaque id to return in `session/set_config_option`.
    pub id: String,
    /// Human-readable label supplied by the agent.
    pub name: String,
    /// Optional explanatory copy supplied by the agent.
    pub description: Option<String>,
    /// ACP semantic category, such as `model` or `thought_level`.
    pub category: Option<String>,
    /// Type-specific current value and choices.
    #[serde(flatten)]
    pub kind: SessionConfigKind,
}

/// The supported ACP session-config shapes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SessionConfigKind {
    /// A single-value selector.
    Select {
        /// The value currently selected by the agent.
        current_value: String,
        /// Choices in the order advertised by the agent.
        options: Vec<SessionConfigSelectOption>,
    },
    /// An on/off setting.
    Boolean {
        /// The value currently selected by the agent.
        current_value: bool,
    },
}

/// One value in an ACP select option.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfigSelectOption {
    /// Opaque value to return in `session/set_config_option`.
    pub value: String,
    /// Human-readable label supplied by the agent.
    pub name: String,
    /// Optional explanatory copy supplied by the agent.
    pub description: Option<String>,
    /// Optional group heading supplied by the agent.
    pub group: Option<String>,
}

/// Project every recognized ACP option without assigning provider semantics.
#[must_use]
pub fn session_config_options(options: &[AcpConfigOption]) -> Vec<SessionConfigOption> {
    options.iter().filter_map(project_option).collect()
}

fn project_option(option: &AcpConfigOption) -> Option<SessionConfigOption> {
    let kind = match &option.kind {
        AcpConfigKind::Select(select) => SessionConfigKind::Select {
            current_value: select.current_value.to_string(),
            options: match &select.options {
                SessionConfigSelectOptions::Ungrouped(options) => options
                    .iter()
                    .map(|option| project_select_option(option, None))
                    .collect(),
                SessionConfigSelectOptions::Grouped(groups) => groups
                    .iter()
                    .flat_map(|group| {
                        group
                            .options
                            .iter()
                            .map(|option| project_select_option(option, Some(group.name.as_str())))
                    })
                    .collect(),
                _ => return None,
            },
        },
        AcpConfigKind::Boolean(boolean) => SessionConfigKind::Boolean {
            current_value: boolean.current_value,
        },
        _ => return None,
    };
    Some(SessionConfigOption {
        id: option.id.to_string(),
        name: option.name.clone(),
        description: option.description.clone(),
        category: option
            .category
            .as_ref()
            .and_then(|category| serde_json::to_value(category).ok())
            .and_then(|value| value.as_str().map(str::to_owned)),
        kind,
    })
}

fn project_select_option(
    option: &AcpSelectOption,
    group: Option<&str>,
) -> SessionConfigSelectOption {
    SessionConfigSelectOption {
        value: option.value.to_string(),
        name: option.name.clone(),
        description: option.description.clone(),
        group: group.map(str::to_owned),
    }
}
