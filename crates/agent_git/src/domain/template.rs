//! The workspace every new repo starts from.

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

/// One file of the template.
#[derive(Debug, Clone, Copy)]
pub struct TemplateFile {
    /// Path inside the repo.
    pub path: &'static str,
    /// File contents.
    pub contents: &'static str,
    /// Whether git records it as executable (`bin/agent`).
    pub executable: bool,
}

/// The files of a new repo's initial commit.
#[derive(Debug, Clone, Copy)]
pub struct WorkspaceTemplate {
    /// The files.
    pub files: &'static [TemplateFile],
}

/// The starter agent, embedded from `packages/starter-agent/`.
pub const WORKSPACE_TEMPLATE: WorkspaceTemplate = WorkspaceTemplate {
    files: include!(concat!(env!("OUT_DIR"), "/workspace_template.rs")),
};

/// Who the agent is, written into its settings and identity when the repo is
/// created.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaSeed {
    /// Creating admin's Macro user ID: the agent's owner, the only account
    /// that gives it orders.
    #[serde(default)]
    pub creator_id: Option<MacroUserIdStr<'static>>,
    /// Display name.
    pub name: String,
    /// What the agent is responsible for.
    pub job_description: String,
    /// How the agent behaves and talks.
    pub personality: String,
}

/// One file of a new repo's initial commit, rendered for one agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedFile {
    /// Path inside the repo.
    pub path: &'static str,
    /// File contents.
    pub contents: String,
    /// Whether git records it as executable.
    pub executable: bool,
}

/// Why a template could not be rendered for an agent.
#[derive(Debug, thiserror::Error)]
pub enum RenderError {
    /// The seed names no owner, and an agent without one obeys nobody.
    #[error("the persona seed has no creator to own the agent")]
    MissingCreator,
    /// The template has no settings example to render `agent.json` from.
    #[error("the template has no {SETTINGS_EXAMPLE_PATH}")]
    MissingSettingsExample,
    /// The settings example is not a JSON object.
    #[error("the template's settings example is invalid: {0}")]
    InvalidSettingsExample(#[from] serde_json::Error),
}

/// The example settings the template ships; rendered into `agent.json`.
const SETTINGS_EXAMPLE_PATH: &str = "agent.example.json";
/// The agent's settings: who it is in Macro, its owner, its git identity.
const SETTINGS_PATH: &str = "agent.json";
/// Who the agent is, in its committed memory (`behavior/capabilities/identity`).
const IDENTITY_PATH: &str = "state/memory/identity/identity.md";
/// The zone wall-clock times mean until the agent learns its owner's.
const DEFAULT_TIME_ZONE: &str = "UTC";

impl WorkspaceTemplate {
    /// The template's files for one agent: its settings in `agent.json` and,
    /// when the invite described it, its identity. An invite with no job and
    /// no personality leaves the identity empty, so the agent asks its owner.
    pub fn render(
        &self,
        agent: &MacroUserIdStr<'_>,
        seed: &PersonaSeed,
    ) -> Result<Vec<RenderedFile>, RenderError> {
        let owner = seed.creator_id.as_ref().ok_or(RenderError::MissingCreator)?;
        let example = self
            .files
            .iter()
            .find(|file| file.path == SETTINGS_EXAMPLE_PATH)
            .ok_or(RenderError::MissingSettingsExample)?;
        let mut settings: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(example.contents)?;
        settings.insert("owner".into(), owner.as_ref().into());
        settings.insert("me".into(), agent.as_ref().into());
        settings.insert("name".into(), seed.name.clone().into());
        settings.insert("email".into(), agent.email_str().into());
        settings.insert("timeZone".into(), DEFAULT_TIME_ZONE.into());

        let mut files: Vec<RenderedFile> = self
            .files
            .iter()
            .filter(|file| file.path != SETTINGS_EXAMPLE_PATH)
            .map(|file| RenderedFile {
                path: file.path,
                contents: file.contents.to_owned(),
                executable: file.executable,
            })
            .collect();
        files.push(RenderedFile {
            path: SETTINGS_PATH,
            contents: format!("{}\n", serde_json::to_string_pretty(&settings)?),
            executable: false,
        });
        if let Some(identity) = identity(seed) {
            files.push(RenderedFile {
                path: IDENTITY_PATH,
                contents: identity,
                executable: false,
            });
        }
        Ok(files)
    }
}

/// The identity the invite gave, in the agent's own voice, or none when the
/// invite only named it.
fn identity(seed: &PersonaSeed) -> Option<String> {
    let job = seed.job_description.trim();
    let personality = seed.personality.trim();
    if job.is_empty() && personality.is_empty() {
        return None;
    }
    let mut text = format!("# {}\n\nMy owner described me when they invited me.\n", seed.name.trim());
    if !job.is_empty() {
        text.push_str(&format!("\n## What I do\n\n{job}\n"));
    }
    if !personality.is_empty() {
        text.push_str(&format!("\n## How I work and talk\n\n{personality}\n"));
    }
    Some(text)
}

#[cfg(test)]
mod test;
