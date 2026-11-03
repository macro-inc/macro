//! Agent-only skill: how Macro databases work and the rules for changing them.
//! How to call the database tools is in their descriptions.

use crate::{SystemSkill, Visibility};

/// The databases skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "databases",
    name: "Databases",
    description: "Use when working with a Macro database or table: creating one, querying, counting or filtering its rows, adding rows, columns or views; not CRM pipelines or spreadsheets.",
    visibility: Visibility::AgentOnly,
    tools: &[
        "ListDatabases",
        "DescribeDatabase",
        "QueryDatabase",
        "SaveDatabaseQuery",
        "SaveDatabaseView",
        "DeleteDatabaseView",
    ],
    sdk_entities: &["databases"],
    instructions: include_str!("databases.md"),
};
