use chrono::{DateTime, Utc};
use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{CalendarEventFilters, ast::ExpandErr};

/// Literal values supported by calendar-event Soup filters.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum CalendarEventLiteral {
    /// Match a canonical event id.
    #[serde(rename = "id")]
    Id(Uuid),
    /// Match a canonical event status.
    #[serde(rename = "s")]
    Status(String),
    /// Match events whose master start is before this instant.
    #[serde(rename = "sb")]
    StartsBefore(DateTime<Utc>),
    /// Match events whose master end is after this instant.
    #[serde(rename = "ea")]
    EndsAfter(DateTime<Utc>),
    /// Match an attendee email.
    #[serde(rename = "a")]
    Attendee(String),
    /// Match an organizer email.
    #[serde(rename = "o")]
    Organizer(String),
}

impl ExpandFrame<CalendarEventLiteral> for CalendarEventFilters {
    type Err = ExpandErr;

    fn expand_ast(
        filters: CalendarEventFilters,
    ) -> Result<Option<Expr<CalendarEventLiteral>>, Self::Err> {
        let ids = filters
            .calendar_event_ids
            .iter()
            .map(|id| Uuid::parse_str(id))
            .try_expand(|id| id.map(CalendarEventLiteral::Id), Expr::or)?;
        let statuses = filters
            .statuses
            .into_iter()
            .map(|status| status.to_ascii_lowercase())
            .expand(CalendarEventLiteral::Status, Expr::or);
        let attendees = filters
            .attendees
            .into_iter()
            .map(|email| email.to_ascii_lowercase())
            .expand(CalendarEventLiteral::Attendee, Expr::or);
        let organizers = filters
            .organizers
            .into_iter()
            .map(|email| email.to_ascii_lowercase())
            .expand(CalendarEventLiteral::Organizer, Expr::or);

        Ok([
            ids,
            statuses,
            filters
                .starts_before
                .map(|value| Expr::val(CalendarEventLiteral::StartsBefore(value))),
            filters
                .ends_after
                .map(|value| Expr::val(CalendarEventLiteral::EndsAfter(value))),
            attendees,
            organizers,
        ]
        .into_iter()
        .fold_with(Expr::and))
    }
}
