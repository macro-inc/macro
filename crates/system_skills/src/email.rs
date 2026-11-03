//! Agent-only skill: email inbox behavior, including how the email tools
//! handle multi-inbox setups. How each host confirms `SendEmail` is in the
//! host's prompt (`prompt::user_tools`).

use crate::{SystemSkill, Visibility};

/// The email skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "email",
    name: "Email",
    description: "Use when reading, searching, labelling, drafting or sending email, or working across several inboxes.",
    visibility: Visibility::AgentOnly,
    tools: &[
        "ListInboxes",
        "ListLabels",
        "UpdateThreadLabels",
        "SetSenderPolicy",
    ],
    sdk_entities: &["email"],
    instructions: include_str!("email.md"),
};
