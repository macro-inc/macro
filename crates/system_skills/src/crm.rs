//! Agent-only skill: the deal vocabulary users speak and how it maps to CRM
//! pipelines. How to call the pipeline tools is in their descriptions.

use crate::{SystemSkill, Visibility};

/// The CRM skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "crm",
    name: "CRM",
    description: "Use when working with CRM deals, pipelines, stages, companies or contacts; not generic databases, and not a search that merely names a company.",
    visibility: Visibility::AgentOnly,
    tools: &[
        "AddToPipeline",
        "CreateCompany",
        "CreateContact",
        "CreatePipeline",
        "EditPipeline",
        "ExportPipelineCsv",
        "FindPipelineEntries",
        "GetCompany",
        "ImportCompaniesCsv",
        "ImportPipelineCsv",
        "ListCompanies",
        "ListPipelines",
        "RemoveFromPipeline",
        "UpdatePipelineEntries",
    ],
    sdk_entities: &["crm"],
    instructions: include_str!("crm.md"),
};
