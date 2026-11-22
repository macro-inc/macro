//! `DescribeCodeTools` and `ReadCodeDocs` for turns taught the dialect
//! ([`CodeModeKind::Dialect`](crate::domain::CodeModeKind), in
//! [`toolset_with_js_tools`](super::toolset_with_js_tools)): hand-written guides to writing a JavaScript
//! tools program, served beside the TypeScript SDK documentation, never in
//! place of it. Operations and their signatures come from `search()` in a
//! program, which reads the same catalog the program runs against.

use super::{CodeModeToolContext, DescribeCodeTools, ReadCodeDocs, tool_error};
use crate::domain::CodeModeError;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// What a dialect program is, in one paragraph.
const OVERVIEW: &str = include_str!("dialect/overview.md");
/// How to find operations and read the guides.
const DISCOVERY: &str = include_str!("dialect/discovery.md");

/// A guide to writing dialect programs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DialectGuide {
    /// The language, operation calls, `search` and errors.
    Program,
    /// The result: data, reviews, images and views.
    Results,
    /// How the agent's permissions gate a program.
    Permissions,
    /// The optional TypeScript module, read with `get` and `call`.
    Module,
    /// Searching and browsing the workspace.
    Search,
    /// Worked examples.
    Examples,
}

impl DialectGuide {
    /// Every guide, in reading order.
    pub const ALL: [DialectGuide; 6] = [
        Self::Program,
        Self::Results,
        Self::Permissions,
        Self::Module,
        Self::Search,
        Self::Examples,
    ];

    /// The guide's text.
    pub fn markdown(self) -> &'static str {
        match self {
            Self::Program => include_str!("dialect/program.md"),
            Self::Results => include_str!("dialect/results.md"),
            Self::Permissions => include_str!("dialect/permissions.md"),
            Self::Module => include_str!("dialect/module.md"),
            Self::Search => include_str!("dialect/search.md"),
            Self::Examples => include_str!("dialect/examples.md"),
        }
    }
}

/// One requested guide.
#[derive(Serialize, JsonSchema)]
pub struct DialectGuidePage {
    /// The requested guide.
    pub guide: DialectGuide,
    /// Its text.
    pub markdown: String,
}

fn pages(guides: &[DialectGuide]) -> Result<Vec<DialectGuidePage>, CodeModeError> {
    if guides.len() > DialectGuide::ALL.len() {
        return Err(CodeModeError::Invalid(format!(
            "Request at most {} guides.",
            DialectGuide::ALL.len()
        )));
    }
    Ok(guides
        .iter()
        .map(|guide| DialectGuidePage {
            guide: *guide,
            markdown: guide.markdown().into(),
        })
        .collect())
}

/// How to write a dialect program and find its operations.
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "DescribeCodeTools",
    description = "How to write an ExecuteCode program: plain JavaScript that reaches Macro only through await tools.<service>.<operation>({path, query, body}). Returns an overview and how to find operations, which a program does with search(\"create task\"), plus the guides you name: program (the language and operation calls), results (data, reviews, images, views), permissions (ask and never), module (TypeScript computation read with get and call), search (searching the workspace) and examples. Never guess an operation, its inputs or its result's fields."
)]
pub struct DescribeDialect {
    /// Guides to return beside the overview.
    #[serde(default)]
    #[schemars(
        description = "Guides to return, e.g. [\"program\", \"results\"]; empty returns the overview alone."
    )]
    pub guides: Vec<DialectGuide>,
}

/// The overview, how to discover operations, and the requested guides.
#[derive(Serialize, JsonSchema)]
pub struct DialectDescription {
    /// What a program is.
    pub overview: String,
    /// How to find operations and read the guides.
    pub instructions: String,
    /// The requested guides; empty unless guides were named.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub guides: Vec<DialectGuidePage>,
}

impl DescribeDialect {
    fn describe(&self) -> Result<DialectDescription, CodeModeError> {
        Ok(DialectDescription {
            overview: OVERVIEW.into(),
            instructions: DISCOVERY.into(),
            guides: pages(&self.guides)?,
        })
    }
}

impl ToolAnnotated for DescribeDialect {
    const ANNOTATIONS: ToolAnnotations = DescribeCodeTools::ANNOTATIONS;
}

#[async_trait]
impl AsyncTool<CodeModeToolContext> for DescribeDialect {
    type Output = DialectDescription;

    async fn call(
        &self,
        _context: ServiceContext<CodeModeToolContext>,
        _request: RequestContext,
    ) -> ToolResult<Self::Output> {
        self.describe().map_err(tool_error)
    }
}

/// Read dialect guides by name.
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "ReadCodeDocs",
    description = "Read guides to writing ExecuteCode programs, by name, all you need in one call: program (the language, tools.<service>.<operation> calls and search), results (data, reviews, images, views), permissions (ask and never), module (TypeScript computation read with get and call), search (searching the workspace) and examples. For an operation's exact inputs and result, run a program that returns search(\"<service>.<operation>\")."
)]
pub struct ReadDialectDocs {
    /// Guides to read.
    #[schemars(description = "One or more guides, e.g. [\"program\", \"examples\"].")]
    pub guides: Vec<DialectGuide>,
}

/// The requested guides.
#[derive(Serialize, JsonSchema)]
pub struct DialectGuides {
    /// In request order.
    pub guides: Vec<DialectGuidePage>,
}

impl ReadDialectDocs {
    fn read(&self) -> Result<DialectGuides, CodeModeError> {
        if self.guides.is_empty() {
            return Err(CodeModeError::Invalid("Name at least one guide.".into()));
        }
        Ok(DialectGuides {
            guides: pages(&self.guides)?,
        })
    }
}

impl ToolAnnotated for ReadDialectDocs {
    const ANNOTATIONS: ToolAnnotations = ReadCodeDocs::ANNOTATIONS;
}

#[async_trait]
impl AsyncTool<CodeModeToolContext> for ReadDialectDocs {
    type Output = DialectGuides;

    async fn call(
        &self,
        _context: ServiceContext<CodeModeToolContext>,
        _request: RequestContext,
    ) -> ToolResult<Self::Output> {
        self.read().map_err(tool_error)
    }
}

#[cfg(test)]
mod test;
