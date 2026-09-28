//! Provider-reported catalogs and validated, open-ended model identifiers.
use super::{
    model::{Error, Event, Result},
    ports::Cloud,
};

/// An open-ended model ID; default retains the original Macro persisted ID.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Model(String);
impl Default for Model {
    fn default() -> Self {
        Self("claude-default".into())
    }
}
impl Model {
    /// Validate shape, not membership: membership belongs to the session catalog.
    pub fn parse(value: &str) -> Result<Self> {
        if matches!(value, "default" | "claude-default") {
            return Ok(Self::default());
        }
        if value.is_empty()
            || value.len() > 128
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.:[]".contains(&b))
        {
            return Err(Error::ModelUnavailable);
        }
        Ok(Self(value.into()))
    }
    /// Stable Macro option ID.
    pub fn id(&self) -> &str {
        &self.0
    }
    /// Provider reset uses null, not the Macro-specific default ID.
    pub fn provider_value(&self) -> Option<&str> {
        (self != &Self::default()).then_some(self.id())
    }
}

/// One choice reported by the account catalog or cloud worker.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelOption {
    /// Provider model ID, normalized only for default.
    pub model: Model,
    /// Provider display name.
    pub name: String,
    /// Provider description, when present.
    pub description: Option<String>,
}

/// No catalog yet is distinct from a reported empty catalog.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Catalog {
    /// Bootstrap without claiming account-entitled models.
    #[default]
    Unknown,
    /// Ordered choices from the account catalog or successful initialization.
    Reported(Vec<ModelOption>),
}
impl Catalog {
    /// Invalid events cannot replace the last usable catalog.
    pub fn from_event(event: &Event) -> Option<Self> {
        if event.kind != "client_event" {
            return None;
        }
        let payload = &event.data["payload"];
        let response = &payload["response"];
        if payload["type"] != "control_response" || response["subtype"] != "success" {
            return None;
        }
        let models = response["response"]["models"].as_array()?;
        if models.len() > 256 {
            return None;
        }
        let mut seen = std::collections::BTreeSet::new();
        let mut options = Vec::new();
        for value in models {
            let model = Model::parse(value["value"].as_str()?).ok()?;
            let name = value["displayName"].as_str()?;
            if name.trim().is_empty() || name.len() > 512 || !seen.insert(model.id().to_owned()) {
                return None;
            }
            let description = match value.get("description") {
                None | Some(serde_json::Value::Null) => None,
                Some(value) => Some(value.as_str().filter(|s| s.len() <= 4096)?.to_owned()),
            };
            options.push(ModelOption {
                model,
                name: name.into(),
                description,
            });
        }
        Some(Self::Reported(options))
    }
    /// Use the newest valid catalog in ordered durable history.
    pub fn from_history(events: &[Event]) -> Self {
        events
            .iter()
            .rev()
            .find_map(Self::from_event)
            .unwrap_or_default()
    }
    /// Bootstrap offers only the provider's reset behavior.
    pub fn options(&self) -> Vec<ModelOption> {
        match self {
            Self::Reported(options) => options.clone(),
            Self::Unknown => vec![ModelOption {
                model: Model::default(), name: "Claude · subscription default".into(),
                description: Some("No Claude model catalog reported yet. Start a session with default; choices appear when Claude reports them.".into()),
            }],
        }
    }
    /// Add account choices, preserving this session catalog's labels
    /// and order for duplicate IDs. Unknown catalogs do not manufacture defaults.
    pub fn supplemented_by(self, other: Self) -> Self {
        match (self, other) {
            (Self::Unknown, catalog) | (catalog, Self::Unknown) => catalog,
            (Self::Reported(mut options), Self::Reported(other)) => {
                let mut seen: std::collections::BTreeSet<_> = options
                    .iter()
                    .map(|option| option.model.id().to_owned())
                    .collect();
                options.extend(
                    other
                        .into_iter()
                        .filter(|option| seen.insert(option.model.id().to_owned())),
                );
                Self::Reported(options)
            }
        }
    }

    /// Reject choices absent from the provider-reported choices.
    pub fn contains(&self, model: &Model) -> bool {
        self.options().iter().any(|option| &option.model == model)
    }
}

/// Discover from the account catalog without reading transcripts or starting a
/// worker. The provider still validates the selected model when a turn runs.
pub async fn discover<C: Cloud>(cloud: &C) -> Result<Catalog> {
    let models = cloud.models().await?;
    let default = ModelOption {
        model: Model::default(),
        name: "Claude · subscription default".into(),
        description: Some("Let Claude choose the subscription's default model.".into()),
    };
    Ok(Catalog::Reported(vec![default]).supplemented_by(Catalog::Reported(models)))
}

#[cfg(test)]
mod test;
