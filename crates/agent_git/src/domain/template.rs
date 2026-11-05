//! The workspace every new repo starts from.

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
    files: &[
        TemplateFile {
            path: "OPERATING.md",
            contents: include_str!("../../../../packages/brain/template/OPERATING.md"),
        },
        TemplateFile {
            path: "brain.lock",
            contents: include_str!("../../../../packages/brain/template/brain.lock"),
        },
        TemplateFile {
            path: "config/budget.json",
            contents: include_str!("../../../../packages/brain/template/config/budget.json"),
        },
        TemplateFile {
            path: "config/events.json",
            contents: include_str!("../../../../packages/brain/template/config/events.json"),
        },
        TemplateFile {
            path: "config/jev.json",
            contents: include_str!("../../../../packages/brain/template/config/jev.json"),
        },
        TemplateFile {
            path: "memory/self.json",
            contents: include_str!("../../../../packages/brain/template/memory/self.json"),
        },
        TemplateFile {
            path: "prompts/respond.md",
            contents: include_str!("../../../../packages/brain/template/prompts/respond.md"),
        },
        TemplateFile {
            path: "prompts/heartbeat.md",
            contents: include_str!("../../../../packages/brain/template/prompts/heartbeat.md"),
        },
        TemplateFile {
            path: "prompts/work.md",
            contents: include_str!("../../../../packages/brain/template/prompts/work.md"),
        },
        TemplateFile {
            path: ".gitignore",
            contents: include_str!("../../template/gitignore"),
        },
    ],
};

/// Who the agent is, written into its charter when the repo is created.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaSeed {
    /// Display name.
    pub name: String,
    /// What the agent is responsible for.
    pub job_description: String,
    /// How the agent behaves and talks.
    pub personality: String,
    /// Creating admin's Macro user ID; older saved seeds may omit it.
    #[serde(default)]
    pub creator_id: Option<String>,
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
    pub fn render(&self, seed: &PersonaSeed) -> Vec<RenderedFile> {
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
                            seed.creator_id.as_deref().unwrap_or("the team owner"),
                        )
                } else {
                    file.contents.to_string()
                };

                RenderedFile {
                    path: file.path,
                    contents,
                }
            })
            .collect()
    }
}
