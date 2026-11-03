//! The deal vocabulary users speak and how it maps to CRM pipelines. How to
//! call the pipeline tools is in their descriptions.

use crate::types::StaticPrompt;

/// Instructions for the CRM pipeline tools.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(
    "CRM pipelines",
    include_str!("crm_pipelines.md"),
    "Map deal, stage and pipeline requests to pipeline entries rather than databases, and keep pipeline stages apart from a company's own properties.",
);

#[cfg(test)]
mod test;
