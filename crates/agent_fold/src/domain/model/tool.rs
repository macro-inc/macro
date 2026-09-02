//! Tool calls: how far one got and what it did.

use std::path::PathBuf;

use serde::Serialize;
use specta::Type;

/// How far a tool call progressed.
///
/// [`ToolStatus::Pending`] and [`ToolStatus::Running`] are legitimate final
/// states, not errors: a live session's newest calls have not finished, and a
/// session that dies mid-call leaves one behind permanently.
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    PartialEq,
    Eq,
    strum::Display,
    strum::IntoStaticStr,
    Serialize,
    Type,
)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    /// Not started - either still streaming input or awaiting permission.
    #[default]
    Pending,
    /// Currently running.
    Running,
    /// Finished successfully.
    Completed,
    /// Finished unsuccessfully.
    Failed,
}

/// What a tool call actually did.
///
/// Discriminated by what a reader needs in order to render it, not by ACP's
/// [`ToolKind`](agent_client_protocol::ToolKind). A terminal wants command and
/// output; an edit wants a diff; a handful of others want the paths they
/// touched or whatever text they reported; everything else wants its raw
/// input shown as JSON. Every named [`ToolKind`](agent_client_protocol::ToolKind)
/// has a variant here, so the fold never falls back to [`Self::Other`] for a
/// kind ACP defines - only for `switch_mode` (nothing a reader would want
/// rendered) and a kind this fold does not yet know about.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ToolDetail {
    /// A shell command. ACP's `execute`.
    Terminal {
        /// The command line, when the harness reported one.
        command: Option<String>,
        /// Captured output, ANSI escapes intact. See [`AnsiText`].
        output: Option<AnsiText>,
        /// Process exit code, when the harness reported one.
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
    },
    /// One or more file modifications. ACP's `edit`.
    Edit {
        /// The diffs ACP reported for this call.
        diffs: Vec<FileDiff>,
    },
    /// A file read. ACP's `read`.
    Read {
        /// Paths this call touched.
        paths: Vec<PathBuf>,
    },
    /// One or more files removed. ACP's `delete`.
    Delete {
        /// Paths this call touched.
        paths: Vec<PathBuf>,
    },
    /// One or more files moved or renamed. ACP's `move`.
    ///
    /// Only the paths a reader can be sure of. ACP has no standard field for
    /// "from" versus "to" - a call's `locations` is just the set of paths it
    /// touched - so this does not guess at a direction.
    Move {
        /// Paths this call touched.
        paths: Vec<PathBuf>,
    },
    /// A search. ACP's `search`.
    Search {
        /// Paths this call touched.
        paths: Vec<PathBuf>,
        /// Text the call reported - e.g. matched lines - when any.
        output: Option<String>,
    },
    /// Retrieving external data. ACP's `fetch`.
    Fetch {
        /// Text the call reported, when any.
        output: Option<String>,
    },
    /// Explicit reasoning surfaced as its own tool call, as distinct from
    /// [`MessagePart::Thought`], which is reasoning streamed inline. ACP's
    /// `think`.
    Think {
        /// Text the call reported, when any.
        output: Option<String>,
    },
    /// Anything else: ACP's `switch_mode`, and any kind - including `other`
    /// itself, [`ToolKind`](agent_client_protocol::ToolKind)'s default for a
    /// call that names no kind at all - this fold has no special rendering
    /// for.
    Other {
        /// ACP's tool kind, as its wire string.
        #[serde(rename = "acpKind")]
        kind: String,
        /// Text the call reported, when any.
        output: Option<String>,
        /// The tool's input, when reported.
        #[specta(type = specta_typescript::Unknown)]
        input: Option<serde_json::Value>,
    },
}

/// A file modification a tool reported.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    /// The file that changed.
    pub path: PathBuf,
    /// Prior contents, absent when the file is new.
    pub old_text: Option<String>,
    /// New contents.
    pub new_text: String,
}

/// Terminal output with ANSI escape sequences left in place.
///
/// Stripping here would be lossy and irreversible, and the escapes carry real
/// information - the recordings are full of colorized `ls` and `grep` output.
/// Rendering decides whether to interpret, strip, or ignore them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(transparent)]
#[specta(transparent)]
pub struct AnsiText(pub String);

impl AnsiText {
    /// The raw text, escapes included.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
