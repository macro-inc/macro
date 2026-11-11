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
}

/// The files of a new repo's initial commit.
#[derive(Debug, Clone, Copy)]
pub struct WorkspaceTemplate {
    /// The files.
    pub files: &'static [TemplateFile],
}

/// The canonical brain workspace, embedded from `packages/brain/template/`.
pub const WORKSPACE_TEMPLATE: WorkspaceTemplate = WorkspaceTemplate {
    files: include!(concat!(env!("OUT_DIR"), "/workspace_template.rs")),
};

/// Who the agent is, written into its charter when the repo is created.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaSeed {
    /// Creating admin's Macro user ID; the charter names the team owner
    /// when it is absent.
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
}

/// The charter containing the persona placeholders.
const CHARTER_PATH: &str = "OPERATING.md";

impl WorkspaceTemplate {
    /// The template's files with the persona substituted into the charter.
    pub fn render(&self, seed: &PersonaSeed) -> Result<Vec<RenderedFile>, serde_json::Error> {
        self.files
            .iter()
            .map(|file| {
                let contents = if file.path == CHARTER_PATH {
                    file.contents
                        .replace("{{name}}", &seed.name)
                        .replace("{{job_description}}", &seed.job_description)
                        .replace("{{personality}}", &seed.personality)
                        .replace(
                            "{{creator}}",
                            seed.creator_id
                                .as_ref()
                                .map(|creator| creator.as_ref())
                                .unwrap_or("the team owner"),
                        )
                } else if file.path == "config/jev.json" {
                    let mut config = serde_json::from_str(file.contents)?;
                    render_jev(&mut config, seed);
                    format!("{}\n", serde_json::to_string_pretty(&config)?)
                } else {
                    file.contents.to_string()
                };

                Ok(RenderedFile {
                    path: file.path,
                    contents,
                })
            })
            .collect()
    }
}

// Match the brain and relevance endpoint's 500 UTF-16-unit question limit.
// Bound substitutions, preserving the question around the persona context.
fn render_jev(config: &mut serde_json::Value, seed: &PersonaSeed) {
    match config {
        serde_json::Value::String(question) => {
            let fixed = question
                .replace("{{name}}", "")
                .replace("{{job_description}}", "");
            let room = 500_usize.saturating_sub(fixed.encode_utf16().count());
            let name_limit = room / question.matches("{{name}}").count().max(1);
            let named = question.replace("{{name}}", &truncate_utf16(&seed.name, name_limit));
            let job_count = named.matches("{{job_description}}").count();
            let fixed = named.replace("{{job_description}}", "");
            let job_limit =
                500_usize.saturating_sub(fixed.encode_utf16().count()) / job_count.max(1);
            *question = named.replace(
                "{{job_description}}",
                &truncate_utf16(&seed.job_description, job_limit),
            );
        }
        serde_json::Value::Array(values) => {
            for value in values {
                render_jev(value, seed);
            }
        }
        serde_json::Value::Object(values) => {
            for value in values.values_mut() {
                render_jev(value, seed);
            }
        }
        _ => {}
    }
}

fn truncate_utf16(value: &str, limit: usize) -> String {
    let mut used = 0;
    value
        .chars()
        .take_while(|character| {
            used += character.len_utf16();
            used <= limit
        })
        .collect()
}

#[cfg(test)]
mod test;
