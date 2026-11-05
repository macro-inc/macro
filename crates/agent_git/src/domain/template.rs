//! The workspace every new repo starts from.

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
