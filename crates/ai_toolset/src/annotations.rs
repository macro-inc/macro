//! MCP-facing metadata describing what a tool is called and what it does to
//! the user's workspace.
//!
//! Every tool added to a toolset must declare these via [`ToolAnnotated`].
//! The trait has no blanket implementation and the const has no default, so a
//! tool that omits them fails to compile at the point it is added — an
//! unannotated tool cannot reach an MCP client.
//!
//! These are deliberately protocol-agnostic. The MCP transport maps
//! [`ToolKind`] onto the wire-level `readOnlyHint` / `destructiveHint` pair;
//! the AI provider codepaths ignore annotations entirely.

/// How a tool affects the user's workspace.
///
/// This models the MCP `readOnlyHint` / `destructiveHint` pair as a single
/// choice, because only three of their four combinations are meaningful:
/// a tool cannot be both read-only and destructive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolKind {
    /// The tool does not modify anything. Clients may run it without asking
    /// the user for per-call confirmation.
    ReadOnly,
    /// The tool creates or adds, but never overwrites or removes existing
    /// data.
    Additive,
    /// The tool overwrites or removes existing data. Clients always prompt
    /// before running it.
    Destructive,
}

impl ToolKind {
    /// The MCP `readOnlyHint` value for this kind.
    pub const fn read_only_hint(self) -> bool {
        matches!(self, Self::ReadOnly)
    }

    /// The MCP `destructiveHint` value for this kind.
    ///
    /// Only meaningful when [`Self::read_only_hint`] is `false`.
    pub const fn destructive_hint(self) -> bool {
        matches!(self, Self::Destructive)
    }
}

/// MCP-facing metadata for a single tool.
///
/// Build these with [`ToolAnnotations::read_only`],
/// [`ToolAnnotations::additive`], or [`ToolAnnotations::destructive`], then
/// adjust the optional hints with the `with_*` methods where the default is
/// wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolAnnotations {
    /// Human-readable display name shown to the user, distinct from the
    /// tool's machine name.
    ///
    /// The machine name (`SendChannelMessage`) comes from the schemars
    /// `title`; this is the name a person reads in a permission prompt
    /// (`Send channel message`).
    pub title: &'static str,
    /// What the tool does to the workspace.
    pub kind: ToolKind,
    /// Whether the tool reaches systems outside Macro. Maps to the MCP
    /// `openWorldHint`.
    pub open_world: bool,
    /// Whether repeating the call with the same arguments has no further
    /// effect. Maps to the MCP `idempotentHint`.
    pub idempotent: bool,
}

impl ToolAnnotations {
    /// Annotates a tool that modifies nothing.
    ///
    /// Defaults to idempotent, since repeating a read changes nothing.
    pub const fn read_only(title: &'static str) -> Self {
        Self {
            title,
            kind: ToolKind::ReadOnly,
            open_world: false,
            idempotent: true,
        }
    }

    /// Annotates a tool that creates or adds without overwriting or removing.
    pub const fn additive(title: &'static str) -> Self {
        Self {
            title,
            kind: ToolKind::Additive,
            open_world: false,
            idempotent: false,
        }
    }

    /// Annotates a tool that overwrites or removes existing data.
    pub const fn destructive(title: &'static str) -> Self {
        Self {
            title,
            kind: ToolKind::Destructive,
            open_world: false,
            idempotent: false,
        }
    }

    /// Marks the tool as reaching systems outside Macro.
    pub const fn with_open_world(mut self) -> Self {
        self.open_world = true;
        self
    }

    /// Marks the tool as safe to repeat with the same arguments.
    pub const fn with_idempotent(mut self) -> Self {
        self.idempotent = true;
        self
    }

    /// Marks the tool as unsafe to repeat with the same arguments.
    pub const fn without_idempotent(mut self) -> Self {
        self.idempotent = false;
        self
    }
}

/// Declares a tool's MCP annotations.
///
/// Required by [`AsyncToolCollection::add_tool`] and
/// [`AsyncToolCollection::add_user_tool`]. There is no blanket implementation
/// and no default value, so adding a tool that has not declared its
/// annotations is a compile error.
///
/// [`AsyncToolCollection::add_tool`]: crate::AsyncToolCollection::add_tool
/// [`AsyncToolCollection::add_user_tool`]: crate::AsyncToolCollection::add_user_tool
///
/// # Example
///
/// ```
/// use ai_toolset::{ToolAnnotated, ToolAnnotations};
///
/// struct RenameDocument { id: String, name: String }
///
/// impl ToolAnnotated for RenameDocument {
///     const ANNOTATIONS: ToolAnnotations =
///         ToolAnnotations::destructive("Rename document");
/// }
/// ```
pub trait ToolAnnotated {
    /// This tool's display title and workspace effect.
    const ANNOTATIONS: ToolAnnotations;
}

#[cfg(test)]
mod test;
