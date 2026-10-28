//! How agents work with CRM pipelines: the deal vocabulary users speak and
//! the pipeline tools that carry it out.

use crate::types::StaticPrompt;

/// Instructions for the CRM pipeline tools.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(
    "CRM pipelines",
    include_str!("crm_pipelines.md"),
    "Map deal, stage and pipeline requests to pipeline entries, find them by name, change them by field name and stage label, verify the saved values, and keep pipeline stages apart from a company's own properties.",
);

#[cfg(test)]
mod test;
