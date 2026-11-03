//! Agent-only skill: acting in channels and direct messages, such as running
//! a poll. Reading and sending messages are eager tools that need no skill.

use crate::{SystemSkill, Visibility};

/// The channels skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "channels",
    name: "Channels",
    description: "Use when posting a poll, reacting, or creating, renaming or managing members of a channel or direct message; not reading or replying in a thread already in context.",
    visibility: Visibility::AgentOnly,
    tools: &[
        "CreateForm",
        "EditForm",
        "ReactToChannelMessage",
        "EditChannelMessage",
        "DeleteChannelMessage",
        "CreateChannel",
        "RenameChannel",
        "ManageChannelParticipants",
        "OpenDirectMessage",
    ],
    sdk_entities: &["channels", "forms"],
    instructions: include_str!("channels.md"),
};
