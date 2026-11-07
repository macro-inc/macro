//! What opened an agent session.
//!
//! [`crate::TriggerContext`] is written for the agent: it carries content, and
//! it is absent when it could not be read. [`TriggerOrigin`] is the record of
//! the cause: references to users and entities only, known from the source
//! event alone, and stored on the session. Each variant holds exactly the
//! fields that path always has, so what happened and who did it cannot
//! disagree. It describes a session; it grants nothing.

use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// What opened a session.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "origin", rename_all = "snake_case")]
pub enum TriggerOrigin {
    /// A message mentioned the agent.
    Mentioned {
        /// Who posted it.
        by: Caller,
        /// The message.
        message_id: Uuid,
    },
    /// A person wrote in their private conversation with the agent.
    Conversation {
        /// Who wrote.
        by: MacroUserIdStr<'static>,
        /// The message.
        message_id: Uuid,
    },
    /// The agent was added to a task's assignees.
    TaskAssigned {
        /// Who assigned it.
        by: Caller,
        /// The task.
        task: String,
    },
    /// The task joined a project, and inherited the project's agents.
    ProjectInherited {
        /// Who added the task to the project.
        by: Caller,
        /// The task.
        task: String,
        /// The project.
        project: Uuid,
    },
    /// A person opened the session directly: from the composer, or by asking
    /// for work done in one (a routine draft).
    Requested {
        /// Who opened it.
        by: MacroUserIdStr<'static>,
    },
    /// A tool handed the agent work. The tool knows only whose authority it
    /// runs under, not which agent called it.
    Dispatched {
        /// The user whose authority the work runs under.
        on_behalf_of: MacroUserIdStr<'static>,
    },
    /// A routine fired. Its owner owns the session, so the owner is not repeated.
    Routine {
        /// The routine.
        routine: Uuid,
        /// What made it fire.
        firing: RoutineCause,
    },
    /// Not known: an unclaimed warm session, a producer that predates this
    /// record, or a kind this build does not know.
    #[default]
    #[serde(other)]
    Unknown,
}

impl TriggerOrigin {
    /// Whether nothing is known, which the wire omits.
    #[must_use]
    pub fn is_unknown(&self) -> bool {
        matches!(self, Self::Unknown)
    }
}

/// Who did something that opened a session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Caller {
    /// A person.
    Person {
        /// Who.
        user: MacroUserIdStr<'static>,
    },
    /// An agent, which always acts for a person on a path that opens a session.
    Agent(AgentActor),
}

/// An agent acting for a person.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct AgentActor {
    /// The agent.
    pub bot: BotId,
    /// The person it acts for.
    pub on_behalf_of: MacroUserIdStr<'static>,
    /// Where the agent's own work came from.
    pub lineage: Lineage,
}

/// Where an acting agent's work came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Lineage {
    /// The session the agent acted from, and so where the chain started.
    Session {
        /// The acting session.
        session: Uuid,
        /// The first non-agent cause of its work.
        root: Root,
    },
    /// An agent acted, but its session was not captured.
    Unattributed,
}

/// The first non-agent cause. An agent cannot be one, so a chain always ends
/// at a person or a routine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Root {
    /// A person.
    Person {
        /// Who.
        user: MacroUserIdStr<'static>,
    },
    /// A routine.
    Routine {
        /// The routine.
        routine: Uuid,
    },
}

/// What made a routine fire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RoutineCause {
    /// One of its schedules came due.
    Scheduled,
    /// Its owner started it by hand.
    Manual,
    /// An event it watches happened.
    Event {
        /// The event.
        event_id: Uuid,
    },
}
