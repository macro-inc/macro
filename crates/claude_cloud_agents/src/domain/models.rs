//! Provider-reported catalogs and validated, open-ended model identifiers.
use super::{
    model::{Error, Event, Result, SessionId},
    ports::Cloud,
};

/// Bound account discovery without reading every session transcript.
pub const RECENT_SESSION_LIMIT: usize = 50;
const CATALOG_SESSION_LIMIT: usize = 10;

/// Session metadata used to sample catalogs from different configured models.
#[derive(Clone, Debug)]
pub struct RecentSession {
    /// Provider conversation identity.
    pub id: SessionId,
    /// A sampling hint, never sufficient evidence to offer a model by itself.
    pub model: Option<Model>,
}

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
    fn sampling_id(&self) -> &str {
        self.id()
            .split_once('[')
            .map_or(self.id(), |(base, _)| base)
    }

    /// Provider reset uses null, not the Macro-specific default ID.
    pub fn provider_value(&self) -> Option<&str> {
        (self != &Self::default()).then_some(self.id())
    }
}

/// One choice reported by the cloud worker.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelOption {
    /// Provider model ID, normalized only for default.
    pub model: Model,
    /// Provider display name.
    pub name: String,
    /// Provider description, when present.
    pub description: Option<String>,
    /// Canonical provider ID, used only to avoid sampling equivalent aliases.
    pub resolved_model: Option<Model>,
}

/// No catalog yet is distinct from a reported empty catalog.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Catalog {
    /// Bootstrap without claiming account-entitled models.
    #[default]
    Unknown,
    /// Ordered choices from successful initialization responses.
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
                resolved_model: value["resolvedModel"]
                    .as_str()
                    .and_then(|value| Model::parse(value).ok()),
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
                resolved_model: None,
            }],
        }
    }
    /// Add choices reported by other sessions, preserving this catalog's labels
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

    /// Sampling may treat context variants as equivalent, but selection still
    /// requires an exact advertised option ID through `contains`.
    fn covers_sampling_hint(&self, model: Option<&Model>) -> bool {
        let Self::Reported(options) = self else {
            return false;
        };
        let Some(model) = model else {
            return true;
        };
        options.iter().any(|option| {
            option.model.sampling_id() == model.sampling_id()
                || option
                    .resolved_model
                    .as_ref()
                    .is_some_and(|resolved| resolved.sampling_id() == model.sampling_id())
        })
    }
}

/// Discover without creating sessions or inference. The source is account-scoped;
/// catalogs are never cached across owners. These are last-reported choices,
/// not a fresh entitlement guarantee.
pub async fn discover<C: Cloud>(cloud: &C) -> Result<Catalog> {
    discover_excluding(cloud, None).await
}

/// Keep a session's own live catalog separate from the account snapshot so a
/// later initialization can replace its old choices without resurrecting them.
pub(super) async fn discover_excluding<C: Cloud>(
    cloud: &C,
    exclude: Option<&SessionId>,
) -> Result<Catalog> {
    let mut catalog = Catalog::Unknown;
    let mut reads = 0;
    for session in cloud
        .recent_sessions()
        .await?
        .into_iter()
        .take(RECENT_SESSION_LIMIT)
    {
        if exclude.is_some_and(|id| id == &session.id)
            || catalog.covers_sampling_hint(session.model.as_ref())
        {
            continue;
        }
        if reads == CATALOG_SESSION_LIMIT {
            break;
        }
        // Keep looking when a session configured for Fable reports only Opus:
        // an older Fable session can still supply the missing advertised option.
        reads += 1;
        let history = match cloud.history(&session.id).await {
            Ok(history) => history,
            Err(Error::Http(404 | 410)) => continue,
            Err(error) => return Err(error),
        };
        catalog = catalog.supplemented_by(Catalog::from_history(&history));
    }
    Ok(catalog)
}

#[cfg(test)]
mod test;
