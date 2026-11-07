//! Reminder filter inputs kept for clients built before reminders became email
//! snoozes (#7536). Those clients still send `reminderFilter`, and an unknown
//! input field fails the whole Soup query. Soup no longer returns reminders, so
//! the filter is accepted and ignored.

use serde::{Deserialize, Serialize};

use crate::ID;

/// The two operands of a recursive reminder filter expression. Ignored.
/// Remove after 2026-11-30.
#[cfg_attr(feature = "server", derive(async_graphql::InputObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphqlReminderBinaryExpr {
    /// Left expression.
    left: Box<GraphqlReminderExpr>,
    /// Right expression.
    right: Box<GraphqlReminderExpr>,
}

/// A recursive reminder filter expression. Ignored. Remove after 2026-11-30.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GraphqlReminderExpr {
    /// Both expressions must match.
    And(GraphqlReminderBinaryExpr),
    /// Either expression may match.
    Or(GraphqlReminderBinaryExpr),
    /// Negate an expression.
    Not(Box<GraphqlReminderExpr>),
    /// Match a literal.
    Literal(GraphqlReminderLiteral),
}

/// A reminder literal. Ignored. Remove after 2026-11-30.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GraphqlReminderLiteral {
    /// Opt the query into reminders.
    Include(bool),
    /// The reminder id.
    Id(ID),
    /// The referenced entity, as `"{type}:{id}"`.
    Entity(String),
    /// Whether the owner marked the reminder done.
    Completed(bool),
    /// Whether the reminder came due.
    Fired(bool),
}
