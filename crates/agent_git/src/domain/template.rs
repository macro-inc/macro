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

/// The template shipped with this crate (`template/`). The brain owns the
/// rest of the layout and adds it on its first turn.
pub const WORKSPACE_TEMPLATE: WorkspaceTemplate = WorkspaceTemplate {
    files: &[
        TemplateFile {
            path: "OPERATING.md",
            contents: include_str!("../../template/OPERATING.md"),
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
}

/// One file of a new repo's initial commit, rendered for one agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedFile {
    /// Path inside the repo.
    pub path: &'static str,
    /// File contents.
    pub contents: String,
}

/// The charter every persona section is appended to.
const CHARTER_PATH: &str = "OPERATING.md";

impl WorkspaceTemplate {
    /// The template's files with the persona appended to the charter.
    pub fn render(&self, seed: &PersonaSeed) -> Vec<RenderedFile> {
        self.files
            .iter()
            .map(|file| {
                let contents = if file.path == CHARTER_PATH {
                    format!(
                        "{}\n## Who you are\n\nYou are {}.\n\n### Your job\n\n{}\n\n### Your personality\n\n{}\n",
                        file.contents, seed.name, seed.job_description, seed.personality
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
