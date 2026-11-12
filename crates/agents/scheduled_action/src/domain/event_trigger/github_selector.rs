//! Which deliveries from Macro's GitHub App a routine watches.

use github::domain::models::GithubWebhookReceived;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[cfg(test)]
mod test;

pub const MAX_GITHUB_NAMES: usize = 32;
pub const MAX_GITHUB_REPOSITORIES: usize = 100;
const MAX_NAME_CHARS: usize = 64;
const MAX_FULL_NAME_CHARS: usize = 200;

/// Narrows a GitHub event filter. Lists left empty match everything; the
/// lists combine with AND.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "GithubSelectorInput", into = "GithubSelectorInput")]
pub struct GithubSelector {
    events: Vec<String>,
    actions: Vec<String>,
    repositories: Vec<String>,
    include_bots: bool,
}

/// Which GitHub deliveries match.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = GithubSelector)]
pub struct GithubSelectorInput {
    /// GitHub event names, such as `workflow_run` or `pull_request`; any when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<String>,
    /// Payload actions, such as `completed` or `opened`; any when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<String>,
    /// Repositories as `owner/name`, matched without regard to case; every
    /// repository the owner's installations cover when empty. A renamed
    /// repository stops matching until it is chosen again.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repositories: Vec<String>,
    /// Also run for deliveries caused by bots and apps, including Macro's own.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub include_bots: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum GithubSelectorError {
    #[error(
        "GitHub event and action names are 1 to 64 lowercase letters or underscores, at most 32 of each"
    )]
    Names,
    #[error("expected at most 100 repositories, each named owner/name")]
    Repositories,
}

/// `owner/name`, as GitHub names a repository.
fn valid_full_name(name: &str) -> bool {
    name.chars().count() <= MAX_FULL_NAME_CHARS
        && name.matches('/').count() == 1
        && !name.starts_with('/')
        && !name.ends_with('/')
        && !name.contains(char::is_whitespace)
}

/// GitHub's event and action names are snake_case words.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_CHARS
        && name.chars().all(|c| c.is_ascii_lowercase() || c == '_')
}

fn names(mut names: Vec<String>) -> Result<Vec<String>, GithubSelectorError> {
    if names.len() > MAX_GITHUB_NAMES || !names.iter().all(|name| valid_name(name)) {
        return Err(GithubSelectorError::Names);
    }
    names.sort_unstable();
    names.dedup();
    Ok(names)
}

impl TryFrom<GithubSelectorInput> for GithubSelector {
    type Error = GithubSelectorError;

    fn try_from(input: GithubSelectorInput) -> Result<Self, Self::Error> {
        if input.repositories.len() > MAX_GITHUB_REPOSITORIES
            || !input.repositories.iter().all(|name| valid_full_name(name))
        {
            return Err(GithubSelectorError::Repositories);
        }
        let mut repositories: Vec<String> = input
            .repositories
            .iter()
            .map(|name| name.to_lowercase())
            .collect();
        repositories.sort_unstable();
        repositories.dedup();
        Ok(Self {
            events: names(input.events)?,
            actions: names(input.actions)?,
            repositories,
            include_bots: input.include_bots,
        })
    }
}

impl From<GithubSelector> for GithubSelectorInput {
    fn from(selector: GithubSelector) -> Self {
        Self {
            events: selector.events,
            actions: selector.actions,
            repositories: selector.repositories,
            include_bots: selector.include_bots,
        }
    }
}

impl GithubSelector {
    pub fn events(&self) -> &[String] {
        &self.events
    }

    pub fn actions(&self) -> &[String] {
        &self.actions
    }

    /// Lowercased `owner/name`s.
    pub fn repositories(&self) -> &[String] {
        &self.repositories
    }

    pub fn include_bots(&self) -> bool {
        self.include_bots
    }

    /// Bots are left out unless asked for: a routine whose agent acts through
    /// Macro's App would otherwise trigger itself.
    pub fn accepts(&self, delivery: &GithubWebhookReceived) -> bool {
        (self.events.is_empty() || self.events.contains(&delivery.event))
            && (self.actions.is_empty()
                || delivery
                    .action
                    .as_ref()
                    .is_some_and(|action| self.actions.contains(action)))
            && (self.repositories.is_empty()
                || delivery.repository.as_ref().is_some_and(|repository| {
                    self.repositories
                        .contains(&repository.full_name.to_lowercase())
                }))
            && (self.include_bots || !delivery.sender.as_ref().is_some_and(|sender| sender.bot))
    }
}

/// Whether a delivery's event name can be stored and matched at all.
pub fn valid_event_name(name: &str) -> bool {
    valid_name(name)
}
